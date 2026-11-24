/**
 * PHASE 13: eszköz-cache (createMarketDataCache) – TTL, kézi frissítés, offline tartalék,
 * provenance-megőrzés, sérült rekord, invalidálás, takarítás, legrégebbi adat.
 * Valós domain-objektumok a demó gateway-ből; a „hálózat” kapcsolható és számolja a hívásokat.
 */
import {
  CACHE_PAYLOAD_VERSION,
  cacheKeys,
  createMarketDataCache,
  type CacheRecord,
  type CacheStore,
  type ConnectivityMonitor,
  type ConnectivityState,
  type FxGateway,
  type MarketDataGateway,
} from '@/application';
import {
  AppErrors,
  err,
  parseCurrencyCode,
  parseIsoDate,
  parseListingId,
  type AppError,
  type CurrencyCode,
  type IsoDate,
  type ListingId,
} from '@/domain';
import { createMockFxGateway } from '@/infrastructure/mock/mock-fx-gateway';
import { createMockMarketDataGateway } from '@/infrastructure/mock/mock-market-data-gateway';
import { createInMemoryCacheStore } from '@/infrastructure/storage/in-memory-stores';

const T0 = new Date('2026-11-24T10:00:00Z');
const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

function id(raw: string): ListingId {
  const parsed = parseListingId(raw);
  if (!parsed.ok) throw new Error(raw);
  return parsed.value;
}
function date(raw: string): IsoDate {
  const parsed = parseIsoDate(raw);
  if (!parsed.ok) throw new Error(raw);
  return parsed.value;
}
function ccy(raw: string): CurrencyCode {
  const parsed = parseCurrencyCode(raw);
  if (!parsed.ok) throw new Error(raw);
  return parsed.value;
}
const DEMO = id('DEMO@XNAS');
const DEMO_ETF = id('DEMOETF@XETR');

/** Kapcsolható hálózat a demó gateway körül: `failWith` esetén minden hívás azzal a hibával bukik. */
function setup(options: { store?: CacheStore; connectivity?: ConnectivityState } = {}) {
  let now = T0;
  const clock = { now: () => now };
  const inner = createMockMarketDataGateway(clock);
  const innerFx = createMockFxGateway(clock);
  const calls: string[] = [];
  let failWith: AppError | null = null;
  let connectivity: ConnectivityState = options.connectivity ?? 'unknown';
  const monitor: ConnectivityMonitor = {
    current: () => connectivity,
    subscribe: () => () => undefined,
  };

  function wrap<K extends keyof MarketDataGateway>(name: K): MarketDataGateway[K] {
    return ((...args: unknown[]) => {
      calls.push(name);
      if (failWith !== null) return Promise.resolve(err(failWith));
      return (inner[name] as (...a: unknown[]) => unknown)(...args);
    }) as MarketDataGateway[K];
  }
  const network: MarketDataGateway = {
    getQuote: wrap('getQuote'),
    getSecurityListings: wrap('getSecurityListings'),
    getFinancialStatements: wrap('getFinancialStatements'),
    getPriceHistory: wrap('getPriceHistory'),
    getInstrumentProfile: wrap('getInstrumentProfile'),
    getDividends: wrap('getDividends'),
    searchInstruments: wrap('searchInstruments'),
  };
  const fx: FxGateway = {
    getReferenceRates: (request) => {
      calls.push('fx');
      if (failWith !== null) return Promise.resolve(err(failWith));
      return innerFx.getReferenceRates(request);
    },
  };
  const store = options.store ?? createInMemoryCacheStore();
  const cache = createMarketDataCache({
    marketData: network,
    fx,
    store,
    clock,
    connectivity: monitor,
  });
  return {
    cache,
    store,
    calls,
    advance: (ms: number) => {
      now = new Date(now.getTime() + ms);
    },
    offline: (error: AppError = AppErrors.network('nincs net')) => {
      failWith = error;
      connectivity = 'offline';
    },
    failOnly: (error: AppError) => {
      failWith = error;
    },
    online: () => {
      failWith = null;
      connectivity = 'online';
    },
    setConnectivity: (state: ConnectivityState) => {
      connectivity = state;
    },
  };
}

