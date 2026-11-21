/**
 * Result minta: a várt hibát nem kivétel, hanem visszatérési érték jelzi.
 *
 * Miért? A hívó a típusrendszer miatt NEM tudja elfelejteni a hibaágat kezelni
 * (`if (!result.ok) …`). Kivételt csak programozási hiba (bug) esetén dobunk.
 */
import type { AppError } from './errors';

export interface Ok<T> {
  readonly ok: true;
  readonly value: T;
}

export interface Err<E> {
  readonly ok: false;
  readonly error: E;
}

export type Result<T, E = AppError> = Ok<T> | Err<E>;

export function ok<T>(value: T): Ok<T> {
  return { ok: true, value };
}

export function err<E>(error: E): Err<E> {
  return { ok: false, error };
}

/** Sikeres értéket alakít át; hibát változatlanul továbbad. */
export function mapResult<T, U, E>(result: Result<T, E>, fn: (value: T) => U): Result<U, E> {
  return result.ok ? ok(fn(result.value)) : result;
}

/** Láncolás: a következő lépés csak siker esetén fut (és maga is hibázhat). */
export function andThen<T, U, E>(
  result: Result<T, E>,
  fn: (value: T) => Result<U, E>,
): Result<U, E> {
  return result.ok ? fn(result.value) : result;
}
