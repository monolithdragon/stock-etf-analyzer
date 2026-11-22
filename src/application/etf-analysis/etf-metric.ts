/**
 * Segédek az ETF-elemzés mutatóihoz: `CalcResult` → `EtfMetric`, motor-provenance a bemenetek
 * provenance-éből (fajta, legrégebbi `asOf`, legrosszabb frissesség).
 */
import type { CalcResult } from '@/calculations';
import { classifyMetricOrigin, metricOk, type MeasurementUnit, type Metric } from '@/domain';

import type { AnalysisWindow, EtfMetric } from './types';
import { engineProvenance, type EngineContext } from '../shared/engine-provenance';

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

export { engineProvenance, type EngineContext } from '../shared/engine-provenance';

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
