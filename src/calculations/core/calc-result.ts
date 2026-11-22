/**
 * `CalcResult<T>` – egy képlet eredménye (PHASE 05, D-055).
 *
 * A képletek szám-szintűek: a bemenet `number | null` (a `null`/`undefined` = HIÁNYZÓ adat,
 * a `0` = tényleges nulla). Az eredmény vagy `OK` érték (opcionális megjegyzésekkel),
 * vagy egy nem-OK státusz kötelező, emberi nyelvű indokkal. A státuszok a domain
 * `MetricStatus` értékeinek részhalmazai, így a `Metric<T>`-re emelés veszteségmentes
 * (lásd `to-metric.ts`).
 */
import type { MetricStatus } from '@/domain';

/** A képletmotor által adható nem-OK státuszok (az `UNAVAILABLE` és `ERROR` forrásoldali). */
export type CalcFailureStatus = Extract<
  MetricStatus,
  'MISSING' | 'NOT_APPLICABLE' | 'NOT_MEANINGFUL' | 'INSUFFICIENT_DATA' | 'INVALID_INPUT'
>;

export interface CalcOk<T> {
  readonly status: 'OK';
  readonly value: T;
  /** Átláthatósági megjegyzések (pl. „csak záró saját tőke, nem átlag”). Lehet üres. */
  readonly notes: readonly string[];
}

export interface CalcFailure {
  readonly status: CalcFailureStatus;
  readonly reason: string;
}

export type CalcResult<T> = CalcOk<T> | CalcFailure;

/** Bemenet: szám, vagy hiányzó (`null`/`undefined`). */
export type NumericInput = number | null | undefined;

function containsNonFinite(value: unknown): boolean {
  if (typeof value === 'number') return !Number.isFinite(value);
  if (Array.isArray(value)) return value.some(containsNonFinite);
  if (value !== null && typeof value === 'object') {
    return Object.values(value).some(containsNonFinite);
  }
  return false;
}

/**
 * Sikeres eredmény. Biztonsági háló (mint a `metricOk`): ha az eredményben bárhol nem véges
 * szám (NaN, ±Infinity) van, `INVALID_INPUT` lesz belőle – soha nem kerül ki `OK`-ként.
 */
export function calcOk<T>(value: T, notes: readonly string[] = []): CalcResult<T> {
  if (containsNonFinite(value)) {
    return {
      status: 'INVALID_INPUT',
      reason: 'A számítás nem véges számot adott (NaN/Infinity) – a bemenet valószínűleg hibás.',
    };
  }
  return { status: 'OK', value, notes };
}

export const calcMissing = (reason: string): CalcFailure => ({ status: 'MISSING', reason });
export const calcNotApplicable = (reason: string): CalcFailure => ({
  status: 'NOT_APPLICABLE',
  reason,
});
export const calcNotMeaningful = (reason: string): CalcFailure => ({
  status: 'NOT_MEANINGFUL',
  reason,
});
export const calcInsufficientData = (reason: string): CalcFailure => ({
  status: 'INSUFFICIENT_DATA',
  reason,
});
export const calcInvalidInput = (reason: string): CalcFailure => ({
  status: 'INVALID_INPUT',
  reason,
});

export function isCalcOk<T>(result: CalcResult<T>): result is CalcOk<T> {
  return result.status === 'OK';
}

/** Érték átalakítása csak `OK` esetén (a megjegyzések megmaradnak). */
export function mapCalc<T, U>(result: CalcResult<T>, fn: (value: T) => U): CalcResult<U> {
  return result.status === 'OK' ? calcOk(fn(result.value), result.notes) : result;
}

/** Láncolás: a második lépés csak `OK` esetén fut; a megjegyzések összeadódnak. */
export function chainCalc<T, U>(
  result: CalcResult<T>,
  fn: (value: T) => CalcResult<U>,
): CalcResult<U> {
  if (result.status !== 'OK') return result;
  const next = fn(result.value);
  return next.status === 'OK' && result.notes.length > 0
    ? { ...next, notes: [...result.notes, ...next.notes] }
    : next;
}

/**
 * Bemenetek ellenőrzése név szerint. Sorrend: 1) ha bármelyik nem véges szám → `INVALID_INPUT`;
 * 2) ha bármelyik hiányzik → `MISSING` (az összes hiányzó nevével). Különben a validált,
 * `number` típusú bemenetek.
 *
 * @example requireInputs({ revenue: 100, costOfRevenue: null }) // → MISSING: costOfRevenue
 */
export function requireInputs<K extends string>(
  inputs: Readonly<Record<K, NumericInput>>,
): CalcResult<Readonly<Record<K, number>>> {
  const entries = Object.entries(inputs) as [K, NumericInput][];
  const nonFinite = entries.filter(
    ([, value]) => typeof value === 'number' && !Number.isFinite(value),
  );
  if (nonFinite.length > 0) {
    return calcInvalidInput(
      `Nem véges szám a bemenetben: ${nonFinite.map(([key, value]) => `${key}=${String(value)}`).join(', ')}.`,
    );
  }
  const missing = entries.filter(([, value]) => value === null || value === undefined);
  if (missing.length > 0) {
    return calcMissing(`Hiányzó bemenet: ${missing.map(([key]) => key).join(', ')}.`);
  }
  return calcOk(Object.fromEntries(entries) as Record<K, number>);
}
