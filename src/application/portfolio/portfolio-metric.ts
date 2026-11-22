/**
 * `CalcResult` → `PortfolioMetric` (a motor eredménye provenance-szel és megbízhatósági címkével).
 */
import type { CalcResult, RiskReliability } from '@/calculations';
import {
  classifyMetricOrigin,
  metricOk,
  type DataProvenance,
  type MeasurementUnit,
  type Metric,
} from '@/domain';

import type { PortfolioMetric } from './types';

export interface PortfolioMetricSpec {
  readonly id: string;
  readonly label: string;
  readonly unit: MeasurementUnit;
  readonly formula: string;
}

export function portfolioMetric(
  spec: PortfolioMetricSpec,
  value: Metric<number>,
  notes: readonly string[] = [],
  reliability: RiskReliability | null = null,
): PortfolioMetric {
  return {
    ...spec,
    value,
    origin: classifyMetricOrigin(value),
    reliability: value.status === 'OK' ? reliability : null,
    notes,
  };
}

export function metricFromCalc(
  spec: PortfolioMetricSpec,
  result: CalcResult<number>,
  provenance: DataProvenance,
  extraNotes: readonly string[] = [],
  reliability: RiskReliability | null = null,
): PortfolioMetric {
  if (result.status !== 'OK') {
    return portfolioMetric(spec, { status: result.status, reason: result.reason }, extraNotes);
  }
  return portfolioMetric(
    spec,
    metricOk(result.value, { ...provenance, unit: spec.unit }),
    [...result.notes, ...extraNotes],
    reliability,
  );
}

/** Ugyanaz a hiány minden mutatóra (pl. nincs historikus idősor). */
export function failedMetric(spec: PortfolioMetricSpec, failure: Metric<never>): PortfolioMetric {
  return portfolioMetric(spec, failure);
}
