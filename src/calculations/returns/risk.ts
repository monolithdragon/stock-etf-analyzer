/**
 * Kockázati mutatók idősorból: periódushozamok, dátum-igazítás, évesített volatilitás,
 * downside deviation, Sharpe, Sortino, béta. DATA_DICTIONARY 5.5, D-066.
 *
 * Konvenciók (D-066):
 * - Hozam: EGYSZERŰ periódushozam `P_t / P_{t−1} − 1` (nem log-hozam), tizedes tört.
 * - Évesítés: a periódusszámot a hívó adja (`periodsPerYear`); napi EOD-sornál 252
 *   (`TRADING_DAYS_PER_YEAR`), mert a sor csak kereskedési napokat tartalmaz.
 * - Szórás: MINTA szórás (n − 1 nevező).
 * - Downside deviation: `√(Σ min(0, r_t − MAR_p)² / N) × √periodsPerYear`, ahol N az ÖSSZES
 *   megfigyelés száma (Sortino–Price konvenció), `MAR_p = (1 + MAR_éves)^(1/periodsPerYear) − 1`.
 * - Béta: `cov(r_eszköz, r_benchmark) / var(r_benchmark)` (minta-kovariancia és -variancia),
 *   AZONOS dátumokra igazított hozamokból.
 * - A minimális megfigyelésszámot a hívó adja (`minObservations`); az alkalmazási réteg
 *   alapértéke 126 napi hozam (≈ fél év) – ennél rövidebb sorra `INSUFFICIENT_DATA`.
 */
import type { IsoDate, PricePoint } from '@/domain';

import {
  calcInsufficientData,
  calcInvalidInput,
  calcNotMeaningful,
  calcOk,
  chainCalc,
  requireInputs,
  type CalcResult,
  type NumericInput,
} from '../core/calc-result';
import { firstFailure, mean, mustBeAboveMinusOne, sampleStandardDeviation } from '../core/numeric';

/** Napi EOD-hozamsor évesítési periódusszáma (kereskedési napok egy évben, D-066). */
export const TRADING_DAYS_PER_YEAR = 252;

/** A kockázati mutatók alapértelmezett minimális periódushozam-száma (≈ fél év napi adat, D-066/6). */
export const RISK_MIN_OBSERVATIONS = 126;

/**
 * Ettől a periódushozam-számtól „standard” a kockázati mutató megbízhatósága (D-070).
 * Szándékosan 240 és nem 252: egy naptári év az ünnepnapok miatt 250–253 kereskedési nap,
 * így egy teljes évnyi sor ne kapjon „rövid ablak” címkét egy-két hiányzó nap miatt.
 */
export const RISK_STANDARD_OBSERVATIONS = 240;

/**
 * Egy KISZÁMOLT kockázati mutató megbízhatósági címkéje (D-070):
 * - `standard`: ≥ `RISK_STANDARD_OBSERVATIONS` periódushozam (≈ legalább 1 év napi adat);
 * - `short_window`: a minimum felett, de 1 évnél rövidebb ablak – a mutató elkészül, de zajosabb,
 *   és a max drawdown nem tartalmaz korábbi válságidőszakot.
 * A minimum alatti eset nem címke, hanem `INSUFFICIENT_DATA` státusz (a mutató el sem készül).
 */
export type RiskReliability = 'standard' | 'short_window';

export function riskReliability(observations: number): RiskReliability {
  return observations >= RISK_STANDARD_OBSERVATIONS ? 'standard' : 'short_window';
}

function checkPeriodsPerYear(periodsPerYear: number) {
  return Number.isInteger(periodsPerYear) && periodsPerYear >= 1
    ? null
    : calcInvalidInput(`Az évi periódusszám pozitív egész kell (${periodsPerYear}).`);
}

function checkMinObservations(count: number, minObservations: number, what: string) {
  if (!Number.isInteger(minObservations) || minObservations < 2) {
    return calcInvalidInput(`A minimális megfigyelésszám legalább 2 egész (${minObservations}).`);
  }
  return count < minObservations
    ? calcInsufficientData(
        `A(z) ${what} számításához legalább ${minObservations} periódushozam kell; csak ${count} van.`,
      )
    : null;
}

