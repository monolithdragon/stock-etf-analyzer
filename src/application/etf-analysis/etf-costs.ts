/**
 * ETF-költség: TER, éves költség 10 000 egységre, a TER hosszú távú hatása (PHASE 08 feladat 6.).
 * A hosszú távú hatás feltételezett bruttó hozammal számol → `estimated`, feltevései láthatók.
 */
import { annualTerCost, terLongTermImpact } from '@/calculations';
import type { EtfProfile, IsoTimestamp } from '@/domain';

import { etfMetric, fromCalc, propagateFailure, type MetricSpec } from './etf-metric';
import type { EtfAnalysisOptions, EtfCostAnalysis } from './types';

export const COST_SPECS = {
  ter: {
    id: 'ter',
    label: 'Teljes költséghányad (TER)',
    unit: 'ratio',
    formula: 'a kibocsátó által közölt éves költséghányad (tört)',
  },
  annualCostPer10k: {
    id: 'annualCostPer10k',
    label: 'Éves TER-költség 10 000 egységre',
    unit: 'money',
    formula: '10 000 × TER (állandó állomány közelítés; pénznem-független illusztráció)',
  },
  longTermCostShare: {
    id: 'longTermCostShare',
    label: 'A TER miatt elmaradó vagyon aránya',
    unit: 'ratio',
    formula: '1 − (1 + r − TER)^n / (1 + r)^n (közelítés, D-058, KI-46)',
  },
} as const satisfies Record<string, MetricSpec>;

/** A TER-hatás kiinduló feltevései – jelölve, felülírhatók (nem előrejelzés). */
export const DEFAULT_TER_IMPACT = { years: 10, assumedGrossReturn: 0.06 } as const;

export function analyzeCosts(
  profile: EtfProfile,
  options: EtfAnalysisOptions['terImpact'],
  fetchedAt: IsoTimestamp,
): EtfCostAnalysis {
  const years = options?.years ?? DEFAULT_TER_IMPACT.years;
  const assumedGrossReturn = options?.assumedGrossReturn ?? DEFAULT_TER_IMPACT.assumedGrossReturn;
  const assumptions = {
    years,
    assumedGrossReturn,
    source:
      options?.years === undefined && options?.assumedGrossReturn === undefined
        ? ('default' as const)
        : ('user' as const),
  };
  const ter = profile.ter;
  if (ter.status !== 'OK') {
    const failed = propagateFailure('TER', ter);
    return {
      ter: etfMetric(COST_SPECS.ter, ter),
      annualCostPer10k: etfMetric(COST_SPECS.annualCostPer10k, failed),
      longTermCostShare: etfMetric(COST_SPECS.longTermCostShare, failed),
      assumptions,
    };
  }
  const inputs = [['ter', ter.provenance]] as const;
  const impact = terLongTermImpact({
    initialAmount: 10_000,
    annualGrossReturn: assumedGrossReturn,
    ter: ter.value,
    years,
  });
  return {
    ter: etfMetric(COST_SPECS.ter, ter),
    annualCostPer10k: fromCalc(
      COST_SPECS.annualCostPer10k,
      annualTerCost({ investedAmount: 10_000, ter: ter.value }),
      { fetchedAt, inputs },
    ),
    longTermCostShare: fromCalc(
      COST_SPECS.longTermCostShare,
      impact.status === 'OK' ? { ...impact, value: impact.value.costShare } : impact,
      { fetchedAt, inputs, kind: 'estimated' },
      null,
      [
        `Feltevés: ${years} év, ${(assumedGrossReturn * 100).toFixed(1)}% éves bruttó hozam (${assumptions.source === 'default' ? 'kiinduló érték' : 'felhasználói'}) – nem előrejelzés.`,
      ],
    ),
    assumptions,
  };
}
