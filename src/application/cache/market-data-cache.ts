/**
 * Eszköz-cache a piaci adatokhoz (PHASE 13, D-082): `MarketDataGateway` és `FxGateway`
 * dekorátor + vezérlő (`CacheControl`). A use case-ek nem tudnak a cache-ről – ugyanazt a portot
 * kapják, csak a composition root teszi elé a cache-t.
 *
 * Olvasási szabály (kulcsonként):
 * 1. Van rekord, NINCS kézi frissítéssel jelölve, és a `freshUntil` előtt vagyunk
 *    → kiszolgálás a cache-ből (`cache_hit`), hálózati kérés NINCS (nincs lekérés renderenként).
 * 2. Ismerten offline vagyunk és van rekord → offline tartalék hálózat nélkül (nincs timeout-várás).
 * 3. Különben hálózat. Siker → a rekord felülírva (új `fetchedAt`), az eredmény megy tovább.
 * 4. Átmeneti hiba (hálózat, timeout, rate limit, 5xx, napi kvóta) és van rekord
 *    → offline tartalék (`offline_fallback`): az EREDETI `fetchedAt`-tal, legalább `STALE`
 *    frissességgel. Rekord nélkül a hiba megy tovább (kiegészítve: nincs offline adat).
 * 5. Végleges hiba (nem található, érvénytelen kérés, csomagkorlát) → a hiba megy tovább; a régi
 *    rekordot nem mutatjuk „helyette”.
 *
 * Egyidejű azonos kérések egy hálózati hívásra futnak össze (kvótakímélés).
 */
import {
  ok,
  toEpochMs,
  toIsoTimestamp,
  toUtcIsoDate,
  type AppError,
  type DataProvenance,
  type Freshness,
  type FxRateSet,
  type InstrumentProfile,
  type IsoTimestamp,
  type Result,
} from '@/domain';

import type {
  CacheStore,
  Clock,
  ConnectivityMonitor,
  FxGateway,
  MarketDataGateway,
} from '../ports';
import {
  dividendHistoryCodec,
  financialStatementsCodec,
  fxRateSetCodec,
  instrumentProfileCodec,
  priceSeriesCodec,
  quoteCodec,
  searchResultCodec,
  securityListingsCodec,
  type CacheCodec,
} from './cache-codecs';
import { cacheKeys } from './cache-keys';
import {
  CACHE_POLICIES,
  cacheValidity,
  type CacheDataKind,
  type CachePolicy,
} from './cache-policy';
import {
  CACHE_PAYLOAD_VERSION,
  type CachedDataEntry,
  type CacheRecord,
  type CacheServeMode,
  type CacheStats,
  type ConnectivityState,
  type DataStatus,
} from './types';

const FRESHNESS_RANK: Readonly<Record<Freshness, number>> = {
  FRESH: 0,
  UNKNOWN: 1,
  STALE: 2,
  EXPIRED: 3,
};

function worse(a: Freshness, b: Freshness): Freshness {
  return FRESHNESS_RANK[a] >= FRESHNESS_RANK[b] ? a : b;
}

/** A cache szerinti frissesség a lekérés életkorából. */
export function cacheFreshness(record: CacheRecord, now: Date): Freshness {
  const t = now.getTime();
  const fetched = toEpochMs(record.fetchedAt);
  if (!Number.isFinite(fetched) || fetched > t) return 'UNKNOWN';
  if (t < toEpochMs(record.freshUntil)) return 'FRESH';
  if (t < toEpochMs(record.staleUntil)) return 'STALE';
  return 'EXPIRED';
}

/**
 * Átmeneti hiba: érdemes a korábbi adatot (jelölve) megmutatni. A végleges hibák (NOT_FOUND,
 * VALIDATION, PLAN_LIMIT) azt jelentik, hogy a kérés maga nem teljesíthető – ott nincs tartalék.
 */
export function isTransientForCache(error: AppError): boolean {
  switch (error.kind) {
    case 'NETWORK':
    case 'TIMEOUT':
    case 'RATE_LIMITED':
      return true;
    case 'UPSTREAM':
      return error.failure !== 'NOT_IMPLEMENTED';
    case 'UNAVAILABLE':
      return error.reason === 'QUOTA_EXHAUSTED';
    default:
      return false;
  }
}

const NO_OFFLINE_DATA = 'Korábban letöltött (offline) adat sincs ehhez.';

function withNoOfflineHint(error: AppError): AppError {
  return { ...error, message: `${error.message} ${NO_OFFLINE_DATA}` };
}

interface PayloadMeta {
  readonly sourceId: string;
  readonly sourceName: string;
  readonly provenance: DataProvenance | null;
}

function metaFromProvenance(provenance: DataProvenance): PayloadMeta {
  return { sourceId: provenance.sourceId, sourceName: provenance.sourceName, provenance };
}

