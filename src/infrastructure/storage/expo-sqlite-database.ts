/**
 * `expo-sqlite` → `SqlDatabase` adapter (PHASE 13). Csak natívon töltődik be
 * (`default-storage.ts`; a web a `default-storage.web.ts`-t kapja, SQLite nélkül).
 *
 * A `withTransactionAsync` nem kizárólagos (más aszinkron lekérdezés közbeékelődhet), ezért a
 * tranzakciókat egy egyszerű sorral (mutex) sorosítjuk – kis adatmennyiségnél ez elég.
 */
import { openDatabaseAsync, type SQLiteDatabase } from 'expo-sqlite';

import type { SqlDatabase, SqlValue } from './sql-database';

export const APP_DATABASE_NAME = 'stock-etf-analyzer.db';

export function wrapExpoDatabase(db: SQLiteDatabase): SqlDatabase {
  let queue: Promise<unknown> = Promise.resolve();
  const params = (values: readonly SqlValue[] | undefined) => [...(values ?? [])];
  return {
    exec: (sql) => db.execAsync(sql),
    run: async (sql, values) => {
      const result = await db.runAsync(sql, params(values));
      return { changes: result.changes };
    },
    getFirst: <T>(sql: string, values?: readonly SqlValue[]) =>
      db.getFirstAsync<T>(sql, params(values)),
    getAll: <T>(sql: string, values?: readonly SqlValue[]) =>
      db.getAllAsync<T>(sql, params(values)),
    transaction: (task) => {
      const next = queue.then(() => db.withTransactionAsync(task));
      queue = next.catch(() => undefined);
      return next;
    },
  };
}

export async function openExpoDatabase(name: string = APP_DATABASE_NAME): Promise<SqlDatabase> {
  const db = await openDatabaseAsync(name);
  // WAL: gyorsabb írás, olvasás közben is; a foreign key-t nem használjuk.
  await db.execAsync('PRAGMA journal_mode = WAL;');
  return wrapExpoDatabase(db);
}
