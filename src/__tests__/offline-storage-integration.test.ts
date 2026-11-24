/**
 * PHASE 13 – végponttól végpontig (folyamaton belül):
 *   use case → CACHE (valódi SQLite: node:sqlite) → proxy gateway → [kapcsolható „hálózat”]
 *   → VALÓDI szerver-handlerek (mock provider).
 *
 * Igazolja az elfogadási feltételeket: offline a régi adat nem friss-ként látszik; a cache-elt
 * adat provenance-e és időbélyege megmarad; a portfólió mentése/visszaolvasása „újraindítás”
 * után; a hálózat-visszatérés háttérfrissítést indít; nincs lekérés minden megnyitáskor.
 */
import type { ConnectivityMonitor, ConnectivityState } from '@/application';
import { createAppServices } from '@/config/container';
import { parseCurrencyCode, parseListingId, type Result } from '@/domain';
import { createDatabaseProvider } from '@/infrastructure/storage/database-provider';
import {
  createKvPreferencesRepository,
  createMemoryKeyValueStore,
} from '@/infrastructure/storage/kv-preferences-repository';
import type { LocalStorage } from '@/infrastructure/storage/local-storage';
import { createSqliteCacheStore } from '@/infrastructure/storage/sqlite-cache-store';
import { createSqlitePortfolioRepository } from '@/infrastructure/storage/sqlite-portfolio-repository';
import { createSqliteWatchlistRepository } from '@/infrastructure/storage/sqlite-watchlist-repository';
import { buildDataStatusNotices } from '@/presentation/view-models/data-status-notices';
import { silentServerLogger } from '@/server/logging';
import { createServerContext, type ServerContext } from '@/server/server-context';
import { fakeFetch } from '@/server/testing/test-helpers';
import { createNodeSqliteDatabase, type NodeSqliteDatabase } from '@/testing/node-sqlite-database';

function must<T>(result: Result<T>): T {
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}
const EUR = must(parseCurrencyCode('EUR'));
const USD = must(parseCurrencyCode('USD'));

const MIN = 60 * 1000;
const HOUR = 60 * MIN;

function routeTo(server: ServerContext) {
  const { handlers } = server;
  return async (input: string): Promise<Response> => {
    const url = new URL(input);
    const path = url.pathname;
    const request = new Request(url.toString());
    let m: RegExpMatchArray | null;
    if (path === '/api/v1/fx') return handlers.fx(request);
    if ((m = path.match(/^\/api\/v1\/stocks\/([^/]+)\/financials$/))) {
      return handlers.financials(request, { id: decodeURIComponent(m[1] ?? '') });
    }
    if ((m = path.match(/^\/api\/v1\/instruments\/([^/]+)\/(quote|prices|profile|dividends)$/))) {
      const endpoint = m[2] as 'quote' | 'prices' | 'profile' | 'dividends';
      return handlers[endpoint](request, { id: decodeURIComponent(m[1] ?? '') });
    }
    if (path === '/api/v1/search') return handlers.search(request);
    return new Response('Not found', { status: 404 });
  };
}

