/**
 * A proxy composition rootja: env → szolgáltatók → handlerek. Csak itt dől el, hogy élő vagy
 * mock szolgáltatók futnak (soha nem vegyesen).
 */
import { parseServerEnv, type RawServerEnv, type ServerEnvIssue } from './env';
import { createApiHandlers, type ApiHandlers } from './handlers/api-handlers';
import type { FetchLike } from './http/request-json';
import { consoleServerLogger, type ServerLogger } from './logging';
import { createEcbFxProvider } from './providers/ecb-fx/ecb-fx-provider';
import { createEodhdProvider } from './providers/eodhd/eodhd-provider';
import { createFmpProvider } from './providers/fmp/fmp-provider';
import {
  createProviderRegistry,
  type MarketDataProvider,
  type ProviderRegistry,
} from './providers/market-data-provider';
import { createMockProvider } from './providers/mock/mock-provider';
import { createOpenFigiProvider } from './providers/openfigi/openfigi-provider';
import { createSecEdgarProvider } from './providers/sec-edgar/sec-edgar-provider';
import { createProviderRouter, type ProviderRouter } from './routing/provider-router';
import { createDailyQuota, type QuotaGuard } from './routing/quota';

export interface ServerContextOptions {
  readonly rawEnv: RawServerEnv;
  readonly fetchImpl: FetchLike;
  readonly now?: () => Date;
  readonly logger?: ServerLogger;
}

export interface ServerContext {
  readonly registry: ProviderRegistry;
  readonly router: ProviderRouter;
  readonly handlers: ApiHandlers;
  readonly envIssues: readonly ServerEnvIssue[];
}

export function createServerContext(options: ServerContextOptions): ServerContext {
  const now = options.now ?? (() => new Date());
  const { env, issues } = parseServerEnv(options.rawEnv);
  const quotas = new Map<string, QuotaGuard>();
  let providers: MarketDataProvider[];
  if (env.dataMode === 'mock') {
    providers = [createMockProvider({ now })];
  } else {
    const fmpQuota = createDailyQuota({
      providerId: 'fmp',
      dailyLimit: env.fmpPlan.dailyQuota,
      now,
    });
    const eodhdQuota = createDailyQuota({
      providerId: 'eodhd',
      dailyLimit: env.eodhdPlan.dailyQuota,
      now,
    });
    quotas.set('fmp', fmpQuota);
    quotas.set('eodhd', eodhdQuota);
    const fetchImpl = options.fetchImpl;
    providers = [
      createSecEdgarProvider({ fetchImpl, now, userAgent: env.secUserAgent }),
      createEcbFxProvider({ fetchImpl, now }),
      createOpenFigiProvider({ fetchImpl, now, apiKey: env.openFigiApiKey }),
      createFmpProvider({
        fetchImpl,
        now,
        apiKey: env.fmpApiKey,
        plan: env.fmpPlan,
        quota: fmpQuota,
      }),
      createEodhdProvider({
        fetchImpl,
        now,
        apiKey: env.eodhdApiKey,
        plan: env.eodhdPlan,
        quota: eodhdQuota,
      }),
    ];
  }
  const registry = createProviderRegistry(env.dataMode, providers);
  const logger = options.logger ?? consoleServerLogger;
  for (const issue of issues) {
    // Az érték soha nem kerül a naplóba, csak a változó neve és a teendő.
    console.warn(
      JSON.stringify({ level: 'warn', envVariable: issue.variable, message: issue.message }),
    );
  }
  const router = createProviderRouter(registry);
  return {
    registry,
    router,
    handlers: createApiHandlers({ registry, router, quotas, now, logger }),
    envIssues: issues,
  };
}

/**
 * A futó proxy egyetlen példánya, a `globalThis`-en tárolva (PHASE 04B lelet, KI-31): az Expo
 * minden `+api.ts` route-ot KÜLÖN bundle-be fordít, így egy modul-szintű változó route-onként
 * külön példány lenne – a kvóta-számláló és a memók nem látnák egymást. A `globalThis` egy
 * folyamaton belül közös; több szerverpéldány között továbbra sem (KI-23, U-03).
 */
const GLOBAL_KEY = '__stockEtfAnalyzerServerContext';
type GlobalWithContext = typeof globalThis & { [GLOBAL_KEY]?: ServerContext };

export function getServerContext(): ServerContext {
  const holder = globalThis as GlobalWithContext;
  holder[GLOBAL_KEY] ??= createServerContext({
    rawEnv: {
      PROXY_DATA_MODE: process.env.PROXY_DATA_MODE,
      SEC_USER_AGENT: process.env.SEC_USER_AGENT,
      OPENFIGI_API_KEY: process.env.OPENFIGI_API_KEY,
      FMP_API_KEY: process.env.FMP_API_KEY,
      FMP_PLAN: process.env.FMP_PLAN,
      EODHD_API_KEY: process.env.EODHD_API_KEY,
      EODHD_PLAN: process.env.EODHD_PLAN,
    },
    fetchImpl: (input, init) => fetch(input, init),
  });
  return holder[GLOBAL_KEY];
}
