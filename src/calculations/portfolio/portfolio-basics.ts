/**
 * Portfólió-alapok: portfóliósúly és súlyozott hozam. DATA_DICTIONARY 5.5, D-058.
 * A teljes portfólió-motor (pozíciók, P/L, FX-hatás) a PHASE 09 feladata.
 *
 * - Súly = pozícióérték / az ÁRAZOTT pozíciók összértéke, a kijelzési pénznemben. A hiányzó árú
 *   pozíció NEM kap 0 súlyt: külön listában jelenik meg (`unpriced`).
 * - Súlyozott hozam = Σ w_i × r_i; a súlyok összege 1 (±1e-6) kell legyen.
 * - Short (negatív) pozíció nem támogatott → `INVALID_INPUT`.
 */
import type { CurrencyCode, Money } from '@/domain';

import {
  calcInsufficientData,
  calcInvalidInput,
  calcMissing,
  calcNotMeaningful,
  calcOk,
  type CalcResult,
} from '../core/calc-result';
import { approximatelyEqual } from '../core/numeric';

/** A súlyok összegének tűrése (kerekített súlyok, pl. 0.333 + 0.333 + 0.334). */
export const WEIGHT_SUM_TOLERANCE = 1e-6;

export interface PositionValueInput {
  readonly id: string;
  /** A pozíció értéke a kijelzési pénznemben; `null` = nincs ár/FX (NEM nulla). */
  readonly value: Money | null;
}

export interface PortfolioWeights {
  readonly currency: CurrencyCode;
  /** Az árazott pozíciók összértéke. */
  readonly totalValue: number;
  readonly weights: readonly { readonly id: string; readonly weight: number }[];
  /** Ár/érték nélküli pozíciók azonosítói – a súlyozásból kimaradtak. */
  readonly unpriced: readonly string[];
}

export function portfolioWeights(
  positions: readonly PositionValueInput[],
): CalcResult<PortfolioWeights> {
  if (positions.length === 0) return calcInsufficientData('A portfólió üres.');
  const ids = new Set<string>();
  for (const position of positions) {
    if (ids.has(position.id)) return calcInvalidInput(`Ismétlődő pozíció: ${position.id}.`);
    ids.add(position.id);
  }
  const priced = positions.filter(
    (position): position is { id: string; value: Money } => position.value !== null,
  );
  const unpriced = positions.filter((position) => position.value === null).map((p) => p.id);
  const first = priced[0];
  if (first === undefined)
    return calcMissing('Egyik pozíciónak sincs értéke (ár vagy FX hiányzik).');

  for (const position of priced) {
    if (position.value.currency !== first.value.currency) {
      return calcInvalidInput(
        `Eltérő pénznemű pozícióértékek (${first.value.currency} és ${position.value.currency}) – előbb a kijelzési pénznemre kell váltani.`,
      );
    }
    if (!Number.isFinite(position.value.amount) || position.value.amount < 0) {
      return calcInvalidInput(
        `Érvénytelen pozícióérték (${position.id}: ${position.value.amount}); short pozíció nem támogatott.`,
      );
    }
  }
  const totalValue = priced.reduce((sum, position) => sum + position.value.amount, 0);
  if (totalValue <= 0) return calcNotMeaningful('Az árazott pozíciók összértéke 0.');

  const notes =
    unpriced.length > 0
      ? [`${unpriced.length} pozíció ár/érték nélkül kimaradt a súlyozásból (nem 0 súllyal).`]
      : [];
  return calcOk(
    {
      currency: first.value.currency,
      totalValue,
      weights: priced.map((position) => ({
        id: position.id,
        weight: position.value.amount / totalValue,
      })),
      unpriced,
    },
    notes,
  );
}

export interface WeightedReturnInput {
  readonly id: string;
  /** Tizedes tört, 0..1. */
  readonly weight: number;
  /** Az elem hozama (tört); `null` = hiányzik. */
  readonly return: number | null;
}

/**
 * Súlyozott hozam = Σ w_i × r_i.
 * - üres → `INSUFFICIENT_DATA`; nem véges szám → `INVALID_INPUT`;
 * - negatív súly → `INVALID_INPUT`; a súlyok összege ≠ 1 (±1e-6) → `INVALID_INPUT`
 *   (≈100 esetén a hibaüzenet a „százalék vs. tört” hibára utal);
 * - bármelyik hozam hiányzik → `MISSING` (nem 0-val számolunk).
 */
export function weightedReturn(items: readonly WeightedReturnInput[]): CalcResult<number> {
  if (items.length === 0) return calcInsufficientData('Nincs elem a súlyozott hozamhoz.');
  if (
    items.some(
      (item) =>
        !Number.isFinite(item.weight) || (item.return !== null && !Number.isFinite(item.return)),
    )
  ) {
    return calcInvalidInput('Nem véges szám a súlyokban vagy a hozamokban.');
  }
  const negative = items.find((item) => item.weight < 0);
  if (negative) return calcInvalidInput(`Negatív súly: ${negative.id} (${negative.weight}).`);
  const weightSum = items.reduce((sum, item) => sum + item.weight, 0);
  if (!approximatelyEqual(weightSum, 1, WEIGHT_SUM_TOLERANCE)) {
    const hint = approximatelyEqual(weightSum, 100, 0.01)
      ? ' Úgy tűnik, százalékban adták meg: tizedes tört kell (0.25 = 25%).'
      : '';
    return calcInvalidInput(`A súlyok összege ${weightSum}, nem 1.${hint}`);
  }
  const missing = items.filter((item) => item.return === null).map((item) => item.id);
  if (missing.length > 0) return calcMissing(`Hiányzó hozam: ${missing.join(', ')}.`);
  return calcOk(items.reduce((sum, item) => sum + item.weight * (item.return as number), 0));
}
