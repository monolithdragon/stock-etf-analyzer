/**
 * Közös számítási konvenciók (PHASE 05, D-009, D-055).
 *
 * - Szám: JS `number` (float64). A motor SOHA nem kerekít; kerekítés csak a megjelenítésnél.
 * - Arány / hozam / ráta: TIZEDES TÖRT (0.15 = 15%). A `%`-os bemenetet a hívó váltja át a
 *   `percentToDecimal`-lal, a megjelenítés a formatter dolga (PHASE 12).
 * - Lebegőpontos zaj: a ±1e-12-nél kisebb abszolút értékű eredményt ott, ahol az előjel
 *   jelentést hordoz (drawdown, kerekítési maradék), 0-ra „pattintjuk” (`snapToZero`).
 */
import { calcInvalidInput, type CalcFailure, type CalcFailureStatus } from './calc-result';

/** A lebegőpontos zaj küszöbe (abszolút). */
export const ROUNDING_EPSILON = 1e-12;

/** ±1e-12-nél kisebb abszolút értékű szám → 0 (a `-0` is `0` lesz). */
export function snapToZero(value: number, epsilon: number = ROUNDING_EPSILON): number {
  return Math.abs(value) < epsilon ? 0 : value;
}

/** Két szám egyezése abszolút tűréssel (pl. súlyok összege ≈ 1). */
export function approximatelyEqual(a: number, b: number, tolerance: number): boolean {
  return Math.abs(a - b) <= tolerance;
}

/** Százalék → tizedes tört: `15` → `0.15`. Bemeneti normalizálásra (nem formázásra). */
export function percentToDecimal(percent: number): number {
  return percent / 100;
}

/** Tizedes tört → százalékpont: `0.15` → `15`. Csak ott, ahol a képlet ezt írja elő (PEG). */
export function decimalToPercentagePoints(decimal: number): number {
  return decimal * 100;
}

/** Az első nem-`null` hiba (ellenőrzések rövidzáras összefűzése). */
export function firstFailure(...checks: readonly (CalcFailure | null)[]): CalcFailure | null {
  for (const check of checks) if (check !== null) return check;
  return null;
}

function failure(status: CalcFailureStatus, reason: string): CalcFailure {
  return { status, reason };
}

/** `value > 0`, különben a megadott státusz (alapból `INVALID_INPUT`). */
export function mustBePositive(
  name: string,
  value: number,
  status: CalcFailureStatus = 'INVALID_INPUT',
  hint = '',
): CalcFailure | null {
  return value > 0 ? null : failure(status, `${name} ≤ 0 (${value}).${hint ? ` ${hint}` : ''}`);
}

/** `value ≥ 0`, különben `INVALID_INPUT` (pl. kiáramlás pozitív nagyságként tárolva). */
export function mustBeNonNegative(name: string, value: number, hint = ''): CalcFailure | null {
  return value >= 0 ? null : calcInvalidInput(`${name} < 0 (${value}).${hint ? ` ${hint}` : ''}`);
}

/** Hozam/ráta: `value > −1` (−100% alatti hozam vagy infláció nem értelmezett). */
export function mustBeAboveMinusOne(name: string, value: number): CalcFailure | null {
  return value > -1
    ? null
    : calcInvalidInput(`${name} ≤ −1 (${value}): −100% vagy annál rosszabb ráta nem értelmezett.`);
}

/** Zárt tartomány `[min, max]`; a `hint` tipikusan a „százalék vs. tört” figyelmeztetés. */
export function mustBeInRange(
  name: string,
  value: number,
  min: number,
  max: number,
  hint = '',
): CalcFailure | null {
  return value >= min && value <= max
    ? null
    : calcInvalidInput(
        `${name} a megengedett [${min}, ${max}] tartományon kívül esik (${value}).${hint ? ` ${hint}` : ''}`,
      );
}

/** Figyelmeztetés a tipikus „százalék a tört helyett” hibára. */
export const DECIMAL_HINT = 'A ráták tizedes törtként értendők (0.05 = 5%), nem százalékként.';

/** Számtani átlag (üres tömbre `NaN` – a hívó ellenőrzi a hosszt). */
export function mean(values: readonly number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

/** Minta szórás (n − 1 nevező). Legalább 2 elem kell, különben `NaN`. */
export function sampleStandardDeviation(values: readonly number[]): number {
  if (values.length < 2) return Number.NaN;
  const average = mean(values);
  const sumSquares = values.reduce((sum, value) => sum + (value - average) ** 2, 0);
  return Math.sqrt(sumSquares / (values.length - 1));
}
