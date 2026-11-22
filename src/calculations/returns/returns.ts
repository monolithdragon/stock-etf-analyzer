/**
 * Hozamok: egyszerű és total return, évesítés, reálhozam, az árfolyam felbontása EPS- és
 * P/E-változásra, valamint az elvárt hozam egyszerűsített mentális modellje.
 * DATA_DICTIONARY 5.3, 5.5, D-058.
 *
 * Minden hozam tizedes tört és időszaki (NEM évesített), hacsak a név mást nem mond.
 */
import { toEpochMs, type IsoDate, type PriceAdjustment, type PricePoint } from '@/domain';

import {
  calcInsufficientData,
  calcInvalidInput,
  calcOk,
  chainCalc,
  requireInputs,
  type CalcResult,
  type NumericInput,
} from '../core/calc-result';
import {
  firstFailure,
  mustBeAboveMinusOne,
  mustBeNonNegative,
  mustBePositive,
} from '../core/numeric';
import { cagr } from '../fundamentals/growth';

const MS_PER_DAY = 86_400_000;

/** Évesítéshez használt naptári évhossz (D-058): 365,25 nap (szökőévekkel átlagolva). */
export const DAYS_PER_YEAR = 365.25;

/** Egyszerű hozam = záró / nyitó − 1. Nyitó ≤ 0 → `INVALID_INPUT`; záró < 0 → `INVALID_INPUT`. */
export function simpleReturn(input: {
  readonly startValue: NumericInput;
  readonly endValue: NumericInput;
}): CalcResult<number> {
  return chainCalc(requireInputs(input), ({ startValue, endValue }) => {
    const bad = firstFailure(
      mustBePositive('startValue', startValue),
      mustBeNonNegative('endValue', endValue),
    );
    return bad ?? calcOk(endValue / startValue - 1);
  });
}

/**
 * Total return árakból és az időszakban kapott részvényenkénti osztalékból (újrabefektetés
 * NÉLKÜL – egyszerűsítés): (záró ár + osztalék) / nyitó ár − 1.
 * Hiányzó osztalék → `MISSING` (ha csak árhozam kell, a `simpleReturn` a helyes függvény).
 * Az osztalék és az ár azonos pénznemű és split-bázisú kell legyen.
 */
export function totalReturnFromPrices(input: {
  readonly startPrice: NumericInput;
  readonly endPrice: NumericInput;
  readonly dividendsPerShare: NumericInput;
}): CalcResult<number> {
  return chainCalc(requireInputs(input), ({ startPrice, endPrice, dividendsPerShare }) => {
    const bad = firstFailure(
      mustBePositive('startPrice', startPrice),
      mustBeNonNegative('endPrice', endPrice),
      mustBeNonNegative('dividendsPerShare', dividendsPerShare),
    );
    return (
      bad ??
      calcOk((endPrice + dividendsPerShare) / startPrice - 1, [
        'Osztalék-újrabefektetés nélkül számolva.',
      ])
    );
  });
}

export type SeriesReturnBasis = 'total_return' | 'price_return' | 'raw_price_return';

export interface SeriesReturn {
  readonly value: number;
  readonly basis: SeriesReturnBasis;
  readonly startDate: IsoDate;
  readonly endDate: IsoDate;
}

/**
 * Hozam egy ártörténetből (első és utolsó pont), a korrekció fajtája szerint címkézve (D-050):
 * `SPLIT_DIVIDEND` → total return; `SPLIT` → árhozam; `NONE` → nyers árhozam (egy közbenső
 * split torzíthatja – megjegyzéssel). Kevesebb mint 2 pont → `INSUFFICIENT_DATA`.
 */
