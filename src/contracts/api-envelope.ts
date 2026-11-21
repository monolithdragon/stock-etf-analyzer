/**
 * Válasz-boríték és hibakódok (ARCHITECTURE 6.3) – contract v1 váz.
 * A kliens a proxy válaszát MINDIG ezen keresztül értelmezi (bizalmi határ, [3b] lépés).
 */
import { z } from 'zod';

import { AppErrors, err, ok, type AppError, type Result } from '@/domain';

export const API_VERSION = '1';

export const API_ERROR_CODES = [
  'VALIDATION_FAILED',
  'NOT_FOUND',
  'UNSUPPORTED_MARKET',
  /** Ehhez a képességhez nincs bekötött forrás (pl. árfolyam a PHASE 04B-ig). PHASE 04A. */
  'CAPABILITY_UNAVAILABLE',
  'RATE_LIMITED',
  'TIMEOUT',
  'UPSTREAM_ERROR',
  'UPSTREAM_INVALID',
  'AI_DISABLED',
  'AI_INVALID_OUTPUT',
  'AI_REFUSED',
  'INTERNAL',
] as const;
export type ApiErrorCode = (typeof API_ERROR_CODES)[number];

export const apiErrorSchema = z.object({
  apiVersion: z.literal(API_VERSION),
  error: z.object({
    code: z.enum(API_ERROR_CODES),
    message: z.string().max(1000),
    retryAfterSec: z.number().int().nonnegative().nullable().optional(),
  }),
});
export type ApiErrorDto = z.output<typeof apiErrorSchema>['error'];

/** Siker-boríték; a `data` tartalmát a végpont saját sémája ellenőrzi (`parseApiResponse`). */
export const apiSuccessEnvelopeSchema = z.object({
  apiVersion: z.literal(API_VERSION),
  data: z.unknown(),
  warnings: z.array(z.string().max(500)).max(50).default([]),
});

/** Proxy hibakód → az alkalmazás hibamodellje. */
export function apiErrorToAppError(error: ApiErrorDto): AppError {
  const { message } = error;
  switch (error.code) {
    case 'VALIDATION_FAILED':
      return AppErrors.validation(message);
    case 'NOT_FOUND':
      return { kind: 'NOT_FOUND', message, resource: 'api', id: '' };
    case 'UNSUPPORTED_MARKET':
      return AppErrors.missingData(['market'], message);
    case 'CAPABILITY_UNAVAILABLE':
      return AppErrors.missingData(['source'], message);
    case 'RATE_LIMITED':
      return AppErrors.rateLimited(message, error.retryAfterSec ?? null);
    case 'TIMEOUT':
      return AppErrors.timeout(message);
    case 'UPSTREAM_ERROR':
    case 'INTERNAL':
      return AppErrors.upstream('HTTP_ERROR', message, 'proxy');
    case 'UPSTREAM_INVALID':
      return AppErrors.upstream('INVALID_RESPONSE', message, 'proxy');
    case 'AI_DISABLED':
    case 'AI_INVALID_OUTPUT':
    case 'AI_REFUSED':
      return AppErrors.ai(error.code, message);
  }
}

/**
 * Ismeretlen JSON → validált `data` vagy `AppError`.
 * - érvényes siker-boríték → `ok(data)`
 * - érvényes hiba-boríték → a megfelelő `AppError`
 * - egyik sem → `UPSTREAM / CONTRACT_MISMATCH` (pl. régi app, megváltozott API)
 */
export function parseApiResponse<S extends z.ZodType>(
  json: unknown,
  dataSchema: S,
): Result<z.output<S>> {
  // A hiba-borítékot nézzük először: a siker-boríték `data: unknown` mezője azt is elfogadná.
  const failure = apiErrorSchema.safeParse(json);
  if (failure.success) return err(apiErrorToAppError(failure.data.error));

  const envelope = apiSuccessEnvelopeSchema.safeParse(json);
  if (!envelope.success) return contractMismatch(envelope.error.issues[0]);

  const data = dataSchema.safeParse(envelope.data.data);
  if (!data.success) return contractMismatch(data.error.issues[0], 'data');
  return ok(data.data);
}

function contractMismatch(
  issue: { readonly path: readonly PropertyKey[]; readonly message: string } | undefined,
  prefix?: string,
): Result<never> {
  const path = [prefix, ...(issue?.path ?? []).map(String)].filter(Boolean).join('.');
  const where = issue === undefined ? '' : ` (${path || 'gyökér'}: ${issue.message})`;
  return err(
    AppErrors.upstream(
      'CONTRACT_MISMATCH',
      `A szerver válasza nem felel meg a szerződésnek${where}.`,
      'proxy',
    ),
  );
}
