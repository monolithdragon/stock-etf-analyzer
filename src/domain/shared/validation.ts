/**
 * Kis validációs segédek a domain konstruktorokhoz (zod nélkül – a domain nem függ külső csomagtól).
 *
 * Minta:
 *   const fields = validateFields({ isin: parseIsin(input.isin), name: requireNonEmpty(input.name) });
 *   if (!fields.ok) return fields;            // az ÖSSZES hibás mező egyszerre jön vissza
 *   const { isin, name } = fields.value;      // típushelyes, ellenőrzött értékek
 */
import { AppErrors, type AppError, type ValidationIssue } from './errors';
import { err, ok, type Ok, type Result } from './result';

type OkValue<R> = R extends Ok<infer T> ? T : never;

/** Egyetlen hiba validációs eredményként (mezőútvonal nélkül; a `validateFields` teszi elé). */
export function invalid(message: string): Result<never> {
  return err(AppErrors.validation(message, [{ path: '', message }]));
}

/** Egy konkrét mezőhöz tartozó hiba (pl. mezők közötti, ún. cross-field ellenőrzésnél). */
export function invalidField(
  path: string,
  message: string,
  summary = 'Érvénytelen adatok.',
): Result<never> {
  return err(AppErrors.validation(summary, [{ path, message }]));
}

function issuesOf(error: AppError): readonly ValidationIssue[] {
  return error.kind === 'VALIDATION' && error.issues.length > 0
    ? error.issues
    : [{ path: '', message: error.message }];
}

function joinPath(prefix: string, path: string): string {
  return path === '' ? prefix : `${prefix}.${path}`;
}

/**
 * Több mező validálásának eredményét gyűjti össze.
 * Ha bármelyik hibás, egyetlen `VALIDATION` hibát ad vissza az összes problémával.
 */
export function validateFields<F extends Record<string, Result<unknown>>>(
  fields: F,
  message = 'Érvénytelen adatok.',
): Result<{ readonly [K in keyof F]: OkValue<F[K]> }> {
  const issues: ValidationIssue[] = [];
  const values: Record<string, unknown> = {};

  for (const [key, result] of Object.entries(fields)) {
    if (result.ok) {
      values[key] = result.value;
    } else {
      for (const issue of issuesOf(result.error)) {
        issues.push({ path: joinPath(key, issue.path), message: issue.message });
      }
    }
  }

  if (issues.length > 0) {
    return err(AppErrors.validation(message, issues));
  }
  // A ciklus minden kulcsot sikeres értékkel töltött fel, így a típus-szűkítés biztonságos.
  return ok(values as { readonly [K in keyof F]: OkValue<F[K]> });
}

/** `null`/`undefined` → `ok(null)`; egyébként a megadott parserrel ellenőriz. */
export function parseNullable<I, T>(
  input: I | null | undefined,
  parse: (value: I) => Result<T>,
): Result<T | null> {
  return input === null || input === undefined ? ok(null) : parse(input);
}

export function requireNonEmpty(value: string, maxLength = 200): Result<string> {
  const trimmed = value.trim();
  if (trimmed === '') return invalid('Nem lehet üres.');
  if (trimmed.length > maxLength) return invalid(`Legfeljebb ${maxLength} karakter lehet.`);
  return ok(trimmed);
}

export function requireFinite(value: number): Result<number> {
  return Number.isFinite(value) ? ok(value) : invalid('Véges szám kell (nem NaN/Infinity).');
}

export function requirePositive(value: number): Result<number> {
  if (!Number.isFinite(value)) return invalid('Véges szám kell (nem NaN/Infinity).');
  return value > 0 ? ok(value) : invalid('Pozitív szám kell (> 0).');
}

export function requireNonNegative(value: number): Result<number> {
  if (!Number.isFinite(value)) return invalid('Véges szám kell (nem NaN/Infinity).');
  return value >= 0 ? ok(value) : invalid('Nem lehet negatív.');
}

export function requireInRange(value: number, min: number, max: number): Result<number> {
  if (!Number.isFinite(value)) return invalid('Véges szám kell (nem NaN/Infinity).');
  return value >= min && value <= max
    ? ok(value)
    : invalid(`A megengedett tartomány: ${min} … ${max}.`);
}
