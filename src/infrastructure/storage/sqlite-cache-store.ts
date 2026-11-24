/**
 * SQLite cache-tároló (PHASE 13, D-082). Minden rekord oszlopokban hordozza a provenance-t és az
 * érvényességet (lekérdezhető payload-bontás nélkül); a payload JSON-szöveg.
 * Sérült sor (rossz JSON, ismeretlen fajta) → törlés + `ok(null)` (a cache újratölthető).
 */
import {
  CACHE_DATA_KINDS,
  type CacheDataKind,
  type CacheRecord,
  type CacheStore,
} from '@/application';
import {
  FRESHNESS_VALUES,
  ok,
  PROVENANCE_KINDS,
  type Freshness,
  type IsoTimestamp,
  type ProvenanceKind,
} from '@/domain';

import { withDatabase, type DatabaseProvider } from './database-provider';
import type { SqlValue } from './sql-database';

interface Row {
  readonly key: string;
  readonly kind: string;
  readonly listing_id: string | null;
  readonly payload: string;
  readonly payload_version: number;
  readonly source_id: string;
  readonly source_name: string;
  readonly provenance_kind: string;
  readonly freshness_at_fetch: string;
  readonly fetched_at: string;
  readonly as_of: string | null;
  readonly period: string | null;
  readonly stored_at: string;
  readonly fresh_until: string;
  readonly stale_until: string;
  readonly retain_until: string;
  readonly invalidated_at: string | null;
}

const isKind = (v: string): v is CacheDataKind =>
  (CACHE_DATA_KINDS as readonly string[]).includes(v);
const isProvenanceKind = (v: string): v is ProvenanceKind =>
  (PROVENANCE_KINDS as readonly string[]).includes(v);
const isFreshness = (v: string): v is Freshness =>
  (FRESHNESS_VALUES as readonly string[]).includes(v);
const isTimestamp = (v: string) => Number.isFinite(Date.parse(v));

/** Sor → rekord; `null`, ha bármely mező sérült. */
export function rowToRecord(row: Row): CacheRecord | null {
  if (
    !isKind(row.kind) ||
    !isProvenanceKind(row.provenance_kind) ||
    !isFreshness(row.freshness_at_fetch)
  ) {
    return null;
  }
  const times = [row.fetched_at, row.stored_at, row.fresh_until, row.stale_until, row.retain_until];
  if (!times.every(isTimestamp)) return null;
  if (row.invalidated_at !== null && !isTimestamp(row.invalidated_at)) return null;
  let payload: unknown;
  try {
    payload = JSON.parse(row.payload);
  } catch {
    return null;
  }
  const ts = (v: string) => v as IsoTimestamp;
  return {
    key: row.key,
    kind: row.kind,
    listingId: row.listing_id,
    payload,
    payloadVersion: row.payload_version,
    sourceId: row.source_id,
    sourceName: row.source_name,
    provenanceKind: row.provenance_kind,
    freshnessAtFetch: row.freshness_at_fetch,
    fetchedAt: ts(row.fetched_at),
    asOf: row.as_of,
    period: row.period,
    storedAt: ts(row.stored_at),
    freshUntil: ts(row.fresh_until),
    staleUntil: ts(row.stale_until),
    retainUntil: ts(row.retain_until),
    invalidatedAt: row.invalidated_at === null ? null : ts(row.invalidated_at),
  };
}

const COLUMNS =
  'key, kind, listing_id, payload, payload_version, source_id, source_name, provenance_kind, freshness_at_fetch, fetched_at, as_of, period, stored_at, fresh_until, stale_until, retain_until, invalidated_at';

/** Időbélyegek összehasonlítása: ISO-szöveg helyett epoch ms (eltérő tört másodperc-formátum ellen). */
const ms = (v: string) => Date.parse(v);

export function createSqliteCacheStore(provider: DatabaseProvider): CacheStore {
  async function decodeRows(
    rows: readonly Row[],
    remove: (key: string) => Promise<unknown>,
  ): Promise<CacheRecord[]> {
    const records: CacheRecord[] = [];
    for (const row of rows) {
      const record = rowToRecord(row);
      if (record === null) await remove(row.key);
      else records.push(record);
    }
    return records;
  }

  return {
    get: (key) =>
      withDatabase(provider, 'cache olvasása', async (db) => {
        const row = await db.getFirst<Row>(`SELECT ${COLUMNS} FROM cache_entries WHERE key = ?`, [
          key,
        ]);
        if (row === null) return ok(null);
        const record = rowToRecord(row);
        if (record === null) {
          await db.run('DELETE FROM cache_entries WHERE key = ?', [key]);
          return ok(null);
        }
        return ok(record);
      }),

    put: (record) =>
      withDatabase(provider, 'cache írása', async (db) => {
        const values: SqlValue[] = [
          record.key,
          record.kind,
          record.listingId,
          JSON.stringify(record.payload),
          record.payloadVersion,
          record.sourceId,
          record.sourceName,
          record.provenanceKind,
          record.freshnessAtFetch,
          record.fetchedAt,
          record.asOf,
          record.period,
          record.storedAt,
          record.freshUntil,
          record.staleUntil,
          record.retainUntil,
          record.invalidatedAt,
        ];
        await db.run(
          `INSERT OR REPLACE INTO cache_entries (${COLUMNS}) VALUES (${values.map(() => '?').join(', ')})`,
          values,
        );
        return ok(undefined);
      }),

    delete: (key) =>
      withDatabase(provider, 'cache törlése', async (db) => {
        await db.run('DELETE FROM cache_entries WHERE key = ?', [key]);
        return ok(undefined);
      }),

    list: (filter = {}) =>
      withDatabase(provider, 'cache listázása', async (db) => {
        const ids = filter.listingIds;
        const rows =
          ids === undefined
            ? await db.getAll<Row>(`SELECT ${COLUMNS} FROM cache_entries ORDER BY key`)
            : ids.length === 0
              ? []
              : await db.getAll<Row>(
                  `SELECT ${COLUMNS} FROM cache_entries WHERE listing_id IN (${ids.map(() => '?').join(', ')}) ORDER BY key`,
                  [...ids],
                );
        const records = await decodeRows(rows, (key) =>
          db.run('DELETE FROM cache_entries WHERE key = ?', [key]),
        );
        return ok(records);
      }),

    markInvalidated: (listingIds, at) =>
      withDatabase(provider, 'cache jelölése', async (db) => {
        if (listingIds.length === 0) return ok(0);
        const result = await db.run(
          `UPDATE cache_entries SET invalidated_at = ? WHERE listing_id IN (${listingIds.map(() => '?').join(', ')})`,
          [at, ...listingIds],
        );
        return ok(result.changes);
      }),

    clear: () =>
      withDatabase(provider, 'cache ürítése', async (db) => {
        const result = await db.run('DELETE FROM cache_entries');
        return ok(result.changes);
      }),

    prune: (now) =>
      withDatabase(provider, 'cache takarítása', async (db) => {
        const rows = await db.getAll<{ key: string; retain_until: string }>(
          'SELECT key, retain_until FROM cache_entries',
        );
        const expired = rows.filter((r) => !(ms(r.retain_until) >= ms(now)));
        for (const r of expired) await db.run('DELETE FROM cache_entries WHERE key = ?', [r.key]);
        return ok(expired.length);
      }),
  };
}
