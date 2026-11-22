/**
 * ETF-hozamok: árfolyamhozam, total return, évesítés, osztalékhozam – úgy, hogy az akkumuláló
 * és a disztribúciós ETF összehasonlítása ne legyen félrevezető (PHASE 08 feladat 7., D-069).
 *
 * Total return forrásának sorrendje:
 * 1. split- és osztalék-korrigált ártörténet (`SPLIT_DIVIDEND`) → `adjusted_series`;
 * 2. akkumuláló ETF árhozama (a hozam a NAV-ban marad) → `accumulating_price`;
 * 3. disztribúciós ETF: árhozam + az időszak kifizetései (újrabefektetés nélkül) → `price_plus_distributions`;
 * 4. különben `MISSING`, és az összehasonlítási alap `price_return_only` (figyelmeztetéssel).
 */
import {
  annualizeReturn,
  calcInvalidInput,
  calcMissing,
  calcNotApplicable,
  dividendYieldFromMoney,
  seriesReturn,
  totalReturnFromPrices,
  trailingDividendPerShare,
  yearsBetween,
  type CalcResult,
} from '@/calculations';
import {
  toEpochMs,
  toMajor,
  type AppError,
  type DataProvenance,
  type DividendHistory,
  type EtfDistribution,
  type IsoTimestamp,
  type Metric,
  type PriceSeries,
  type Result,
} from '@/domain';

import { etfMetric, fromCalc, propagateFailure, type MetricSpec } from './etf-metric';
import type {
  AnalysisWindow,
  EtfMetric,
  EtfReturnAnalysis,
  ReturnComparisonBasis,
  TotalReturnMethod,
} from './types';
import { appErrorToMetric } from '../shared/app-error-metric';

export const RETURN_SPECS = {
  priceReturn: {
    id: 'priceReturn',
    label: 'Árfolyamhozam (időszaki)',
    unit: 'ratio',
    formula: 'P_vég / P_kezdő − 1 (split-korrigált vagy nyers záróár; osztalék nélkül)',
  },
  totalReturn: {
    id: 'totalReturn',
    label: 'Total return (időszaki)',
    unit: 'ratio',
    formula:
      'korrigált záróárból: P*_vég / P*_kezdő − 1; akkumulálónál = árhozam; disztribúciósnál (P_vég + kifizetések) / P_kezdő − 1',
  },
  annualizedTotalReturn: {
    id: 'annualizedTotalReturn',
    label: 'Évesített total return',
    unit: 'ratio',
    formula: '(1 + R)^(1/évek) − 1, évek = napok / 365,25; csak ≥ 1 éves ablakra',
  },
  distributionYieldTtm: {
    id: 'distributionYieldTtm',
    label: 'Osztalékhozam (TTM)',
    unit: 'ratio',
    formula: 'utolsó 12 havi kifizetés / utolsó záróár (azonos fő pénznemben; GBX → GBP)',
  },
} as const satisfies Record<string, MetricSpec>;

/** Ennél rövidebb ablakot nem évesítünk (a rövid időszak évesítése felnagyítja a véletlent). */
export const MIN_ANNUALIZATION_YEARS = 1;
/** Tűrés: 7 nap (hétvége/ünnep miatt egy „1 éves” EOD-ablak néhány nappal rövidebb lehet). */
export const ANNUALIZATION_TOLERANCE_YEARS = 7 / 365.25;

export interface ReturnInputs {
  readonly totalSeries: Result<PriceSeries, AppError>;
  readonly priceSeries: Result<PriceSeries, AppError>;
  readonly dividends: Result<DividendHistory, AppError>;
  readonly distribution: Metric<EtfDistribution>;
  readonly fetchedAt: IsoTimestamp;
}

export function seriesWindow(series: PriceSeries): AnalysisWindow | null {
  const first = series.points[0];
  const last = series.points[series.points.length - 1];
  return first === undefined || last === undefined
    ? null
    : { start: first.date, end: last.date, observations: series.points.length - 1 };
}

function seriesInput(name: string, series: PriceSeries): readonly [string, DataProvenance] {
  return [name, { ...series.provenance, currency: series.currency }];
}

function failedSeries(spec: MetricSpec, result: Result<PriceSeries, AppError>, resource: string) {
  return result.ok ? null : etfMetric(spec, appErrorToMetric<number>(result.error, resource));
}