export function seriesReturn(series: {
  readonly adjustment: PriceAdjustment;
  readonly points: readonly PricePoint[];
}): CalcResult<SeriesReturn> {
  const first = series.points[0];
  const last = series.points[series.points.length - 1];
  if (first === undefined || last === undefined || series.points.length < 2) {
    return calcInsufficientData('A hozamhoz legalább 2 árpont kell.');
  }
  const basis: SeriesReturnBasis =
    series.adjustment === 'SPLIT_DIVIDEND'
      ? 'total_return'
      : series.adjustment === 'SPLIT'
        ? 'price_return'
        : 'raw_price_return';
  const notes =
    basis === 'raw_price_return'
      ? ['Nyers (nem korrigált) ár: egy közbenső részvényfelosztás torzíthatja a hozamot.']
      : basis === 'price_return'
        ? ['Csak árfolyamhozam (osztalék nélkül).']
        : [];
  return chainCalc(simpleReturn({ startValue: first.close, endValue: last.close }), (value) =>
    calcOk({ value, basis, startDate: first.date, endDate: last.date }, notes),
  );
}

/** Évek száma két dátum között: napok / 365,25. A záró dátum a nyitó után kell legyen. */
export function yearsBetween(start: IsoDate, end: IsoDate): CalcResult<number> {
  const days = (toEpochMs(end) - toEpochMs(start)) / MS_PER_DAY;
  return days > 0
    ? calcOk(days / DAYS_PER_YEAR)
    : calcInvalidInput(`A záró dátum (${end}) nem későbbi a nyitónál (${start}).`);
}

/**
 * Évesített hozam = (1 + időszaki hozam)^(1/évek) − 1.
 * Hozam < −1 → `INVALID_INPUT`; évek ≤ 0 → `INVALID_INPUT`. 1 évnél rövidebb időszakra `OK`,
 * de megjegyzés figyelmeztet: a rövid időszak évesítése felnagyítja a véletlent.
 */
export function annualizeReturn(input: {
  readonly periodReturn: NumericInput;
  readonly years: NumericInput;
}): CalcResult<number> {
  return chainCalc(requireInputs(input), ({ periodReturn, years }) => {
    const bad = firstFailure(
      periodReturn < -1 ? calcInvalidInput(`A hozam −100% alatti (${periodReturn}).`) : null,
      mustBePositive('years', years),
    );
    if (bad) return bad;
    const notes = years < 1 ? ['1 évnél rövidebb időszak évesítése félrevezető lehet.'] : [];
    return calcOk((1 + periodReturn) ** (1 / years) - 1, notes);
  });
}

/**
 * Reálhozam = (1 + nominális hozam) / (1 + infláció) − 1 (Fisher-egyenlet, pontos alak).
 * Infláció ≤ −1 → `INVALID_INPUT`; nominális hozam < −1 → `INVALID_INPUT`.
 * A két ráta ugyanarra az időszakra vonatkozzon (pl. mindkettő éves).
 */
export function realReturn(input: {
  readonly nominalReturn: NumericInput;
  readonly inflation: NumericInput;
}): CalcResult<number> {
  return chainCalc(requireInputs(input), ({ nominalReturn, inflation }) => {
    const bad = firstFailure(
      nominalReturn < -1
        ? calcInvalidInput(`A nominális hozam −100% alatti (${nominalReturn}).`)
        : null,
      mustBeAboveMinusOne('inflation', inflation),
    );
    return bad ?? calcOk((1 + nominalReturn) / (1 + inflation) - 1);
  });
}

// --- Az árfolyam-változás felbontása ---------------------------------------------------------

/**
 * Árváltozás az EPS- és a P/E-változás együttes hatásaként: (1 + g_EPS)(1 + Δ_P/E) − 1.
 * Pl. +10% EPS és −10% P/E → −1% ár (nem 0%!). Mindkét bemenet > −1 kell legyen.
 */
export function priceChangeFromEpsAndMultiple(input: {
  readonly epsGrowth: NumericInput;
  readonly multipleChange: NumericInput;
}): CalcResult<number> {
  return chainCalc(requireInputs(input), ({ epsGrowth, multipleChange }) => {
    const bad = firstFailure(
      mustBeAboveMinusOne('epsGrowth', epsGrowth),
      mustBeAboveMinusOne('multipleChange', multipleChange),
    );
    return bad ?? calcOk((1 + epsGrowth) * (1 + multipleChange) - 1);
  });
}

