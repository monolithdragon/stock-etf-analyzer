/**
 * CSAK TESZTEKHEZ: determinisztikus feature-építők a score-/döntési motor tesztjeihez.
 * Az alkalmazás nem importálja.
 */
import {
  metricMissing,
  metricNotMeaningful,
  type DataProvenance,
  type IsoTimestamp,
  type MeasurementUnit,
  type Metric,
} from '@/domain';

import type { FeatureReliability, ScoringFeature, ScoringInput } from './types';

export const FETCHED = '2026-11-22T12:00:00Z' as IsoTimestamp;

export const prov = (overrides: Partial<DataProvenance> = {}): DataProvenance => ({
  sourceId: 'test',
  sourceName: 'Teszt',
  kind: 'reported',
  fetchedAt: FETCHED,
  asOf: '2026-09-30' as never,
  freshness: 'FRESH',
  ...overrides,
});

export function num(
  id: string,
  value: number | Metric<number>,
  options: {
    readonly unit?: MeasurementUnit;
    readonly provenance?: Partial<DataProvenance>;
    readonly reliability?: FeatureReliability;
  } = {},
): ScoringFeature {
  return {
    id,
    label: id,
    kind: 'numeric',
    unit: options.unit ?? 'ratio',
    value:
      typeof value === 'number'
        ? { status: 'OK', value, provenance: prov(options.provenance) }
        : value,
    reliability: options.reliability ?? null,
  };
}

export function cat(
  id: string,
  value: string,
  provenance: Partial<DataProvenance> = {},
): ScoringFeature {
  return {
    id,
    label: id,
    kind: 'categorical',
    value: { status: 'OK', value, provenance: prov(provenance) },
    reliability: null,
  };
}

export const missing = (id: string, reason = 'nincs adat'): ScoringFeature =>
  num(id, metricMissing<number>(reason));

export const notMeaningful = (id: string, reason = 'negatív nevező'): ScoringFeature =>
  num(id, metricNotMeaningful<number>(reason));

/**
 * Részvény-feature-készlet, amelyben minden pontozott mutató a horgonyai között egy adott
 * arányban áll: `level = 1` → minden mutató a „best” horgonyon (100 pont), `0` → „worst”
 * (0 pont). A kategóriánkénti szint felülírható. Így a dimenziók pontja pontosan
 * `100 × szint` (a kerekítés után), és a döntési szabályok határai célzottan tesztelhetők.
 */
export const STOCK_ANCHORS: Readonly<Record<string, readonly [number, number, string]>> = {
  roic: [0.05, 0.2, 'BUSINESS_QUALITY'],
  grossMargin: [0.2, 0.6, 'BUSINESS_QUALITY'],
  revenueCagr3y: [0, 0.12, 'GROWTH'],
  revenueCagr5y: [0, 0.12, 'GROWTH'],
  epsCagr3y: [0, 0.15, 'GROWTH'],
  fcfCagr3y: [0, 0.15, 'GROWTH'],
  revenueGrowth: [-0.05, 0.12, 'GROWTH'],
  operatingMargin: [0.05, 0.3, 'PROFITABILITY'],
  netMargin: [0.02, 0.2, 'PROFITABILITY'],
  roe: [0.05, 0.25, 'PROFITABILITY'],
  debtToEquity: [2.5, 0.3, 'BALANCE_SHEET'],
  netDebtToEbitda: [4, 0, 'BALANCE_SHEET'],
  fcfMargin: [0, 0.2, 'CASH_FLOW'],
  fcfConversion: [0.5, 1.2, 'CASH_FLOW'],
  sharesCagr3y: [0.03, -0.02, 'MANAGEMENT'],
  pe: [35, 12, 'VALUATION'],
  pfcf: [35, 12, 'VALUATION'],
  evToEbitda: [22, 8, 'VALUATION'],
  fcfYield: [0.01, 0.07, 'VALUATION'],
  ps: [10, 1.5, 'VALUATION'],
  beta: [2, 0.8, 'RISK'],
};

export function stockFeatures(
  level: number,
  byCategory: Readonly<Record<string, number>> = {},
): ScoringFeature[] {
  return Object.entries(STOCK_ANCHORS).map(([id, [worst, best, category]]) => {
    const l = byCategory[category] ?? level;
    return num(id, worst + (best - worst) * l);
  });
}

export function stockInput(
  features: readonly ScoringFeature[],
  flags: ScoringInput['flags'] = {},
): ScoringInput {
  return { subjectKind: 'stock', features, flags };
}
