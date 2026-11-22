/**
 * Felfelé irányuló (szolgáltató felé menő) HTTP-hívás egységes hibaleképezéssel.
 *
 * Ez az EGYETLEN hely a szerveren, ahol szolgáltatói HTTP-hívás történik; minden adapter ezt
 * használja, így a timeout, az offline állapot, a rate limit és a hibás JSON kezelése egyforma.
 *
 * | Helyzet                          | AppError                         |
 * |----------------------------------|----------------------------------|
 * | időtúllépés                      | TIMEOUT (timeoutMs)              |
 * | nincs kapcsolat / DNS / TLS hiba | NETWORK                          |
 * | HTTP 429                         | RATE_LIMITED (Retry-After mp)    |
 * | HTTP 402 (napi kvóta elfogyott)  | UNAVAILABLE / QUOTA_EXHAUSTED    |
 * | HTTP 404                         | NOT_FOUND (a hívó erőforrásával) |
 * | egyéb nem 2xx                    | UPSTREAM / HTTP_ERROR            |
 * | 2xx, de nem JSON                 | UPSTREAM / INVALID_RESPONSE      |
 *
 * PHASE 04B: a 402 alapértelmezése az EODHD dokumentált viselkedése (napi keret elfogyott,
 * nem percenkénti limit → újrapróbálás aznap nem segít). Az FMP a 402-t CSOMAGKORLÁTRA
 * használja – ezt az FMP adapter a saját `mapStatus`-ával PLAN_LIMIT-re képezi.
 */
import { AppErrors, err, ok, type AppError, type Result } from '@/domain';

/** A globális `fetch` alakja – tesztben injektálható, így teszt sosem hív élő API-t. */
export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface RequestJsonOptions {
  readonly url: string;
  readonly sourceId: string;
  readonly fetchImpl: FetchLike;
  readonly timeoutMs: number;
  readonly method?: 'GET' | 'POST';
  readonly headers?: Readonly<Record<string, string>>;
  readonly body?: string;
  /** 404 esetén ez lesz a NOT_FOUND hiba erőforrása és azonosítója. */
  readonly notFound?: { readonly resource: string; readonly id: string };
  /**
   * Szolgáltató-specifikus státuszkezelés (pl. Frankfurter 422). `null` → az alapértelmezett
   * leképezés fut. A törzs már JSON-ként értelmezve (vagy `null`, ha nem JSON).
   */
  readonly mapStatus?: (status: number, body: unknown) => AppError | null;
}

export const DEFAULT_UPSTREAM_TIMEOUT_MS = 10_000;

/** `Retry-After`: másodperc vagy HTTP-dátum; ismeretlen alak → `null`. */
export function parseRetryAfter(header: string | null, now: Date = new Date()): number | null {
  if (header === null) return null;
  const trimmed = header.trim();
  if (/^\d+$/.test(trimmed)) return Number(trimmed);
  const date = Date.parse(trimmed);
  if (Number.isNaN(date)) return null;
  return Math.max(0, Math.ceil((date - now.getTime()) / 1000));
}

async function readJson(response: Response): Promise<{ ok: true; json: unknown } | { ok: false }> {
  try {
    const text = await response.text();
    return { ok: true, json: JSON.parse(text) as unknown };
  } catch {
    return { ok: false };
  }
}

export async function requestJson(options: RequestJsonOptions): Promise<Result<unknown>> {
  const { url, sourceId, timeoutMs } = options;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let response: Response;
  try {
    response = await options.fetchImpl(url, {
      method: options.method ?? 'GET',
      headers: { Accept: 'application/json', ...options.headers },
      body: options.body,
      signal: controller.signal,
    });
  } catch (error) {
    clearTimeout(timer);
    if (controller.signal.aborted) {
      return err(
        AppErrors.timeout(`A(z) ${sourceId} nem válaszolt ${timeoutMs} ms alatt.`, timeoutMs),
      );
    }
    // Az eredeti hibaüzenet tartalmazhat URL-t; nem adjuk tovább a kliensnek.
    void error;
    return err(AppErrors.network(`A(z) ${sourceId} nem érhető el (hálózati hiba).`));
  }

  const parsed = await readJson(response);
  clearTimeout(timer);
  // A törzs olvasása közbeni időtúllépés is TIMEOUT, nem „hibás JSON”.
  if (controller.signal.aborted) {
    return err(
      AppErrors.timeout(`A(z) ${sourceId} nem válaszolt ${timeoutMs} ms alatt.`, timeoutMs),
    );
  }

  const custom = options.mapStatus?.(response.status, parsed.ok ? parsed.json : null) ?? null;
  if (custom !== null) return err(custom);

  if (response.status === 429) {
    return err(
      AppErrors.rateLimited(
        `A(z) ${sourceId} rate limitje betelt.`,
        parseRetryAfter(response.headers.get('retry-after')),
      ),
    );
  }
  if (response.status === 402) {
    return err(AppErrors.unavailable('QUOTA_EXHAUSTED', `A(z) ${sourceId} napi kerete elfogyott.`));
  }
  if (response.status === 404) {
    const target = options.notFound ?? { resource: sourceId, id: '' };
    return err(AppErrors.notFound(target.resource, target.id));
  }
  if (!response.ok) {
    return err(
      AppErrors.upstream(
        'HTTP_ERROR',
        `A(z) ${sourceId} HTTP ${response.status} hibát adott.`,
        sourceId,
      ),
    );
  }
  if (!parsed.ok) {
    return err(
      AppErrors.upstream(
        'INVALID_RESPONSE',
        `A(z) ${sourceId} válasza nem érvényes JSON.`,
        sourceId,
      ),
    );
  }
  return ok(parsed.json);
}

/** Szolgáltatói DTO-séma hibája → UPSTREAM / INVALID_RESPONSE, az első hiba útvonalával. */
export function invalidUpstream(
  sourceId: string,
  issue: { readonly path: readonly PropertyKey[]; readonly message: string } | undefined,
): AppError {
  const where =
    issue === undefined
      ? ''
      : ` (${issue.path.map(String).join('.') || 'gyökér'}: ${issue.message})`;
  return AppErrors.upstream(
    'INVALID_RESPONSE',
    `A(z) ${sourceId} válasza nem a várt formátumú${where}.`,
    sourceId,
  );
}
