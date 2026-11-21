/**
 * A proxy composition rootja: env → szolgáltatók → handlerek. Csak itt dől el, hogy élő vagy
 * mock szolgáltatók futnak (soha nem vegyesen).
 */
import { parseServerEnv, type RawServerEnv, type ServerEnvIssue } from './env';
import { createApiHandlers, type ApiHandlers } from './handlers/api-handlers';
import type { FetchLike } from './http/request-json';
import { consoleServerLogger, type ServerLogger } from './logging';
import { createEcbFxProvider } from './providers/ecb-fx/ecb-fx-provider';
import { createProviderRegistry, type ProviderRegistry } from './providers/market-data-provider';
import { createMockProvider } from './providers/mock/mock-provider';
import { createOpenFigiProvider } from './providers/openfigi/openfigi-provider';
import { createSecEdgarProvider } from './providers/sec-edgar/sec-edgar-provider';

export interface ServerContextOptions {
  readonly rawEnv: RawServerEnv;
  readonly fetchImpl: FetchLike;
  readonly now?: () => Date;
  readonly logger?: ServerLogger;
}

export interface ServerContext {
  readonly registry: ProviderRegistry;
  readonly handlers: ApiHandlers;
  readonly envIssues: readonly ServerEnvIssue[];
}

export function createServerContext(options: ServerContextOptions): ServerContext {
  const now = options.now ?? (() => new Date());
  const { env, issues } = parseServerEnv(options.rawEnv);
  const providers =
    env.dataMode === 'mock'
      ? [createMockProvider({ now })]
      : [
          createSecEdgarProvider({
            fetchImpl: options.fetchImpl,
            now,
            userAgent: env.secUserAgent,
          }),
          createEcbFxProvider({ fetchImpl: options.fetchImpl, now }),
          createOpenFigiProvider({ fetchImpl: options.fetchImpl, now, apiKey: env.openFigiApiKey }),
        ];
  const registry = createProviderRegistry(env.dataMode, providers);
  const logger = options.logger ?? consoleServerLogger;
  for (const issue of issues) {
    // Az érték soha nem kerül a naplóba, csak a változó neve és a teendő.
    console.warn(
      JSON.stringify({ level: 'warn', envVariable: issue.variable, message: issue.message }),
    );
  }
  return { registry, handlers: createApiHandlers({ registry, now, logger }), envIssues: issues };
}

let singleton: ServerContext | null = null;

/** A futó proxy egyetlen példánya (lusta létrehozás, hogy az env a kérés idején olvasódjon). */
export function getServerContext(): ServerContext {
  singleton ??= createServerContext({
    rawEnv: {
      PROXY_DATA_MODE: process.env.PROXY_DATA_MODE,
      SEC_USER_AGENT: process.env.SEC_USER_AGENT,
      OPENFIGI_API_KEY: process.env.OPENFIGI_API_KEY,
    },
    fetchImpl: (input, init) => fetch(input, init),
  });
  return singleton;
}
