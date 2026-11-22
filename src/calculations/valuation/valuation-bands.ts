/**
 * Értékelési kategóriák konfigurálható küszöbökkel – PHASE 07, D-065.
 *
 * FONTOS: a küszöbök ELEMZÉSI KONVENCIÓK, nem objektív igazságok. Iparáganként, növekedési
 * profilonként és kamatkörnyezetenként mást jelentenek; a hívó felülírhatja őket, és a
 * kimenet mindig tartalmazza a ténylegesen használt küszöböt. Nem BUY/HOLD/SELL jelzés.
 */
import {
  calcInvalidInput,
  calcNotMeaningful,
  calcOk,
  chainCalc,
  requireInputs,
  type CalcResult,
  type NumericInput,
} from '../core/calc-result';

export const VALUATION_THRESHOLD_DISCLAIMER =
  'A kategóriahatárok elemzési küszöbök, nem objektív igazságok: iparáganként és kamatkörnyezetenként mást jelentenek, és szabadon állíthatók. Nem vételi/eladási jelzés.';

// --- Biztonsági sáv (DCF modellérték vs. ár) --------------------------------------------------

export interface MarginOfSafetyThresholds {
  /** MOS ≥ ennyi → az ár érdemben a modellérték ALATT van. */
  readonly discountAtLeast: number;
  /** MOS < ennyi → az ár érdemben a modellérték FELETT van. */
  readonly premiumBelow: number;
}

export const DEFAULT_MOS_THRESHOLDS: MarginOfSafetyThresholds = {
  discountAtLeast: 0.25,
  premiumBelow: -0.1,
};

export type ModelValueCategory = 'DISCOUNT_TO_MODEL' | 'NEAR_MODEL' | 'PREMIUM_TO_MODEL';

export interface MarginOfSafetyCategory {
  readonly category: ModelValueCategory;
  readonly marginOfSafety: number;
  readonly thresholds: MarginOfSafetyThresholds;
}

/**
 * MOS-kategória: `≥ discountAtLeast` → `DISCOUNT_TO_MODEL`; `< premiumBelow` → `PREMIUM_TO_MODEL`;
 * különben `NEAR_MODEL`. Érvénytelen küszöb (nem véges, `premiumBelow ≥ discountAtLeast`,
 * `discountAtLeast ≥ 1`) → `INVALID_INPUT`.
 */
export function classifyMarginOfSafety(
  marginOfSafety: NumericInput,
  thresholds: MarginOfSafetyThresholds = DEFAULT_MOS_THRESHOLDS,
): CalcResult<MarginOfSafetyCategory> {
  return chainCalc(
    requireInputs({
      marginOfSafety,
      discountAtLeast: thresholds.discountAtLeast,
      premiumBelow: thresholds.premiumBelow,
    }),
    ({ marginOfSafety: mos, discountAtLeast, premiumBelow }) => {
      if (premiumBelow >= discountAtLeast || discountAtLeast >= 1) {
        return calcInvalidInput(
          `Érvénytelen MOS-küszöbök: premiumBelow (${premiumBelow}) < discountAtLeast (${discountAtLeast}) < 1 szükséges.`,
        );
      }
      const category: ModelValueCategory =
        mos >= discountAtLeast
          ? 'DISCOUNT_TO_MODEL'
          : mos < premiumBelow
            ? 'PREMIUM_TO_MODEL'
            : 'NEAR_MODEL';
      return calcOk({ category, marginOfSafety: mos, thresholds });
    },
  );
}

// --- Szorzó-sávok -----------------------------------------------------------------------------

export interface MultipleBandThresholds {
  /** Érték < ennyi → `LOW`. */
  readonly lowBelow: number;
  /** Érték > ennyi → `HIGH`. */
  readonly highAbove: number;
  /** Hozam jellegű mutatónál (FCF-hozam) a magasabb érték az olcsóbb; szorzónál fordítva. */
  readonly higherIsCheaper: boolean;
  /** Megengedett-e a nem pozitív érték (hozam: igen; szorzó: nem – ott N/M). */
  readonly allowNonPositive: boolean;
}

export const VALUATION_BAND_METRICS = [
  'pe',
  'forwardPe',
  'pfcf',
  'ps',
  'pb',
  'evToEbitda',
  'peg',
  'fcfYield',
] as const;
export type ValuationBandMetric = (typeof VALUATION_BAND_METRICS)[number];

const multipleBand = (lowBelow: number, highAbove: number): MultipleBandThresholds => ({
  lowBelow,
  highAbove,
  higherIsCheaper: false,
  allowNonPositive: false,
});

/** Kiinduló, széles piaci küszöbök (D-065) – NEM iparág-specifikusak. */
export const DEFAULT_MULTIPLE_BANDS: Readonly<Record<ValuationBandMetric, MultipleBandThresholds>> =
  {
    pe: multipleBand(15, 25),
    forwardPe: multipleBand(15, 25),
    pfcf: multipleBand(15, 25),
    ps: multipleBand(2, 6),
    pb: multipleBand(1.5, 4),
    evToEbitda: multipleBand(10, 16),
    peg: multipleBand(1, 2),
    fcfYield: { lowBelow: 0.03, highAbove: 0.06, higherIsCheaper: true, allowNonPositive: true },
  };

export type MultipleBand = 'LOW' | 'MODERATE' | 'HIGH';

export interface MultipleBandResult {
  readonly band: MultipleBand;
  readonly value: number;
  readonly thresholds: MultipleBandThresholds;
}

/** Sáv-besorolás: `< lowBelow` → `LOW`, `> highAbove` → `HIGH`, különben `MODERATE`. */
export function classifyMultipleBand(
  value: NumericInput,
  thresholds: MultipleBandThresholds,
): CalcResult<MultipleBandResult> {
  return chainCalc(
    requireInputs({ value, lowBelow: thresholds.lowBelow, highAbove: thresholds.highAbove }),
    ({ value: v, lowBelow, highAbove }) => {
      if (lowBelow >= highAbove) {
        return calcInvalidInput(
          `Érvénytelen sávhatárok: lowBelow (${lowBelow}) < highAbove (${highAbove}) szükséges.`,
        );
      }
      if (v <= 0 && !thresholds.allowNonPositive) {
        return calcNotMeaningful(`Nem pozitív szorzó (${v}) nem sorolható sávba.`);
      }
      const band: MultipleBand = v < lowBelow ? 'LOW' : v > highAbove ? 'HIGH' : 'MODERATE';
      return calcOk({ band, value: v, thresholds });
    },
  );
}