/** Egy kiszolgált érték provenance-ének jelölése (cache-mód + frissesség-plafon). */
function markProvenance(
  provenance: DataProvenance,
  mode: 'cache_hit' | 'offline_fallback',
  record: CacheRecord,
  now: Date,
): DataProvenance {
  let freshness = worse(provenance.freshness, cacheFreshness(record, now));
  if (mode === 'offline_fallback') freshness = worse(freshness, 'STALE');
  return { ...provenance, freshness, cache: { mode, storedAt: record.storedAt } };
}

interface ReadSpec<T> {
  readonly key: string;
  readonly listingId: string | null;
  readonly period: string | null;
  readonly codec: CacheCodec<T>;
  /** A rekord fajtája (a payloadból is függhet, pl. ETF-profil). */
  readonly kindOf: (value: T) => CacheDataKind;
  readonly meta: (value: T) => PayloadMeta | null;
  /** A provenance-jelölés alkalmazása a kiszolgált értékre. */
  readonly mark: (value: T, apply: (p: DataProvenance) => DataProvenance) => T;
  readonly fetch: () => Promise<Result<T, AppError>>;
}

export interface CacheControl {
  /** Kézi frissítés: a jegyzés rekordjai jelölve (a tartalék megmarad), a következő olvasás a hálózatot próbálja. */
  refreshListings(listingIds: readonly string[]): Promise<Result<number, AppError>>;
  /** Teljes invalidálás: minden cache-rekord törlése. */
  clearAll(): Promise<Result<number, AppError>>;
  /** Megőrzési időn túli rekordok törlése. */
  prune(): Promise<Result<number, AppError>>;
  /** Adatállapot a UI-nak („utoljára frissítve”, offline, elavult). */
  describe(listingIds: readonly string[]): Promise<Result<DataStatus, AppError>>;
  stats(): Promise<Result<CacheStats, AppError>>;
  /** Friss-e (TTL-en belül, nem jelölt) a jegyzés árfolyam-rekordja – a háttérfrissítő használja. */
  isQuoteFresh(listingId: string): Promise<boolean>;
  connectivity(): ConnectivityState;
}

export interface MarketDataCache {
  readonly marketData: MarketDataGateway;
  readonly fx: FxGateway;
  readonly control: CacheControl;
}

export interface MarketDataCacheDeps {
  readonly marketData: MarketDataGateway;
  readonly fx: FxGateway;
  readonly store: CacheStore;
  readonly clock: Clock;
  readonly connectivity?: ConnectivityMonitor;
  readonly policies?: Readonly<Record<CacheDataKind, CachePolicy>>;
  /** Tárolási hiba jelzése (pl. fejlesztői napló). A cache ettől még működik (hálózatról). */
  readonly onStorageError?: (error: AppError) => void;
}

