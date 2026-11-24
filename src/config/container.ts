/**
 * Composition root (kézi dependency injection, ARCHITECTURE 7.).
 *
 * Itt – és CSAK itt – dől el, melyik konkrét adapter kerül egy port mögé.
 * A UI a kész `AppServices`-t kapja (React Contexten át), az adaptereket nem ismeri.
 */
import {
  createAnalyzeEtf,
  createEvaluateEtf,
  createEvaluateStock,
  createExplainAnalysis,
  createAnalyzePortfolio,
  createAnalyzeStockFundamentals,
  createAnalyzeStockValuation,
  createRecalculateStockValuation,
  createConvertMoney,
  createCreatePortfolio,
  createGetDividendHistory,
  createGetFinancialStatements,
  createGetInstrumentProfile,
  createGetListingQuote,
  createGetPriceHistory,
  createGetSecurityListings,
  createRecordTransaction,
  createSearchInstruments,
  collectRefreshTargets,
  createBackgroundRefresher,
  createLocalDataService,
  createMarketDataCache,
  createPreferencesService,
  createWatchlistService,
  DEFAULT_PREFERENCES,
  type AiGateway,
  type AppServices,
  type CacheControl,
  type Clock,
  type ConnectivityMonitor,
  type FxGateway,
  type IdGenerator,
  type MarketDataGateway,
  type PortfolioRepository,
  type PreferencesRepository,
  type WatchlistRepository,
} from '@/application';
import {
  notImplementedFxGateway,
  notImplementedMarketDataGateway,
} from '@/infrastructure/api-client/not-implemented-market-data-gateway';
import {
  createProxyAiGateway,
  disabledAiGateway,
} from '@/infrastructure/api-client/proxy-ai-gateway';
import {
  createProxyFxGateway,
  createProxyMarketDataGateway,
} from '@/infrastructure/api-client/proxy-gateways';
import {
  createProxyHttpClient,
  type ClientFetch,
} from '@/infrastructure/api-client/proxy-http-client';
import { createMockFxGateway } from '@/infrastructure/mock/mock-fx-gateway';
import { createMockMarketDataGateway } from '@/infrastructure/mock/mock-market-data-gateway';
import { createDefaultLocalStorage } from '@/infrastructure/storage/default-storage';
import type { LocalStorage } from '@/infrastructure/storage/local-storage';
import { createLocalIdGenerator, systemClock } from '@/infrastructure/system/system-clock';

import type { PublicEnv } from './env';

export interface AppDependencies {
  readonly clock: Clock;
  readonly ids: IdGenerator;
  readonly marketData: MarketDataGateway;
  readonly fx: FxGateway;
  readonly portfolioRepository: PortfolioRepository;
  /** PHASE 11: opcionális LLM-magyarázat (demó módban / proxy nélkül kikapcsolt). */
  readonly aiGateway: AiGateway;
  /** PHASE 13: tartós figyelőlista és beállítások. */
  readonly watchlistRepository: WatchlistRepository;
  readonly preferencesRepository: PreferencesRepository;
  readonly connectivity: ConnectivityMonitor;
  /**
   * PHASE 13: az eszköz-cache vezérlője – csak élő módban (proxyval) van cache; demó módban és
   * proxy nélkül `null` (a demóadatot nincs értelme tárolni).
   */
  readonly cacheControl: CacheControl | null;
  /** A helyi tárolás tartós-e (natív SQLite) vagy memóriabeli (web). */
  readonly persistentStorage: boolean;
}

/** A globális fetch, késleltetve feloldva (tesztben a `fetchImpl` felülírható). */
const globalFetch: ClientFetch = (input, init) => fetch(input, init);

/**
 * Az adatmódnak megfelelő alapértelmezett adapterek.
 * - `mock`: demóadat (`kind: 'mock'`), hálózat nélkül;
 * - `live` + proxy URL: a proxy gateway-ek;
 * - `live` URL nélkül: őszinte hibát adó helyőrzők (nem csendes demóadat).
 * Az órát kívülről kapja, hogy egy (tesztben) felülírt óra az adapterekhez is eljusson.
 */
export function createDefaultDependencies(
  env: PublicEnv,
  clock: Clock = systemClock,
  fetchImpl: ClientFetch = globalFetch,
  storage: LocalStorage = createDefaultLocalStorage(),
): AppDependencies {
  const base = {
    clock,
    ids: createLocalIdGenerator(clock),
    // PHASE 13: natívon SQLite + kv-store, weben memória (D-082).
    portfolioRepository: storage.portfolioRepository,
    watchlistRepository: storage.watchlistRepository,
    preferencesRepository: storage.preferencesRepository,
    connectivity: storage.connectivity,
    persistentStorage: storage.persistent,
  };
  if (env.dataMode === 'mock') {
    return {
      ...base,
      marketData: createMockMarketDataGateway(clock),
      fx: createMockFxGateway(clock),
      aiGateway: disabledAiGateway,
      cacheControl: null,
    };
  }
  if (env.apiBaseUrl === null) {
    return {
      ...base,
      marketData: notImplementedMarketDataGateway,
      fx: notImplementedFxGateway,
      aiGateway: disabledAiGateway,
      cacheControl: null,
    };
  }
  const http = createProxyHttpClient({ baseUrl: env.apiBaseUrl, fetchImpl });
  // PHASE 13: a proxy gateway-ek elé kerül az eszköz-cache (a use case-ek erről nem tudnak).
  const cache = createMarketDataCache({
    marketData: createProxyMarketDataGateway(http),
    fx: createProxyFxGateway(http),
    store: storage.cacheStore,
    clock,
    connectivity: storage.connectivity,
  });
  return {
    ...base,
    marketData: cache.marketData,
    fx: cache.fx,
    aiGateway: createProxyAiGateway(http),
    cacheControl: cache.control,
  };
}

