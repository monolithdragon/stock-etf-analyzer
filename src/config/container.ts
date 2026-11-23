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
  type AiGateway,
  type AppServices,
  type Clock,
  type FxGateway,
  type IdGenerator,
  type MarketDataGateway,
  type PortfolioRepository,
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
import { InMemoryPortfolioRepository } from '@/infrastructure/mock/in-memory-portfolio-repository';
import { createMockFxGateway } from '@/infrastructure/mock/mock-fx-gateway';
import { createMockMarketDataGateway } from '@/infrastructure/mock/mock-market-data-gateway';
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
): AppDependencies {
  const base = {
    clock,
    ids: createLocalIdGenerator(clock),
    // A tartós (SQLite) tároló a PHASE 13-ban jön; addig mindkét módban memóriában.
    portfolioRepository: new InMemoryPortfolioRepository(),
  };
  if (env.dataMode === 'mock') {
    return {
      ...base,
      marketData: createMockMarketDataGateway(clock),
      fx: createMockFxGateway(clock),
      aiGateway: disabledAiGateway,
    };
  }
  if (env.apiBaseUrl === null) {
    return {
      ...base,
      marketData: notImplementedMarketDataGateway,
      fx: notImplementedFxGateway,
      aiGateway: disabledAiGateway,
    };
  }
  const http = createProxyHttpClient({ baseUrl: env.apiBaseUrl, fetchImpl });
  return {
    ...base,
    marketData: createProxyMarketDataGateway(http),
    fx: createProxyFxGateway(http),
    aiGateway: createProxyAiGateway(http),
  };
}

/** Use case-ek összeállítása. Tesztben bármelyik függőség felülírható. */
export function createAppServices(
  env: PublicEnv,
  overrides: Partial<AppDependencies> & { readonly fetchImpl?: ClientFetch } = {},
): AppServices {
  const clock = overrides.clock ?? systemClock;
  const { fetchImpl, ...depOverrides } = overrides;
  const deps: AppDependencies = {
    ...createDefaultDependencies(env, clock, fetchImpl),
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
  };
}