/** Egy „eszköz”: tartós SQLite-adatbázis + kv-store; az app többször „újraindítható” rajta. */
function device() {
  let now = new Date('2026-11-24T10:00:00Z');
  const clock = { now: () => now };
  const db: NodeSqliteDatabase = createNodeSqliteDatabase();
  const kv = createMemoryKeyValueStore();
  let state: ConnectivityState = 'online';
  const listeners = new Set<(s: ConnectivityState) => void>();
  const connectivity: ConnectivityMonitor = {
    current: () => state,
    subscribe: (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
  };
  const server = createServerContext({
    rawEnv: { PROXY_DATA_MODE: 'mock' },
    fetchImpl: fakeFetch(() => new Response('{}', { status: 404 })),
    now: clock.now,
    logger: silentServerLogger,
  });
  const route = routeTo(server);
  const requests: string[] = [];
  const fetchImpl = async (input: string) => {
    if (state === 'offline') throw new TypeError('Network request failed');
    requests.push(new URL(input).pathname);
    return route(input);
  };

  /** „App-indítás”: új composition root ugyanazon az adatbázison. */
  function launch() {
    const provider = createDatabaseProvider(async () => db);
    const storage: LocalStorage = {
      portfolioRepository: createSqlitePortfolioRepository(provider),
      watchlistRepository: createSqliteWatchlistRepository(provider),
      preferencesRepository: createKvPreferencesRepository(kv),
      cacheStore: createSqliteCacheStore(provider),
      connectivity,
      persistent: true,
    };
    return createAppServices(
      { dataMode: 'live', apiBaseUrl: 'http://proxy.test' },
      { clock, fetchImpl, storage },
    );
  }

  return {
    launch,
    requests,
    db,
    advance: (ms: number) => {
      now = new Date(now.getTime() + ms);
    },
    setNetwork: (next: ConnectivityState) => {
      state = next;
      listeners.forEach((l) => l(next));
    },
  };
}

describe('offline mód (élő mód + cache + valódi SQLite)', () => {
  it('ismételt megnyitás TTL-en belül nem kér le új adatot', async () => {
    const d = device();
    const app = d.launch();
    expect((await app.evaluateStock('DEMO@XNAS')).ok).toBe(true);
    const afterFirst = d.requests.length;
    expect(afterFirst).toBeGreaterThan(0);
    d.advance(5 * MIN);
    expect((await app.evaluateStock('DEMO@XNAS')).ok).toBe(true);
    expect(d.requests.length).toBe(afterFirst);
    const status = await app.localData.getStatus(['DEMO@XNAS']);
    expect(status.ok && status.value.entries.every((e) => e.lastServed === 'cache_hit')).toBe(true);
    const notices = buildDataStatusNotices(status.ok ? status.value : null);
    expect(notices.map((n) => n.id)).toEqual(['cache']);
  });

  it('offline: az elemzés a cache-ből fut, az ár nem FRESH, a provenance és a lekérési idő az eredeti', async () => {
    const d = device();
    const online = d.launch();
    const quoteOnline = await online.getListingQuote('DEMO@XNAS');
    expect(quoteOnline.ok && quoteOnline.value.provenance.freshness).toBe('FRESH');
    await online.evaluateStock('DEMO@XNAS');

    d.advance(2 * HOUR);
    d.setNetwork('offline');
    const app = d.launch(); // újraindítás offline állapotban (a memória üres, csak az SQLite van)
    const quote = await app.getListingQuote('DEMO@XNAS');
    expect(quote.ok).toBe(true);
    if (!quote.ok || !quoteOnline.ok) return;
    expect(quote.value.provenance.freshness).not.toBe('FRESH');
    expect(quote.value.provenance.cache?.mode).toBe('offline_fallback');
    expect(quote.value.provenance.fetchedAt).toBe(quoteOnline.value.provenance.fetchedAt);
    expect(quote.value.provenance.sourceId).toBe(quoteOnline.value.provenance.sourceId);
    expect(quote.value.price).toEqual(quoteOnline.value.price);

    const evaluation = await app.evaluateStock('DEMO@XNAS');
    expect(evaluation.ok).toBe(true);
    const status = await app.localData.getStatus(['DEMO@XNAS']);
    expect(status.ok).toBe(true);
    if (!status.ok) return;
    expect(status.value.servedOffline).toBe(true);
    expect(status.value.oldestFetchedAt).toBe('2026-11-24T10:00:00.000Z');
    const [notice] = buildDataStatusNotices(status.value);
    expect(notice?.id).toBe('offline');
    expect(notice?.message).toMatch(/elavult|korábban letöltött/);
    expect(notice?.message).toMatch(/2026\. 11\. 24\./);
  });

  it('offline és nincs cache: őszinte hiba („nincs offline adat”)', async () => {
    const d = device();
    d.setNetwork('offline');
    const quote = await d.launch().getListingQuote('DEMO@XNAS');
    expect(quote.ok).toBe(false);
    expect(!quote.ok && quote.error.kind).toBe('NETWORK');
    expect(!quote.ok && quote.error.message).toMatch(/offline\) adat sincs/);
  });

  it('kézi frissítés: online újra lekér; a régi rekord offline tartalékként megmarad', async () => {
    const d = device();
    const app = d.launch();
    await app.getListingQuote('DEMO@XNAS');
    const before = d.requests.length;
    await app.localData.refreshListings(['DEMO@XNAS']);
    await app.getListingQuote('DEMO@XNAS');
    expect(d.requests.length).toBe(before + 1);
    await app.localData.refreshListings(['DEMO@XNAS']);
    d.setNetwork('offline');
    const offline = await app.getListingQuote('DEMO@XNAS');
    expect(offline.ok && offline.value.provenance.cache?.mode).toBe('offline_fallback');
  });

  it('hálózat-visszatérés: a figyelőlista árfolyama a háttérben frissül (ha engedélyezett)', async () => {
    const d = device();
    const app = d.launch();
    await app.watchlist.add({ listingId: 'DEMO@XNAS', name: 'Demo', kind: 'stock' });
    await app.getListingQuote('DEMO@XNAS');
    const stop = app.localData.startBackgroundRefresh();
    d.setNetwork('offline');
    d.advance(1 * HOUR);
    const before = d.requests.length;
    d.setNetwork('online');
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(d.requests.slice(before)).toEqual(['/api/v1/instruments/DEMO%40XNAS/quote']);
    const quote = await app.getListingQuote('DEMO@XNAS');
    expect(quote.ok && quote.value.provenance.cache?.mode).toBe('cache_hit');
    expect(quote.ok && quote.value.provenance.freshness).toBe('FRESH');
    stop();

    // Kikapcsolt beállításnál nincs háttér-lekérés.
    await app.preferences.save({
      baseCurrency: 'HUF',
      themePreference: 'system',
      llmEnabled: false,
      refresh: { refreshOnReconnect: false },
    });
    const report = await app.localData.runBackgroundRefresh();
    expect(report?.status).toBe('disabled');
  });
});

