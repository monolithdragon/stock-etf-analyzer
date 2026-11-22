/**
 * Közös segédek a részvényelemzéshez (PHASE 06): `Metric` → `FundamentalMetric`, hibák
 * leképezése mutató-státuszra, frissesség továbbadása.
 */
import { METRIC_DEFINITIONS, type MetricCalculation } from '@/calculations';
import {
  createFundamentalMetric,
  type FinancialMetricId,
  type FiscalPeriod,
  type Freshness,
  type FundamentalMetric,
  type FundamentalMetricId,
  type MeasurementUnit,
  type Metric,
} from '@/domain';

/** Kimutatás-tételek egysége (a többi pénzösszeg). */
const ITEM_UNITS: Partial<Record<string, MeasurementUnit>> = {
  epsBasic: 'money_per_share',
  epsDiluted: 'money_per_share',
  weightedSharesDiluted: 'shares',
  sharesOutstanding: 'shares',
};

export function itemUnit(item: string): MeasurementUnit {
  return ITEM_UNITS[item] ?? 'money';
}

/** Jelentett kimutatás-tétel mint mutató. */
export function lineItemMetric(
  id: FundamentalMetricId,
  value: Metric<number>,
  period: FiscalPeriod | null,
  notes: readonly string[] = [],
): FundamentalMetric {
  const source = value.status === 'OK' ? value.provenance.sourceName : 'forrás';
  const kind = value.status === 'OK' ? value.provenance.kind : 'reported';
  return createFundamentalMetric({
    id,
    unit: itemUnit(id),
    formula:
      kind === 'reported'
        ? `jelentett (${source})`
        : `összetett tétel (${source}; lásd a provenance hivatkozását)`,
    period,
    value,
    notes,
  });
}

/** Számított mutató a PHASE 05 definíciós táblájával (képlet + egység egy helyen). */
export function calculatedMetric(
  id: FinancialMetricId,
  calculation: MetricCalculation,
  period: FiscalPeriod | null,
  extraNotes: readonly string[] = [],
): FundamentalMetric {
  const definition = METRIC_DEFINITIONS[id];
  return createFundamentalMetric({
    id,
    unit: definition.unit,
    formula: definition.formula,
    period,
    value: calculation.metric,
    notes: [...calculation.notes, ...extraNotes],
  });
}

/** Közös segéd (PHASE 08-ban kiemelve, hogy az ETF-elemzés is használhassa). */
export { appErrorToMetric } from '../shared/app-error-metric';

/**
 * A készlet-szintű frissességet (a use case számolja a saját órájával) ráírja azokra a
 * tételekre, amelyeknek a forrás nem adott saját frissességet (`UNKNOWN`). Így egy elavult
 * kimutatás-készletből számolt mutató is `stale` eredetű lesz.
 */
export function withFreshness(metric: Metric<number>, freshness: Freshness): Metric<number> {
  if (metric.status !== 'OK' || metric.provenance.freshness !== 'UNKNOWN') return metric;
  return { ...metric, provenance: { ...metric.provenance, freshness } };
}
