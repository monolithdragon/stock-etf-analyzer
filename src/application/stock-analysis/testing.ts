/**
 * Teszt-segéd (csak tesztekből importálható): tömör leírásból valódi, a domain konstruktorain
 * átment `FinancialStatementSet`. A meg nem adott tétel a konstruktorban `MISSING` lesz –
 * pontosan úgy, mint éles adatnál.
 */
import {
  createFinancialStatement,
  createFinancialStatementSet,
  createFiscalPeriod,
  metricOk,
  parseSecurityId,
  type BalanceSheetItem,
  type CashFlowItem,
  type CurrencyCode,
  type DataProvenance,
  type FinancialStatement,
  type FinancialStatementSet,
  type FiscalPeriodType,
  type Freshness,
  type IncomeStatementItem,
  type IsoTimestamp,
  type Metric,
  type StatementFrequency,
} from '@/domain';

import { itemUnit } from './metric-helpers';

export const TEST_FETCHED_AT = '2026-11-21T12:00:00Z' as IsoTimestamp;

export interface PeriodSpec {
  readonly fy: number;
  readonly fp: FiscalPeriodType;
  readonly start: string;
  readonly end: string;
  readonly income?: Partial<Record<IncomeStatementItem, number>>;
  readonly balance?: Partial<Record<BalanceSheetItem, number>>;
  readonly cashflow?: Partial<Record<CashFlowItem, number>>;
  /** Felülírja a kimutatás pénznemét (pl. pénznemváltás teszteléséhez). */
  readonly currency?: CurrencyCode;
}

export interface SetSpec {
  readonly frequency: StatementFrequency;
  readonly currency?: CurrencyCode;
  readonly freshness?: Freshness;
  readonly periods: readonly PeriodSpec[];
}

const SECURITY = (() => {
  const id = parseSecurityId('sec-edgar:0000000001');
  if (!id.ok) throw new Error('setup');
  return id.value;
})();

function provenance(currency: CurrencyCode, extra: Partial<DataProvenance> = {}): DataProvenance {
  return {
    sourceId: 'sec-edgar',
    sourceName: 'Teszt SEC',
    kind: 'reported',
    fetchedAt: TEST_FETCHED_AT,
    asOf: '2026-11-01' as never,
    freshness: 'UNKNOWN',
    currency,
    ...extra,
  };
}

function items<K extends string>(
  values: Partial<Record<K, number>> | undefined,
  currency: CurrencyCode,
): Partial<Record<K, Metric<number>>> {
  const out: Partial<Record<K, Metric<number>>> = {};
  for (const [key, value] of Object.entries(values ?? {}) as [K, number][]) {
    const unit = itemUnit(key);
    out[key] = metricOk(
      value,
      provenance(currency, { unit, ...(unit === 'shares' ? { currency: undefined } : {}) }),
    );
  }
  return out;
}

export function statementSet(spec: SetSpec): FinancialStatementSet {
  const baseCurrency = spec.currency ?? ('USD' as CurrencyCode);
  const statements: FinancialStatement[] = [];
  for (const p of spec.periods) {
    const period = createFiscalPeriod({
      fiscalYear: p.fy,
      fiscalPeriod: p.fp,
      start: p.start,
      end: p.end,
    });
    if (!period.ok) throw new Error(`teszt-időszak: ${period.error.message}`);
    const currency = p.currency ?? baseCurrency;
    const common = {
      securityId: SECURITY,
      period: period.value,
      currency,
      provenance: provenance(currency),
    };
    const add = (result: {
      ok: boolean;
      value?: FinancialStatement;
      error?: { message: string };
    }) => {
      if (!result.ok || result.value === undefined) throw new Error(result.error?.message ?? '');
      statements.push(result.value);
    };
    if (p.income !== undefined) {
      add(
        createFinancialStatement({
          ...common,
          statementType: 'income',
          lineItems: items(p.income, currency),
        }),
      );
    }
    if (p.balance !== undefined) {
      add(
        createFinancialStatement({
          ...common,
          statementType: 'balance',
          lineItems: items(p.balance, currency),
        }),
      );
    }
    if (p.cashflow !== undefined) {
      add(
        createFinancialStatement({
          ...common,
          statementType: 'cashflow',
          lineItems: items(p.cashflow, currency),
        }),
      );
    }
  }
  statements.sort((a, b) => (a.period.end < b.period.end ? 1 : -1));
  const set = createFinancialStatementSet({
    securityId: SECURITY,
    cik: null,
    entityName: 'Teszt Rt.',
    frequency: spec.frequency,
    statements,
    notes: [],
    provenance: provenance(baseCurrency, { freshness: spec.freshness ?? 'FRESH' }),
  });
  if (!set.ok) throw new Error(set.error.message);
  return set.value;
}

/** Egy „egészséges” teljes év adatai (USD), a tesztek ebből módosítanak. */
export function fullYear(fy: number, scale = 1): PeriodSpec {
  return {
    fy,
    fp: 'FY',
    start: `${fy}-01-01`,
    end: `${fy}-12-31`,
    income: {
      revenue: 1000 * scale,
      costOfRevenue: 600 * scale,
      operatingIncome: 200 * scale,
      pretaxIncome: 190 * scale,
      incomeTaxExpense: 40 * scale,
      netIncome: 150 * scale,
      epsDiluted: 1.5 * scale,
      weightedSharesDiluted: 100,
      depreciationAmortization: 50 * scale,
    },
    balance: {
      cashAndEquivalents: 300,
      totalDebt: 500,
      totalAssets: 2000,
      totalLiabilities: 1200,
      shareholdersEquity: 800,
      sharesOutstanding: 100,
    },
    cashflow: { operatingCashFlow: 250 * scale, capitalExpenditure: 50 * scale, dividendsPaid: 20 },
  };
}