describe('cache-first olvasás és TTL', () => {
  it('TTL-en belül a második olvasás nem hív hálózatot (nincs lekérés minden renderkor)', async () => {
    const s = setup();
    const first = await s.cache.marketData.getQuote(DEMO);
    const second = await s.cache.marketData.getQuote(DEMO);
    expect(first.ok && second.ok).toBe(true);
    expect(s.calls).toEqual(['getQuote']);
    if (!second.ok) return;
    expect(second.value.provenance.cache).toEqual({
      mode: 'cache_hit',
      storedAt: '2026-11-24T10:00:00.000Z',
    });
    expect(second.value.price).toEqual(first.ok ? first.value.price : null);
  });

  it('a TTL lejárta után a hálózatról frissít (quote: 15 perc)', async () => {
    const s = setup();
    await s.cache.marketData.getQuote(DEMO);
    s.advance(14 * MIN);
    await s.cache.marketData.getQuote(DEMO);
    expect(s.calls).toHaveLength(1);
    s.advance(2 * MIN);
    const refreshed = await s.cache.marketData.getQuote(DEMO);
    expect(s.calls).toHaveLength(2);
    expect(refreshed.ok && refreshed.value.provenance.cache).toBeUndefined();
  });

  it('adatfajtánként eltérő TTL: a kimutatás 6 nap után is cache-ből jön, az ár nem', async () => {
    const s = setup();
    await s.cache.marketData.getFinancialStatements(DEMO, 'annual');
    await s.cache.marketData.getQuote(DEMO);
    s.advance(6 * DAY);
    await s.cache.marketData.getFinancialStatements(DEMO, 'annual');
    await s.cache.marketData.getQuote(DEMO);
    expect(s.calls).toEqual(['getFinancialStatements', 'getQuote', 'getQuote']);
  });

  it('egyidejű azonos kérések egy hálózati hívásra futnak össze', async () => {
    const s = setup();
    const results = await Promise.all([
      s.cache.marketData.getQuote(DEMO),
      s.cache.marketData.getQuote(DEMO),
      s.cache.marketData.getQuote(DEMO),
    ]);
    expect(results.every((r) => r.ok)).toBe(true);
    expect(s.calls).toEqual(['getQuote']);
  });

  it('ETF-profil etf_metadata, részvényprofil instrument_profile fajtával tárolódik', async () => {
    const s = setup();
    await s.cache.marketData.getInstrumentProfile(DEMO);
    await s.cache.marketData.getInstrumentProfile(DEMO_ETF);
    const listed = await s.store.list();
    const kinds = listed.ok ? listed.value.map((r) => `${r.listingId}:${r.kind}`) : [];
    expect(kinds).toEqual(
      expect.arrayContaining(['DEMO@XNAS:instrument_profile', 'DEMOETF@XETR:etf_metadata']),
    );
  });

  it('történeti FX (adott nap) fx_historical, a legutóbbi fx_latest fajtájú', async () => {
    const s = setup();
    await s.cache.fx.getReferenceRates({ quotes: [ccy('USD')], date: null });
    await s.cache.fx.getReferenceRates({ quotes: [ccy('USD')], date: date('2026-01-05') });
    const listed = await s.store.list();
    expect(listed.ok && listed.value.map((r) => r.kind).sort()).toEqual([
      'fx_historical',
      'fx_latest',
    ]);
  });
});

