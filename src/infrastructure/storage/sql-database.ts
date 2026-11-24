/**
 * Minimális SQL-interfész (PHASE 13, D-082) – az `expo-sqlite` `SQLiteDatabase` aszinkron API-jának
 * részhalmaza. A repository-k csak ezt ismerik, így:
 * - natívon az `expo-sqlite` adapter (`expo-sqlite-database.ts`) van mögötte;
 * - Jestben a Node beépített SQLite-ja (`src/testing/node-sqlite-database.ts`) – VALÓDI SQL-lel
 *   teszteljük a sémát, a migrációt és a lekérdezéseket, nem kézi hamisítvánnyal.
 */
export type SqlValue = string | number | null;

export interface SqlRunResult {
  readonly changes: number;
}

export interface SqlDatabase {
  /** Több utasítás paraméter nélkül (séma, PRAGMA). */
  exec(sql: string): Promise<void>;
  run(sql: string, params?: readonly SqlValue[]): Promise<SqlRunResult>;
  getFirst<T>(sql: string, params?: readonly SqlValue[]): Promise<T | null>;
  getAll<T>(sql: string, params?: readonly SqlValue[]): Promise<T[]>;
  /** Tranzakció: hiba esetén visszagörget (rollback), és a hibát továbbdobja. */
  transaction(task: () => Promise<void>): Promise<void>;
}
