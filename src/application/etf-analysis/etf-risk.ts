/**
 * ETF kockázati és követési mutatók (PHASE 08 feladat 6. és 8., D-066).
 *
 * - A kockázati mutatók a total return (split- és osztalék-korrigált) sorból készülnek, ha van;
 *   különben az árfolyamsorból (megjegyzéssel). Minimum: `minRiskObservations` napi hozam.
 * - A tracking difference / tracking error CSAK total return indexszel készül, azonos
 *   (közös dátumú) ablakon és azonos (fő) pénznemben. Árindexszel `NOT_MEANINGFUL`.
 */
import {
  RISK_MIN_OBSERVATIONS,
  TRADING_DAYS_PER_YEAR,
  alignByDate,
  annualizeReturn,
  annualizedVolatility,
  beta,
  calcInsufficientData,
  calcInvalidInput,
  calcMissing,
  calcNotMeaningful,
  chainCalc,
  downsideDeviation,
  maxDrawdown,
  periodicReturns,
  riskReliability,
  seriesReturn,
  sharpeRatio,
  simpleReturn,
  sortinoRatio,
  trackingDifference,
  trackingError,
  yearsBetween,
  type CalcResult,
} from '@/calculations';
import {
  toMajor,
  type AppError,
  type DataProvenance,
  type EtfDistribution,
  type IsoTimestamp,
  type Metric,
  type PriceSeries,
  type Result,
} from '@/domain';

import { etfMetric, fromCalc, type MetricSpec } from './etf-metric';
import {
  ANNUALIZATION_TOLERANCE_YEARS,
  MIN_ANNUALIZATION_YEARS,
  seriesWindow,
} from './etf-returns';
import type {
  AnalysisWindow,
  EtfBenchmarkInput,
  EtfMetric,
  EtfRiskAnalysis,
  EtfTrackingAnalysis,
} from './types';
import { appErrorToMetric } from '../shared/app-error-metric';

/** A kockázati mutatók alapértelmezett minimális napi hozamszáma (≈ fél év, D-066/6). */
export const DEFAULT_MIN_RISK_OBSERVATIONS = RISK_MIN_OBSERVATIONS;

/**
 * Megbízhatósági címke egy kiszámolt mutatóra a periódushozamok száma alapján (D-070).
 * Nem-OK mutatónál (pl. `INSUFFICIENT_DATA`) vagy ablak nélkül `null` marad.
 */
function withReliability(metric: EtfMetric): EtfMetric {
  return metric.value.status === 'OK' && metric.window !== null
    ? { ...metric, reliability: riskReliability(metric.window.observations) }
    : metric;
}

const TRADING_DAYS = TRADING_DAYS_PER_YEAR;

export const RISK_SPECS = {
  volatility: {
    id: 'volatility',
    label: 'Évesített volatilitás',
    unit: 'ratio',
    formula: 'minta szórás(napi egyszerű hozam) × √252',
  },
  maxDrawdown: {
    id: 'maxDrawdown',
    label: 'Maximális visszaesés',
    unit: 'ratio',
    formula: 'min_t(P_t / max(P_0..P_t) − 1) a vizsgált ablakon',
  },
  downsideDeviation: {
    id: 'downsideDeviation',
    label: 'Downside deviation (évesített)',
    unit: 'ratio',
    formula: '√(Σ min(0, r_t − MAR_napi)² / N) × √252; MAR = kockázatmentes hozam (ha nincs: 0)',
  },
  sharpe: {
    id: 'sharpe',
    label: 'Sharpe-mutató',
    unit: 'multiple',
    formula: '(évesített hozam − rf) / évesített volatilitás',
  },
  sortino: {
    id: 'sortino',
    label: 'Sortino-mutató',
    unit: 'multiple',
    formula: '(évesített hozam − rf) / downside deviation (MAR = rf)',
  },
  beta: {
    id: 'beta',
    label: 'Béta (a megadott indexhez)',
    unit: 'multiple',
    formula: 'cov(r_ETF, r_index) / var(r_index), közös dátumokra igazított napi hozamokból',
  },
} as const satisfies Record<string, MetricSpec>;

