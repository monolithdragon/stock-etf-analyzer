/**
 * `AppError` → felhasználónak szóló, érthető hibaüzenet (PHASE 12).
 * A technikai részlet (`message`) a részletekben marad; titkot az AppError nem tartalmaz.
 */
import type { AppError } from '@/domain';

export interface FormattedError {
  readonly title: string;
  readonly message: string;
  /** Van-e értelme az „Újrapróbálás” gombnak (átmeneti hiba). */
  readonly retryable: boolean;
}

const UNAVAILABLE_TITLE = {
  PLAN_LIMIT: 'A jelenlegi adatcsomag ezt nem tartalmazza',
  NOT_COVERED: 'Az adatforrás ezt nem fedi le',
  QUOTA_EXHAUSTED: 'Elfogyott a napi lekérési keret',
} as const;

const AI_TITLE = {
  AI_DISABLED: 'Az AI-magyarázat ki van kapcsolva',
  AI_TIMEOUT: 'Az AI nem válaszolt időben',
  AI_RATE_LIMITED: 'Elérted az AI napi keretét',
  AI_INVALID_OUTPUT: 'Az AI-válasz nem ment át az ellenőrzésen',
  AI_REFUSED: 'Az AI-szolgáltató elutasította a kérést',
} as const;

export function formatAppError(error: AppError): FormattedError {
  switch (error.kind) {
    case 'NETWORK':
      return { title: 'Nincs kapcsolat', message: error.message, retryable: true };
    case 'TIMEOUT':
      return { title: 'Időtúllépés', message: error.message, retryable: true };
    case 'RATE_LIMITED': {
      const wait =
        error.retryAfterSec !== null ? ` Próbáld újra ${error.retryAfterSec} mp múlva.` : '';
      return { title: 'Túl sok kérés', message: `${error.message}${wait}`, retryable: true };
    }
    case 'NOT_FOUND':
      return { title: 'Nem található', message: error.message, retryable: false };
    case 'VALIDATION': {
      const details = error.issues
        .slice(0, 5)
        .map((issue) => (issue.path === '' ? issue.message : `${issue.path}: ${issue.message}`));
      return {
        title: 'Érvénytelen adat',
        message: [error.message, ...details].join('\n'),
        retryable: false,
      };
    }
    case 'UPSTREAM':
      return {
        title: error.failure === 'NOT_IMPLEMENTED' ? 'Az adatforrás nincs bekötve' : 'Forráshiba',
        message: error.message,
        retryable: error.failure !== 'NOT_IMPLEMENTED',
      };
    case 'MISSING_DATA':
      return { title: 'Hiányzó adat', message: error.message, retryable: false };
    case 'UNAVAILABLE':
      return {
        title: UNAVAILABLE_TITLE[error.reason],
        message: error.message,
        retryable: error.reason === 'QUOTA_EXHAUSTED',
      };
    case 'CALCULATION_INVALID':
      return { title: 'A számítás nem végezhető el', message: error.message, retryable: false };
    case 'STORAGE':
      return { title: 'Tárolási hiba', message: error.message, retryable: true };
    case 'AI':
      return {
        title: AI_TITLE[error.failure],
        message: error.message,
        retryable: error.failure === 'AI_TIMEOUT' || error.failure === 'AI_RATE_LIMITED',
      };
  }
}