describe('cache-rekord: provenance és érvényesség', () => {
  it('minden rekord hordozza a lekérés idejét, forrást, időszakot, minőséget és érvényességet', async () => {
    const s = setup();
    await s.cache.marketData.getPriceHistory({
      listingId: DEMO,
      from: date('2025-11-24'),
      to: date('2026-11-24'),
      adjustment: 'SPLIT_DIVIDEND',
    });
    const listed = await s.store.list({ listingIds: ['DEMO@XNAS'] });
    expect(listed.ok).toBe(true);
    if (!listed.ok) return;
    const record = listed.value[0];
    expect(record).toMatchObject({
      kind: 'price_history',
      listingId: 'DEMO@XNAS',
      sourceId: 'mock',
      provenanceKind: 'mock',
      period: '2025-11-24..2026-11-24',
      payloadVersion: CACHE_PAYLOAD_VERSION,
      invalidatedAt: null,
    });
    expect(record?.fetchedAt).toBe('2026-11-24T10:00:00.000Z');
    // price_history: 12 óra friss, 14 nap elavult, 60 nap megőrzés.
    expect(record?.freshUntil).toBe('2026-11-24T22:00:00.000Z');
    expect(record?.staleUntil).toBe('2026-12-08T10:00:00.000Z');
    expect(record?.retainUntil).toBe('2027-01-23T10:00:00.000Z');
    expect(record?.asOf).not.toBeNull();
  });

  it('a „365 nap máig” ártörténet másnap is ugyanazt a kulcsot kapja (offline tartalék)', () => {
    const today = date('2026-11-24');
    const tomorrow = date('2026-11-25');
    const a = cacheKeys.priceHistory(DEMO, 'SPLIT_DIVIDEND', date('2025-11-24'), today, today);
    const b = cacheKeys.priceHistory(
      DEMO,
      'SPLIT_DIVIDEND',
      date('2025-11-25'),
      tomorrow,
      tomorrow,
    );
    expect(a).toBe(b);
    // Lezárt (régi) ablak pontos dátumokkal kulcsol.
    expect(
      cacheKeys.priceHistory(DEMO, 'SPLIT_DIVIDEND', date('2020-01-01'), date('2021-01-01'), today),
    ).toBe('prices:DEMO@XNAS:SPLIT_DIVIDEND:2020-01-01:2021-01-01');
  });
});

describe('offline mód', () => {
  it('offline: a korábbi adat látszik, az EREDETI lekérési idővel és forrással, soha nem FRESH-ként', async () => {
    const s = setup();
    const online = await s.cache.marketData.getQuote(DEMO);
    expect(online.ok).toBe(true);
    if (!online.ok) return;
    s.advance(10 * MIN); // még a TTL-en belül …
    s.offline();
    const offline = await s.cache.marketData.getQuote(DEMO);
    expect(offline.ok).toBe(true);
    if (!offline.ok) return;
    // … ezért ez még szabályos (friss) cache-találat, hálózati kísérlet nélkül
    expect(offline.value.provenance.cache?.mode).toBe('cache_hit');
    s.advance(10 * MIN); // TTL lejárt
    const fallback = await s.cache.marketData.getQuote(DEMO);
    expect(fallback.ok).toBe(true);
    if (!fallback.ok) return;
    expect(fallback.value.provenance).toMatchObject({
      sourceId: online.value.provenance.sourceId,
      sourceName: online.value.provenance.sourceName,
      fetchedAt: online.value.provenance.fetchedAt,
      cache: { mode: 'offline_fallback', storedAt: '2026-11-24T10:00:00.000Z' },
    });
    expect(fallback.value.provenance.freshness).not.toBe('FRESH');
    expect(fallback.value.asOf).toBe(online.value.asOf);
    expect(s.calls).toEqual(['getQuote']);
  });

  it('ismeretlen hálózati állapotnál átmeneti hiba után ad tartalékot (a hálózatot megpróbálta)', async () => {
    const s = setup();
    await s.cache.marketData.getQuote(DEMO);
    s.advance(1 * HOUR);
    s.failOnly(AppErrors.timeout('lassú', 10000));
    const result = await s.cache.marketData.getQuote(DEMO);
    expect(result.ok && result.value.provenance.cache?.mode).toBe('offline_fallback');
    expect(s.calls).toEqual(['getQuote', 'getQuote']);
  });

  it('a napi kvóta kimerülése (UNAVAILABLE/QUOTA_EXHAUSTED) is tartalékot ad; a csomagkorlát nem', async () => {
    const s = setup();
    await s.cache.marketData.getQuote(DEMO);
    s.advance(1 * HOUR);
    s.failOnly(AppErrors.unavailable('QUOTA_EXHAUSTED', 'elfogyott'));
    expect((await s.cache.marketData.getQuote(DEMO)).ok).toBe(true);
    s.failOnly(AppErrors.unavailable('PLAN_LIMIT', 'csomag'));
    const planLimited = await s.cache.marketData.getQuote(DEMO);
    expect(planLimited.ok).toBe(false);
  });

  it('végleges hiba (NOT_FOUND) mellett nem mutat régi adatot „helyette”', async () => {
    const s = setup();
    await s.cache.marketData.getQuote(DEMO);
    s.advance(1 * HOUR);
    s.failOnly(AppErrors.notFound('quote', 'DEMO@XNAS'));
    const result = await s.cache.marketData.getQuote(DEMO);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error.kind).toBe('NOT_FOUND');
  });

  it('offline és nincs cache: hálózati hiba, a „nincs offline adat” kiegészítéssel', async () => {
    const s = setup();
    s.offline();
    const result = await s.cache.marketData.getQuote(DEMO);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe('NETWORK');
    expect(result.error.message).toMatch(/offline\) adat sincs/);
  });

  it('a lejárt (EXPIRED) rekord is megjeleníthető offline, EXPIRED jelöléssel', async () => {
    const s = setup();
    await s.cache.marketData.getQuote(DEMO);
    s.advance(5 * DAY); // quote: 3 nap után EXPIRED, 30 napig megőrizve
    s.offline();
    const result = await s.cache.marketData.getQuote(DEMO);
    expect(result.ok && result.value.provenance.freshness).toBe('EXPIRED');
  });

  it('FX offline: minden ráta jelölve, a dátum és a forrás megmarad', async () => {
    const s = setup();
    const first = await s.cache.fx.getReferenceRates({ quotes: [ccy('USD')], date: null });
    s.advance(1 * DAY);
    s.offline();
    const offline = await s.cache.fx.getReferenceRates({ quotes: [ccy('USD')], date: null });
    expect(offline.ok).toBe(true);
    if (!offline.ok || !first.ok) return;
    for (const rate of offline.value.rates) {
      expect(rate.provenance.cache?.mode).toBe('offline_fallback');
      expect(rate.provenance.freshness).not.toBe('FRESH');
    }
    expect(offline.value.rates.map((r) => r.asOf)).toEqual(first.value.rates.map((r) => r.asOf));
  });
});