function checkFinite(values: readonly number[], name: string) {
  const bad = values.findIndex((value) => !Number.isFinite(value));
  return bad >= 0 ? calcInvalidInput(`Nem véges érték a(z) ${name} sorban (#${bad}).`) : null;
}

/**
 * Periódushozamok egymást követő árakból: `r_t = P_t / P_{t−1} − 1`.
 * < 2 ár → `INSUFFICIENT_DATA`; ár ≤ 0 vagy nem véges → `INVALID_INPUT`.
 */
export function periodicReturns(prices: readonly number[]): CalcResult<readonly number[]> {
  if (prices.length < 2) return calcInsufficientData('A hozamsorhoz legalább 2 ár kell.');
  const bad = prices.findIndex((price) => !Number.isFinite(price) || price <= 0);
  if (bad >= 0) {
    return calcInvalidInput(`Érvénytelen ár a(z) ${bad}. pozíción (${prices[bad]}); > 0 kell.`);
  }
  return calcOk(prices.slice(1).map((price, index) => price / (prices[index] as number) - 1));
}

export interface AlignedPrices {
  readonly dates: readonly IsoDate[];
  readonly first: readonly number[];
  readonly second: readonly number[];
}

/**
 * Két ártörténet igazítása a KÖZÖS dátumokra (metszet). Eltérő tőzsdei ünnepnapok esetén a
 * csak az egyik sorban szereplő nap kimarad; a hozam így a két közös nap közötti teljes
 * változás (nem torzul egy „hiányzó” nap 0 hozamával). Mindkét sor dátum szerint növekvő.
 */
export function alignByDate(
  first: readonly PricePoint[],
  second: readonly PricePoint[],
): AlignedPrices {
  const secondByDate = new Map(second.map((point) => [point.date, point.close]));
  const dates: IsoDate[] = [];
  const a: number[] = [];
  const b: number[] = [];
  for (const point of first) {
    const other = secondByDate.get(point.date);
    if (other !== undefined) {
      dates.push(point.date);
      a.push(point.close);
      b.push(other);
    }
  }
  return { dates, first: a, second: b };
}

/** Évesített volatilitás = minta szórás(r_t) × √periodsPerYear. */
export function annualizedVolatility(input: {
  readonly returns: readonly number[];
  readonly periodsPerYear: number;
  readonly minObservations: number;
}): CalcResult<number> {
  const bad = firstFailure(
    checkPeriodsPerYear(input.periodsPerYear),
    checkFinite(input.returns, 'hozam'),
    checkMinObservations(input.returns.length, input.minObservations, 'volatilitás'),
  );
  return bad ?? calcOk(sampleStandardDeviation(input.returns) * Math.sqrt(input.periodsPerYear));
}

/**
 * Évesített downside deviation a `minimumAcceptableReturn` (éves, tört) küszöbhöz képest.
 * Az N nevező az összes megfigyelés (nem csak a küszöb alattiak).
 */
export function downsideDeviation(input: {
  readonly returns: readonly number[];
  readonly periodsPerYear: number;
  readonly minimumAcceptableReturn: number;
  readonly minObservations: number;
}): CalcResult<number> {
  const bad = firstFailure(
    checkPeriodsPerYear(input.periodsPerYear),
    checkFinite(input.returns, 'hozam'),
    Number.isFinite(input.minimumAcceptableReturn)
      ? mustBeAboveMinusOne('minimumAcceptableReturn', input.minimumAcceptableReturn)
      : calcInvalidInput('A küszöbhozam nem véges szám.'),
    checkMinObservations(input.returns.length, input.minObservations, 'downside deviation'),
  );
  if (bad) return bad;
  const periodicMar = (1 + input.minimumAcceptableReturn) ** (1 / input.periodsPerYear) - 1;
  const sumSquares = input.returns.reduce(
    (sum, value) => sum + Math.min(0, value - periodicMar) ** 2,
    0,
  );
  return calcOk(Math.sqrt(sumSquares / input.returns.length) * Math.sqrt(input.periodsPerYear));
}

/**
 * Sharpe-mutató = (évesített hozam − kockázatmentes hozam) / évesített volatilitás.
 * Volatilitás ≤ 0 → `NOT_MEANINGFUL` (nulla kockázatra a hányados nem értelmezett).
 */
