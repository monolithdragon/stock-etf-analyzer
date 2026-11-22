/**
 * Kimutatások időszakonként, Q4-származtatás, TTM és a kimutatás-nézetek (PHASE 06, D-060).
 *
 * Szabályok (DATA_DICTIONARY 4.3, 13.2):
 * - Egy oszlop = egy pénzügyi időszak (a `start`/`end` dátumok alapján, D-021); éves és
 *   negyedéves adat SOHA nem keveredik egy táblában.
 * - Q4 = FY − (Q1 + Q2 + Q3), csak időszaki és additív tételnél, csak ha a négy negyedév
 *   hézag nélkül lefedi a pénzügyi évet (Q1 kezdete = FY kezdete, Q4 vége = FY vége).
 *   EPS és átlagos részvényszám NEM additív → a Q4-ben `MISSING`. A Q4 mérlege = az FY mérlege
 *   (ugyanaz az időpont, jelentett érték).
 * - TTM = az utolsó 4 egymást követő negyedév összege (időszaki tételnél); mérlegtételnél a
 *   legutolsó negyedév értéke. Ha nincs 4 egymást követő negyedév: nincs TTM-oszlop.
 */
import { calcInvalidInput, calcOk, calculateMetric, type CalculationContext } from '@/calculations';
import {
  BALANCE_SHEET_ITEMS,
  CASH_FLOW_ITEMS,
  INCOME_STATEMENT_ITEMS,
  createFiscalPeriod,
  inclusiveDaysBetween,
  metricMissing,
  toEpochMs,
  type BalanceSheet,
  type BalanceSheetItem,
  type CashFlowItem,
  type CashFlowStatement,
  type CurrencyCode,
  type FinancialStatementSet,
  type FiscalPeriod,
  type Freshness,
  type IncomeStatement,
  type IncomeStatementItem,
  type IsoDate,
  type IsoTimestamp,
  type Metric,
  type PeriodColumn,
  type StatementFrequency,
  type StatementTable,
} from '@/domain';

import { itemUnit, withFreshness } from './metric-helpers';

export type LineItemKey = IncomeStatementItem | BalanceSheetItem | CashFlowItem;

