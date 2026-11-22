/**
 * Két ETF (vagy portfólió) holdings-átfedése. DATA_DICTIONARY 7.6, D-072.
 *
 * Átfedés = Σ_i min(w_A,i, w_B,i) a KÖZÖS kulcsú (ISIN) pozitív súlyokra. 0 = nincs közös
 * pozíció, 1 = azonos összetétel. Kulcs nélküli (ISIN nélküli) tétel nem párosítható: név
 * alapján nem találgatunk – a súlyuk külön látszik (`unmatchableWeightA/B`).
 * Részleges listán az átfedés ALSÓ becslés (megjegyzés). A teljes összehasonlító funkció és
 * képernyő későbbi fázis (PHASE 14); itt csak az adatmodell és az alapképlet készül.
 */
import { HOLDING_WEIGHT_RANGE } from './holdings';
import {
  calcInsufficientData,
  calcInvalidInput,
  calcOk,
  type CalcResult,
} from '../core/calc-result';

export interface OverlapItem {
  /** Párosító kulcs (ISIN); `null` = nem párosítható. */
  readonly key: string | null;
  readonly weight: number;
}

export interface HoldingsOverlap {
  readonly overlapWeight: number;
  readonly commonCount: number;
  /** A közös tételek, átfedés szerint csökkenő sorrendben. */
  readonly common: readonly {
    readonly key: string;
    readonly weightA: number;
    readonly weightB: number;
    readonly overlap: number;
  }[];
  readonly unmatchableWeightA: number;
  readonly unmatchableWeightB: number;
}

function aggregate(items: readonly OverlapItem[]): {
  byKey: Map<string, number>;
  unmatchable: number;
} {
  const byKey = new Map<string, number>();
  let unmatchable = 0;
  for (const item of items) {
    if (item.weight <= 0) continue;
    if (item.key === null) unmatchable += item.weight;
    else byKey.set(item.key, (byKey.get(item.key) ?? 0) + item.weight);
  }
  return { byKey, unmatchable };
}

export function holdingsOverlap(input: {
  readonly a: readonly OverlapItem[];
  readonly b: readonly OverlapItem[];
  readonly bothComplete: boolean;
}): CalcResult<HoldingsOverlap> {
  const all = [...input.a, ...input.b];
  const bad = all.find(
    (item) =>
      !Number.isFinite(item.weight) ||
      item.weight < HOLDING_WEIGHT_RANGE.min ||
      item.weight > HOLDING_WEIGHT_RANGE.max,
  );
  if (bad) return calcInvalidInput(`Érvénytelen súly (${bad.weight}); tizedes tört kell.`);
  if (input.a.length === 0 || input.b.length === 0) {
    return calcInsufficientData('Az átfedéshez mindkét oldalon kell holdings-lista.');
  }
  const a = aggregate(input.a);
  const b = aggregate(input.b);
  const common = [...a.byKey.entries()]
    .filter(([key]) => b.byKey.has(key))
    .map(([key, weightA]) => {
      const weightB = b.byKey.get(key) as number;
      return { key, weightA, weightB, overlap: Math.min(weightA, weightB) };
    })
    .sort((x, y) => y.overlap - x.overlap || x.key.localeCompare(y.key));
  const notes: string[] = [];
  if (!input.bothComplete) notes.push('Részleges holdings-lista: az átfedés alsó becslés.');
  if (a.unmatchable > 0 || b.unmatchable > 0) {
    notes.push('ISIN nélküli tételek nem párosíthatók (név alapján nem találgatunk).');
  }
  return calcOk(
    {
      overlapWeight: common.reduce((sum, item) => sum + item.overlap, 0),
      commonCount: common.length,
      common,
      unmatchableWeightA: a.unmatchable,
      unmatchableWeightB: b.unmatchable,
    },
    notes,
  );
}
