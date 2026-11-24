/**
 * CSAK TESZTEKHEZ (jest `moduleNameMapper`): az `expo-sqlite` natív modul helyett a Node
 * beépített SQLite-ja. Mint az eszközön: azonos fájlnév → UGYANAZ az (itt memóriabeli) adatbázis,
 * így a route-tesztben az app „újraindítása” (új `createAppServices`) látja a korábban mentett
 * adatot. A `jest-setup.ts` minden teszt után üríti → a tesztek egymástól függetlenek.
 * Csak az alkalmazás által használt API-részt valósítja meg.
 */
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';

type Bind = SQLInputValue[];

export interface SQLiteDatabase {
  execAsync(source: string): Promise<void>;
  runAsync(source: string, params: Bind): Promise<{ changes: number; lastInsertRowId: number }>;
  getFirstAsync<T>(source: string, params: Bind): Promise<T | null>;
  getAllAsync<T>(source: string, params: Bind): Promise<T[]>;
  withTransactionAsync(task: () => Promise<void>): Promise<void>;
}

const databases = new Map<string, DatabaseSync>();

export function __resetSqlite(): void {
  for (const db of databases.values()) db.close();
  databases.clear();
}

export async function openDatabaseAsync(name: string): Promise<SQLiteDatabase> {
  const db = databases.get(name) ?? new DatabaseSync(':memory:');
  databases.set(name, db);
  return {
    execAsync: async (source) => {
      db.exec(source);
    },
    runAsync: async (source, params) => {
      const r = db.prepare(source).run(...params);
      return { changes: Number(r.changes), lastInsertRowId: Number(r.lastInsertRowid) };
    },
    getFirstAsync: async <T>(source: string, params: Bind) => {
      const row = db.prepare(source).get(...params);
      return row === undefined ? null : ({ ...row } as T);
    },
    getAllAsync: async <T>(source: string, params: Bind) =>
      db
        .prepare(source)
        .all(...params)
        .map((row) => ({ ...row }) as T),
    withTransactionAsync: async (task) => {
      db.exec('BEGIN');
      try {
        await task();
        db.exec('COMMIT');
      } catch (cause) {
        db.exec('ROLLBACK');
        throw cause;
      }
    },
  };
}
