/**
 * 1/3/5/10 éves trendek és CAGR (PHASE 06, feladat 5., D-061).
 *
 * CAGR csak akkor számolható, ha a két végpont azonos konvenció szerint összehasonlítható:
 * 1. mindkét végpont-év létezik és az értéke `OK` (különben a végpont státusza / `INSUFFICIENT_DATA`);
 * 2. azonos beszámolási pénznem;
 * 3. azonos pénzügyi év vége (±7 nap a 52/53 hetes év miatt); ha a cég év végét váltott →
 *    `NOT_MEANINGFUL`;
 * 4. részvényenkénti / részvényszám-sornál a split-bázis az ablak MINDEN egymást követő
 *    évpárján ellenőrizve (`SPLIT_SUSPECT_RATIO`); gyanú → `NOT_MEANINGFUL`;
 * 5. a végpont ≤ 0 → `NOT_MEANINGFUL` (a `cagr` képlet szabálya).
 * Az évek száma a pénzügyi év-címkék különbsége (a 52/53 hetes eltérés elhanyagolható).
 */
import {
  cagr,
  calculateMetric,
  freeCashFlow,
  grossProfit,
  preferReported,
  type CalculationContext,
} from '@/calculations';
import {
  TREND_HORIZONS,
  createFundamentalMetric,
  metricInsufficientData,
  metricNotMeaningful,
  toEpochMs,
  type FundamentalMetric,
  type IsoDate,
  type IsoTimestamp,
  type Metric,
  type TrendCagr,
  type TrendHorizon,
  type TrendPoint,
  type TrendSeries,
  type TrendSeriesId,
} from '@/domain';

import { itemUnit } from './metric-helpers';
import { SPLIT_SUSPECT_RATIO, selectEpsMetric } from './period-metrics';
import { lineItem, type PeriodStatements } from './statement-periods';

const MS_PER_DAY = 24 * 60 * 60 * 1000;
/** Az év végének megengedett elcsúszása (52/53 hetes üzleti év: legfeljebb 7 nap). */
export const FISCAL_YEAR_END_TOLERANCE_DAYS = 7;

const SERIES_DEFS: Readonly<
  Record<
    TrendSeriesId,
    {
      readonly unit: ReturnType<typeof itemUnit>;
      readonly splitSensitive: boolean;
      readonly value: (ps: PeriodStatements, ctx: CalculationContext) => Metric<number>;
    }
  >
> = {
  revenue: { unit: 'money', splitSensitive: false, value: (ps) => lineItem(ps, 'revenue') },
  grossProfit: {
    unit: 'money',
    splitSensitive: false,
    // Ugyanaz a szabály, mint az időszaki táblában: a jelentett az elsődleges.
    value: (ps, ctx) =>
      preferReported(lineItem(ps, 'grossProfit'), () =>
        calculateMetric(
          { revenue: lineItem(ps, 'revenue'), costOfRevenue: lineItem(ps, 'costOfRevenue') },
          {},
          grossProfit,
          { ...ctx, unit: 'money' },
        ),
      ).metric,
  },
  operatingIncome: {
    unit: 'money',
    splitSensitive: false,
    value: (ps) => lineItem(ps, 'operatingIncome'),
  },
  netIncome: { unit: 'money', splitSensitive: false, value: (ps) => lineItem(ps, 'netIncome') },
  eps: {
    unit: 'money_per_share',
    splitSensitive: true,
    value: (ps, ctx) => selectEpsMetric(ps, ctx).metric,
  },
  operatingCashFlow: {
    unit: 'money',
    splitSensitive: false,
    value: (ps) => lineItem(ps, 'operatingCashFlow'),
  },
  fcf: {
    unit: 'money',
    splitSensitive: false,
    value: (ps, ctx) =>
      calculateMetric(
        {
          operatingCashFlow: lineItem(ps, 'operatingCashFlow'),
          capitalExpenditure: lineItem(ps, 'capitalExpenditure'),
        },
        {},
        freeCashFlow,
        { ...ctx, unit: 'money' },
      ).metric,
  },
  sharesOutstanding: {
    unit: 'shares',
    splitSensitive: true,
    value: (ps) => lineItem(ps, 'sharesOutstanding'),
  },
};

/** Napok eltérése két év vége között, évfordulóra vetítve (pl. 09-26 vs 09-27 → 1). */
export function fiscalYearEndShiftDays(a: IsoDate, b: IsoDate): number {
  const later = toEpochMs(a) > toEpochMs(b) ? a : b;
  const earlier = later === a ? b : a;
  const years = Number(later.slice(0, 4)) - Number(earlier.slice(0, 4));
  const projected = Date.UTC(
    Number(earlier.slice(0, 4)) + years,
    Number(earlier.slice(5, 7)) - 1,
    Number(earlier.slice(8, 10)),
  );
  const diff = Math.abs(toEpochMs(later) - projected) / MS_PER_DAY;
  // Az év határán átcsúszó vég (pl. 01-03 vs 12-29) is kicsi eltérés.
  return Math.min(diff, Math.abs(365 - diff), Math.abs(366 - diff));
}

