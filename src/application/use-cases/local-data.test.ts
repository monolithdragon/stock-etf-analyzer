/**
 * PHASE 13: beállítás-, figyelőlista- és lokálisadat-use case-ek (export, törlés, állapot),
 * valamint a beállítás-séma migrációja.
 */
import { AppErrors, err, ok, type Portfolio, type PortfolioId, type Transaction } from '@/domain';

import {
  collectRefreshTargets,
  createLocalDataService,
  createPreferencesService,
  createWatchlistService,
  serializeUserDataExport,
  USER_DATA_EXPORT_FORMAT,
} from './local-data';
import type { CacheControl } from '../cache/market-data-cache';
import { AAPL, PORTFOLIO, tx, USD } from '../portfolio/testing';
import type { PortfolioRepository, PreferencesRepository, WatchlistRepository } from '../ports';
import {
  decodePreferences,
  DEFAULT_PREFERENCES,
  type UserPreferences,
} from '../preferences/user-preferences';
import type { WatchlistItem } from '../watchlist/types';

const clock = { now: () => new Date('2026-11-24T10:00:00Z') };

function repos() {
  const portfolios = new Map<PortfolioId, Portfolio>();
  const transactions: Transaction[] = [];
  let watchlist: WatchlistItem[] = [];
  let prefs: UserPreferences | null = null;
  const portfolioRepository: PortfolioRepository = {
    getPortfolio: async (id) => ok(portfolios.get(id) ?? null),
    savePortfolio: async (p) => {
      portfolios.set(p.id, p);
      return ok(undefined);
    },
    listTransactions: async (id) => ok(transactions.filter((t) => t.portfolioId === id)),
    addTransaction: async (t) => {
      transactions.push(t);
      return ok(undefined);
    },
    listPortfolios: async () => ok([...portfolios.values()]),
    deleteAll: async () => {
      portfolios.clear();
      transactions.length = 0;
      return ok(undefined);
    },
  };
  const watchlistRepository: WatchlistRepository = {
    list: async () => ok(watchlist),
    add: async (item) => {
      watchlist = [...watchlist, item];
      return ok(undefined);
    },
    remove: async (listingId) => {
      watchlist = watchlist.filter((i) => i.listingId !== listingId);
      return ok(undefined);
    },
    clear: async () => {
      watchlist = [];
      return ok(undefined);
    },
  };
  const preferencesRepository: PreferencesRepository = {
    load: async () => ok(prefs),
    save: async (p) => {
      prefs = p;
      return ok(undefined);
    },
    clear: async () => {
      prefs = null;
      return ok(undefined);
    },
  };
  return { portfolioRepository, watchlistRepository, preferencesRepository, transactions };
}

describe('createPreferencesService', () => {
  it('mentés nélkül az alapértékeket adja; érvénytelen beállítást nem ment', async () => {
    const r = repos();
    const service = createPreferencesService({ repository: r.preferencesRepository });
    expect(await service.load()).toEqual({ ok: true, value: DEFAULT_PREFERENCES });
    const bad = await service.save({ ...DEFAULT_PREFERENCES, baseCurrency: 'JPY' as 'HUF' });
    expect(!bad.ok && bad.error.kind).toBe('VALIDATION');
    const good = { ...DEFAULT_PREFERENCES, themePreference: 'dark' as const };
    expect((await service.save(good)).ok).toBe(true);
    expect(await service.load()).toEqual({ ok: true, value: good });
  });
});

describe('decodePreferences (migrációs lánc)', () => {
  it('v1 → v2: a frissítési beállítás alapértékkel kiegészül', () => {
    const decoded = decodePreferences({
      schemaVersion: 1,
      data: { baseCurrency: 'EUR', themePreference: 'system', llmEnabled: true },
    });
    expect(decoded).toEqual({
      status: 'ok',
      migratedFrom: 1,
      preferences: {
        baseCurrency: 'EUR',
        themePreference: 'system',
        llmEnabled: true,
        refresh: { refreshOnReconnect: true },
      },
    });
  });
  it('sérült, ismeretlen mezős és újabb verzió', () => {
    expect(decodePreferences('szöveg').status).toBe('corrupt');
    expect(
      decodePreferences({ schemaVersion: 2, data: { ...DEFAULT_PREFERENCES, titok: 'x' } }).status,
    ).toBe('corrupt');
    expect(decodePreferences({ schemaVersion: 0, data: {} }).status).toBe('corrupt');
    expect(decodePreferences({ schemaVersion: 3, data: {} })).toEqual({
      status: 'newer_version',
      version: 3,
    });
  });
});