export interface PriceReturnDecomposition {
  /** Teljes árváltozás: P_end / P_start − 1. */
  readonly priceReturn: number;
  /** EPS-növekedés: EPS_end / EPS_start − 1. */
  readonly epsGrowth: number;
  /** P/E-változás: PE_end / PE_start − 1. */
  readonly multipleChange: number;
  /** Kereszthatás: g_EPS × Δ_P/E (a két hatás szorzata; a háromból adódik az összes). */
  readonly interaction: number;
}

/**
 * Múltbeli árváltozás felbontása: priceReturn = epsGrowth + multipleChange + interaction.
 * Csak pozitív EPS mellett értelmezett (különben a P/E is N/M) → egyébként `NOT_MEANINGFUL`.
 */
export function decomposePriceReturn(input: {
  readonly priceStart: NumericInput;
  readonly priceEnd: NumericInput;
  readonly epsStart: NumericInput;
  readonly epsEnd: NumericInput;
}): CalcResult<PriceReturnDecomposition> {
  return chainCalc(requireInputs(input), ({ priceStart, priceEnd, epsStart, epsEnd }) => {
    const bad = firstFailure(
      mustBePositive('priceStart', priceStart),
      mustBePositive('priceEnd', priceEnd),
      mustBePositive(
        'epsStart',
        epsStart,
        'NOT_MEANINGFUL',
        'Negatív/nulla EPS mellett a P/E N/M.',
      ),
      mustBePositive('epsEnd', epsEnd, 'NOT_MEANINGFUL', 'Negatív/nulla EPS mellett a P/E N/M.'),
    );
    if (bad) return bad;
    const epsGrowth = epsEnd / epsStart - 1;
    const multipleChange = priceEnd / epsEnd / (priceStart / epsStart) - 1;
    return calcOk({
      priceReturn: priceEnd / priceStart - 1,
      epsGrowth,
      multipleChange,
      interaction: epsGrowth * multipleChange,
    });
  });
}

/**
 * Évesített P/E-változás = (PE_end / PE_start)^(1/évek) − 1. P/E ≤ 0 → `NOT_MEANINGFUL`.
 */
export function annualizedMultipleChange(input: {
  readonly peStart: NumericInput;
  readonly peEnd: NumericInput;
  readonly years: NumericInput;
}): CalcResult<number> {
  return cagr({ startValue: input.peStart, endValue: input.peEnd, years: input.years });
}

export interface ExpectedReturnBreakdown {
  readonly dividendYield: number;
  readonly earningsGrowth: number;
  readonly annualMultipleChange: number;
  /** (1 + növekedés)(1 + P/E-változás) − 1 + osztalékhozam. */
  readonly total: number;
}

/**
 * Elvárt éves hozam EGYSZERŰSÍTETT mentális modellje (D-058) – NEM előrejelzés, NEM garancia:
 *
 *   elvárt hozam ≈ osztalékhozam + (1 + EPS-növekedés)(1 + évesített P/E-változás) − 1
 *
 * Feltevések: az osztalékot az év végén kapjuk, a kifizetési arány és a részvényszám állandó
 * (nincs visszavásárlás/hígulás), a ráták a teljes időszakra átlagosak. Az eredmény mindig
 * becslés (`estimated`), és a megjegyzés ezt kimondja.
 */
export function expectedReturnBreakdown(input: {
  readonly dividendYield: NumericInput;
  readonly earningsGrowth: NumericInput;
  readonly annualMultipleChange: NumericInput;
}): CalcResult<ExpectedReturnBreakdown> {
  return chainCalc(requireInputs(input), (v) => {
    const bad = firstFailure(
      mustBeNonNegative('dividendYield', v.dividendYield),
      mustBeAboveMinusOne('earningsGrowth', v.earningsGrowth),
      mustBeAboveMinusOne('annualMultipleChange', v.annualMultipleChange),
    );
    if (bad) return bad;
    const total = v.dividendYield + (1 + v.earningsGrowth) * (1 + v.annualMultipleChange) - 1;
    return calcOk({ ...v, total }, [
      'Egyszerűsített mentális modell feltevésekből – nem előrejelzés és nem garantált hozam.',
    ]);
  });
}
