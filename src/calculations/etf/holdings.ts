/**
 * Holdings-alapú ETF-mutatók: top N súly, koncentráció (HHI, effektív pozíciószám) és
 * csoportosított kitettség (ország, szektor, deviza). DATA_DICTIONARY 15.4, D-067.
 *
 * Konvenciók (D-067):
 * - A súly tizedes tört, a forrás szerinti „nettó eszközérték arányában” (N-PORT: `pctVal/100`).
 *   A súlyokat NEM normalizáljuk 100%-ra: egy részleges lista top 10 súlya így a valós
 *   (az alap egészéhez mért) arány marad.
 * - Negatív súly (short, derivatíva) nem pozíció-koncentráció: a top N és a HHI csak a
 *   pozitív súlyokat használja (megjegyzéssel).
 * - Top N: részleges listánál csak akkor `OK`, ha legalább N pozíció szerepel (a forrás a
 *   legnagyobbakat adja – feltevés, megjegyzéssel); teljes listánál N-nél kevesebb pozíció is `OK`.
 * - HHI = Σ wᵢ² a pozitív súlyokra, 1-re normalizálva; effektív pozíciószám = 1 / HHI.
 *   Csak TELJES listára (részleges listán a HHI alulbecsült volna) → különben `INSUFFICIENT_DATA`.
 */
import {
  calcInsufficientData,
  calcInvalidInput,
  calcOk,
  type CalcResult,
} from '../core/calc-result';

/** Egyetlen pozíció súlyának megengedett tartománya (tört): −1 … 1. */
export const HOLDING_WEIGHT_RANGE = { min: -1, max: 1 } as const;

function validateWeights(weights: readonly number[]): CalcResult<readonly number[]> {
  const bad = weights.findIndex(
    (weight) =>
      !Number.isFinite(weight) ||
      weight < HOLDING_WEIGHT_RANGE.min ||
      weight > HOLDING_WEIGHT_RANGE.max,
  );
  return bad >= 0
    ? calcInvalidInput(
        `Érvénytelen súly a(z) ${bad}. pozíción (${weights[bad]}); tizedes tört kell (0.05 = 5%).`,
      )
    : calcOk(weights);
}

function positiveSortedDesc(weights: readonly number[]): readonly number[] {
  return weights.filter((weight) => weight > 0).sort((a, b) => b - a);
}

function negativeNote(weights: readonly number[]): readonly string[] {
  const negatives = weights.filter((weight) => weight < 0).length;
  return negatives > 0
    ? [`${negatives} negatív súlyú tétel (short/derivatíva) kimaradt a koncentrációból.`]
    : [];
}

/** A legnagyobb N pozíció összsúlya (a forrás szerinti, nem normalizált súlyokkal). */
export function topNWeight(input: {
  readonly weights: readonly number[];
  readonly n: number;
  /** A lista az alap TELJES összetétele-e. */
  readonly isComplete: boolean;
}): CalcResult<number> {
  if (!Number.isInteger(input.n) || input.n < 1) {
    return calcInvalidInput(`Az N pozitív egész kell (${input.n}).`);
  }
  const valid = validateWeights(input.weights);
  if (valid.status !== 'OK') return valid;
  const positive = positiveSortedDesc(valid.value);
  if (positive.length === 0) return calcInsufficientData('Nincs pozitív súlyú pozíció.');
  const notes = [...negativeNote(valid.value)];
  if (positive.length < input.n) {
    if (!input.isComplete) {
      return calcInsufficientData(
        `Részleges holdings-lista: csak ${positive.length} pozíció ismert, a top ${input.n} súlyhoz kevés.`,
      );
    }
    notes.push(`Az alapnak csak ${positive.length} pozíciója van; az összes súlya szerepel.`);
  } else if (!input.isComplete) {
    notes.push('Részleges lista: feltevés, hogy a forrás a legnagyobb pozíciókat adja.');
  }
  const sum = positive.slice(0, input.n).reduce((total, weight) => total + weight, 0);
  return calcOk(sum, notes);
}

export interface Concentration {
  /** Herfindahl–Hirschman-index a normalizált pozitív súlyokra (1/N … 1). */
  readonly herfindahl: number;
  /** Effektív pozíciószám = 1 / HHI (ennyi egyenlő súlyú pozícióval egyenértékű). */
  readonly effectiveHoldings: number;
}

/** HHI és effektív pozíciószám – csak teljes holdings-listára. */
export function holdingsConcentration(input: {
  readonly weights: readonly number[];
  readonly isComplete: boolean;
}): CalcResult<Concentration> {
  const valid = validateWeights(input.weights);
  if (valid.status !== 'OK') return valid;
  if (!input.isComplete) {
    return calcInsufficientData(
      'A koncentrációs index (HHI) csak teljes holdings-listából számolható; részleges listán alulbecsült volna.',
    );
  }
  const positive = positiveSortedDesc(valid.value);
  const total = positive.reduce((sum, weight) => sum + weight, 0);
  if (total <= 0) return calcInsufficientData('Nincs pozitív súlyú pozíció.');
  const herfindahl = positive.reduce((sum, weight) => sum + (weight / total) ** 2, 0);
  return calcOk({ herfindahl, effectiveHoldings: 1 / herfindahl }, negativeNote(valid.value));
}

export interface ExposureGroup {
  readonly key: string;
  readonly weight: number;
}

export interface ExposureBreakdown {
  /** Csoportok súly szerint csökkenő sorrendben (ismert kulccsal). */
  readonly groups: readonly ExposureGroup[];
  /** Azoknak a felsorolt pozícióknak az összsúlya, amelyeknél a forrás nem adta meg a kulcsot. */
  readonly unclassifiedWeight: number;
  /** A lista által le nem fedett súly: max(0, 1 − Σ súly). Részleges listánál jelentős. */
  readonly uncoveredWeight: number;
}

/**
 * Csoportosított kitettség (pl. ország, szektor, deviza). A `null` kulcs nem kerül kitalált
 * csoportba: az `unclassifiedWeight`-be megy; a lista hiányzó része az `uncoveredWeight`.
 */
export function exposureBreakdown(
  items: readonly { readonly key: string | null; readonly weight: number }[],
): CalcResult<ExposureBreakdown> {
  const valid = validateWeights(items.map((item) => item.weight));
  if (valid.status !== 'OK') return valid;
  if (items.length === 0) return calcInsufficientData('Nincs pozíció a csoportosításhoz.');
  const sums = new Map<string, number>();
  let unclassified = 0;
  let listed = 0;
  for (const item of items) {
    listed += item.weight;
    if (item.key === null) unclassified += item.weight;
    else sums.set(item.key, (sums.get(item.key) ?? 0) + item.weight);
  }
  const groups = [...sums.entries()]
    .map(([key, weight]) => ({ key, weight }))
    .sort((a, b) => b.weight - a.weight || a.key.localeCompare(b.key));
  const uncovered = Math.max(0, 1 - listed);
  const notes: string[] = [];
  if (unclassified > 0) notes.push('Egyes pozícióknál a forrás nem adta meg a besorolást.');
  if (uncovered > 0.02) {
    notes.push('A felsorolt pozíciók nem fedik le a teljes alapot; a súlyok alsó becslések.');
  }
  return calcOk({ groups, unclassifiedWeight: unclassified, uncoveredWeight: uncovered }, notes);
}