export const TRACKING_SPECS = {
  trackingDifference: {
    id: 'trackingDifference',
    label: 'Tracking difference (időszaki)',
    unit: 'ratio',
    formula: 'ETF total return − index total return, ugyanarra a közös ablakra',
  },
  annualizedTrackingDifference: {
    id: 'annualizedTrackingDifference',
    label: 'Tracking difference (évesített)',
    unit: 'ratio',
    formula: 'évesített ETF total return − évesített index total return (csak ≥ 1 éves ablakra)',
  },
  trackingError: {
    id: 'trackingError',
    label: 'Tracking error (évesített)',
    unit: 'ratio',
    formula: 'minta szórás(r_ETF,t − r_index,t) × √252, közös dátumokra igazított napi hozamokból',
  },
} as const satisfies Record<string, MetricSpec>;

export const RISK_CONVENTIONS = [
  'Napi egyszerű hozamok a kereskedési napok záróárából; évesítés √252-vel (D-066).',
  'Minta szórás (n − 1). Downside deviation: az N nevező az összes megfigyelés.',
  'A Sharpe és a Sortino kockázatmentes hozama (rf) felhasználói beállítás; nélküle nem számolunk.',
  'A béta és a tracking a két sor KÖZÖS dátumain számol (eltérő tőzsdei ünnepnapok kimaradnak).',
  'Megbízhatóság (D-070): legalább 240 napi hozamtól „standard”, 126–239 között „rövid ablak” (a mutató elkészül, de zajosabb); 126 alatt nem számolunk.',
  'Múltbeli kockázati mutató, nem előrejelzés.',
];

export const TRACKING_DEFINITIONS = [
  'Tracking difference (TD) = ETF total return − index total return, azonos időszakra; tipikusan negatív, nagyságrendje ≈ −TER (+/− kölcsönzési bevétel, adóhatás).',
  'UCITS ETF-eknél a szokásos viszonyítás a NETTÓ total return index (forrásadó levonva).',
  'Tracking error (TE) = a napi hozamkülönbségek minta szórása × √252 – a követés egyenletessége, nem a költsége.',
  'Árindexszel (osztalék nélkül) a TD az osztalékhozammal torzul, ezért nem számoljuk.',
  'Eltérő pénznemű ETF és index között a TD az FX-mozgást is tartalmazná, ezért nem számoljuk.',
];

export interface RiskInputs {
  readonly totalSeries: Result<PriceSeries, AppError>;
  readonly priceSeries: Result<PriceSeries, AppError>;
  readonly distribution: Metric<EtfDistribution>;
  readonly benchmark: EtfBenchmarkInput | undefined;
  readonly riskFreeRate: number | undefined;
  readonly minObservations: number;
  readonly fetchedAt: IsoTimestamp;
}

interface RiskSeries {
  readonly series: PriceSeries;
  readonly label: 'total_return' | 'price';
  readonly notes: readonly string[];
}

/** A kockázathoz használt sor: total return, különben árfolyamsor (megjegyzéssel). */
function pickRiskSeries(inputs: RiskInputs): RiskSeries | AppError {
  if (inputs.totalSeries.ok && inputs.totalSeries.value.points.length >= 2) {
    return { series: inputs.totalSeries.value, label: 'total_return', notes: [] };
  }
  if (inputs.priceSeries.ok && inputs.priceSeries.value.points.length >= 2) {
    return {
      series: inputs.priceSeries.value,
      label: 'price',
      notes: [
        'A kockázati mutatók árfolyamsorból készültek (total return sor nincs): az osztalék-napok kis torzítást okozhatnak.',
        ...(inputs.priceSeries.value.adjustment === 'NONE'
          ? ['Nyers (nem split-korrigált) ár: egy közbenső split hamis visszaesést okozhat.']
          : []),
      ],
    };
  }
  return inputs.totalSeries.ok
    ? { kind: 'MISSING_DATA', message: 'Az ártörténet túl rövid (< 2 pont).', missing: ['prices'] }
    : inputs.totalSeries.error;
}

function provenanceOf(name: string, series: PriceSeries): readonly [string, DataProvenance] {
  return [name, { ...series.provenance, currency: series.currency }];
}

/** Egy származtatott bemenet `Metric`-je képlet-bemenetként (forrásoldali hiba → `MISSING`). */
function metricToCalc(metric: Metric<number>): CalcResult<number> {
  if (metric.status === 'OK') return { status: 'OK', value: metric.value, notes: [] };
  if (metric.status === 'UNAVAILABLE' || metric.status === 'ERROR')
    return calcMissing(metric.reason);
  return { status: metric.status, reason: metric.reason };
}