/** Egy időszak kimutatásai (bármelyik hiányozhat). */
export interface PeriodStatements {
  readonly column: PeriodColumn;
  readonly currency: CurrencyCode;
  readonly income: Readonly<Partial<Record<IncomeStatementItem, Metric<number>>>> | null;
  readonly balance: Readonly<Partial<Record<BalanceSheetItem, Metric<number>>>> | null;
  readonly cashflow: Readonly<Partial<Record<CashFlowItem, Metric<number>>>> | null;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

const STATEMENT_OF: Readonly<Record<LineItemKey, 'income' | 'balance' | 'cashflow'>> = {
  ...Object.fromEntries(INCOME_STATEMENT_ITEMS.map((k) => [k, 'income'])),
  ...Object.fromEntries(BALANCE_SHEET_ITEMS.map((k) => [k, 'balance'])),
  ...Object.fromEntries(CASH_FLOW_ITEMS.map((k) => [k, 'cashflow'])),
} as Record<LineItemKey, 'income' | 'balance' | 'cashflow'>;

const STATEMENT_LABEL = { income: 'eredménykimutatás', balance: 'mérleg', cashflow: 'cash flow' };

/** Tétel egy időszakból; ha a kimutatás nincs meg, indokolt `MISSING` (soha nem 0). */
export function lineItem(ps: PeriodStatements | null, key: LineItemKey): Metric<number> {
  if (ps === null) return metricMissing('Nincs összehasonlítható időszak.');
  const statementType = STATEMENT_OF[key];
  const items = ps[statementType] as Readonly<Partial<Record<string, Metric<number>>>> | null;
  if (items === null) {
    return metricMissing(
      `A(z) ${ps.column.label} időszakra nincs ${STATEMENT_LABEL[statementType]}.`,
    );
  }
  return items[key] ?? metricMissing(`A(z) ${key} tétel nem szerepel (${ps.column.label}).`);
}

export function periodLabel(period: FiscalPeriod): string {
  return period.fiscalPeriod === 'FY'
    ? `FY${period.fiscalYear}`
    : `${period.fiscalPeriod} FY${period.fiscalYear}`;
}

export function columnOf(period: FiscalPeriod, derived = false): PeriodColumn {
  return {
    kind: period.fiscalPeriod,
    label: periodLabel(period),
    fiscalYear: period.fiscalYear,
    start: period.start,
    end: period.end,
    period,
    derived,
    constituents: [],
  };
}

function freshen<K extends string>(
  items: Readonly<Record<K, Metric<number>>>,
  freshness: Freshness,
): Record<K, Metric<number>> {
  const out = {} as Record<K, Metric<number>>;
  for (const key of Object.keys(items) as K[]) out[key] = withFreshness(items[key], freshness);
  return out;
}

/**
 * Egy készlet kimutatásai időszakonként csoportosítva (legfrissebb elöl). A készlet
 * frissessége az egyedi tételekre is rákerül (lásd `withFreshness`).
 */
export function groupByPeriod(set: FinancialStatementSet): PeriodStatements[] {
  const byKey = new Map<
    string,
    {
      period: FiscalPeriod;
      currency: CurrencyCode;
      income: IncomeStatement | null;
      balance: BalanceSheet | null;
      cashflow: CashFlowStatement | null;
    }
  >();
  for (const statement of set.statements) {
    const key = `${statement.period.start}/${statement.period.end}`;
    const entry = byKey.get(key) ?? {
      period: statement.period,
      currency: statement.currency,
      income: null,
      balance: null,
      cashflow: null,
    };
    if (statement.statementType === 'income') entry.income = statement;
    if (statement.statementType === 'balance') entry.balance = statement;
    if (statement.statementType === 'cashflow') entry.cashflow = statement;
    byKey.set(key, entry);
  }
  const freshness = set.provenance.freshness;
  return [...byKey.values()]
    .sort((a, b) => (a.period.end < b.period.end ? 1 : a.period.end > b.period.end ? -1 : 0))
    .map((e) => ({
      column: columnOf(e.period),
      currency: e.currency,
      income: e.income === null ? null : freshen(e.income.lineItems, freshness),
      balance: e.balance === null ? null : freshen(e.balance.lineItems, freshness),
      cashflow: e.cashflow === null ? null : freshen(e.cashflow.lineItems, freshness),
    }));
}

const dayAfter = (date: IsoDate): number => toEpochMs(date) + MS_PER_DAY;

/** `b` közvetlenül `a` után kezdődik (egymást követő időszakok, hézag és átfedés nélkül). */
export function isConsecutive(a: PeriodColumn, b: PeriodColumn): boolean {
  return toEpochMs(b.start) === dayAfter(a.end);
}

/** Nem additív (részvényenkénti / átlagos) tételek: Q4 és TTM nem képezhető összeadással. */
const NON_ADDITIVE: ReadonlySet<LineItemKey> = new Set([
  'epsBasic',
  'epsDiluted',
  'weightedSharesDiluted',
]);

/** Ezek a tételek természetüknél fogva nem lehetnek negatívak (negatív Q4 = ellentmondás). */
const NON_NEGATIVE: ReadonlySet<LineItemKey> = new Set([
  'revenue',
  'costOfRevenue',
  'depreciationAmortization',
  'capitalExpenditure',
  'dividendsPaid',
  'debtRepayment',
]);

function durationItems<K extends LineItemKey>(
  keys: readonly K[],
  build: (key: K) => Metric<number>,
): Record<K, Metric<number>> {
  const out = {} as Record<K, Metric<number>>;
  for (const key of keys) out[key] = build(key);
  return out;
}

/**
 * Q4 származtatása minden olyan FY-ra, amelyhez Q1, Q2, Q3 hézagmentesen megvan.
 * A már létező (jelentett) Q4-et nem írja felül.
 */
export function deriveQ4(
  annual: readonly PeriodStatements[],
  quarterly: readonly PeriodStatements[],
  calculatedAt: IsoTimestamp,
): { readonly derived: PeriodStatements[]; readonly notes: string[] } {
  const derived: PeriodStatements[] = [];
  const notes: string[] = [];
  for (const fy of annual) {
    if (fy.column.kind !== 'FY') continue;
    const inYear = (kind: string) =>
      quarterly.find(
        (q) =>
          q.column.kind === kind &&
          toEpochMs(q.column.start) >= toEpochMs(fy.column.start) &&
          toEpochMs(q.column.end) <= toEpochMs(fy.column.end),
      );
    if (inYear('Q4') !== undefined) continue;
    const [q1, q2, q3] = [inYear('Q1'), inYear('Q2'), inYear('Q3')];
    if (q1 === undefined || q2 === undefined || q3 === undefined) continue;
    if (
      q1.column.start !== fy.column.start ||
      !isConsecutive(q1.column, q2.column) ||
      !isConsecutive(q2.column, q3.column)
    ) {
      notes.push(`${fy.column.label}: a negyedévek nem fedik le hézagmentesen az évet – nincs Q4.`);
      continue;
    }
    if (q1.currency !== fy.currency || q2.currency !== fy.currency || q3.currency !== fy.currency) {
      notes.push(`${fy.column.label}: eltérő pénznemű negyedévek – nincs Q4.`);
      continue;
    }
    const start = new Date(dayAfter(q3.column.end)).toISOString().slice(0, 10);
    const period = createFiscalPeriod({
      fiscalYear: fy.column.fiscalYear,
      fiscalPeriod: 'Q4',
      start,
      end: fy.column.end,
    });
    if (!period.ok) {
      notes.push(
        `${fy.column.label}: a származtatott Q4 hossza nem negyedéves (${period.error.message}).`,
      );
      continue;
    }
    const context: CalculationContext = {
      unit: 'money',
      calculatedAt,
      period: period.value,
    };
    const q4Of = (key: LineItemKey): Metric<number> => {
      if (NON_ADDITIVE.has(key)) {
        return metricMissing(
          'Részvényenkénti / átlagos részvényszám nem additív: a Q4 nem képezhető az FY − (Q1+Q2+Q3) különbséggel.',
        );
      }
      return calculateMetric(
        {
          FY: lineItem(fy, key),
          Q1: lineItem(q1, key),
          Q2: lineItem(q2, key),
          Q3: lineItem(q3, key),
        },
        {},
        (v) => {
          const value = v.FY - v.Q1 - v.Q2 - v.Q3;
          return NON_NEGATIVE.has(key) && value < 0
            ? calcInvalidInput(
                `A származtatott Q4 negatív (${value}) – az FY és a negyedéves adatok ellentmondanak (pl. restatement).`,
              )
            : calcOk(value);
        },
        { ...context, unit: itemUnit(key) },
      ).metric;
    };
    // Csak akkor van Q4-kimutatás, ha az FY-nak ÉS mindhárom negyedévnek van ilyen kimutatása
    // (különben egy csupa-MISSING oszlop azt sugallná, hogy van adat).
    const allHave = (type: 'income' | 'cashflow') =>
      fy[type] !== null && [q1, q2, q3].every((quarter) => quarter[type] !== null);
    derived.push({
      column: columnOf(period.value, true),
      currency: fy.currency,
      income: allHave('income') ? durationItems(INCOME_STATEMENT_ITEMS, q4Of) : null,
      cashflow: allHave('cashflow') ? durationItems(CASH_FLOW_ITEMS, q4Of) : null,
      // Ugyanaz az időpont: a Q4 vége = FY vége, a jelentett mérleg változatlanul érvényes.
      balance: fy.balance,
    });
  }
  if (derived.length > 0) {
    notes.push(
      'Q4 = FY − (Q1 + Q2 + Q3) (calculated). Az FY és a negyedévek eltérő filingből származhatnak; restatement esetén a Q4 torzulhat. EPS és átlagos részvényszám Q4-re nem származtatható.',
    );
  }
  return { derived, notes };
}

/**
 * TTM az utolsó 4 egymást követő negyedévből (a származtatott Q4-gyel együtt).
 * `null`, ha nincs 4 hézagmentes negyedév.
 */
export function buildTtm(
  quarterly: readonly PeriodStatements[],
  calculatedAt: IsoTimestamp,
): PeriodStatements | null {
  const [a, b, c, d] = quarterly; // legfrissebb elöl
  if (a === undefined || b === undefined || c === undefined || d === undefined) return null;
  if (!isConsecutive(b.column, a.column) || !isConsecutive(c.column, b.column)) return null;
  if (!isConsecutive(d.column, c.column)) return null;
  if (new Set([a.currency, b.currency, c.currency, d.currency]).size > 1) return null;
  const quarters = [a, b, c, d];
  const days = inclusiveDaysBetween(d.column.start, a.column.end);
  const column: PeriodColumn = {
    kind: 'TTM',
    label: `TTM ${a.column.end}`,
    fiscalYear: a.column.fiscalYear,
    start: d.column.start,
    end: a.column.end,
    period: null,
    derived: true,
    constituents: quarters.flatMap((q) => (q.column.period === null ? [] : [q.column.period])),
  };
  const sumOf = (key: LineItemKey): Metric<number> => {
    if (key === 'weightedSharesDiluted') {
      return metricMissing('Az átlagos részvényszám nem additív; TTM-re nem képezzük.');
    }
    const [m0, m1, m2, m3] = quarters.map((q) => lineItem(q, key)) as [
      Metric<number>,
      Metric<number>,
      Metric<number>,
      Metric<number>,
    ];
    return calculateMetric(
      { q0: m0, q1: m1, q2: m2, q3: m3 },
      {},
      (v) => calcOk(v.q0 + v.q1 + v.q2 + v.q3, [`TTM: ${days} nap, 4 negyedév összege.`]),
      { unit: itemUnit(key), calculatedAt },
    ).metric;
  };
  return {
    column,
    currency: a.currency,
    income: durationItems(INCOME_STATEMENT_ITEMS, sumOf),
    cashflow: durationItems(CASH_FLOW_ITEMS, sumOf),
    balance: a.balance,
  };
}

/** Kimutatás-táblák (feladat 3.) egy gyakoriságra. */
export function buildStatementTables(
  frequency: StatementFrequency,
  periods: readonly PeriodStatements[],
  notes: readonly string[],
): StatementTable[] {
  const currencies = new Set(periods.map((p) => p.currency));
  const currency = currencies.size === 1 ? [...currencies][0]! : null;
  const tableNotes =
    currencies.size > 1
      ? [...notes, `Több pénznem a készletben (${[...currencies].join(', ')}) – nem összevethető.`]
      : notes;
  const make = (
    statementType: 'income' | 'balance' | 'cashflow',
    keys: readonly LineItemKey[],
  ): StatementTable => {
    const relevant = periods.filter((p) => p[statementType] !== null);
    return {
      statementType,
      frequency,
      currency: relevant.length === 0 ? null : currency,
      periods: relevant.flatMap((p) => (p.column.period === null ? [] : [p.column.period])),
      derived: relevant.map((p) => p.column.derived),
      rows: keys.map((item) => ({
        item,
        unit: itemUnit(item),
        cells: relevant.map((p) => lineItem(p, item)),
      })),
      notes: tableNotes,
    };
  };
  return [
    make('income', INCOME_STATEMENT_ITEMS),
    make('balance', BALANCE_SHEET_ITEMS),
    make('cashflow', CASH_FLOW_ITEMS),
  ];
}
