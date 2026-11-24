/**
 * A helyi tárolók csomagja (PHASE 13, D-082). A composition root ezt kapja platformonként:
 * natívon SQLite + kv-store (`default-storage.ts`), weben memória (`default-storage.web.ts`).
 */
import type {
  CacheStore,
  ConnectivityMonitor,
  PortfolioRepository,
  PreferencesRepository,
  WatchlistRepository,
} from '@/application';
import { InMemoryPortfolioRepository } from '@/infrastructure/mock/in-memory-portfolio-repository';
import { unknownConnectivity } from '@/infrastructure/system/expo-connectivity';

import { createInMemoryCacheStore, createInMemoryWatchlistRepository } from './in-memory-stores';
import {
  createKvPreferencesRepository,
  createMemoryKeyValueStore,
} from './kv-preferences-repository';

export interface LocalStorage {
  readonly portfolioRepository: PortfolioRepository;
  readonly watchlistRepository: WatchlistRepository;
  readonly preferencesRepository: PreferencesRepository;
  readonly cacheStore: CacheStore;
  readonly connectivity: ConnectivityMonitor;
  /** `false`: memóriában (újraindításkor elvész) – a UI ezt jelzi. */
  readonly persistent: boolean;
}

export function createInMemoryLocalStorage(): LocalStorage {
  return {
    portfolioRepository: new InMemoryPortfolioRepository(),
    watchlistRepository: createInMemoryWatchlistRepository(),
    preferencesRepository: createKvPreferencesRepository(createMemoryKeyValueStore()),
    cacheStore: createInMemoryCacheStore(),
    connectivity: unknownConnectivity,
    persistent: false,
  };
}