function annualReturnOf(series: PriceSeries): CalcResult<number> {
  return chainCalc(seriesReturn(series), (ret) =>
    chainCalc(yearsBetween(ret.startDate, ret.endDate), (years) =>
      annualizeReturn({ periodReturn: ret.value, years }),
    ),
  );
}

export function analyzeRisk(inputs: RiskInputs): EtfRiskAnalysis {
  const { fetchedAt, riskFreeRate, minObservations } = inputs;
  const picked = pickRiskSeries(inputs);
  if ('kind' in picked) {
    const failed = (spec: MetricSpec) =>
      etfMetric(spec, appErrorToMetric<number>(picked, 'Ártörténet'));
    return {
      volatility: failed(RISK_SPECS.volatility),
      maxDrawdown: failed(RISK_SPECS.maxDrawdown),
      downsideDeviation: failed(RISK_SPECS.downsideDeviation),
      sharpe: failed(RISK_SPECS.sharpe),
      sortino: failed(RISK_SPECS.sortino),
      beta: failed(RISK_SPECS.beta),
      conventions: RISK_CONVENTIONS,
    };
  }
  const { series } = picked;
  const window = seriesWindow(series);
  const returnsCalc = periodicReturns(series.points.map((point) => point.close));
  const returns = returnsCalc.status === 'OK' ? returnsCalc.value : [];
  const context = { fetchedAt, inputs: [provenanceOf('prices', series)] };
  const shortWindow =
    returns.length >= minObservations && riskReliability(returns.length) === 'short_window'
      ? [
          `1 évnél rövidebb ablak (${returns.length} napi hozam): a mutató bizonytalanabb, megbízhatóság: „rövid ablak” (a szokásos összevetés 3 év).`,
        ]
      : [];
  const notes = [...picked.notes, ...shortWindow];
  const enough = returns.length >= minObservations;
  const insufficient = calcInsufficientData(
    `Legalább ${minObservations} napi hozam kell; csak ${returns.length} van (pl. a free csomag 1 éves korlátja vagy fiatal ETF).`,
  );

  const volatilityCalc =
    returnsCalc.status !== 'OK'
      ? returnsCalc
      : annualizedVolatility({ returns, periodsPerYear: TRADING_DAYS, minObservations });
  const volatility = fromCalc(RISK_SPECS.volatility, volatilityCalc, context, window, notes);

  const drawdown = enough ? maxDrawdown(series.points) : insufficient;
  const maxDd = fromCalc(
    RISK_SPECS.maxDrawdown,
    drawdown.status === 'OK' ? { ...drawdown, value: drawdown.value.maxDrawdown } : drawdown,
    context,
    window,
    drawdown.status === 'OK'
      ? [
          ...notes,
          ...(shortWindow.length > 0
            ? ['Rövid ablak: a max drawdown nem tartalmaz korábbi válságidőszakot.']
            : []),
          `Csúcs: ${drawdown.value.peakDate}, mélypont: ${drawdown.value.troughDate}, helyreállás: ${drawdown.value.recoveryDate ?? 'még nem'}.`,
        ]
      : notes,
  );

  const mar = riskFreeRate ?? 0;
  const ddCalc =
    returnsCalc.status !== 'OK'
      ? returnsCalc
      : downsideDeviation({
          returns,
          periodsPerYear: TRADING_DAYS,
          minimumAcceptableReturn: mar,
          minObservations,
        });
  const downside = fromCalc(
    RISK_SPECS.downsideDeviation,
    ddCalc,
    context,
    window,
    riskFreeRate === undefined
      ? [...notes, 'MAR = 0 (nincs megadott kockázatmentes hozam).']
      : notes,
  );

  const rfMissing = calcMissing(
    'A kockázatmentes hozam (rf) nincs megadva – felhasználói beállítás, alapértéket nem feltételezünk.',
  );
  const annualReturn = enough ? annualReturnOf(series) : insufficient;
  const sharpeCalc =
    riskFreeRate === undefined
      ? rfMissing
      : chainCalc(annualReturn, (r) =>
          chainCalc(metricToCalc(volatility.value), (annualVolatility) =>
            sharpeRatio({ annualReturn: r, riskFreeRate, annualVolatility }),
          ),
        );
  const sortinoCalc =
    riskFreeRate === undefined
      ? rfMissing
      : chainCalc(annualReturn, (r) =>
          chainCalc(metricToCalc(downside.value), (dd) =>
            sortinoRatio({ annualReturn: r, riskFreeRate, downsideDeviation: dd }),
          ),
        );

  return {
    volatility: withReliability(volatility),
    maxDrawdown: withReliability(maxDd),
    downsideDeviation: withReliability(downside),
    sharpe: withReliability(fromCalc(RISK_SPECS.sharpe, sharpeCalc, context, window, notes)),
    sortino: withReliability(fromCalc(RISK_SPECS.sortino, sortinoCalc, context, window, notes)),
    beta: withReliability(analyzeBeta(series, inputs)),
    conventions: RISK_CONVENTIONS,
  };
}

