/**
 * PHASE 13: háttérfrissítés – hálózat-visszatérésre indul, korlátozott, csak a nem friss
 * árfolyamokat kéri, és elkülönül a kézi frissítéstől / invalidálástól.
 */
import { err, ok, AppErrors, type ListingId, type Quote } from '@/domain';

import type { ConnectivityMonitor, MarketDataGateway } from '../ports';
import { createBackgroundRefresher, type BackgroundRefreshReport } from './background-refresh';
import type { CacheControl } from './market-data-cache';
import type { ConnectivityState } from './types';

function monitor(initial: ConnectivityState) {
  let state = initial;
  const listeners = new Set<(s: ConnectivityState) => void>();
  const m: ConnectivityMonitor = {
    current: () => state,
    subscribe: (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
  };
  return {
    monitor: m,
    set: (next: ConnectivityState) => {
      state = next;
      listeners.forEach((l) => l(next));
    },
    listenerCount: () => listeners.size,
  };
}

function setup(
  options: {
    fresh?: readonly string[];
    targets?: readonly string[];
    enabled?: boolean;
    failing?: readonly string[];
    fallback?: readonly string[];
  } = {},
) {
  let now = new Date('2026-11-24T10:00:00Z');
  const requested: string[] = [];
  const net = monitor('online');
  const marketData = {
    getQuote: async (listingId: ListingId) => {
      requested.push(listingId);
      if (options.failing?.includes(listingId)) return err(AppErrors.network('x'));
      const cache = options.fallback?.includes(listingId)
        ? { mode: 'offline_fallback' as const, storedAt: '2026-11-23T10:00:00Z' }
        : undefined;
      return ok({ provenance: { cache } } as unknown as Quote);
    },
  } as unknown as MarketDataGateway;
  const control = {
    isQuoteFresh: async (listingId: string) => options.fresh?.includes(listingId) ?? false,
  } as unknown as CacheControl;
  const reports: BackgroundRefreshReport[] = [];
  const refresher = createBackgroundRefresher({
    control,
    marketData,
    clock: { now: () => now },
    connectivity: net.monitor,
    targets: async () => options.targets ?? ['AAPL@XNAS', 'MSFT@XNAS'],
    isEnabled: async () => options.enabled ?? true,
    maxListings: 3,
    onReport: (r) => reports.push(r),
  });
  return {
    refresher,
    requested,
    net,
    reports,
    advance: (ms: number) => {
      now = new Date(now.getTime() + ms);
    },
  };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('createBackgroundRefresher', () => {
  it('csak a nem friss árfolyamokat kéri le', async () => {
    const s = setup({ fresh: ['AAPL@XNAS'] });
    const report = await s.refresher.runOnce();
    expect(s.requested).toEqual(['MSFT@XNAS']);
    expect(report).toMatchObject({ status: 'ran', attempted: 1, refreshed: 1, skippedFresh: 1 });
  });

  it('korlátozott darabszám (kvótakímélés), a duplikált célok egyszer számítanak', async () => {
    const s = setup({ targets: ['A@XNAS', 'B@XNAS', 'A@XNAS', 'C@XNAS', 'D@XNAS', 'E@XNAS'] });
    const report = await s.refresher.runOnce();
    expect(s.requested).toEqual(['A@XNAS', 'B@XNAS', 'C@XNAS']);
    expect(report.skippedOverLimit).toBe(2);
  });

  it('két futás között legalább 5 perc (throttle)', async () => {
    const s = setup();
    await s.refresher.runOnce();
    expect((await s.refresher.runOnce()).status).toBe('throttled');
    s.advance(5 * 60 * 1000);
    expect((await s.refresher.runOnce()).status).toBe('ran');
  });

  it('kikapcsolt beállításnál nem kér le semmit', async () => {
    const s = setup({ enabled: false });
    expect((await s.refresher.runOnce()).status).toBe('disabled');
    expect(s.requested).toEqual([]);
  });

  it('offline állapotban nem próbálkozik', async () => {
    const s = setup();
    s.net.set('offline');
    expect((await s.refresher.runOnce()).status).toBe('offline');
  });

  it('a tartalékból (offline_fallback) jött érték és a hiba nem számít frissítésnek; érvénytelen azonosító kimarad', async () => {
    const s = setup({
      targets: ['A@XNAS', 'B@XNAS', 'rossz azonosító'],
      failing: ['A@XNAS'],
      fallback: ['B@XNAS'],
    });
    const report = await s.refresher.runOnce();
    expect(report).toMatchObject({ refreshed: 0, failed: 3 });
  });

  it('hálózat-visszatérés (offline → online) indítja; online → online nem; leiratkozás működik', async () => {
    const s = setup();
    const stop = s.refresher.start();
    s.net.set('online');
    await flush();
    expect(s.requested).toEqual([]);
    s.net.set('offline');
    s.net.set('online');
    await flush();
    expect(s.requested).toEqual(['AAPL@XNAS', 'MSFT@XNAS']);
    expect(s.reports).toHaveLength(1);
    stop();
    expect(s.net.listenerCount()).toBe(0);
  });
});
