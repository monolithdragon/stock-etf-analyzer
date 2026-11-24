/**
 * Kliensoldali HTTP-kliens a saját proxyhoz (ARCHITECTURE 4.1 [3b]: bizalmi határ).
 *
 * | Helyzet                                  | AppError                          |
 * |------------------------------------------|-----------------------------------|
 * | nincs hálózat / a proxy nem érhető el    | NETWORK (offline)                 |
 * | időtúllépés                              | TIMEOUT                           |
 * | nem a mi borítékunk + HTTP 429            | RATE_LIMITED (`Retry-After` mp)   |
 * | nem a mi borítékunk + HTTP 408/504        | TIMEOUT                           |
 * | nem a mi borítékunk + egyéb HTTP ≥ 400    | UPSTREAM / HTTP_ERROR             |
 * | a válasz nem JSON, HTTP 2xx/3xx           | UPSTREAM / CONTRACT_MISMATCH      |
 * | érvényes hiba-boríték                    | `apiErrorToAppError` szerint      |
 * | a `data` nem felel meg a sémának         | UPSTREAM / CONTRACT_MISMATCH      |
 *
 * PHASE 15: korábban a hoszt nem-JSON 429/5xx válasza is „nem JSON” szerződéssértés lett, így a
 * felhasználó nem tudta, hogy elég később újrapróbálni.
 */
import type { z } from 'zod';

import { parseApiResponse } from '@/contracts';
import { AppErrors, err, type AppError, type Result } from '@/domain';

export type ClientFetch = (input: string, init?: RequestInit) => Promise<Response>;

export interface ProxyHttpClient {
  get<S extends z.ZodType>(path: string, schema: S): Promise<Result<z.output<S>>>;
  /** JSON-törzsű POST (PHASE 11: `/api/v1/ai/explain`); opcionálisan saját timeouttal. */
  post<S extends z.ZodType>(
    path: string,
    body: unknown,
    schema: S,
    options?: { readonly timeoutMs?: number },
  ): Promise<Result<z.output<S>>>;
}

export interface ProxyHttpClientOptions {
  /** Pl. `http://192.168.0.10:8081` (záró `/` nélkül, `EXPO_PUBLIC_API_BASE_URL`). */
  readonly baseUrl: string;
  readonly fetchImpl: ClientFetch;
  readonly timeoutMs?: number;
}

export const DEFAULT_PROXY_TIMEOUT_MS = 20_000;
/** Józansági felső korlát a `Retry-After` értékére (1 nap). */
const MAX_RETRY_AFTER_SEC = 86_400;

/**
 * `Retry-After` → másodperc. Csak a nemnegatív egész másodperc alakot fogadjuk el; a HTTP-dátum
 * alakot és a hibás értéket `null`-ként adjuk tovább (nem találunk ki várakozási időt).
 */
export function parseRetryAfterSeconds(raw: string | null): number | null {
  if (raw === null || !/^\d{1,6}$/.test(raw.trim())) return null;
  return Math.min(Number(raw.trim()), MAX_RETRY_AFTER_SEC);
}

const isContractMismatch = (error: AppError) =>
  error.kind === 'UPSTREAM' && error.failure === 'CONTRACT_MISMATCH';

/**
 * Nem a saját borítékunkban érkezett válasz (pl. az EAS Hosting / egy átjáró HTML- vagy
 * szöveges hibaoldala) → a HTTP-státusz alapján értelmes hiba, nem „szerződéssértés”.
 */
function nonJsonError(status: number, retryAfter: string | null): AppError {
  if (status === 429) {
    return AppErrors.rateLimited(
      'Túl sok kérés a szerver felé (HTTP 429). Próbáld újra később.',
      parseRetryAfterSeconds(retryAfter),
    );
  }
  if (status === 504 || status === 408) {
    return AppErrors.timeout(`A szerver átjárója időtúllépést jelzett (HTTP ${status}).`);
  }
  if (status >= 400) {
    return AppErrors.upstream(
      'HTTP_ERROR',
      `A szerver hibát adott (HTTP ${status}), a válasz nem az alkalmazás formátumában érkezett.`,
      'proxy',
    );
  }
  return AppErrors.upstream('CONTRACT_MISMATCH', 'A szerver válasza nem JSON.', 'proxy');
}

export function createProxyHttpClient(options: ProxyHttpClientOptions): ProxyHttpClient {
  const timeoutMs = options.timeoutMs ?? DEFAULT_PROXY_TIMEOUT_MS;

  async function send<S extends z.ZodType>(
    path: string,
    init: { readonly method: 'GET' | 'POST'; readonly body?: string },
    schema: S,
    requestTimeoutMs: number,
  ): Promise<Result<z.output<S>>> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), requestTimeoutMs);
    let text: string;
    let status: number;
    let retryAfter: string | null;
    try {
      const response = await options.fetchImpl(`${options.baseUrl}${path}`, {
        method: init.method,
        headers:
          init.body === undefined
            ? { Accept: 'application/json' }
            : { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: init.body,
        signal: controller.signal,
      });
      status = response.status;
      retryAfter = response.headers.get('Retry-After');
      text = await response.text();
    } catch {
      return controller.signal.aborted
        ? err(
            AppErrors.timeout(
              `A szerver nem válaszolt ${requestTimeoutMs} ms alatt.`,
              requestTimeoutMs,
            ),
          )
        : err(AppErrors.network('Nincs kapcsolat a szerverrel (offline vagy a proxy nem fut).'));
    } finally {
      clearTimeout(timer);
    }

    let json: unknown;
    try {
      json = JSON.parse(text) as unknown;
    } catch {
      return err(nonJsonError(status, retryAfter));
    }
    const parsed = parseApiResponse(json, schema);
    // PHASE 15: egy hoszt/átjáró JSON-hibaoldala (nem a mi borítékunk) se tűnjön szerződéssértésnek.
    if (!parsed.ok && status >= 400 && isContractMismatch(parsed.error)) {
      return err(nonJsonError(status, retryAfter));
    }
    return parsed;
  }

  return {
    get: (path, schema) => send(path, { method: 'GET' }, schema, timeoutMs),
    post: (path, body, schema, postOptions) =>
      send(
        path,
        { method: 'POST', body: JSON.stringify(body) },
        schema,
        postOptions?.timeoutMs ?? timeoutMs,
      ),
  };
}
