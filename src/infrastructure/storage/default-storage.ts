/**
 * Natív (Android/iOS) alapértelmezett tárolás (PHASE 13, D-082):
 * - strukturált adat + cache: `expo-sqlite` (egy adatbázisfájl, verziózott migrációval);
 * - kis beállítások: `expo-sqlite/kv-store`;
 * - hálózati állapot: `expo-network`.
 * Weben a Metro a `default-storage.web.ts`-t választja (memória, SQLite/WASM nélkül).
 */
import { Storage } from 'expo-sqlite/kv-store';

import { createExpoConnectivityMonitor } from '@/infrastructure/system/expo-connectivity';

import { createDatabaseProvider } from './database-provider';
import { openExpoDatabase } from './expo-sqlite-database';
import { createKvPreferencesRepository } from './kv-preferences-repository';
import type { LocalStorage } from './local-storage';
import { createSqliteAlertRuleRepository } from './sqlite-alert-rule-repository';
import { createSqliteCacheStore } from './sqlite-cache-store';
import { createSqlitePortfolioRepository } from './sqlite-portfolio-repository';
import { createSqliteWatchlistRepository } from './sqlite-watchlist-repository';

export function createDefaultLocalStorage(): LocalStorage {
  const provider = createDatabaseProvider(() => openExpoDatabase());
  return {
    portfolioRepository: createSqlitePortfolioRepository(provider),
    watchlistRepository: createSqliteWatchlistRepository(provider),
    alertRuleRepository: createSqliteAlertRuleRepository(provider),
    preferencesRepository: createKvPreferencesRepository(Storage),
    cacheStore: createSqliteCacheStore(provider),
    connectivity: createExpoConnectivityMonitor(),
    persistent: true,
  };
}