/** Use case-ek összeállítása. Tesztben bármelyik függőség felülírható. */
export function createAppServices(
  env: PublicEnv,
  overrides: Partial<AppDependencies> & {
    readonly fetchImpl?: ClientFetch;
    /** PHASE 13: a helyi tárolók (tesztben memória vagy Node-SQLite). */
    readonly storage?: LocalStorage;
  } = {},
): AppServices {
  const clock = overrides.clock ?? systemClock;
  const { fetchImpl, storage, ...depOverrides } = overrides;
  const deps: AppDependencies = {
    ...createDefaultDependencies(env, clock, fetchImpl, storage),
    // Saját (felülírt) marketData mellé nem tartozik a default cache vezérlője.
    ...(depOverrides.marketData !== undefined ? { cacheControl: null } : {}),
    ...depOverrides,
  };
  const market = { marketData: deps.marketData, clock: deps.clock };
  const getListingQuote = createGetListingQuote(market);
  const getFinancialStatements = createGetFinancialStatements(market);
  const getPriceHistory = createGetPriceHistory(market);
  const getInstrumentProfile = createGetInstrumentProfile(market);
  const getDividendHistory = createGetDividendHistory(market);
  const convertMoney = createConvertMoney({ fxGateway: deps.fx, clock: deps.clock });
  const analyzeStockFundamentals = createAnalyzeStockFundamentals({
    getFinancialStatements,
    getListingQuote,
    getInstrumentProfile,
    getPriceHistory,
    getDividendHistory,
    clock: deps.clock,
  });
  const analyzeStockValuation = createAnalyzeStockValuation({
    analyzeStockFundamentals,
    clock: deps.clock,
  });
  const analyzeEtf = createAnalyzeEtf({
    getListingQuote,
    getPriceHistory,
    getDividendHistory,
    getInstrumentProfile,
    convertMoney,
    clock: deps.clock,
  });
  const preferences = createPreferencesService({ repository: deps.preferencesRepository });
  const backgroundRefresher =
    deps.cacheControl === null
      ? null
      : createBackgroundRefresher({
          control: deps.cacheControl,
          marketData: deps.marketData,
          clock: deps.clock,
          connectivity: deps.connectivity,
          targets: () =>
            collectRefreshTargets({
              portfolioRepository: deps.portfolioRepository,
              watchlistRepository: deps.watchlistRepository,
            }),
          isEnabled: async () => {
            const loaded = await preferences.load();
            return (loaded.ok ? loaded.value : DEFAULT_PREFERENCES).refresh.refreshOnReconnect;
          },
        });
  return {
    getListingQuote,
    getSecurityListings: createGetSecurityListings(market),
    getFinancialStatements,
    getPriceHistory,
    getInstrumentProfile,
    getDividendHistory,
    searchInstruments: createSearchInstruments(market),
    convertMoney,
    recordTransaction: createRecordTransaction({
      portfolioRepository: deps.portfolioRepository,
      clock: deps.clock,
      ids: deps.ids,
    }),
    createPortfolio: createCreatePortfolio({
      portfolioRepository: deps.portfolioRepository,
      clock: deps.clock,
      ids: deps.ids,
    }),
    analyzeStockFundamentals,
    analyzeStockValuation,
    recalculateStockValuation: createRecalculateStockValuation({ clock: deps.clock }),
    analyzeEtf,
    analyzePortfolio: createAnalyzePortfolio({
      portfolioRepository: deps.portfolioRepository,
      getListingQuote,
      getInstrumentProfile,
      getPriceHistory,
      convertMoney,
      clock: deps.clock,
    }),
    evaluateStock: createEvaluateStock({ analyzeStockValuation }),
    evaluateEtf: createEvaluateEtf({ analyzeEtf }),
    explainAnalysis: createExplainAnalysis({ aiGateway: deps.aiGateway, clock: deps.clock }),
    preferences,
    watchlist: createWatchlistService({ repository: deps.watchlistRepository, clock: deps.clock }),
    localData: createLocalDataService({
      cache: deps.cacheControl,
      backgroundRefresher,
      portfolioRepository: deps.portfolioRepository,
      watchlistRepository: deps.watchlistRepository,
      preferencesRepository: deps.preferencesRepository,
      clock: deps.clock,
      persistent: deps.persistentStorage,
    }),
  };
}
