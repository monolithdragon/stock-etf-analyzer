/**
 * A proxy composition rootja: env → szolgáltatók → handlerek. Csak itt dől el, hogy élő vagy
 * mock szolgáltatók futnak (soha nem vegyesen).
 */
import { parseAiConfig, type AiConfig, type RawAiEnv } from './ai/ai-config';
import { createAiExplainService, type AiExplainService } from './ai/ai-explain-service';
import type { AiProvider } from './ai/ai-provider';
import { createAnthropicAiProvider, createSdkMessagesClient } from './ai/anthropic-ai-provider';
import { createMockAiProvider } from './ai/mock-ai-provider';
import { parseServerEnv, type RawServerEnv, type ServerEnvIssue } from './env';
import { createAiExplainHandler } from './handlers/ai-handler';
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
  readonly rawEnv: RawServerEnv & RawAiEnv;
  /** Tesztben: kész AI-provider (élő hívás nélkül); különben az env alapján épül. */
  readonly aiProvider?: AiProvider | null;
  readonly fetchImpl: FetchLike;
  readonly now?: () => Date;
  readonly logger?: ServerLogger;
}

export interface ServerContext {
  readonly registry: ProviderRegistry;
  readonly router: ProviderRouter;
  readonly handlers: ApiHandlers;
  /** PHASE 11: AI-magyarázat (`POST /api/v1/ai/explain`). */
  readonly ai: {
    readonly service: AiExplainService;
    readonly explain: (request: Request) => Promise<Response>;
  };
  readonly envIssues: readonly ServerEnvIssue[];
}

/** Az env-ből: `null`, ha az LLM ki van kapcsolva (alapállapot, D-026). */
function createAiProviderFromConfig(config: AiConfig): AiProvider | null {
  if (!config.enabled) return null;
  if (config.provider === 'mock') return createMockAiProvider();
  if (config.provider === 'anthropic' && config.anthropicApiKey !== null) {
    return createAnthropicAiProvider({
      model: config.model,
      effort: config.effort,
      client: createSdkMessagesClient({
        apiKey: config.anthropicApiKey,
        timeoutMs: config.timeoutMs,
      }),
    });
  }
  return null;
}

export function createServerContext(options: ServerContextOptions): ServerContext {
  const now = options.now ?? (() => new Date());
  const { env, issues: dataIssues } = parseServerEnv(options.rawEnv);
  const { config: aiConfig, issues: aiIssues } = parseAiConfig(options.rawEnv);
  const issues = [...dataIssues, ...aiIssues];
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
  const aiService = createAiExplainService({
    config: aiConfig,
    provider:
      options.aiProvider === undefined ? createAiProviderFromConfig(aiConfig) : options.aiProvider,
    now,
  });
  return {
    registry,
    router,
    handlers: createApiHandlers({ registry, router, quotas, now, logger }),
    ai: {
      service: aiService,
      explain: createAiExplainHandler({ service: aiService, logger, now }),
    },
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
      AI_PROVIDER: process.env.AI_PROVIDER,
      AI_ENABLED: process.env.AI_ENABLED,
      ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
      AI_MODEL: process.env.AI_MODEL,
      AI_EFFORT: process.env.AI_EFFORT,
      AI_MAX_OUTPUT_TOKENS: process.env.AI_MAX_OUTPUT_TOKENS,
      AI_DAILY_LIMIT: process.env.AI_DAILY_LIMIT,
      AI_TIMEOUT_MS: process.env.AI_TIMEOUT_MS,
    },
    fetchImpl: (input, init) => fetch(input, init),
  });
  return holder[GLOBAL_KEY];
}