/** A split-bázis ellenőrzéséhez használt részvényszám. */
function sharesBasis(ps: PeriodStatements, id: TrendSeriesId): Metric<number> {
  return id === 'eps' ? lineItem(ps, 'weightedSharesDiluted') : lineItem(ps, 'sharesOutstanding');
}

function cagrFor(
  id: TrendSeriesId,
  years: TrendHorizon,
  byYear: ReadonlyMap<number, PeriodStatements>,
  points: readonly TrendPoint[],
  calculatedAt: IsoTimestamp,
): FundamentalMetric {
  const unit = 'ratio' as const;
  const make = (value: Metric<number>, notes: readonly string[] = []) =>
    createFundamentalMetric({
      id: id === 'revenue' ? 'revenueCagr' : id === 'sharesOutstanding' ? 'sharesOutstanding' : id,
      unit,
      formula: `(${id}_end / ${id}_start)^(1/${years}) − 1`,
      period: null,
      value,
      notes,
    });
  const last = points[points.length - 1];
  if (last === undefined) return make(metricInsufficientData('Nincs éves adat.'));
  const endYear = last.fiscalYear;
  const startYear = endYear - years;
  const end = byYear.get(endYear);
  const start = byYear.get(startYear);
  const startPoint = points.find((p) => p.fiscalYear === startYear);
  if (end === undefined || start === undefined || startPoint === undefined) {
    return make(
      metricInsufficientData(
        `${years} éves CAGR-hez az FY${startYear} és az FY${endYear} adata kell; az FY${startYear} nem érhető el (elérhető: FY${points[0]?.fiscalYear}–FY${endYear}).`,
      ),
    );
  }
  if (start.currency !== end.currency) {
    return make(
      metricNotMeaningful(
        `Eltérő beszámolási pénznem (FY${startYear}: ${start.currency}, FY${endYear}: ${end.currency}).`,
      ),
    );
  }
  const shift = fiscalYearEndShiftDays(start.column.end, end.column.end);
  if (shift > FISCAL_YEAR_END_TOLERANCE_DAYS) {
    return make(
      metricNotMeaningful(
        `A pénzügyi év vége megváltozott (${start.column.end} → ${end.column.end}); az évek nem azonos konvenciójúak.`,
      ),
    );
  }
  const notes: string[] = [];
  if (SERIES_DEFS[id].splitSensitive) {
    for (let year = startYear; year < endYear; year += 1) {
      const a = byYear.get(year);
      const b = byYear.get(year + 1);
      if (a === undefined || b === undefined) {
        notes.push(`A split-bázis FY${year}–FY${year + 1} között nem ellenőrizhető (hiányzó év).`);
        continue;
      }
      const sa = sharesBasis(a, id);
      const sb = sharesBasis(b, id);
      if (sa.status !== 'OK' || sb.status !== 'OK' || sa.value <= 0 || sb.value <= 0) {
        notes.push(
          `A split-bázis FY${year}–FY${year + 1} között nem ellenőrizhető (hiányzó részvényszám).`,
        );
        continue;
      }
      const ratio = sb.value / sa.value;
      if (ratio > SPLIT_SUSPECT_RATIO || ratio < 1 / SPLIT_SUSPECT_RATIO) {
        return make(
          metricNotMeaningful(
            `A részvényszám FY${year} → FY${year + 1} között ${ratio.toFixed(2)}×-esére változott – valószínű részvényfelosztás; a végpontok nem azonos bázisúak.`,
          ),
        );
      }
    }
  }
  const calc = calculateMetric(
    { startValue: startPoint.value, endValue: last.value },
    {},
    (v) => cagr({ ...v, years }),
    { unit, calculatedAt },
  );
  return make(calc.metric, [...notes, ...calc.notes, `FY${startYear} → FY${endYear}.`]);
}

export function buildTrends(
  annual: readonly PeriodStatements[],
  calculatedAt: IsoTimestamp,
): TrendSeries[] {
  const fy = annual.filter((p) => p.column.kind === 'FY');
  const byYear = new Map<number, PeriodStatements>();
  const notes: string[] = [];
  for (const ps of fy) {
    if (byYear.has(ps.column.fiscalYear)) {
      notes.push(`Az FY${ps.column.fiscalYear} kétszer szerepel; a frissebb időszak marad.`);
      continue;
    }
    byYear.set(ps.column.fiscalYear, ps);
  }
  const ascending = [...byYear.values()].sort((a, b) => a.column.fiscalYear - b.column.fiscalYear);
  return (Object.keys(SERIES_DEFS) as TrendSeriesId[]).map((id) => {
    const def = SERIES_DEFS[id];
    const points: TrendPoint[] = ascending.flatMap((ps) =>
      ps.column.period === null
        ? []
        : [
            {
              fiscalYear: ps.column.fiscalYear,
              period: ps.column.period,
              value: def.value(ps, { unit: def.unit, calculatedAt, period: ps.column.period }),
            },
          ],
    );
    const cagrs: TrendCagr[] = TREND_HORIZONS.map((years) => ({
      years,
      value: cagrFor(id, years, byYear, points, calculatedAt),
    }));
    return { id, unit: def.unit, points, cagr: cagrs, notes };
  });
}