describe('createWatchlistService', () => {
  it('érvénytelen azonosítót elutasít; érvényeset ment', async () => {
    const r = repos();
    const service = createWatchlistService({ repository: r.watchlistRepository, clock });
    expect((await service.add({ listingId: 'nem jó', name: null, kind: 'stock' })).ok).toBe(false);
    expect((await service.add({ listingId: 'aapl@xnas', name: 'Apple', kind: 'stock' })).ok).toBe(
      true,
    );
    expect(await service.list()).toEqual({
      ok: true,
      value: [{ listingId: 'AAPL@XNAS', name: 'Apple', kind: 'stock' }],
    });
  });
});

describe('createLocalDataService', () => {
  function service(cache: CacheControl | null = null) {
    const r = repos();
    return {
      r,
      s: createLocalDataService({
        cache,
        backgroundRefresher: null,
        portfolioRepository: r.portfolioRepository,
        watchlistRepository: r.watchlistRepository,
        preferencesRepository: r.preferencesRepository,
        clock,
        persistent: true,
      }),
    };
  }

  it('export: saját adatok verziózott JSON-ban, piaci adat (cache) nélkül', async () => {
    const { r, s } = service();
    await r.portfolioRepository.savePortfolio(PORTFOLIO);
    const t = tx.buy(AAPL, '2026-01-02', 1, 100, USD);
    await r.portfolioRepository.addTransaction(t);
    await r.watchlistRepository.add({ listingId: 'AAPL@XNAS', name: 'Apple', kind: 'stock' }, 'x');
    const exported = await s.exportUserData();
    expect(exported.ok).toBe(true);
    if (!exported.ok) return;
    expect(exported.value).toMatchObject({
      format: USER_DATA_EXPORT_FORMAT,
      version: 2,
      alerts: [],
      exportedAt: '2026-11-24T10:00:00.000Z',
      portfolios: [{ portfolio: PORTFOLIO, transactions: [t] }],
      watchlist: [{ listingId: 'AAPL@XNAS' }],
      preferences: DEFAULT_PREFERENCES,
    });
    const text = serializeUserDataExport(exported.value);
    expect(JSON.parse(text)).toEqual(JSON.parse(JSON.stringify(exported.value)));
    expect(text).not.toMatch(/cache|api[_-]?key|token/i);
  });

  it('export: tárolási hiba továbbmegy (nem részleges export)', async () => {
    const { r, s } = service();
    r.portfolioRepository.listPortfolios = async () => err(AppErrors.storage('lemez'));
    expect((await s.exportUserData()).ok).toBe(false);
  });

  it('teljes törlés: portfólió, tranzakció, figyelőlista, beállítás és cache', async () => {
    const clearAll = jest.fn(async () => ok(7));
    const { r, s } = service({ clearAll } as unknown as CacheControl);
    await r.portfolioRepository.savePortfolio(PORTFOLIO);
    await r.portfolioRepository.addTransaction(tx.buy(AAPL, '2026-01-02', 1, 100, USD));
    await r.watchlistRepository.add({ listingId: 'AAPL@XNAS', name: null, kind: 'stock' }, 'x');
    await r.preferencesRepository.save({ ...DEFAULT_PREFERENCES, llmEnabled: true });
    expect(await s.deleteAllLocalData()).toEqual({ ok: true, value: { cacheEntriesDeleted: 7 } });
    expect(await r.portfolioRepository.listPortfolios()).toEqual({ ok: true, value: [] });
    expect(r.transactions).toEqual([]);
    expect(await r.watchlistRepository.list()).toEqual({ ok: true, value: [] });
    expect(await r.preferencesRepository.load()).toEqual({ ok: true, value: null });
  });

  it('cache nélkül (demó mód): üres állapot, a frissítés no-op', async () => {
    const { s } = service(null);
    const status = await s.getStatus(['AAPL@XNAS']);
    expect(status.ok && status.value.entries).toEqual([]);
    expect(await s.refreshListings(['AAPL@XNAS'])).toEqual({ ok: true, value: 0 });
    expect(await s.cacheStats()).toEqual({ ok: true, value: null });
    expect(await s.runBackgroundRefresh()).toBeNull();
    expect(typeof s.startBackgroundRefresh()).toBe('function');
  });

  it('a háttérfrissítés céljai: figyelőlista + tranzakciós jegyzések, ismétlés nélkül', async () => {
    const { r } = service();
    await r.portfolioRepository.savePortfolio(PORTFOLIO);
    await r.portfolioRepository.addTransaction(tx.buy(AAPL, '2026-01-02', 1, 100, USD));
    await r.watchlistRepository.add({ listingId: 'AAPL@XNAS', name: null, kind: 'stock' }, 'x');
    await r.watchlistRepository.add({ listingId: 'MSFT@XNAS', name: null, kind: 'stock' }, 'x');
    expect(await collectRefreshTargets(r)).toEqual(['AAPL@XNAS', 'MSFT@XNAS']);
  });
});
