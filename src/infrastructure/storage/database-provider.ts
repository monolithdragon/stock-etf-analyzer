/**
 * Lusta adatbázis-nyitás + migráció (PHASE 13). A composition root szinkron marad: az adatbázis
 * az első tényleges tárolói hívásnál nyílik meg, egyszer. Sikertelen nyitás után a következő
 * hívás újrapróbálja (nem ragad be egy átmeneti hibára).
 */
import { AppErrors, err, ok, type AppError, type Result } from '@/domain';

import { runMigrations, type Migration, MIGRATIONS } from './migrations';
import type { SqlDatabase } from './sql-database';

export type DatabaseProvider = () => Promise<Result<SqlDatabase, AppError>>;

function describe(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

export function createDatabaseProvider(
  open: () => Promise<SqlDatabase>,
  migrations: readonly Migration[] = MIGRATIONS,
): DatabaseProvider {
  let pending: Promise<Result<SqlDatabase, AppError>> | null = null;

  async function openAndMigrate(): Promise<Result<SqlDatabase, AppError>> {
    try {
      const db = await open();
      const outcome = await runMigrations(db, migrations);
      if (outcome.status === 'newer_than_app') {
        return err(
          AppErrors.storage(
            `A helyi adatbázis újabb app-verzióból származik (séma ${outcome.version} > ${outcome.appVersion}). Adatvesztés elkerülése miatt nem nyitjuk meg – frissítsd az alkalmazást.`,
          ),
        );
      }
      return ok(db);
    } catch (cause) {
      return err(AppErrors.storage(`A helyi adatbázis nem nyitható meg: ${describe(cause)}`));
    }
  }

  return async () => {
    pending ??= openAndMigrate();
    const result = await pending;
    if (!result.ok) pending = null;
    return result;
  };
}

/**
 * Egy tárolói művelet futtatása: adatbázis + kivétel → `STORAGE` hiba (a hívó soha nem kap
 * kivételt tárolási problémáért).
 */
export async function withDatabase<T>(
  provider: DatabaseProvider,
  action: string,
  task: (db: SqlDatabase) => Promise<Result<T, AppError>>,
): Promise<Result<T, AppError>> {
  const db = await provider();
  if (!db.ok) return db;
  try {
    return await task(db.value);
  } catch (cause) {
    return err(AppErrors.storage(`Tárolási hiba (${action}): ${describe(cause)}`));
  }
}
