/**
 * `Metric<T>` – egy érték a státuszával együtt (D-010, DATA_DICTIONARY 2.1, 2.5).
 *
 * Szabály: a hiányzó adat NEM nulla. Érték (`value`) csak `OK` státusznál létezik,
 * minden más státusz kötelezően indokot (`reason`) ad – a típusrendszer kikényszeríti.
 */
import type { DataProvenance } from './provenance';

export const METRIC_STATUSES = [
  'OK',
  'MISSING',
  'NOT_APPLICABLE',
  'NOT_MEANINGFUL',
  'INSUFFICIENT_DATA',
  'INVALID_INPUT',
  'UNAVAILABLE',
  'ERROR',
] as const;
export type MetricStatus = (typeof METRIC_STATUSES)[number];

/** Miért nem elérhető (`UNAVAILABLE`) egy adat? (D-027) */
export const UNAVAILABLE_REASONS = ['PLAN_LIMIT', 'NOT_COVERED', 'QUOTA_EXHAUSTED'] as const;
export type UnavailableReason = (typeof UNAVAILABLE_REASONS)[number];

export type MetricOk<T> = {
  readonly status: 'OK';
  readonly value: T;
  readonly provenance: DataProvenance;
};

export type MetricUnavailable = {
  readonly status: 'UNAVAILABLE';
  readonly unavailableReason: UnavailableReason;
  readonly reason: string;
  readonly provenance?: DataProvenance;
};

export type MetricNoValue = {
  readonly status: Exclude<MetricStatus, 'OK' | 'UNAVAILABLE'>;
  readonly reason: string;
  readonly provenance?: DataProvenance;
};

export type Metric<T> = MetricOk<T> | MetricUnavailable | MetricNoValue;

/**
 * Sikeres érték. Biztonsági háló: nem véges szám (NaN, Infinity) SOHA nem lehet `OK` –
 * ilyenkor `INVALID_INPUT` lesz belőle, hogy a hiba ne terjedjen csendben tovább.
 */
export function metricOk<T>(value: T, provenance: DataProvenance): Metric<T> {
  if (typeof value === 'number' && !Number.isFinite(value)) {
    return { status: 'INVALID_INPUT', reason: `Nem véges szám (${String(value)}).`, provenance };
  }
  return { status: 'OK', value, provenance };
}

function noValue<T>(
  status: MetricNoValue['status'],
  reason: string,
  provenance?: DataProvenance,
): Metric<T> {
  return provenance === undefined ? { status, reason } : { status, reason, provenance };
}

export const metricMissing = <T>(reason: string, provenance?: DataProvenance): Metric<T> =>
  noValue('MISSING', reason, provenance);
export const metricNotApplicable = <T>(reason: string, provenance?: DataProvenance): Metric<T> =>
  noValue('NOT_APPLICABLE', reason, provenance);
export const metricNotMeaningful = <T>(reason: string, provenance?: DataProvenance): Metric<T> =>
  noValue('NOT_MEANINGFUL', reason, provenance);
export const metricInsufficientData = <T>(reason: string, provenance?: DataProvenance): Metric<T> =>
  noValue('INSUFFICIENT_DATA', reason, provenance);
export const metricInvalidInput = <T>(reason: string, provenance?: DataProvenance): Metric<T> =>
  noValue('INVALID_INPUT', reason, provenance);
export const metricError = <T>(reason: string, provenance?: DataProvenance): Metric<T> =>
  noValue('ERROR', reason, provenance);

export function metricUnavailable<T>(
  unavailableReason: UnavailableReason,
  reason: string,
  provenance?: DataProvenance,
): Metric<T> {
  return provenance === undefined
    ? { status: 'UNAVAILABLE', unavailableReason, reason }
    : { status: 'UNAVAILABLE', unavailableReason, reason, provenance };
}

export function isMetricOk<T>(metric: Metric<T>): metric is MetricOk<T> {
  return metric.status === 'OK';
}

/** Érték átalakítása csak `OK` esetén; a nem-OK státusz és indok változatlanul megmarad. */
export function mapMetric<T, U>(metric: Metric<T>, fn: (value: T) => U): Metric<U> {
  return metric.status === 'OK' ? metricOk(fn(metric.value), metric.provenance) : metric;
}
