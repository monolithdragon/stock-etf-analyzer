/**
 * Számított (vagy jelentett) pénzügyi mutató a képlet és a bemenetek nyomonkövetésével.
 * A képletek maguk a PHASE 05-ben készülnek (`src/calculations`); itt csak az eredmény alakja van.
 */
import {
  invalid,
  ok,
  requireNonEmpty,
  type FiscalPeriod,
  type MeasurementUnit,
  type Metric,
  type Result,
} from '../shared';

/** A DATA_DICTIONARY 5. fejezetének mutatói. A PHASE 05 bővítheti (DECISIONS-bejegyzéssel). */
export const FINANCIAL_METRIC_IDS = [
  // 5.1 Jövedelmezőség és növekedés
  'grossProfit',
  'grossMargin',
  'operatingMargin',
  'netMargin',
  'eps',
  'revenueGrowth',
  'netIncomeGrowth',
  'epsGrowth',
  'revenueCagr',
  'roe',
  'roa',
  'nopat',
  'effectiveTaxRate',
  'investedCapital',
  'roic',
  'dol',
  // 5.2 Mérleg és cash flow
  'netDebt',
  'netCash',
  'debtToEquity',
  'fcf',
  'fcfMargin',
  'fcfConversion',
  'fcfAfterDividend',
  'fcfAfterDividendAndDebtRepayment',
  'ebitda',
  // 5.3 Piaci és értékelési mutatók
  'marketCap',
  'enterpriseValue',
  'pe',
  // PHASE 07: csak ténylegesen elérhető elemzői EPS-előrejelzésből (D-065)
  'forwardPe',
  'pfcf',
  'ps',
  'pb',
  'evToEbitda',
  'peg',
  'dividendYield',
  'fcfYield',
  'marginOfSafety',
] as const;
export type FinancialMetricId = (typeof FINANCIAL_METRIC_IDS)[number];

export interface FinancialMetric {
  readonly id: FinancialMetricId;
  readonly unit: MeasurementUnit;
  readonly value: Metric<number>;
  /** Ember által olvasható képlet, pl. `netIncome / revenue`. */
  readonly formula: string;
  /** Melyik időszakra vonatkozik; `null` pontszerű piaci mutatónál (pl. aktuális P/E ár alapján). */
  readonly period: FiscalPeriod | null;
  /** A felhasznált bemenetek azonosítói (nyomonkövethetőség). */
  readonly inputs: readonly string[];
}

export function createFinancialMetric(input: FinancialMetric): Result<FinancialMetric> {
  const formula = requireNonEmpty(input.formula, 300);
  if (!formula.ok) return formula;
  // Alapelv: az AI csak magyaráz, számszerű mutatót nem állíthat elő (CLAUDE.md, ARCHITECTURE 1.).
  if (input.value.status === 'OK' && input.value.provenance.kind === 'ai_interpretation') {
    return invalid('Számszerű mutató forrása nem lehet AI-értelmezés.');
  }
  return ok({ ...input, formula: formula.value });
}