interface AlignedPair {
  readonly window: AnalysisWindow;
  readonly fund: readonly number[];
  readonly index: readonly number[];
}

function alignWithBenchmark(
  fund: PriceSeries,
  benchmark: EtfBenchmarkInput,
): CalcResult<AlignedPair> {
  const fundMajor = toMajor(fund.currency).major;
  const indexMajor = toMajor(benchmark.series.currency).major;
  if (fundMajor !== indexMajor) {
    return calcInvalidInput(
      `Az ETF (${fund.currency}) és az index (${benchmark.series.currency}) pénzneme eltér – a mutató az FX-hatást is tartalmazná.`,
    );
  }
  const aligned = alignByDate(fund.points, benchmark.series.points);
  const start = aligned.dates[0];
  const end = aligned.dates[aligned.dates.length - 1];
  if (start === undefined || end === undefined || aligned.dates.length < 2) {
    return calcInsufficientData('Az ETF és az index sorának nincs legalább 2 közös dátuma.');
  }
  return {
    status: 'OK',
    value: {
      window: { start, end, observations: aligned.dates.length - 1 },
      fund: aligned.first,
      index: aligned.second,
    },
    notes: [],
  };
}

function analyzeBeta(series: PriceSeries, inputs: RiskInputs): EtfMetric {
  const { benchmark, fetchedAt, minObservations } = inputs;
  if (benchmark === undefined) {
    return fromCalc(
      RISK_SPECS.beta,
      calcMissing(
        'Nincs megadott indexsor: a free források nem adnak indexadatot (a hívó adhatja meg).',
      ),
      { fetchedAt, inputs: [] },
    );
  }
  const aligned = alignWithBenchmark(series, benchmark);
  const context = {
    fetchedAt,
    inputs: [provenanceOf('prices', series), provenanceOf('benchmark', benchmark.series)],
  };
  if (aligned.status !== 'OK') return fromCalc(RISK_SPECS.beta, aligned, context);
  const fundReturns = periodicReturns(aligned.value.fund);
  const indexReturns = periodicReturns(aligned.value.index);
  const calc =
    fundReturns.status !== 'OK'
      ? fundReturns
      : indexReturns.status !== 'OK'
        ? indexReturns
        : beta({
            assetReturns: fundReturns.value,
            benchmarkReturns: indexReturns.value,
            minObservations,
          });
  const notes =
    calc.status === 'OK'
      ? [
          `Korreláció: ${calc.value.correlation.toFixed(2)}; ${calc.value.observations} közös napi hozam.`,
          `Index: ${benchmark.name}.`,
        ]
      : [];
  return fromCalc(
    RISK_SPECS.beta,
    calc.status === 'OK' ? { ...calc, value: calc.value.beta } : calc,
    context,
    aligned.value.window,
    notes,
  );
}

// --- Tracking ----------------------------------------------------------------------------------

/** A követéshez használható ETF-sor: total return; akkumulálónál az árfolyamsor is az. */
function trackingFundSeries(inputs: RiskInputs): CalcResult<PriceSeries> {
  if (inputs.totalSeries.ok && inputs.totalSeries.value.points.length >= 2) {
    return { status: 'OK', value: inputs.totalSeries.value, notes: [] };
  }
  if (
    inputs.distribution.status === 'OK' &&
    inputs.distribution.value === 'accumulating' &&
    inputs.priceSeries.ok &&
    inputs.priceSeries.value.points.length >= 2
  ) {
    return {
      status: 'OK',
      value: inputs.priceSeries.value,
      notes: ['Akkumuláló ETF: az árfolyamsor total returnként kezelve.'],
    };
  }
  return calcMissing(
    'Nincs az ETF-hez total return ártörténet (korrigált sor, vagy akkumuláló árfolyam).',
  );
}

