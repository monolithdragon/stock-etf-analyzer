/**
 * Kliensoldali HTTP-kliens a saját proxyhoz (ARCHITECTURE 4.1 [3b]: bizalmi határ).
 *
 * | Helyzet                                  | AppError                          |
 * |------------------------------------------|-----------------------------------|
 * | nincs hálózat / a proxy nem érhető el    | NETWORK (offline)                 |
 * | időtúllépés                              | TIMEOUT                           |
 * | a válasz nem JSON (pl. hoszt HTML-hibája) | UPSTREAM / CONTRACT_MISMATCH      |
 * | érvényes hiba-boríték                    | `apiErrorToAppError` szerint      |
 * | a `data` nem felel meg a sémának         | UPSTREAM / CONTRACT_MISMATCH      |
 */
import type { z } from 'zod';

import { parseApiResponse } from '@/contracts';
import { AppErrors, err, type Result } from '@/domain';

export type ClientFetch = (input: string, init?: RequestInit) => Promise<Response>;

export interface ProxyHttpClient {
  get<S extends z.ZodType>(path: string, schema: S): Promise<Result<z.output<S>>>;
}

export interface ProxyHttpClientOptions {
  /** Pl. `http://192.168.0.10:8081` (záró `/` nélkül, `EXPO_PUBLIC_API_BASE_URL`). */
  readonly baseUrl: string;
  readonly fetchImpl: ClientFetch;
  readonly timeoutMs?: number;
}

export const DEFAULT_PROXY_TIMEOUT_MS = 20_000;

export function createProxyHttpClient(options: ProxyHttpClientOptions): ProxyHttpClient {
  const timeoutMs = options.timeoutMs ?? DEFAULT_PROXY_TIMEOUT_MS;

  return {
    async get(path, schema) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      let text: string;
      try {
        const response = await options.fetchImpl(`${options.baseUrl}${path}`, {
          method: 'GET',
          headers: { Accept: 'application/json' },
          signal: controller.signal,
        });
        text = await response.text();
      } catch {
        return controller.signal.aborted
          ? err(AppErrors.timeout(`A szerver nem válaszolt ${timeoutMs} ms alatt.`, timeoutMs))
          : err(AppErrors.network('Nincs kapcsolat a szerverrel (offline vagy a proxy nem fut).'));
      } finally {
        clearTimeout(timer);
      }

      let json: unknown;
      try {
        json = JSON.parse(text) as unknown;
      } catch {
        return err(AppErrors.upstream('CONTRACT_MISMATCH', 'A szerver válasza nem JSON.', 'proxy'));
      }
      return parseApiResponse(json, schema);
    },
  };
}
