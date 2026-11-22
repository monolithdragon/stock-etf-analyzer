/**
 * Időszaki mutatók egy oszlopra (PHASE 06, feladat 4.). Minden képlet a PHASE 05 motorjából
 * jön (`@/calculations`); itt csak a bemenetek kiválasztása és a konvenciók vannak:
 * - Növekedés: éves → előző FY; negyedéves → az előző év UGYANAZON negyedéve (YoY, a
 *   szezonalitás miatt); TTM → az egy évvel korábbi TTM nincs, ezért nem számolunk.
 * - EPS-növekedésnél split-bázis ellenőrzés (D-061): ha a hígított átlagos részvényszám a két
 *   időszak között 1,5×-nél többet változik, a bázis valószínűleg eltér → `NOT_MEANINGFUL`.
 * - ROE/ROA/ROIC csak éves oszlopra (negyedéves érték évesítés nélkül félrevezető).
 */
import {
  calculateMetric,
  calcOk,
  debtToEquity,
  ebitda,
  effectiveTaxRate,
  fcfConversion,
  fcfMargin,
  freeCashFlow,
  grossMargin,
  grossProfit,
  growthRate,
  investedCapital,
  netCash,
  netDebt,
  netMargin,
  nopat,
  operatingMargin,
  preferReported,
  roa,
  roe,
  roic,
  type CalculationContext,
  type MetricCalculation,
} from '@/calculations';
import {
  metricMissing,
  metricNotApplicable,
  metricNotMeaningful,
  type FinancialMetricId,
  type FundamentalMetric,
  type IsoTimestamp,
  type Metric,
} from '@/domain';

import { calculatedMetric, lineItemMetric } from './metric-helpers';
import { lineItem, type PeriodStatements } from './statement-periods';

/** A sorok sorrendje a táblában (feladat 4. listája). */
export const PERIOD_METRIC_IDS = [
  'revenue',
  'grossProfit',
  'grossMargin',
  'operatingIncome',
  'operatingMargin',
  'netIncome',
  'netMargin',
  'eps',
  'revenueGrowth',
  'netIncomeGrowth',
  'epsGrowth',
  'cashAndEquivalents',
  'totalDebt',
  'totalAssets',
  'totalLiabilities',
  'shareholdersEquity',
  'netDebt',
  'netCash',
  'debtToEquity',
  'operatingCashFlow',
  'capitalExpenditure',
  'fcf',
  'fcfMargin',
  'fcfConversion',
  'ebitda',
  'effectiveTaxRate',
  'roe',
  'roa',
  'roic',
  'sharesOutstanding',
] as const;
export type PeriodMetricId = (typeof PERIOD_METRIC_IDS)[number];

/** A split-bázis eltérését jelző részvényszám-arány (D-061). */
export const SPLIT_SUSPECT_RATIO = 1.5;

export interface PeriodMetricInput {
  readonly current: PeriodStatements;
  /** Összehasonlító időszak a növekedéshez (előző FY / előző év azonos negyedéve). */
  readonly comparable: PeriodStatements | null;
  /** Az előző mérlegidőpont (átlagos saját tőke / eszköz / IC); éves oszlopnál az előző FY. */
  readonly previousBalance: PeriodStatements | null;
  readonly basis: 'annual' | 'quarterly' | 'ttm';
  readonly calculatedAt: IsoTimestamp;
}

/**
 * EPS (D-056): jelentett hígított → jelentett alap (megjegyzéssel) → saját számítás.
 * A jelentett érték `reported` marad (nem csomagoljuk át „calculated”-be).
 */
export function selectEpsMetric(
  ps: PeriodStatements,
  context: CalculationContext,
): MetricCalculation {
  const diluted = lineItem(ps, 'epsDiluted');
  if (diluted.status === 'OK') return { metric: diluted, notes: [] };
  const basic = lineItem(ps, 'epsBasic');
  if (basic.status === 'OK') {
    return {
      metric: basic,
      notes: ['Jelentett hígított EPS hiányában az alap (basic) EPS szerepel.'],
    };
  }
  const own = calculateMetric(
    {
      netIncome: lineItem(ps, 'netIncome'),
      weightedSharesDiluted: lineItem(ps, 'weightedSharesDiluted'),
    },
    {},
    (v) =>
      v.weightedSharesDiluted > 0
        ? calcOk(v.netIncome / v.weightedSharesDiluted, [
            'Saját számítás: netIncome / weightedSharesDiluted (elsőbbségi osztalék levonása nélkül).',
          ])
        : { status: 'INVALID_INPUT', reason: 'A részvényszám nem pozitív.' },
    { ...context, unit: 'money_per_share' },
  );
  if (own.metric.status === 'MISSING' && diluted.status !== 'MISSING') {
    return { metric: diluted, notes: [] };
  }
  if (own.metric.status === 'MISSING') {
    return {
      metric: metricMissing(
        'Nincs jelentett EPS, és a saját számításhoz is hiányzik bemenet (netIncome, weightedSharesDiluted).',
      ),
      notes: [],
    };
  }
  return own;
}

