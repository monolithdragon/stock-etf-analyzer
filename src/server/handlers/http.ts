/**
 * Válasz-segédek a proxy handlereihez: boríték (ARCHITECTURE 6.3) és AppError → HTTP leképezés.
 */
import type { z } from 'zod';

import { API_VERSION, type ApiErrorCode } from '@/contracts';
import type { AppError } from '@/domain';

/**
 * Kézi frissítés és cache (PHASE 04 feladat 10.): a 04A-ban NINCS proxy cache, minden kérés
 * friss lekérés, ezért `no-store`. A TTL-alapú cache a PHASE 13 feladata (ARCHITECTURE 11.).
 */
const BASE_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
};

export function errorResponse(
  code: ApiErrorCode,
  status: number,
  message: string,
  retryAfterSec: number | null = null,
): Response {
  const headers: Record<string, string> = { ...BASE_HEADERS };
  if (retryAfterSec !== null) headers['Retry-After'] = String(retryAfterSec);
  return new Response(
    JSON.stringify({ apiVersion: API_VERSION, error: { code, message, retryAfterSec } }),
    { status, headers },
  );
}

/** AppError → (HTTP státusz, API hibakód). A kliens `apiErrorToAppError`-ja a párja. */
export function appErrorToResponse(error: AppError): Response {
  switch (error.kind) {
    case 'VALIDATION': {
      // A részletek közül kihagyjuk azt, ami szó szerint a fő üzenet (ne ismétlődjön).
      const details = error.issues
        .map((i) => (i.path ? `${i.path}: ${i.message}` : i.message))
        .filter((detail) => detail !== error.message);
      const message = details.length > 0 ? `${error.message} ${details.join(' ')}` : error.message;
      return errorResponse('VALIDATION_FAILED', 400, message.slice(0, 1000));
    }
    case 'NOT_FOUND':
      return errorResponse('NOT_FOUND', 404, error.message);
    case 'RATE_LIMITED':
      return errorResponse('RATE_LIMITED', 429, error.message, error.retryAfterSec);
    case 'TIMEOUT':
      return errorResponse('TIMEOUT', 504, error.message);
    case 'NETWORK':
      return errorResponse('UPSTREAM_ERROR', 502, error.message);
    case 'UPSTREAM':
      if (error.failure === 'INVALID_RESPONSE')
        return errorResponse('UPSTREAM_INVALID', 502, error.message);
      if (error.failure === 'NOT_IMPLEMENTED')
        return errorResponse('CAPABILITY_UNAVAILABLE', 501, error.message);
      return errorResponse('UPSTREAM_ERROR', 502, error.message);
    case 'MISSING_DATA':
      if (error.missing.includes('market'))
        return errorResponse('UNSUPPORTED_MARKET', 422, error.message);
      if (error.missing.includes('source'))
        return errorResponse('CAPABILITY_UNAVAILABLE', 501, error.message);
      return errorResponse('INTERNAL', 500, error.message);
    case 'CALCULATION_INVALID':
    case 'STORAGE':
    case 'AI':
      return errorResponse('INTERNAL', 500, 'Belső hiba.');
  }
}

/**
 * Siker-válasz. A kimenetet a KLIENSSEL KÖZÖS contract-sémán is átfuttatjuk: ha a szerver
 * olyat küldene, amit a kliens elutasítana, az itt derül ki (500), nem a felhasználónál.
 */
export function okResponse<S extends z.ZodType>(
  data: unknown,
  schema: S,
  warnings: readonly string[] = [],
): { readonly response: Response; readonly contractError: string | null } {
  const body = JSON.stringify({ apiVersion: API_VERSION, data, warnings });
  const roundTrip = (JSON.parse(body) as { data: unknown }).data;
  const check = schema.safeParse(roundTrip);
  if (!check.success) {
    const issue = check.error.issues[0];
    const where =
      issue === undefined ? '' : `${issue.path.map(String).join('.')}: ${issue.message}`;
    return {
      response: errorResponse(
        'INTERNAL',
        500,
        'A szerver válasza nem felelt meg a saját szerződésének.',
      ),
      contractError: where,
    };
  }
  return {
    response: new Response(body, { status: 200, headers: BASE_HEADERS }),
    contractError: null,
  };
}