describe('kézi frissítés, invalidálás, háttér – különválasztva', () => {
  it('kézi frissítés: TTL-en belül is a hálózatot kéri, és új fetchedAt-ot tárol', async () => {
    const s = setup();
    await s.cache.marketData.getQuote(DEMO);
    s.advance(1 * MIN);
    const marked = await s.cache.control.refreshListings(['DEMO@XNAS']);
    expect(marked).toEqual({ ok: true, value: 1 });
    const refreshed = await s.cache.marketData.getQuote(DEMO);
    expect(s.calls).toEqual(['getQuote', 'getQuote']);
    expect(refreshed.ok && refreshed.value.provenance.cache).toBeUndefined();
    const record = await s.store.get(cacheKeys.quote(DEMO));
    expect(record.ok && record.value?.fetchedAt).toBe('2026-11-24T10:01:00.000Z');
    expect(record.ok && record.value?.invalidatedAt).toBeNull();
  });

  it('kézi frissítés offline: a tartalék megmarad (nem törlődik), jelölve jelenik meg', async () => {
    const s = setup();
    await s.cache.marketData.getQuote(DEMO);
    await s.cache.control.refreshListings(['DEMO@XNAS']);
    s.failOnly(AppErrors.network('nincs net'));
    const result = await s.cache.marketData.getQuote(DEMO);
    expect(result.ok && result.value.provenance.cache?.mode).toBe('offline_fallback');
  });

  it('invalidálás (clearAll): minden rekord törlődik, utána hálózat kell', async () => {
    const s = setup();
    await s.cache.marketData.getQuote(DEMO);
    await s.cache.marketData.getInstrumentProfile(DEMO);
    expect(await s.cache.control.clearAll()).toEqual({ ok: true, value: 2 });
    s.offline();
    expect((await s.cache.marketData.getQuote(DEMO)).ok).toBe(false);
  });

  it('takarítás (prune): csak a megőrzési időn túli rekordok törlődnek', async () => {
    const s = setup();
    await s.cache.marketData.getQuote(DEMO); // megőrzés 30 nap
    await s.cache.marketData.getFinancialStatements(DEMO, 'annual'); // 400 nap
    s.advance(31 * DAY);
    expect(await s.cache.control.prune()).toEqual({ ok: true, value: 1 });
    const listed = await s.store.list();
    expect(listed.ok && listed.value.map((r) => r.kind)).toEqual(['financial_statements']);
  });
});

