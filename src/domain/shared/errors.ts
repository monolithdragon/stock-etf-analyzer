/**
 * Az alkalmazás hibamodellje (ARCHITECTURE 7.): diszkriminált unió a `kind` mező szerint.
 *
 * Fontos különbség (DATA_DICTIONARY 2.1):
 * - `AppError` = a MŰVELET hiúsult meg (pl. nincs hálózat, érvénytelen bemenet).
 * - `Metric` nem-OK státusza = egy ÉRTÉK hiányzik / nem értelmezhető, de az elemzés folytatódhat.
 */
import type { UnavailableReason } from './metric';

export interface ValidationIssue {
  /** A hibás mező útvonala, pl. `quantity` vagy `price.amount`. Üres = maga az érték. */
  readonly path: string;
  readonly message: string;
}

export type UpstreamFailure =
  /** A szolgáltató / proxy HTTP-hibát adott (pl. 5xx). */
  | 'HTTP_ERROR'
  /** A válasz nem felelt meg a várt sémának (szolgáltatói DTO). */
  | 'INVALID_RESPONSE'
  /** A proxy válasza nem felel meg a kliens contract sémájának (pl. régi app, új API). */
  | 'CONTRACT_MISMATCH'
  /** Az adatforrás még nincs megvalósítva / bekötve. */
  | 'NOT_IMPLEMENTED';

export type AiFailure =
  'AI_DISABLED' | 'AI_TIMEOUT' | 'AI_RATE_LIMITED' | 'AI_INVALID_OUTPUT' | 'AI_REFUSED';

export type AppError =
  | {
      readonly kind: 'VALIDATION';
      readonly message: string;
      readonly issues: readonly ValidationIssue[];
    }
  | { readonly kind: 'NETWORK'; readonly message: string }
  | { readonly kind: 'TIMEOUT'; readonly message: string; readonly timeoutMs: number | null }
  | {
      readonly kind: 'RATE_LIMITED';
      readonly message: string;
      /** Ennyi másodperc után érdemes újrapróbálni; `null`, ha a forrás nem közölte. */
      readonly retryAfterSec: number | null;
    }
  | {
      readonly kind: 'NOT_FOUND';
      readonly message: string;
      readonly resource: string;
      readonly id: string;
    }
  | {
      readonly kind: 'UPSTREAM';
      readonly message: string;
      readonly failure: UpstreamFailure;
      readonly sourceId: string | null;
    }
  | {
      readonly kind: 'MISSING_DATA';
      readonly message: string;
      /** A hiányzó bemenetek azonosítói, pl. `['revenue', 'netIncome']`. */
      readonly missing: readonly string[];
    }
  | {
      /**
       * Az adat létezhet, de a jelenlegi forrás-beállítással NEM elérhető (PHASE 04B, D-027):
       * csomagkorlát (`PLAN_LIMIT`), a forrás nem fedi le (`NOT_COVERED`), vagy elfogyott a
       * napi kvóta (`QUOTA_EXHAUSTED`). Nem hiba a mi oldalunkon, és nem „nincs ilyen adat”.
       */
      readonly kind: 'UNAVAILABLE';
      readonly message: string;
      readonly reason: UnavailableReason;
    }
  | { readonly kind: 'CALCULATION_INVALID'; readonly message: string }
  | { readonly kind: 'STORAGE'; readonly message: string }
  | { readonly kind: 'AI'; readonly message: string; readonly failure: AiFailure };

export type AppErrorKind = AppError['kind'];

/** Hibakonstruktorok – egységes alak, kevesebb elírás. */
export const AppErrors = {
  validation: (message: string, issues: readonly ValidationIssue[] = []): AppError => ({
    kind: 'VALIDATION',
    message,
    issues,
  }),
  network: (message: string): AppError => ({ kind: 'NETWORK', message }),
  timeout: (message: string, timeoutMs: number | null = null): AppError => ({
    kind: 'TIMEOUT',
    message,
    timeoutMs,
  }),
  rateLimited: (message: string, retryAfterSec: number | null = null): AppError => ({
    kind: 'RATE_LIMITED',
    message,
    retryAfterSec,
  }),
  notFound: (resource: string, id: string): AppError => ({
    kind: 'NOT_FOUND',
    message: `Nem található: ${resource} (${id}).`,
    resource,
    id,
  }),
  upstream: (
    failure: UpstreamFailure,
    message: string,
    sourceId: string | null = null,
  ): AppError => ({
    kind: 'UPSTREAM',
    message,
    failure,
    sourceId,
  }),
  missingData: (missing: readonly string[], message?: string): AppError => ({
    kind: 'MISSING_DATA',
    message: message ?? `Hiányzó adat: ${missing.join(', ')}.`,
    missing,
  }),
  unavailable: (reason: UnavailableReason, message: string): AppError => ({
    kind: 'UNAVAILABLE',
    message,
    reason,
  }),
  calculationInvalid: (message: string): AppError => ({ kind: 'CALCULATION_INVALID', message }),
  storage: (message: string): AppError => ({ kind: 'STORAGE', message }),
  ai: (failure: AiFailure, message: string): AppError => ({ kind: 'AI', message, failure }),
} as const;

/**
 * Érdemes-e automatikusan újrapróbálni? Csak átmeneti (tranziens) hibánál.
 * A validációs, hiányzó adat és számítási hiba újrapróbálással nem javul.
 */
export function isRetryable(error: AppError): boolean {
  switch (error.kind) {
    case 'NETWORK':
    case 'TIMEOUT':
    case 'RATE_LIMITED':
      return true;
    case 'UPSTREAM':
      return error.failure === 'HTTP_ERROR';
    case 'AI':
      return error.failure === 'AI_TIMEOUT' || error.failure === 'AI_RATE_LIMITED';
    case 'VALIDATION':
    case 'NOT_FOUND':
    case 'MISSING_DATA':
    // Csomagkorlát / lefedettség nem javul újrapróbálással; a kvóta csak másnap (nem azonnal).
    case 'UNAVAILABLE':
    case 'CALCULATION_INVALID':
    case 'STORAGE':
      return false;
  }
}
