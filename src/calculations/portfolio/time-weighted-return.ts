/**
 * Időarányos (time-weighted) portfóliohozam napi értéksorból, pénzmozgásokkal.
 * DATA_DICTIONARY 7.4, D-072.
 *
 * Napi hozam: `r_t = (V_t − F_t + I_t) / V_{t−1} − 1`, ahol
 * - `V_t`: a portfólió napvégi értéke (a napi mozgások UTÁN),
 * - `F_t`: a napi nettó külső pénzmozgás a napvégi áron értékelve (vétel +, eladás −),
 * - `I_t`: a napon kapott jövedelem (osztalék), amely kikerül a portfólióból (nincs készpénz-
 *   számla, nincs újrabefektetés).
 * Ha `V_{t−1} ≤ 0` (a portfólió aznap előtt üres volt), aznap nincs hozam-megfigyelés: nem volt
 * kockáztatott tőke (az alperiódus új induló napja). Az index `Π(1 + r_t)`, 1-ről indulva.
 *
 * Miért TWR: a befizetések/kivétek nem torzítják a hozamot – a portfólió ÉS NEM a mai súlyok
 * múltbeli teljesítményét méri (feladat 7.). A pénzsúlyozott hozam (IRR/MWR) későbbi bővítés.
 */
import type { IsoDate } from '@/domain';

import {
  calcInsufficientData,
  calcInvalidInput,
  calcOk,
  type CalcResult,
} from '../core/calc-result';
import { snapToZero } from '../core/numeric';

export interface PortfolioDayValue {
  readonly date: IsoDate;
  /** Napvégi érték (≥ 0). */
  readonly value: number;
  /** Napi nettó külső pénzmozgás napvégi áron (vétel +, eladás −). */
  readonly netFlow: number;
  /** Napi jövedelem (osztalék, ≥ 0). */
  readonly income: number;
}

export interface TimeWeightedReturn {
  /** Napi hozamok (csak a kockáztatott tőkével rendelkező napokra). */
  readonly returns: readonly { readonly date: IsoDate; readonly value: number }[];
  /** Hozamindex (az első nap 1), a drawdownhoz. */
  readonly index: readonly { readonly date: IsoDate; readonly close: number }[];
  /** Kumulált TWR = index_vég − 1. */
  readonly cumulativeReturn: number;
  /** Napok száma, amikor nem volt kockáztatott tőke (V_{t−1} ≤ 0). */
  readonly uninvestedDays: number;
}

/**
 * TWR számítása. < 2 nap → `INSUFFICIENT_DATA`; nem véges szám, negatív érték/jövedelem,
 * nem növekvő dátum vagy negatív „mozgás előtti” érték → `INVALID_INPUT`.
 */
export function timeWeightedReturn(
  days: readonly PortfolioDayValue[],
): CalcResult<TimeWeightedReturn> {
  if (days.length < 2) return calcInsufficientData('A TWR-hez legalább 2 nap értéke kell.');
  for (const [index, day] of days.entries()) {
    if (![day.value, day.netFlow, day.income].every(Number.isFinite)) {
      return calcInvalidInput(`Nem véges szám a(z) ${day.date} napon.`);
    }
    if (day.value < 0 || day.income < 0) {
      return calcInvalidInput(`Negatív érték vagy jövedelem a(z) ${day.date} napon.`);
    }
    const previous = days[index - 1];
    if (previous !== undefined && day.date <= previous.date) {
      return calcInvalidInput(`A napok dátuma szigorúan növekvő kell legyen (${day.date}).`);
    }
  }
  const returns: { date: IsoDate; value: number }[] = [];
  const first = days[0] as PortfolioDayValue;
  const index: { date: IsoDate; close: number }[] = [{ date: first.date, close: 1 }];
  let level = 1;
  let uninvestedDays = 0;
  for (let i = 1; i < days.length; i += 1) {
    const previous = days[i - 1] as PortfolioDayValue;
    const day = days[i] as PortfolioDayValue;
    if (previous.value <= 0) {
      uninvestedDays += 1;
      index.push({ date: day.date, close: level });
      continue;
    }
    const endBeforeFlows = day.value - day.netFlow + day.income;
    if (endBeforeFlows < -1e-9 * previous.value) {
      return calcInvalidInput(
        `${day.date}: a mozgás előtti érték negatív (${endBeforeFlows}) – a pénzmozgás és az érték ellentmond.`,
      );
    }
    const r = snapToZero(Math.max(0, endBeforeFlows) / previous.value - 1);
    returns.push({ date: day.date, value: r });
    level *= 1 + r;
    index.push({ date: day.date, close: level });
  }
  if (returns.length === 0) {
    return calcInsufficientData('Egyetlen napon sem volt kockáztatott tőke.');
  }
  const notes =
    uninvestedDays > 0
      ? [`${uninvestedDays} nap kimaradt, mert előtte a portfólió üres volt (nincs hozam).`]
      : [];
  return calcOk({ returns, index, cumulativeReturn: snapToZero(level - 1), uninvestedDays }, notes);
}