/** Az időszak (kezdő, vég] ex-dátumú kifizetései részvényenként, a sor fő pénznemében. */
function distributionsInWindow(
  dividends: DividendHistory,
  series: PriceSeries,
): CalcResult<number> {
  const window = seriesWindow(series);
  if (window === null) return calcMissing('Nincs ártörténet.');
  const priceMajor = toMajor(series.currency).major;
  const startMs = toEpochMs(window.start);
  const endMs = toEpochMs(window.end);
  let total = 0;
  for (const event of dividends.events) {
    const ms = toEpochMs(event.exDate);
    if (ms <= startMs || ms > endMs) continue;
    const { major, divisor } = toMajor(event.amount.currency);
    if (major !== priceMajor) {
      return calcInvalidInput(
        `A kifizetés (${event.amount.currency}) és az ár (${series.currency}) pénzneme eltér – FX nélkül nem összeadható.`,
      );
    }
    // Split-korrigált sorhoz split-korrigált összeg; nyers sorhoz a ténylegesen fizetett összeg.
    const raw =
      series.adjustment === 'SPLIT'
        ? (event.splitAdjustedAmount ?? event.amount.amount)
        : event.amount.amount;
    total += divisor === null ? raw : raw / divisor;
  }
  return { status: 'OK', value: total, notes: [] };
}

function majorPrice(close: number, series: PriceSeries): number {
  const { divisor } = toMajor(series.currency);
  return divisor === null ? close : close / divisor;
}

export function analyzeReturns(inputs: ReturnInputs): EtfReturnAnalysis {
  const { totalSeries, priceSeries, dividends, distribution, fetchedAt } = inputs;
  const notes: string[] = [];

  // 1. Árfolyamhozam.
  let priceReturn: EtfMetric =
    failedSeries(RETURN_SPECS.priceReturn, priceSeries, 'Ártörténet (árhozam)') ??
    etfMetric(RETURN_SPECS.priceReturn, { status: 'MISSING', reason: 'Nincs ártörténet.' });
  if (priceSeries.ok) {
    const calc = seriesReturn(priceSeries.value);
    priceReturn = fromCalc(
      RETURN_SPECS.priceReturn,
      calc.status === 'OK' ? { ...calc, value: calc.value.value } : calc,
      { fetchedAt, inputs: [seriesInput('priceSeries', priceSeries.value)] },
      seriesWindow(priceSeries.value),
    );
  }

  // 2. Total return.
  let method: TotalReturnMethod | null = null;
  let totalReturn: EtfMetric;
  let totalWindow: AnalysisWindow | null = null;
  const totalCalc = totalSeries.ok ? seriesReturn(totalSeries.value) : null;
  if (totalSeries.ok && totalCalc?.status === 'OK') {
    method = 'adjusted_series';
    totalWindow = seriesWindow(totalSeries.value);
    totalReturn = fromCalc(
      RETURN_SPECS.totalReturn,
      { ...totalCalc, value: totalCalc.value.value },
      { fetchedAt, inputs: [seriesInput('totalReturnSeries', totalSeries.value)] },
      totalWindow,
    );
  } else if (
    distribution.status === 'OK' &&
    distribution.value === 'accumulating' &&
    priceReturn.value.status === 'OK' &&
    priceSeries.ok
  ) {
    method = 'accumulating_price';
    totalWindow = priceReturn.window;
    totalReturn = etfMetric(RETURN_SPECS.totalReturn, priceReturn.value, totalWindow, [
      'Akkumuláló ETF: a hozamot az alap újrabefekteti, így az árhozam ≈ total return.',
    ]);
  } else if (
    distribution.status === 'OK' &&
    distribution.value === 'distributing' &&
    priceSeries.ok &&
    dividends.ok
  ) {
    method = 'price_plus_distributions';
    const series = priceSeries.value;
    totalWindow = seriesWindow(series);
    const paid = distributionsInWindow(dividends.value, series);
    const first = series.points[0];
    const last = series.points[series.points.length - 1];
    const calc: CalcResult<number> =
      paid.status !== 'OK'
        ? paid
        : first === undefined || last === undefined
          ? calcMissing('Nincs ártörténet.')
          : totalReturnFromPrices({
              startPrice: majorPrice(first.close, series),
              endPrice: majorPrice(last.close, series),
              dividendsPerShare: paid.value,
            });
    totalReturn = fromCalc(
      RETURN_SPECS.totalReturn,
      calc,
      {
        fetchedAt,
        inputs: [seriesInput('priceSeries', series), ['dividends', dividends.value.provenance]],
      },
      totalWindow,
    );
  } else {
    const reason = totalSeries.ok
      ? `A korrigált ártörténetből nem számolható (${totalCalc?.status ?? 'MISSING'}).`
      : `Korrigált ártörténet nincs (${totalSeries.error.message})`;
    const distributionNote =
      distribution.status === 'OK'
        ? distribution.value === 'distributing'
          ? ' Disztribúciós ETF-nél a kifizetések nélkül csak árhozam van.'
          : ''
        : ' Az osztalékkezelés (acc/dist) ismeretlen, így az árhozam nem tekinthető total returnnek.';
    const status = totalCalc !== null && totalCalc.status !== 'OK' ? totalCalc.status : 'MISSING';
    totalReturn = etfMetric(RETURN_SPECS.totalReturn, {
      status,
      reason: `${reason}${distributionNote}`,
    });
  }

  const comparisonBasis: ReturnComparisonBasis =
    totalReturn.value.status === 'OK'
      ? 'total_return'
      : priceReturn.value.status === 'OK'
        ? 'price_return_only'
        : 'none';
  if (comparisonBasis === 'price_return_only') {
    notes.push(
      'Csak árfolyamhozam áll rendelkezésre: disztribúciós és akkumuláló ETF így NEM hasonlítható össze (a kifizetések hiányoznak).',
    );
  }

  // 3. Évesítés – csak ≥ 1 éves ablakra.
  let annualized: EtfMetric;
  if (totalReturn.value.status !== 'OK' || totalWindow === null) {
    annualized = etfMetric(
      RETURN_SPECS.annualizedTotalReturn,
      totalReturn.value.status === 'OK'
        ? { status: 'MISSING', reason: 'Nincs időablak.' }
        : propagateFailure('total return', totalReturn.value),
    );
  } else {
    const years = yearsBetween(totalWindow.start, totalWindow.end);
    const calc: CalcResult<number> =
      years.status !== 'OK'
        ? years
        : years.value < MIN_ANNUALIZATION_YEARS - ANNUALIZATION_TOLERANCE_YEARS
          ? {
              status: 'INSUFFICIENT_DATA',
              reason: `Az ablak ${years.value.toFixed(2)} év; 1 évnél rövidebb időszakot nem évesítünk (félrevezető).`,
            }
          : annualizeReturn({ periodReturn: totalReturn.value.value, years: years.value });
    annualized = fromCalc(
      RETURN_SPECS.annualizedTotalReturn,
      calc,
      { fetchedAt, inputs: [['totalReturn', totalReturn.value.provenance]] },
      totalWindow,
    );
  }

  // 4. Osztalékhozam (TTM).
  const distributionYieldTtm = analyzeDistributionYield(inputs, notes);

  if (priceSeries.ok && totalSeries.ok) {
    const a = seriesWindow(priceSeries.value);
    const b = seriesWindow(totalSeries.value);
    if (a !== null && b !== null && (a.start !== b.start || a.end !== b.end)) {
      notes.push(
        `Az árhozam (${a.start}–${a.end}) és a total return (${b.start}–${b.end}) ablaka eltér; a kettő közvetlenül nem vonható ki egymásból.`,
      );
    }
  }
  [totalSeries, priceSeries].forEach((series) => {
    if (series.ok) notes.push(...series.value.notes);
  });

  return {
    priceReturn,
    totalReturn,
    totalReturnMethod: totalReturn.value.status === 'OK' ? method : null,
    annualizedTotalReturn: annualized,
    distributionYieldTtm,
    comparisonBasis,
    notes: [...new Set(notes)],
  };
}