export function sharpeRatio(input: {
  readonly annualReturn: NumericInput;
  readonly riskFreeRate: NumericInput;
  readonly annualVolatility: NumericInput;
}): CalcResult<number> {
  return chainCalc(requireInputs(input), ({ annualReturn, riskFreeRate, annualVolatility }) => {
    const bad = firstFailure(
      mustBeAboveMinusOne('annualReturn', annualReturn),
      mustBeAboveMinusOne('riskFreeRate', riskFreeRate),
      annualVolatility < 0
        ? calcInvalidInput(`A volatilitás negatív (${annualVolatility}).`)
        : null,
      annualVolatility === 0
        ? calcNotMeaningful('Nulla volatilitás mellett a Sharpe-mutató nem értelmezett.')
        : null,
    );
    return bad ?? calcOk((annualReturn - riskFreeRate) / annualVolatility);
  });
}

/**
 * Sortino-mutató = (évesített hozam − kockázatmentes hozam) / évesített downside deviation.
 * Downside deviation = 0 (soha nem volt a küszöb alatt) → `NOT_MEANINGFUL`.
 */
export function sortinoRatio(input: {
  readonly annualReturn: NumericInput;
  readonly riskFreeRate: NumericInput;
  readonly downsideDeviation: NumericInput;
}): CalcResult<number> {
  return chainCalc(
    requireInputs(input),
    ({ annualReturn, riskFreeRate, downsideDeviation: dd }) => {
      const bad = firstFailure(
        mustBeAboveMinusOne('annualReturn', annualReturn),
        mustBeAboveMinusOne('riskFreeRate', riskFreeRate),
        dd < 0 ? calcInvalidInput(`A downside deviation negatív (${dd}).`) : null,
        dd === 0
          ? calcNotMeaningful('A hozam soha nem volt a küszöb alatt: a Sortino nem értelmezett.')
          : null,
      );
      return bad ?? calcOk((annualReturn - riskFreeRate) / dd);
    },
  );
}

export interface BetaResult {
  readonly beta: number;
  /** Pearson-korreláció (−1 … 1) – a béta értelmezéséhez (alacsony korrelációnál gyenge). */
  readonly correlation: number;
  readonly observations: number;
}

/**
 * Béta = cov(r_a, r_b) / var(r_b), azonos dátumokra igazított hozamokból.
 * Eltérő hossz → `INVALID_INPUT`; kevés megfigyelés → `INSUFFICIENT_DATA`;
 * a benchmark varianciája 0 → `NOT_MEANINGFUL`.
 */
export function beta(input: {
  readonly assetReturns: readonly number[];
  readonly benchmarkReturns: readonly number[];
  readonly minObservations: number;
}): CalcResult<BetaResult> {
  const { assetReturns, benchmarkReturns } = input;
  if (assetReturns.length !== benchmarkReturns.length) {
    return calcInvalidInput(
      `Az eszköz (${assetReturns.length}) és a benchmark (${benchmarkReturns.length}) hozamsora eltérő hosszú – előbb dátum szerint igazítsd.`,
    );
  }
  const bad = firstFailure(
    checkFinite(assetReturns, 'eszköz-hozam'),
    checkFinite(benchmarkReturns, 'benchmark-hozam'),
    checkMinObservations(assetReturns.length, input.minObservations, 'béta'),
  );
  if (bad) return bad;
  const n = assetReturns.length;
  const meanA = mean(assetReturns);
  const meanB = mean(benchmarkReturns);
  let covariance = 0;
  let varianceA = 0;
  let varianceB = 0;
  for (let i = 0; i < n; i += 1) {
    const da = (assetReturns[i] as number) - meanA;
    const db = (benchmarkReturns[i] as number) - meanB;
    covariance += da * db;
    varianceA += da * da;
    varianceB += db * db;
  }
  if (varianceB === 0) {
    return calcNotMeaningful('A benchmark hozama állandó (variancia 0): a béta nem értelmezett.');
  }
  const correlation = varianceA === 0 ? 0 : covariance / Math.sqrt(varianceA * varianceB);
  return calcOk({ beta: covariance / varianceB, correlation, observations: n });
}
