/**
 * Segédek az ETF-elemzés mutatóihoz: `CalcResult` → `EtfMetric`, motor-provenance a bemenetek
 * provenance-éből (fajta, legrégebbi `asOf`, legrosszabb frissesség).
 */
import type { CalcResult } from '@/calculations';
import { ENGINE_SOURCE_ID, ENGINE_SOURCE_NAME } from '@/calculations';
import {
  classifyMetricOrigin,
  metricOk,
  toEpochMs,
  type CurrencyCode,
  type DataProvenance,
  type Freshness,
  type IsoDate,
  type IsoTimestamp,
  type MeasurementUnit,
  type Metric,
  type ProvenanceKind,
} from '@/domain';

import type { AnalysisWindow, EtfMetric } from './types';

export interface MetricSpec {
  readonly id: string;
  readonly label: string;
  readonly unit: MeasurementUnit;
  readonly formula: string;
}

export function etfMetric(
  spec: MetricSpec,
  value: Metric<number>,
  window: AnalysisWindow | null = null,
  notes: readonly string[] = [],
): EtfMetric {
  return {
    ...spec,
    value,
    origin: classifyMetricOrigin(value),
    window,
    reliability: null,
    notes,
  };
}

const FRESHNESS_SEVERITY: readonly Freshness[] = ['EXPIRED', 'UNKNOWN', 'STALE', 'FRESH'];

export interface EngineContext {
  readonly fetchedAt: IsoTimestamp;
  /** A számításhoz felhasznált bemenetek provenance-e. */
  readonly inputs: readonly (readonly [string, DataProvenance])[];
  /** `estimated`, ha a számítás feltevést használ (pl. TER-hatás feltételezett hozammal). */
  readonly kind?: 'calculated' | 'estimated';
  readonly currency?: CurrencyCode;
  readonly unit: MeasurementUnit;
}

export function engineProvenance(context: EngineContext): DataProvenance {
  const kinds = new Set(context.inputs.map(([, p]) => p.kind));
  const kind: ProvenanceKind = kinds.has('mock')
    ? 'mock'
    : context.kind === 'estimated' || kinds.has('estimated')
      ? 'estimated'
      : 'calculated';
  let asOf: IsoDate | IsoTimestamp | null = null;
  for (const [, p] of context.inputs) {
    if (p.asOf !== null && (asOf === null || toEpochMs(p.asOf) < toEpochMs(asOf))) asOf = p.asOf;
  }
  const present = new Set(context.inputs.map(([, p]) => p.freshness));
  return {
    sourceId: ENGINE_SOURCE_ID,
    sourceName: ENGINE_SOURCE_NAME,
    kind,
    fetchedAt: context.fetchedAt,
    asOf,
    freshness: FRESHNESS_SEVERITY.find((value) => present.has(value)) ?? 'UNKNOWN',
    unit: context.unit,
    inputs: context.inputs.map(([name]) => name),
    ...(context.currency === undefined ? {} : { currency: context.currency }),
  };
}

/** Képlet-eredmény → `EtfMetric` (nem-OK esetén a státusz és az indok változatlan). */
export function fromCalc(
  spec: MetricSpec,
  result: CalcResult<number>,
  context: Omit<EngineContext, 'unit'>,
  window: AnalysisWindow | null = null,
  extraNotes: readonly string[] = [],
): EtfMetric {
  if (result.status !== 'OK') {
    return etfMetric(spec, { status: result.status, reason: result.reason }, window, extraNotes);
  }
  const value = metricOk(result.value, engineProvenance({ ...context, unit: spec.unit }));
  return etfMetric(spec, value, window, [...result.notes, ...extraNotes]);
}

/** Egy bemeneti `Metric` nem-OK státuszának továbbadása a származtatott mutatóra. */
export function propagateFailure<T>(
  name: string,
  metric: Exclude<Metric<T>, { status: 'OK' }>,
): Metric<number> {
  const reason = `A(z) „${name}” nem használható (${metric.status}): ${metric.reason}`;
  return metric.status === 'UNAVAILABLE'
    ? { status: 'UNAVAILABLE', unavailableReason: metric.unavailableReason, reason }
    : { status: metric.status, reason };
}
