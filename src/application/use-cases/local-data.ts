/**
 * Lokális adatok use case-ei (PHASE 13, D-082, D-083): beállítások, figyelőlista, cache-állapot,
 * kézi frissítés, cache-invalidálás, export és teljes törlés.
 *
 * Adatmegőrzés: minden felhasználói adat CSAK az eszközön van (nincs szinkron, nincs felhő).
 * Az export a felhasználó saját adatait adja (portfólió, tranzakciók, figyelőlista, riasztások
 * [PHASE 14], beállítások)
 * – a szolgáltatói piaci adatot (cache) NEM, mert az nem a felhasználóé (licenc) és újratölthető.
 */
import {
  AppErrors,
  err,
  ok,
  parseListingId,
  toIsoTimestamp,
  type AppError,
  type Portfolio,
  type Result,
  type Transaction,
} from '@/domain';

import type { BackgroundRefresher, BackgroundRefreshReport } from '../cache/background-refresh';
import type { CacheControl } from '../cache/market-data-cache';
import type { CacheStats, DataStatus } from '../cache/types';
import type { AlertRule } from '../insights/alerts';
import type {
  AlertRuleRepository,
  Clock,
  PortfolioRepository,
  PreferencesRepository,
  WatchlistRepository,
} from '../ports';
import {
  DEFAULT_PREFERENCES,
  userPreferencesSchema,
  type UserPreferences,
} from '../preferences/user-preferences';
import { watchlistItemSchema, type WatchlistItem } from '../watchlist/types';

// ---------------------------------------------------------------------------------------------
// Beállítások
// ---------------------------------------------------------------------------------------------

export interface PreferencesService {
  /** Mentett beállítások, vagy az alapértékek, ha még nincs mentés / sérült volt. */
  load(): Promise<Result<UserPreferences, AppError>>;
  save(preferences: UserPreferences): Promise<Result<void, AppError>>;
}