describe('adatállapot (legrégebbi adat)', () => {
  it('a legrégebbi felhasznált rekord lekérési idejét adja, és jelzi az offline kiszolgálást', async () => {
    const s = setup();
    await s.cache.marketData.getFinancialStatements(DEMO, 'annual');
    s.advance(20 * MIN);
    await s.cache.marketData.getQuote(DEMO);
    s.advance(20 * MIN);
    s.offline();
    await s.cache.marketData.getQuote(DEMO);
    await s.cache.marketData.getFinancialStatements(DEMO, 'annual');
    const status = await s.cache.control.describe(['DEMO@XNAS']);
    expect(status.ok).toBe(true);
    if (!status.ok) return;
    expect(status.value.oldestFetchedAt).toBe('2026-11-24T10:00:00.000Z');
    expect(status.value.newestFetchedAt).toBe('2026-11-24T10:20:00.000Z');
    expect(status.value.servedOffline).toBe(true);
    expect(status.value.connectivity).toBe('offline');
    expect(status.value.hasStale).toBe(true);
  });

  it('friss hálózati adatnál nincs offline jelzés', async () => {
    const s = setup();
    await s.cache.marketData.getQuote(DEMO);
    const status = await s.cache.control.describe(['DEMO@XNAS']);
    expect(status.ok && status.value.servedOffline).toBe(false);
    expect(status.ok && status.value.entries[0]?.lastServed).toBe('network');
  });

  it('stats: rekordszám fajtánként és a legrégebbi adat', async () => {
    const s = setup();
    await s.cache.marketData.getQuote(DEMO);
    s.advance(1 * HOUR);
    await s.cache.marketData.searchInstruments('demo');
    const stats = await s.cache.control.stats();
    expect(stats).toEqual({
      ok: true,
      value: {
        entryCount: 2,
        oldestFetchedAt: '2026-11-24T10:00:00.000Z',
        byKind: { quote: 1, search: 1 },
      },
    });
  });
});

describe('sérült cache-rekord', () => {
  function corrupt(record: CacheRecord, payload: unknown, version = record.payloadVersion) {
    return { ...record, payload, payloadVersion: version };
  }

  it('sémának nem megfelelő payload: törlés + újralekérés (nem jut el hibás adat a számításig)', async () => {
    const s = setup();
    await s.cache.marketData.getQuote(DEMO);
    const stored = await s.store.get(cacheKeys.quote(DEMO));
    if (!stored.ok || stored.value === null) throw new Error('nincs rekord');
    await s.store.put(corrupt(stored.value, { price: 'sok' }));
    const result = await s.cache.marketData.getQuote(DEMO);
    expect(result.ok).toBe(true);
    expect(result.ok && result.value.provenance.cache).toBeUndefined();
    expect(s.calls).toEqual(['getQuote', 'getQuote']);
  });

  it('sérült payload offline: nincs tartalék, a rekord törlődik, őszinte hiba', async () => {
    const s = setup();
    await s.cache.marketData.getQuote(DEMO);
    const stored = await s.store.get(cacheKeys.quote(DEMO));
    if (!stored.ok || stored.value === null) throw new Error('nincs rekord');
    await s.store.put(corrupt(stored.value, null));
    s.advance(1 * HOUR);
    s.offline();
    const result = await s.cache.marketData.getQuote(DEMO);
    expect(result.ok).toBe(false);
    expect((await s.store.get(cacheKeys.quote(DEMO))).ok).toBe(true);
    const after = await s.store.get(cacheKeys.quote(DEMO));
    expect(after.ok && after.value).toBeNull();
  });

  it('régi payload-verzió: érvénytelen, újralekérés', async () => {
    const s = setup();
    await s.cache.marketData.getQuote(DEMO);
    const stored = await s.store.get(cacheKeys.quote(DEMO));
    if (!stored.ok || stored.value === null) throw new Error('nincs rekord');
    await s.store.put(corrupt(stored.value, stored.value.payload, CACHE_PAYLOAD_VERSION - 1));
    await s.cache.marketData.getQuote(DEMO);
    expect(s.calls).toEqual(['getQuote', 'getQuote']);
  });

  it('tárolási hiba olvasáskor: a hálózatról szolgál ki (a cache hibája nem blokkol)', async () => {
    const failing: CacheStore = {
      ...createInMemoryCacheStore(),
      get: async () => err(AppErrors.storage('lemez')),
      put: async () => err(AppErrors.storage('lemez')),
    };
    const s = setup({ store: failing });
    const result = await s.cache.marketData.getQuote(DEMO);
    expect(result.ok).toBe(true);
  });
});
