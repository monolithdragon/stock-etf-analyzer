/**
 * Időszaki árfolyam-tartomány (pl. 52 hetes csúcs / mélypont) záróárakból. PHASE 06, D-061.
 *
 * Definíció: a `(asOf − windowDays, asOf]` ablakba eső napi záróárak maximuma és minimuma.
 * - A záróár-alapú érték eltérhet a szolgáltatók INTRADAY 52 hetes csúcsától/aljától
 *   (megjegyzés jelzi). A korrekció fajtáját (`SPLIT_DIVIDEND` / `SPLIT` / `NONE`) a hívó adja
 *   tovább: osztalékkorrigált sorozatban a régebbi árak kissé alacsonyabbak.
 * - Lefedettség: ha az első pont `maxStartGapDays`-nél később van az ablak kezdeténél, vagy
 *   kevesebb mint `minPoints` pont van → `INSUFFICIENT_DATA` (nem adunk részleges csúcsot).
 */
import { toEpochMs, type IsoDate, type PricePoint } from '@/domain';

import {
  calcInsufficientData,
  calcInvalidInput,
  calcOk,
  type CalcResult,
} from '../core/calc-result';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export interface PriceRange {
  readonly high: number;
  readonly highDate: IsoDate;
  readonly low: number;
  readonly lowDate: IsoDate;
  readonly pointCount: number;
}

export interface PriceRangeOptions {
  /** Az ablak hossza napban (52 hét ≈ 365 nap). */
  readonly windowDays: number;
  /** Az ablak kezdete és az első pont közti legnagyobb megengedett rés (hétvége, ünnep). */
  readonly maxStartGapDays: number;
  /** Legalább ennyi árpont kell (kb. 250 kereskedési nap/év → 52 hétre 200 biztonsággal). */
  readonly minPoints: number;
}

export const WEEK52_RANGE_OPTIONS: PriceRangeOptions = {
  windowDays: 365,
  maxStartGapDays: 10,
  minPoints: 200,
};

export function priceRange(
  points: readonly PricePoint[],
  asOf: IsoDate,
  options: PriceRangeOptions = WEEK52_RANGE_OPTIONS,
): CalcResult<PriceRange> {
  const endMs = toEpochMs(asOf);
  const startMs = endMs - options.windowDays * MS_PER_DAY;
  const inWindow = points.filter((p) => {
    const ms = toEpochMs(p.date);
    return ms > startMs && ms <= endMs;
  });
  const bad = inWindow.find((p) => !Number.isFinite(p.close) || p.close <= 0);
  if (bad !== undefined) {
    return calcInvalidInput(`Érvénytelen záróár (${bad.date}: ${bad.close}); > 0 kell.`);
  }
  const first = inWindow[0];
  if (first === undefined) return calcInsufficientData('Nincs árpont az ablakban.');
  const gapDays = (toEpochMs(first.date) - startMs) / MS_PER_DAY;
  if (gapDays > options.maxStartGapDays || inWindow.length < options.minPoints) {
    return calcInsufficientData(
      `Az ártörténet nem fedi le a ${options.windowDays} napos ablakot (első pont: ${first.date}, ${inWindow.length} pont; legalább ${options.minPoints} kell).`,
    );
  }
  let high = first;
  let low = first;
  for (const p of inWindow) {
    if (p.close > high.close) high = p;
    if (p.close < low.close) low = p;
  }
  return calcOk(
    {
      high: high.close,
      highDate: high.date,
      low: low.close,
      lowDate: low.date,
      pointCount: inWindow.length,
    },
    ['Napi záróárakból számolva; eltérhet a szolgáltató intraday csúcsától/aljától.'],
  );
}
