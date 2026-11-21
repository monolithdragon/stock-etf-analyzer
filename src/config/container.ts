/**
 * Composition root (kézi dependency injection, ARCHITECTURE 7.).
 *
 * Itt – és CSAK itt – dől el, melyik konkrét adapter kerül egy port mögé.
 * A UI a kész `AppServices`-t kapja (React Contexten át), az adaptereket nem ismeri.
 */
import {
  createGetListingQuote,
  createRecordTransaction,
  type AppServices,
  type Clock,
  type IdGenerator,
  type MarketDataGateway,
  type PortfolioRepository,
} from '@/application';
import { notImplementedMarketDataGateway } from '@/infrastructure/api-client/not-implemented-market-data-gateway';
import { InMemoryPortfolioRepository } from '@/infrastructure/mock/in-memory-portfolio-repository';
import { createMockMarketDataGateway } from '@/infrastructure/mock/mock-market-data-gateway';
import { createLocalIdGenerator, systemClock } from '@/infrastructure/system/system-clock';

import type { PublicEnv } from './env';

export interface AppDependencies {
  readonly clock: Clock;
  readonly ids: IdGenerator;
  readonly marketData: MarketDataGateway;
  readonly portfolioRepository: PortfolioRepository;
}

/**
 * Az adatmódnak megfelelő alapértelmezett adapterek.
 * Az órát kívülről kapja, hogy egy (tesztben) felülírt óra az adapterekhez is eljusson.
 */
export function createDefaultDependencies(
  env: PublicEnv,
  clock: Clock = systemClock,
): AppDependencies {
  return {
    clock,
    ids: createLocalIdGenerator(clock),
    // live: a proxy kliens a PHASE 04A-ban váltja a helyőrzőt.
    marketData:
      env.dataMode === 'mock'
        ? createMockMarketDataGateway(clock)
        : notImplementedMarketDataGateway,
    // A tartós (SQLite) tároló a PHASE 13-ban jön; addig mindkét módban memóriában.
    portfolioRepository: new InMemoryPortfolioRepository(),
  };
}

/** Use case-ek összeállítása. Tesztben bármelyik függőség felülírható. */
export function createAppServices(
  env: PublicEnv,
  overrides: Partial<AppDependencies> = {},
): AppServices {
  const clock = overrides.clock ?? systemClock;
  const deps: AppDependencies = { ...createDefaultDependencies(env, clock), ...overrides };
  return {
    getListingQuote: createGetListingQuote({ marketData: deps.marketData, clock: deps.clock }),
    recordTransaction: createRecordTransaction({
      portfolioRepository: deps.portfolioRepository,
      clock: deps.clock,
      ids: deps.ids,
    }),
  };
}