/** Split-bázis ellenőrzés két időszak hígított átlagos részvényszámával. */
export function splitBasisCheck(
  current: PeriodStatements,
  previous: PeriodStatements,
): Metric<number> | null {
  const a = lineItem(current, 'weightedSharesDiluted');
  const b = lineItem(previous, 'weightedSharesDiluted');
  if (a.status !== 'OK' || b.status !== 'OK' || a.value <= 0 || b.value <= 0) return null;
  const ratio = a.value / b.value;
  if (ratio > SPLIT_SUSPECT_RATIO || ratio < 1 / SPLIT_SUSPECT_RATIO) {
    return metricNotMeaningful(
      `A hígított átlagos részvényszám ${ratio.toFixed(2)}×-esére változott (${previous.column.label} → ${current.column.label}) – valószínű részvényfelosztás vagy eltérő bázis; az EPS-ek nem hasonlíthatók össze.`,
    );
  }
  return null;
}

function growthCalc(
  current: Metric<number>,
  previous: Metric<number>,
  context: CalculationContext,
): MetricCalculation {
  return calculateMetric({ current, previous }, {}, growthRate, { ...context, unit: 'ratio' });
}

export function computePeriodMetrics(input: PeriodMetricInput): FundamentalMetric[] {
  const { current: ps, comparable, previousBalance, basis } = input;
  const period = ps.column.period;
  const ctx: CalculationContext = {
    unit: 'ratio',
    calculatedAt: input.calculatedAt,
    ...(period === null ? {} : { period }),
  };
  const money: CalculationContext = { ...ctx, unit: 'money' };
  const ttmNote = basis === 'ttm' ? [`${ps.column.label}: utolsó 4 negyedév.`] : [];
  const item = (key: Parameters<typeof lineItem>[1]) => lineItem(ps, key);

  const revenue = item('revenue');
  const gp = preferReported(item('grossProfit'), () =>
    calculateMetric({ revenue, costOfRevenue: item('costOfRevenue') }, {}, grossProfit, money),
  );
  const operatingIncome = item('operatingIncome');
  const netIncome = item('netIncome');
  const eps = selectEpsMetric(ps, ctx);
  const fcf = calculateMetric(
    {
      operatingCashFlow: item('operatingCashFlow'),
      capitalExpenditure: item('capitalExpenditure'),
    },
    {},
    freeCashFlow,
    money,
  );
  const cash = item('cashAndEquivalents');
  const debt = item('totalDebt');
  const equity = item('shareholdersEquity');

  const noComparable = (what: string): MetricCalculation => ({
    metric: metricMissing(
      basis === 'ttm'
        ? 'TTM-növekedéshez az egy évvel korábbi TTM kellene; nem számoljuk.'
        : `Nincs összehasonlítható előző időszak (${what}).`,
    ),
    notes: [],
  });
  const growthOf = (pick: (p: PeriodStatements) => Metric<number>, what: string) =>
    comparable === null || basis === 'ttm'
      ? noComparable(what)
      : growthCalc(pick(ps), pick(comparable), ctx);
  const epsGrowth = (() => {
    if (comparable === null || basis === 'ttm') return noComparable('EPS');
    const split = splitBasisCheck(ps, comparable);
    if (split !== null) return { metric: split, notes: [] };
    return growthCalc(eps.metric, selectEpsMetric(comparable, ctx).metric, ctx);
  })();

  const returnsApplicable = basis === 'annual';
  const notApplicableReturns = (): MetricCalculation => ({
    metric: metricNotApplicable(
      'Csak éves oszlopra számoljuk: a negyedéves / TTM érték évesítés nélkül félrevezető lenne.',
    ),
    notes: [],
  });
  const prev = (key: Parameters<typeof lineItem>[1]) =>
    previousBalance === null ? null : lineItem(previousBalance, key);
  const taxRate = calculateMetric(
    { incomeTaxExpense: item('incomeTaxExpense'), pretaxIncome: item('pretaxIncome') },
    {},
    effectiveTaxRate,
    ctx,
  );
  const ic = calculateMetric(
    { shareholdersEquity: equity, totalDebt: debt, cashAndEquivalents: cash },
    {},
    investedCapital,
    money,
  );
  const icPrevious =
    previousBalance === null
      ? null
      : calculateMetric(
          {
            shareholdersEquity: lineItem(previousBalance, 'shareholdersEquity'),
            totalDebt: lineItem(previousBalance, 'totalDebt'),
            cashAndEquivalents: lineItem(previousBalance, 'cashAndEquivalents'),
          },
          {},
          investedCapital,
          money,
        ).metric;
  const nopatCalc = calculateMetric({ operatingIncome, taxRate: taxRate.metric }, {}, nopat, money);

  const calc = (id: FinancialMetricId, c: MetricCalculation) =>
    calculatedMetric(id, c, period, ttmNote);
  const reported = (id: Parameters<typeof lineItemMetric>[0], m: Metric<number>) =>
    lineItemMetric(id, m, period, ttmNote);

  const byId: Record<PeriodMetricId, FundamentalMetric> = {
    revenue: reported('revenue', revenue),
    grossProfit:
      gp.metric.status === 'OK' && gp.metric.provenance.kind !== 'reported'
        ? calc('grossProfit', gp)
        : reported('grossProfit', gp.metric),
    grossMargin: calc(
      'grossMargin',
      calculateMetric({ grossProfit: gp.metric, revenue }, {}, grossMargin, ctx),
    ),
    operatingIncome: reported('operatingIncome', operatingIncome),
    operatingMargin: calc(
      'operatingMargin',
      calculateMetric({ operatingIncome, revenue }, {}, operatingMargin, ctx),
    ),
    netIncome: reported('netIncome', netIncome),
    netMargin: calc('netMargin', calculateMetric({ netIncome, revenue }, {}, netMargin, ctx)),
    eps:
      eps.metric.status === 'OK' && eps.metric.provenance.kind === 'reported'
        ? lineItemMetric('eps', eps.metric, period, [...eps.notes, ...ttmNote])
        : calc('eps', eps),
    revenueGrowth: calc(
      'revenueGrowth',
      growthOf((p) => lineItem(p, 'revenue'), 'árbevétel'),
    ),
    netIncomeGrowth: calc(
      'netIncomeGrowth',
      growthOf((p) => lineItem(p, 'netIncome'), 'nettó eredmény'),
    ),
    epsGrowth: calc('epsGrowth', epsGrowth),
    cashAndEquivalents: reported('cashAndEquivalents', cash),
    totalDebt: reported('totalDebt', debt),
    totalAssets: reported('totalAssets', item('totalAssets')),
    totalLiabilities: reported('totalLiabilities', item('totalLiabilities')),
    shareholdersEquity: reported('shareholdersEquity', equity),
    netDebt: calc(
      'netDebt',
      calculateMetric({ totalDebt: debt, cashAndEquivalents: cash }, {}, netDebt, money),
    ),
    netCash: calc(
      'netCash',
      calculateMetric({ totalDebt: debt, cashAndEquivalents: cash }, {}, netCash, money),
    ),
    debtToEquity: calc(
      'debtToEquity',
      calculateMetric({ totalDebt: debt, shareholdersEquity: equity }, {}, debtToEquity, {
        ...ctx,
        unit: 'multiple',
      }),
    ),
    operatingCashFlow: reported('operatingCashFlow', item('operatingCashFlow')),
    capitalExpenditure: reported('capitalExpenditure', item('capitalExpenditure')),
    fcf: calc('fcf', fcf),
    fcfMargin: calc(
      'fcfMargin',
      calculateMetric({ freeCashFlow: fcf.metric, revenue }, {}, fcfMargin, ctx),
    ),
    fcfConversion: calc(
      'fcfConversion',
      calculateMetric({ freeCashFlow: fcf.metric, netIncome }, {}, fcfConversion, ctx),
    ),
    ebitda: calc(
      'ebitda',
      calculateMetric(
        { operatingIncome, depreciationAmortization: item('depreciationAmortization') },
        {},
        ebitda,
        money,
      ),
    ),
    effectiveTaxRate: calc('effectiveTaxRate', taxRate),
    roe: calc(
      'roe',
      returnsApplicable
        ? calculateMetric(
            { netIncome, equityEnd: equity },
            { equityStart: prev('shareholdersEquity') },
            roe,
            ctx,
          )
        : notApplicableReturns(),
    ),
    roa: calc(
      'roa',
      returnsApplicable
        ? calculateMetric(
            { netIncome, totalAssetsEnd: item('totalAssets') },
            { totalAssetsStart: prev('totalAssets') },
            roa,
            ctx,
          )
        : notApplicableReturns(),
    ),
    roic: calc(
      'roic',
      returnsApplicable
        ? calculateMetric(
            { nopat: nopatCalc.metric, investedCapitalEnd: ic.metric },
            { investedCapitalStart: icPrevious },
            roic,
            ctx,
          )
        : notApplicableReturns(),
    ),
    sharesOutstanding: reported('sharesOutstanding', item('sharesOutstanding')),
  };
  return PERIOD_METRIC_IDS.map((id) => byId[id]);
}