function analyzeDistributionYield(inputs: ReturnInputs, notes: string[]): EtfMetric {
  const { dividends, priceSeries, totalSeries, distribution, fetchedAt } = inputs;
  const spec = RETURN_SPECS.distributionYieldTtm;
  const hasEvents = dividends.ok && dividends.value.events.length > 0;
  if (distribution.status === 'OK' && distribution.value === 'accumulating') {
    if (hasEvents) {
      notes.push(
        'Az ETF akkumulálóként van megadva, de a forrás osztalékeseményeket ad – ellenőrizd az osztálykezelést.',
      );
    }
    return fromCalc(
      spec,
      calcNotApplicable('Akkumuláló ETF: nincs kifizetés, a hozam az árban jelenik meg.'),
      { fetchedAt, inputs: [] },
    );
  }
  if (distribution.status !== 'OK' && hasEvents) {
    notes.push(
      'Az osztalékkezelés nincs megadva, de a forrás kifizetéseket ad – valószínűleg disztribúciós.',
    );
  }
  if (!dividends.ok) return etfMetric(spec, appErrorToMetric(dividends.error, 'Osztaléktörténet'));
  const series = priceSeries.ok ? priceSeries.value : totalSeries.ok ? totalSeries.value : null;
  const last = series?.points[series.points.length - 1];
  if (series === null || last === undefined) {
    return etfMetric(spec, { status: 'MISSING', reason: 'Nincs záróár az osztalékhozamhoz.' });
  }
  const ttm = trailingDividendPerShare({
    events: dividends.value.events,
    asOf: last.date,
    // A free források lefedettségét nem ismerjük biztosan → esemény nélkül MISSING (nem 0).
    coverageStart: null,
    listingCurrency: series.currency,
  });
  const calc =
    ttm.status !== 'OK'
      ? ttm
      : dividendYieldFromMoney({
          annualDividendPerShare: ttm.value,
          price: { amount: last.close, currency: series.currency },
        });
  return fromCalc(
    spec,
    ttm.status === 'OK' && calc.status === 'OK'
      ? { ...calc, notes: [...ttm.notes, ...calc.notes] }
      : calc,
    {
      fetchedAt,
      inputs: [seriesInput('price', series), ['dividends', dividends.value.provenance]],
    },
  );
}