export function createMarketDataCache(deps: MarketDataCacheDeps): MarketDataCache {
  const policies = deps.policies ?? CACHE_POLICIES;
  const inFlight = new Map<string, Promise<Result<unknown, AppError>>>();
  const lastServed = new Map<string, CacheServeMode>();
  const reportStorage = (error: AppError) => deps.onStorageError?.(error);
  const connectivity = (): ConnectivityState => deps.connectivity?.current() ?? 'unknown';

  async function readRecord(key: string): Promise<CacheRecord | null> {
    const stored = await deps.store.get(key);
    if (!stored.ok) {
      reportStorage(stored.error);
      return null;
    }
    const record = stored.value;
    if (record !== null && record.payloadVersion !== CACHE_PAYLOAD_VERSION) {
      await deps.store.delete(key);
      return null;
    }
    return record;
  }

  function buildRecord<T>(spec: ReadSpec<T>, value: T, now: Date): CacheRecord | null {
    const meta = spec.meta(value);
    if (meta === null) return null;
    const kind = spec.kindOf(value);
    const policy = policies[kind];
    // A lekérés ideje: a provenance `fetchedAt`-ja, ha hihető (nem jövőbeli), különben most.
    const reported = meta.provenance === null ? NaN : toEpochMs(meta.provenance.fetchedAt);
    const fetchedMs =
      Number.isFinite(reported) && reported <= now.getTime() ? reported : now.getTime();
    const validity = cacheValidity(policy, fetchedMs);
    const iso = (ms: number) => toIsoTimestamp(new Date(ms));
    return {
      key: spec.key,
      kind,
      listingId: spec.listingId,
      payload: spec.codec.encode(value),
      payloadVersion: CACHE_PAYLOAD_VERSION,
      sourceId: meta.sourceId,
      sourceName: meta.sourceName,
      provenanceKind: meta.provenance?.kind ?? 'reported',
      freshnessAtFetch: meta.provenance?.freshness ?? 'UNKNOWN',
      fetchedAt: iso(fetchedMs),
      asOf: meta.provenance?.asOf ?? null,
      period: spec.period,
      storedAt: toIsoTimestamp(now),
      freshUntil: iso(validity.freshUntilMs),
      staleUntil: iso(validity.staleUntilMs),
      retainUntil: iso(validity.retainUntilMs),
      invalidatedAt: null,
    };
  }

  function serve<T>(
    spec: ReadSpec<T>,
    record: CacheRecord,
    mode: 'cache_hit' | 'offline_fallback',
  ): T | null {
    const value = spec.codec.decode(record.payload);
    if (value === null) return null;
    const now = deps.clock.now();
    lastServed.set(spec.key, mode);
    return spec.mark(value, (p) => markProvenance(p, mode, record, now));
  }

  async function readThrough<T>(spec: ReadSpec<T>): Promise<Result<T, AppError>> {
    let record = await readRecord(spec.key);
    const now = deps.clock.now();

    if (
      record !== null &&
      record.invalidatedAt === null &&
      now.getTime() < toEpochMs(record.freshUntil)
    ) {
      const hit = serve(spec, record, 'cache_hit');
      if (hit !== null) return ok(hit);
      // Sérült/régi payload: törlés, és megyünk tovább a hálózatra.
      await deps.store.delete(spec.key);
      record = null;
    }

    if (record !== null && connectivity() === 'offline') {
      const fallback = serve(spec, record, 'offline_fallback');
      if (fallback !== null) return ok(fallback);
      await deps.store.delete(spec.key);
      record = null;
    }

    const pending = inFlight.get(spec.key) as Promise<Result<T, AppError>> | undefined;
    const request = pending ?? spec.fetch();
    if (pending === undefined) {
      inFlight.set(spec.key, request);
      void request.finally(() => inFlight.delete(spec.key));
    }
    const result = await request;

    if (result.ok) {
      if (pending === undefined) {
        const fresh = buildRecord(spec, result.value, deps.clock.now());
        if (fresh !== null) {
          const saved = await deps.store.put(fresh);
          if (!saved.ok) reportStorage(saved.error);
        }
        lastServed.set(spec.key, 'network');
      }
      return result;
    }

    if (!isTransientForCache(result.error)) return result;
    if (record !== null) {
      const fallback = serve(spec, record, 'offline_fallback');
      if (fallback !== null) return ok(fallback);
      await deps.store.delete(spec.key);
    }
    return { ok: false, error: withNoOfflineHint(result.error) };
  }

  /** A legtöbb payload egyetlen `provenance`-t hordoz a tetején. */
  function single<T extends { readonly provenance: DataProvenance }>(
    base: Omit<ReadSpec<T>, 'meta' | 'mark'>,
  ): Promise<Result<T, AppError>> {
    return readThrough<T>({
      ...base,
      meta: (value) => metaFromProvenance(value.provenance),
      mark: (value, apply) => ({ ...value, provenance: apply(value.provenance) }),
    });
  }

  const today = () => toUtcIsoDate(deps.clock.now());
  const fixed = (kind: CacheDataKind) => () => kind;

  const marketData: MarketDataGateway = {
    getQuote: (listingId) =>
      single({
        key: cacheKeys.quote(listingId),
        listingId,
        period: null,
        codec: quoteCodec,
        kindOf: fixed('quote'),
        fetch: () => deps.marketData.getQuote(listingId),
      }),
    getSecurityListings: (isin) =>
      single({
        key: cacheKeys.listings(isin),
        listingId: null,
        period: null,
        codec: securityListingsCodec,
        kindOf: fixed('security_listings'),
        fetch: () => deps.marketData.getSecurityListings(isin),
      }),
    getFinancialStatements: (listingId, frequency) =>
      single({
        key: cacheKeys.financials(listingId, frequency),
        listingId,
        period: frequency,
        codec: financialStatementsCodec,
        kindOf: fixed('financial_statements'),
        fetch: () => deps.marketData.getFinancialStatements(listingId, frequency),
      }),
    getPriceHistory: (request) =>
      single({
        key: cacheKeys.priceHistory(
          request.listingId,
          request.adjustment,
          request.from,
          request.to,
          today(),
        ),
        listingId: request.listingId,
        period: `${request.from}..${request.to}`,
        codec: priceSeriesCodec,
        kindOf: fixed('price_history'),
        fetch: () => deps.marketData.getPriceHistory(request),
      }),
    getInstrumentProfile: (listingId) =>
      single<InstrumentProfile>({
        key: cacheKeys.profile(listingId),
        listingId,
        period: null,
        codec: instrumentProfileCodec,
        kindOf: (profile) => (profile.kindHint === 'etf' ? 'etf_metadata' : 'instrument_profile'),
        fetch: () => deps.marketData.getInstrumentProfile(listingId),
      }),
    getDividends: (request) =>
      single({
        key: cacheKeys.dividends(request.listingId, request.from, request.to, today()),
        listingId: request.listingId,
        period: `${request.from}..${request.to}`,
        codec: dividendHistoryCodec,
        kindOf: fixed('dividends'),
        fetch: () => deps.marketData.getDividends(request),
      }),
    searchInstruments: (query) =>
      single({
        key: cacheKeys.search(query),
        listingId: null,
        period: null,
        codec: searchResultCodec,
        kindOf: fixed('search'),
        fetch: () => deps.marketData.searchInstruments(query),
      }),
  };

  const fx: FxGateway = {
    getReferenceRates: (request) =>
      readThrough<FxRateSet>({
        key: cacheKeys.fx(request.quotes, request.date),
        listingId: null,
        period: request.date ?? 'latest',
        codec: fxRateSetCodec,
        kindOf: fixed(request.date === null ? 'fx_latest' : 'fx_historical'),
        // Üres rátakészletet nem tárolunk (nincs mit offline mutatni).
        meta: (set) => {
          const first = set.rates[0];
          return first === undefined ? null : metaFromProvenance(first.provenance);
        },
        mark: (set, apply) => ({
          ...set,
          rates: set.rates.map((rate) => ({ ...rate, provenance: apply(rate.provenance) })),
        }),
        fetch: () => deps.fx.getReferenceRates(request),
      }),
  };

  function toEntry(record: CacheRecord, now: Date): CachedDataEntry {
    return {
      kind: record.kind,
      listingId: record.listingId,
      sourceName: record.sourceName,
      provenanceKind: record.provenanceKind,
      fetchedAt: record.fetchedAt,
      asOf: record.asOf,
      period: record.period,
      freshness: cacheFreshness(record, now),
      invalidated: record.invalidatedAt !== null,
      lastServed: lastServed.get(record.key) ?? null,
    };
  }

  function bounds(records: readonly CacheRecord[]): {
    oldest: IsoTimestamp | null;
    newest: IsoTimestamp | null;
  } {
    let oldest: CacheRecord | null = null;
    let newest: CacheRecord | null = null;
    for (const r of records) {
      if (oldest === null || toEpochMs(r.fetchedAt) < toEpochMs(oldest.fetchedAt)) oldest = r;
      if (newest === null || toEpochMs(r.fetchedAt) > toEpochMs(newest.fetchedAt)) newest = r;
    }
    return { oldest: oldest?.fetchedAt ?? null, newest: newest?.fetchedAt ?? null };
  }

  const control: CacheControl = {
    async refreshListings(listingIds) {
      if (listingIds.length === 0) return ok(0);
      return deps.store.markInvalidated(listingIds, toIsoTimestamp(deps.clock.now()));
    },
    async clearAll() {
      lastServed.clear();
      return deps.store.clear();
    },
    async prune() {
      return deps.store.prune(toIsoTimestamp(deps.clock.now()));
    },
    async describe(listingIds) {
      const listed = await deps.store.list({ listingIds });
      if (!listed.ok) return listed;
      const now = deps.clock.now();
      // Csak az ebben a futásban ténylegesen kiszolgált rekordok számítanak „felhasznált”-nak;
      // ha még semmit nem olvastunk (pl. friss indítás), az összes rekord a jegyzéshez.
      const served = listed.value.filter((r) => lastServed.has(r.key));
      const used = served.length > 0 ? served : listed.value;
      const entries = used.map((r) => toEntry(r, now));
      const { oldest, newest } = bounds(used);
      return ok({
        connectivity: connectivity(),
        entries,
        oldestFetchedAt: oldest,
        newestFetchedAt: newest,
        servedOffline: entries.some((e) => e.lastServed === 'offline_fallback'),
        hasStale: entries.some((e) => e.freshness !== 'FRESH'),
      });
    },
    async stats() {
      const listed = await deps.store.list();
      if (!listed.ok) return listed;
      const byKind: Partial<Record<CacheDataKind, number>> = {};
      for (const r of listed.value) byKind[r.kind] = (byKind[r.kind] ?? 0) + 1;
      return ok({
        entryCount: listed.value.length,
        oldestFetchedAt: bounds(listed.value).oldest,
        byKind,
      });
    },
    async isQuoteFresh(listingId) {
      const record = await readRecord(cacheKeys.quote(listingId));
      if (record === null || record.invalidatedAt !== null) return false;
      return deps.clock.now().getTime() < toEpochMs(record.freshUntil);
    },
    connectivity,
  };

  return { marketData, fx, control };
}
