/**
 * CSAK TESZTEKHEZ (PHASE 13): `SqlDatabase` a Node beépített SQLite-jával (`node:sqlite`).
 * Valódi SQL-motor → a séma, a migráció, a lekérdezések és a sérült sorok kezelése ugyanúgy
 * fut, mint az eszközön az `expo-sqlite`-tal (mindkettő SQLite 3).
 */
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';

import type { SqlDatabase, SqlValue } from '@/infrastructure/storage/sql-database';

export interface NodeSqliteDatabase extends SqlDatabase {
  /** Közvetlen hozzáférés a tesztnek (pl. rekord szándékos elrontása). */
  readonly raw: DatabaseSync;
  close(): void;
}

const bind = (values: readonly SqlValue[] | undefined): SQLInputValue[] => [...(values ?? [])];

export function createNodeSqliteDatabase(path = ':memory:'): NodeSqliteDatabase {
  const raw = new DatabaseSync(path);
  return {
    raw,
    close: () => raw.close(),
    exec: async (sql) => {
      raw.exec(sql);
    },
    run: async (sql, values) => {
      const result = raw.prepare(sql).run(...bind(values));
      return { changes: Number(result.changes) };
    },
    getFirst: async <T>(sql: string, values?: readonly SqlValue[]) => {
      const row = raw.prepare(sql).get(...bind(values));
      return row === undefined ? null : ({ ...row } as T);
    },
    getAll: async <T>(sql: string, values?: readonly SqlValue[]) =>
      raw
        .prepare(sql)
        .all(...bind(values))
        .map((row) => ({ ...row }) as T),
    transaction: async (task) => {
      raw.exec('BEGIN');
      try {
        await task();
        raw.exec('COMMIT');
      } catch (cause) {
        raw.exec('ROLLBACK');
        throw cause;
      }
    },
  };
}