export function createPreferencesService(deps: {
  readonly repository: PreferencesRepository;
}): PreferencesService {
  return {
    async load() {
      const loaded = await deps.repository.load();
      if (!loaded.ok) return loaded;
      return ok(loaded.value ?? DEFAULT_PREFERENCES);
    },
    async save(preferences) {
      const parsed = userPreferencesSchema.safeParse(preferences);
      if (!parsed.success) {
        return err(AppErrors.validation('Érvénytelen beállítás – nem mentettük.'));
      }
      return deps.repository.save(parsed.data);
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Figyelőlista
// ---------------------------------------------------------------------------------------------

export interface WatchlistService {
  list(): Promise<Result<readonly WatchlistItem[], AppError>>;
  add(item: WatchlistItem): Promise<Result<void, AppError>>;
  remove(listingId: string): Promise<Result<void, AppError>>;
}

export function createWatchlistService(deps: {
  readonly repository: WatchlistRepository;
  readonly clock: Clock;
}): WatchlistService {
  return {
    list: () => deps.repository.list(),
    async add(item) {
      const listingId = parseListingId(item.listingId);
      if (!listingId.ok) return listingId;
      const parsed = watchlistItemSchema.safeParse({ ...item, listingId: listingId.value });
      if (!parsed.success) return err(AppErrors.validation('Érvénytelen figyelőlista-elem.'));
      return deps.repository.add(parsed.data, toIsoTimestamp(deps.clock.now()));
    },
    remove: (listingId) => deps.repository.remove(listingId),
  };
}

// ---------------------------------------------------------------------------------------------
// Cache-állapot, frissítés, export, törlés
// ---------------------------------------------------------------------------------------------

export const USER_DATA_EXPORT_FORMAT = 'stock-etf-analyzer.user-data';
/** 2: PHASE 14 – riasztási szabályok (`alerts`) az exportban. */
export const USER_DATA_EXPORT_VERSION = 2;

export interface UserDataExport {
  readonly format: typeof USER_DATA_EXPORT_FORMAT;
  readonly version: number;
  readonly exportedAt: string;
  readonly portfolios: readonly {
    readonly portfolio: Portfolio;
    readonly transactions: readonly Transaction[];
  }[];
  readonly watchlist: readonly WatchlistItem[];
  /** PHASE 14: riasztási szabályok (üres, ha nincs riasztás-tároló). */
  readonly alerts: readonly AlertRule[];
  readonly preferences: UserPreferences;
  /** Ember által olvasható megjegyzés a fájl tartalmáról. */
  readonly note: string;
}

export interface DeleteAllReport {
  readonly cacheEntriesDeleted: number;
}

export interface LocalDataService {
  /** `true`: az adatok újraindítás után is megmaradnak (natív SQLite); `false`: memória (web). */
  readonly persistent: boolean;
  /** Adatállapot a képernyőnek (utoljára frissítve, offline, elavult). */
  getStatus(listingIds: readonly string[]): Promise<Result<DataStatus, AppError>>;
  /** KÉZI frissítés: a jegyzések cache-rekordjai jelölve (a tartalék megmarad). */
  refreshListings(listingIds: readonly string[]): Promise<Result<number, AppError>>;
  /** Cache-INVALIDÁLÁS: minden piaci adat törlése az eszközről (újra letölthető). */
  clearCache(): Promise<Result<number, AppError>>;
  cacheStats(): Promise<Result<CacheStats | null, AppError>>;
  exportUserData(): Promise<Result<UserDataExport, AppError>>;
  /** Minden helyi adat végleges törlése (portfólió, tranzakció, figyelőlista, riasztás, beállítás, cache). */
  deleteAllLocalData(): Promise<Result<DeleteAllReport, AppError>>;
  /** Háttérfrissítés indítása hálózat-visszatérésre; a visszaadott függvény leállítja. */
  startBackgroundRefresh(): () => void;
  /** Egy háttérfrissítési kör azonnal (teszt, fejlesztői eszköz). */
  runBackgroundRefresh(): Promise<BackgroundRefreshReport | null>;
}

export interface LocalDataServiceDeps {
  /** `null`: nincs cache (demó mód) – az állapot üres, a frissítés no-op. */
  readonly cache: CacheControl | null;
  readonly backgroundRefresher: BackgroundRefresher | null;
  readonly portfolioRepository: PortfolioRepository;
  readonly watchlistRepository: WatchlistRepository;
  /** PHASE 14: riasztások (export és teljes törlés); hiányában kimarad. */
  readonly alertRuleRepository?: AlertRuleRepository;
  readonly preferencesRepository: PreferencesRepository;
  readonly clock: Clock;
  readonly persistent: boolean;
}

const EMPTY_STATUS: DataStatus = {
  connectivity: 'unknown',
  entries: [],
  oldestFetchedAt: null,
  newestFetchedAt: null,
  servedOffline: false,
  hasStale: false,
};

/** A háttérfrissítés céljai: figyelőlista + minden jegyzés, amelyen tranzakció van. */
export async function collectRefreshTargets(deps: {
  readonly portfolioRepository: PortfolioRepository;
  readonly watchlistRepository: WatchlistRepository;
}): Promise<readonly string[]> {
  const targets: string[] = [];
  const watchlist = await deps.watchlistRepository.list();
  if (watchlist.ok) targets.push(...watchlist.value.map((i) => i.listingId));
  const portfolios = await deps.portfolioRepository.listPortfolios();
  if (portfolios.ok) {
    for (const portfolio of portfolios.value) {
      const transactions = await deps.portfolioRepository.listTransactions(portfolio.id);
      if (transactions.ok) targets.push(...transactions.value.map((t) => t.listingId));
    }
  }
  return [...new Set(targets)];
}

export function createLocalDataService(deps: LocalDataServiceDeps): LocalDataService {
  return {
    persistent: deps.persistent,
    async getStatus(listingIds) {
      if (deps.cache === null) return ok(EMPTY_STATUS);
      return deps.cache.describe(listingIds);
    },
    async refreshListings(listingIds) {
      if (deps.cache === null) return ok(0);
      return deps.cache.refreshListings(listingIds);
    },
    async clearCache() {
      if (deps.cache === null) return ok(0);
      return deps.cache.clearAll();
    },
    async cacheStats() {
      if (deps.cache === null) return ok(null);
      return deps.cache.stats();
    },
    async exportUserData() {
      const portfolios = await deps.portfolioRepository.listPortfolios();
      if (!portfolios.ok) return portfolios;
      const withTransactions: { portfolio: Portfolio; transactions: readonly Transaction[] }[] = [];
      for (const portfolio of portfolios.value) {
        const transactions = await deps.portfolioRepository.listTransactions(portfolio.id);
        if (!transactions.ok) return transactions;
        withTransactions.push({ portfolio, transactions: transactions.value });
      }
      const watchlist = await deps.watchlistRepository.list();
      if (!watchlist.ok) return watchlist;
      const alerts = deps.alertRuleRepository ? await deps.alertRuleRepository.list() : ok([]);
      if (!alerts.ok) return alerts;
      const preferences = await deps.preferencesRepository.load();
      if (!preferences.ok) return preferences;
      return ok({
        format: USER_DATA_EXPORT_FORMAT,
        version: USER_DATA_EXPORT_VERSION,
        exportedAt: toIsoTimestamp(deps.clock.now()),
        portfolios: withTransactions,
        watchlist: watchlist.value,
        alerts: alerts.value,
        preferences: preferences.value ?? DEFAULT_PREFERENCES,
        note: 'Saját adatok exportja (portfólió, tranzakciók, figyelőlista, riasztások, beállítások). Piaci adatot és titkot nem tartalmaz.',
      });
    },
    async deleteAllLocalData() {
      const steps: Result<unknown, AppError>[] = [
        await deps.portfolioRepository.deleteAll(),
        await deps.watchlistRepository.clear(),
        deps.alertRuleRepository ? await deps.alertRuleRepository.clear() : ok(undefined),
        await deps.preferencesRepository.clear(),
      ];
      const cleared = deps.cache === null ? ok(0) : await deps.cache.clearAll();
      const failed = [...steps, cleared].find((r) => !r.ok);
      if (failed !== undefined && !failed.ok) return failed;
      return ok({ cacheEntriesDeleted: cleared.ok ? cleared.value : 0 });
    },
    startBackgroundRefresh() {
      // Induláskori karbantartás: a megőrzési időn túli cache-rekordok törlése (egyszer).
      void deps.cache?.prune().catch(() => undefined);
      return deps.backgroundRefresher?.start() ?? (() => undefined);
    },
    async runBackgroundRefresh() {
      return deps.backgroundRefresher === null ? null : deps.backgroundRefresher.runOnce();
    },
  };
}

/** Az export JSON-szövege (a UI másolásra/mentésre mutatja). */
export function serializeUserDataExport(data: UserDataExport): string {
  return JSON.stringify(data, null, 2);
}
