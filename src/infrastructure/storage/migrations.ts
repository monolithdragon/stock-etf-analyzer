/**
 * SQLite séma és migrációk (PHASE 13, D-082).
 *
 * Verzió: `PRAGMA user_version`. Minden migráció egy tranzakcióban fut a verzióemeléssel együtt
 * (vagy minden lefut, vagy semmi). Szabályok (migrációs terv, `docs/phases/phase-13-…`):
 * - meglévő migrációt SOHA nem módosítunk, csak újat fűzünk a lista végére;
 * - felhasználói adatot (portfólió, tranzakció, figyelőlista) migráció nem törölhet;
 * - a cache-tábla bármikor eldobható és újraépíthető (újra letölthető adat);
 * - ha az adatbázis ÚJABB verziójú, mint amit az app ismer (pl. régebbi app-verzió visszaállítása),
 *   nem írunk bele és nem törlünk: `STORAGE` hibát adunk (adatvesztés helyett).
 */
import type { SqlDatabase } from './sql-database';

export interface Migration {
  readonly version: number;
  readonly description: string;
  readonly up: (db: SqlDatabase) => Promise<void>;
}

export const MIGRATIONS: readonly Migration[] = [
  {
    version: 1,
    description: 'Portfólió, tranzakció, figyelőlista és piaci adat cache táblák.',
    up: async (db) => {
      await db.exec(`
        CREATE TABLE portfolios (
          id TEXT PRIMARY KEY NOT NULL,
          json TEXT NOT NULL,
          created_at TEXT NOT NULL
        );
        CREATE TABLE transactions (
          id TEXT PRIMARY KEY NOT NULL,
          portfolio_id TEXT NOT NULL,
          seq INTEGER NOT NULL,
          json TEXT NOT NULL
        );
        CREATE INDEX idx_transactions_portfolio ON transactions (portfolio_id, seq);
        CREATE TABLE watchlist (
          listing_id TEXT PRIMARY KEY NOT NULL,
          json TEXT NOT NULL,
          added_at TEXT NOT NULL,
          seq INTEGER NOT NULL
        );
        CREATE TABLE cache_entries (
          key TEXT PRIMARY KEY NOT NULL,
          kind TEXT NOT NULL,
          listing_id TEXT,
          payload TEXT NOT NULL,
          payload_version INTEGER NOT NULL,
          source_id TEXT NOT NULL,
          source_name TEXT NOT NULL,
          provenance_kind TEXT NOT NULL,
          freshness_at_fetch TEXT NOT NULL,
          fetched_at TEXT NOT NULL,
          as_of TEXT,
          period TEXT,
          stored_at TEXT NOT NULL,
          fresh_until TEXT NOT NULL,
          stale_until TEXT NOT NULL,
          retain_until TEXT NOT NULL,
          invalidated_at TEXT
        );
        CREATE INDEX idx_cache_listing ON cache_entries (listing_id);
        CREATE INDEX idx_cache_retain ON cache_entries (retain_until);
      `);
    },
  },
];

export const LATEST_SCHEMA_VERSION = MIGRATIONS.reduce((max, m) => Math.max(max, m.version), 0);

export type MigrationOutcome =
  | { readonly status: 'up_to_date'; readonly version: number }
  | { readonly status: 'migrated'; readonly from: number; readonly to: number }
  | { readonly status: 'newer_than_app'; readonly version: number; readonly appVersion: number };

export async function readSchemaVersion(db: SqlDatabase): Promise<number> {
  const row = await db.getFirst<{ user_version: number }>('PRAGMA user_version');
  return row?.user_version ?? 0;
}

/** A függőben lévő migrációk futtatása sorrendben. Hibánál a kivétel továbbmegy (a hívó kezeli). */
export async function runMigrations(
  db: SqlDatabase,
  migrations: readonly Migration[] = MIGRATIONS,
): Promise<MigrationOutcome> {
  const latest = migrations.reduce((max, m) => Math.max(max, m.version), 0);
  const current = await readSchemaVersion(db);
  if (current > latest) return { status: 'newer_than_app', version: current, appVersion: latest };
  const pending = [...migrations]
    .filter((m) => m.version > current)
    .sort((a, b) => a.version - b.version);
  if (pending.length === 0) return { status: 'up_to_date', version: current };
  for (const migration of pending) {
    await db.transaction(async () => {
      await migration.up(db);
      // A PRAGMA nem paraméterezhető; a verzió egész szám a saját listánkból (nem felhasználói input).
      await db.exec(`PRAGMA user_version = ${Math.trunc(migration.version)}`);
    });
  }
  return { status: 'migrated', from: current, to: latest };
}