describe('portfólió és beállítások tartósan (újraindítás után)', () => {
  it('portfólió + tranzakciók mentése, majd új app-példányban visszaolvasás és elemzés', async () => {
    const d = device();
    const first = d.launch();
    expect((await first.createPortfolio({ id: 'main', name: 'Fő', baseCurrency: EUR })).ok).toBe(
      true,
    );
    const recorded = await first.recordTransaction({
      portfolioId: 'main',
      listingId: must(parseListingId('DEMO@XNAS')),
      type: 'BUY',
      tradeDate: '2026-11-20',
      quantity: 3,
      price: 90,
      priceCurrency: USD,
      fees: 1,
      feesCurrency: USD,
    });
    expect(recorded.ok).toBe(true);
    await first.watchlist.add({ listingId: 'DEMOETF@XETR', name: 'Demo ETF', kind: 'etf' });
    await first.preferences.save({
      baseCurrency: 'EUR',
      themePreference: 'dark',
      llmEnabled: false,
      refresh: { refreshOnReconnect: true },
    });

    const second = d.launch();
    const analysis = await second.analyzePortfolio('main');
    expect(analysis.ok).toBe(true);
    if (!analysis.ok) return;
    expect(analysis.value.positions.map((p) => p.listingId)).toEqual(['DEMO@XNAS']);
    expect(await second.watchlist.list()).toEqual({
      ok: true,
      value: [{ listingId: 'DEMOETF@XETR', name: 'Demo ETF', kind: 'etf' }],
    });
    const prefs = await second.preferences.load();
    expect(prefs.ok && prefs.value.themePreference).toBe('dark');

    const exported = await second.localData.exportUserData();
    expect(exported.ok && exported.value.portfolios[0]?.transactions).toHaveLength(1);

    expect((await second.localData.deleteAllLocalData()).ok).toBe(true);
    const third = d.launch();
    const gone = await third.analyzePortfolio('main');
    expect(!gone.ok && gone.error.kind).toBe('NOT_FOUND');
    expect(await third.watchlist.list()).toEqual({ ok: true, value: [] });
    expect(await d.db.getAll('SELECT key FROM cache_entries')).toEqual([]);
  });
});
