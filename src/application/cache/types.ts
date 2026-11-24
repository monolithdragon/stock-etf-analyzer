/**
 * Eszköz-cache rekord és kapcsolódó típusok (PHASE 13, D-082).
 *
 * Minden rekord hordozza: lekérés ideje (`fetchedAt`), forrás, időszak, adatminőségi státusz
 * (provenance-fajta + frissesség a lekéréskor) és érvényesség (`freshUntil`, `staleUntil`,
 * `retainUntil`, `invalidatedAt`). A `payload` a contract-séma szerinti JSON – visszaolvasáskor
 * újra validáljuk (sérült/régi rekord → törlés, nem csendes hibás adat).
 */
import type { Freshness, IsoTimestamp, ProvenanceKind } from '@/domain';

import type { CacheDataKind } from './cache-policy';

/** A payload sémaverziója: ha a contract változik, a régi rekordok érvénytelenné válnak. */
export const CACHE_PAYLOAD_VERSION = 1;

export interface CacheRecord {
  /** Egyedi kulcs, pl. `quote:AAPL@XNAS` (lásd `cache-keys.ts`). */
  readonly key: string;
  readonly kind: CacheDataKind;
  /** A jegyzés, amelyhez tartozik (kézi frissítés és állapot-lekérdezés szűrője); FX/keresés: `null`. */
  readonly listingId: string | null;
  /** JSON-szerializálható érték (contract DTO alak). */
  readonly payload: unknown;
  readonly payloadVersion: number;
  readonly sourceId: string;
  readonly sourceName: string;
  /** Adatminőség: a forrás fajtája (jelentett, demó …). */
  readonly provenanceKind: ProvenanceKind;
  /** A forrás/use case által a lekéréskor adott frissesség. */
  readonly freshnessAtFetch: Freshness;
  /** Az EREDETI lekérés ideje – a cache soha nem írja felül újabbra kérés nélkül. */
  readonly fetchedAt: IsoTimestamp;
  /** Az adat tényleges időpontja (záróár napja, filing dátuma); `null`, ha a forrás nem közölte. */
  readonly asOf: string | null;
  /** Az időszak/kérés leírása, pl. `2025-11-24..2026-11-24` vagy `ANNUAL`. */
  readonly period: string | null;
  readonly storedAt: IsoTimestamp;
  readonly freshUntil: IsoTimestamp;
  readonly staleUntil: IsoTimestamp;
  readonly retainUntil: IsoTimestamp;
  /** Kézi frissítés jelölése: a következő olvasás előbb a hálózatot próbálja. */
  readonly invalidatedAt: IsoTimestamp | null;
}

/** Hogyan szolgáltuk ki legutóbb egy kulcsot (memóriában, csak az aktuális futásra). */
export type CacheServeMode = 'network' | 'cache_hit' | 'offline_fallback';

export type ConnectivityState = 'online' | 'offline' | 'unknown';

/** Egy cache-rekord összefoglalója a UI-nak (payload nélkül). */
export interface CachedDataEntry {
  readonly kind: CacheDataKind;
  readonly listingId: string | null;
  readonly sourceName: string;
  readonly provenanceKind: ProvenanceKind;
  readonly fetchedAt: IsoTimestamp;
  readonly asOf: string | null;
  readonly period: string | null;
  /** A cache szerinti frissesség MOST (a `fetchedAt` életkorából, a fajta szabályával). */
  readonly freshness: Freshness;
  readonly invalidated: boolean;
  /** A legutóbbi kiszolgálás módja ebben a futásban; `null`, ha még nem olvastuk. */
  readonly lastServed: CacheServeMode | null;
}

/**
 * Adatállapot egy vagy több jegyzéshez – ebből jelzi a UI az „utoljára frissítve” időpontot,
 * az offline módot és az elavultságot (ARCHITECTURE 12.).
 */
export interface DataStatus {
  readonly connectivity: ConnectivityState;
  readonly entries: readonly CachedDataEntry[];
  /** A legrégebbi felhasznált rekord lekérési ideje; `null`, ha nincs rekord. */
  readonly oldestFetchedAt: IsoTimestamp | null;
  readonly newestFetchedAt: IsoTimestamp | null;
  /** Legalább egy rekordot offline tartalékból szolgáltunk ki ebben a futásban. */
  readonly servedOffline: boolean;
  /** Legalább egy rekord nem friss (STALE/EXPIRED/UNKNOWN). */
  readonly hasStale: boolean;
}

export interface CacheStats {
  readonly entryCount: number;
  readonly oldestFetchedAt: IsoTimestamp | null;
  readonly byKind: Readonly<Partial<Record<CacheDataKind, number>>>;
}