export function analyzeTracking(inputs: RiskInputs): EtfTrackingAnalysis {
  const { benchmark, fetchedAt, minObservations } = inputs;
  const base = {
    benchmarkName: benchmark?.name ?? null,
    benchmarkBasis: benchmark?.returnBasis ?? null,
    definitions: TRACKING_DEFINITIONS,
  };
  const fail = (calc: CalcResult<number>) => ({
    ...base,
    trackingDifference: fromCalc(TRACKING_SPECS.trackingDifference, calc, {
      fetchedAt,
      inputs: [],
    }),
    annualizedTrackingDifference: fromCalc(TRACKING_SPECS.annualizedTrackingDifference, calc, {
      fetchedAt,
      inputs: [],
    }),
    trackingError: fromCalc(TRACKING_SPECS.trackingError, calc, { fetchedAt, inputs: [] }),
  });
  if (benchmark === undefined) {
    return fail(
      calcMissing(
        'Nincs indexadat: a free források nem adnak total return indexet. A tracking csak indexsorral számolható.',
      ),
    );
  }
  if (benchmark.returnBasis === 'price') {
    return fail(
      calcNotMeaningful(
        'Árindex (osztalék nélkül): a TD az osztalékhozammal torzulna. Total return index kell.',
      ),
    );
  }
  const fund = trackingFundSeries(inputs);
  if (fund.status !== 'OK') return fail(fund);
  const aligned = alignWithBenchmark(fund.value, benchmark);
  if (aligned.status !== 'OK') return fail(aligned);

  const { window } = aligned.value;
  const fundWindow = seriesWindow(fund.value);
  const notes = [...fund.notes];
  if (fundWindow !== null && (fundWindow.start !== window.start || fundWindow.end !== window.end)) {
    notes.push(
      `Eltérő időszakok: az ETF-sor ${fundWindow.start}–${fundWindow.end}, a közös ablak ${window.start}–${window.end}; a mutató a közös ablakra készült.`,
    );
  }
  const context = {
    fetchedAt,
    inputs: [provenanceOf('fund', fund.value), provenanceOf('benchmark', benchmark.series)],
  };
  const first = (values: readonly number[]) => values[0] as number;
  const last = (values: readonly number[]) => values[values.length - 1] as number;
  const fundReturn = simpleReturn({
    startValue: first(aligned.value.fund),
    endValue: last(aligned.value.fund),
  });
  const indexReturn = simpleReturn({
    startValue: first(aligned.value.index),
    endValue: last(aligned.value.index),
  });
  const td = chainCalc(fundReturn, (f) =>
    chainCalc(indexReturn, (i) => trackingDifference({ fundReturn: f, indexReturn: i })),
  );

  const years = yearsBetween(window.start, window.end);
  const annualizedTd: CalcResult<number> = chainCalc(years, (y) =>
    y < MIN_ANNUALIZATION_YEARS - ANNUALIZATION_TOLERANCE_YEARS
      ? calcInsufficientData(
          `A közös ablak ${y.toFixed(2)} év; az évesített TD-hez legalább 1 év kell.`,
        )
      : chainCalc(fundReturn, (f) =>
          chainCalc(indexReturn, (i) =>
            chainCalc(annualizeReturn({ periodReturn: f, years: y }), (fa) =>
              chainCalc(annualizeReturn({ periodReturn: i, years: y }), (ia) =>
                trackingDifference({ fundReturn: fa, indexReturn: ia }),
              ),
            ),
          ),
        ),
  );

  const fundReturns = periodicReturns(aligned.value.fund);
  const indexReturns = periodicReturns(aligned.value.index);
  const te: CalcResult<number> =
    window.observations < minObservations
      ? calcInsufficientData(
          `A tracking errorhoz legalább ${minObservations} közös napi hozam kell; csak ${window.observations} van.`,
        )
      : chainCalc(fundReturns, (f) =>
          chainCalc(indexReturns, (i) =>
            trackingError({ fundReturns: f, indexReturns: i, periodsPerYear: TRADING_DAYS }),
          ),
        );

  return {
    ...base,
    trackingDifference: withReliability(
      fromCalc(TRACKING_SPECS.trackingDifference, td, context, window, notes),
    ),
    annualizedTrackingDifference: withReliability(
      fromCalc(TRACKING_SPECS.annualizedTrackingDifference, annualizedTd, context, window, notes),
    ),
    trackingError: withReliability(
      fromCalc(TRACKING_SPECS.trackingError, te, context, window, notes),
    ),
  };
}
