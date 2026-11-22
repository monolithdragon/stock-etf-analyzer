/**
 * A `FinancialMetricId`-k képlete és egysége egy helyen (DATA_DICTIONARY 5.). A `Record` típus
 * miatt új mutató-azonosító felvételekor a fordító kikényszeríti a definíciót is.
 */
import {
  createFinancialMetric,
  type FinancialMetric,
  type FinancialMetricId,
  type FiscalPeriod,
  type MeasurementUnit,
  type Result,
} from '@/domain';

import type { MetricCalculation } from './core/to-metric';

export interface MetricDefinition {
  /** Ember által olvasható képlet (a `FinancialMetric.formula` mezőbe kerül). */
  readonly formula: string;
  readonly unit: MeasurementUnit;
}

export const METRIC_DEFINITIONS: Readonly<Record<FinancialMetricId, MetricDefinition>> = {
  // 5.1 Jövedelmezőség és növekedés
  grossProfit: { formula: 'revenue − costOfRevenue', unit: 'money' },
  grossMargin: { formula: 'grossProfit / revenue', unit: 'ratio' },
  operatingMargin: { formula: 'operatingIncome / revenue', unit: 'ratio' },
  netMargin: { formula: 'netIncome / revenue', unit: 'ratio' },
  eps: {
    formula: 'jelentett epsDiluted → jelentett epsBasic → netIncome / weightedSharesDiluted',
    unit: 'money_per_share',
  },
  revenueGrowth: { formula: '(revenue_t − revenue_t−1) / revenue_t−1', unit: 'ratio' },
  netIncomeGrowth: { formula: '(netIncome_t − netIncome_t−1) / netIncome_t−1', unit: 'ratio' },
  epsGrowth: { formula: '(eps_t − eps_t−1) / eps_t−1', unit: 'ratio' },
  revenueCagr: { formula: '(revenue_end / revenue_start)^(1/évek) − 1', unit: 'ratio' },
  roe: { formula: 'netIncome / avg(shareholdersEquity)', unit: 'ratio' },
  roa: { formula: 'netIncome / avg(totalAssets)', unit: 'ratio' },
  nopat: { formula: 'operatingIncome × (1 − taxRate)', unit: 'money' },
  effectiveTaxRate: { formula: 'incomeTaxExpense / pretaxIncome', unit: 'ratio' },
  investedCapital: {
    formula: 'shareholdersEquity + totalDebt − cashAndEquivalents',
    unit: 'money',
  },
  roic: { formula: 'nopat / avg(investedCapital)', unit: 'ratio' },
  dol: { formula: '%Δ operatingIncome / %Δ revenue', unit: 'multiple' },
  // 5.2 Mérleg és cash flow
  netDebt: { formula: 'totalDebt − cashAndEquivalents', unit: 'money' },
  netCash: { formula: 'cashAndEquivalents − totalDebt', unit: 'money' },
  debtToEquity: { formula: 'totalDebt / shareholdersEquity', unit: 'multiple' },
  fcf: { formula: 'operatingCashFlow − capitalExpenditure', unit: 'money' },
  fcfMargin: { formula: 'fcf / revenue', unit: 'ratio' },
  fcfConversion: { formula: 'fcf / netIncome', unit: 'ratio' },
  fcfAfterDividend: { formula: 'fcf − dividendsPaid', unit: 'money' },
  fcfAfterDividendAndDebtRepayment: {
    formula: 'fcf − dividendsPaid − debtRepayment',
    unit: 'money',
  },
  ebitda: { formula: 'operatingIncome + depreciationAmortization', unit: 'money' },
  // 5.3 Piaci és értékelési mutatók
  marketCap: { formula: 'price × sharesOutstanding', unit: 'money' },
  enterpriseValue: { formula: 'marketCap + totalDebt − cashAndEquivalents', unit: 'money' },
  pe: { formula: 'price / eps', unit: 'multiple' },
  pfcf: { formula: 'marketCap / fcf', unit: 'multiple' },
  ps: { formula: 'marketCap / revenue', unit: 'multiple' },
  pb: { formula: 'marketCap / shareholdersEquity', unit: 'multiple' },
  evToEbitda: { formula: 'enterpriseValue / ebitda', unit: 'multiple' },
  peg: { formula: 'pe / (epsGrowth × 100)', unit: 'multiple' },
  dividendYield: { formula: 'TTM dividendPerShare / price', unit: 'ratio' },
  fcfYield: { formula: 'fcf / marketCap', unit: 'ratio' },
  marginOfSafety: { formula: '(intrinsicValue − price) / intrinsicValue', unit: 'ratio' },
};

/**
 * `FinancialMetric` összeállítása egy számításból: a képlet és az egység a definíciós táblából,
 * a bemenetek listája a provenance-ből jön (nincs kézi duplikáció).
 */
export function toFinancialMetric(
  id: FinancialMetricId,
  calculation: MetricCalculation,
  period: FiscalPeriod | null,
): Result<FinancialMetric> {
  const definition = METRIC_DEFINITIONS[id];
  const metric = calculation.metric;
  return createFinancialMetric({
    id,
    unit: definition.unit,
    value: metric,
    formula: definition.formula,
    period,
    inputs: metric.provenance?.inputs ?? [],
  });
}
