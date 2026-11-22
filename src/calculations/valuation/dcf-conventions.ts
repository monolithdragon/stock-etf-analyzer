/**
 * DCF közös számítási konvenciók (PHASE 05 előkészítés; a teljes DCF a PHASE 07 feladata, D-022).
 *
 * Konvenciók (D-057):
 * - Év végi diszkontálás: a t. év pénzárama `t` egész év múlva érkezik (`t = 1..n`). A félév
 *   közepi (mid-year) konvenció NEM alapértelmezés; ha a PHASE 07 bevezeti, `t − 0.5` periódussal
 *   ugyanezek a függvények használhatók (a periódus lehet tört).
 * - Ráták tizedes törtként; a diszkontráta (0, 1] tartományban (1 = 100% fölött szinte biztosan
 *   „százalék a tört helyett” hiba).
 * - Gordon-modell csak `r > g` esetén; különben `INVALID_INPUT` emberi magyarázattal.
 */
import {
  calcInvalidInput,
  calcOk,
  chainCalc,
  requireInputs,
  type CalcFailure,
  type CalcResult,
  type NumericInput,
} from '../core/calc-result';
import {
  DECIMAL_HINT,
  firstFailure,
  mustBeAboveMinusOne,
  mustBeInRange,
  mustBeNonNegative,
} from '../core/numeric';

/** A diszkontráta józansági felső határa (tört). */
export const MAX_DISCOUNT_RATE = 1;

/** Diszkontráta-ellenőrzés: `(0, 1]` (PHASE 07: a DCF-motor is ezt használja). */
export function checkDiscountRate(rate: number): CalcFailure | null {
  return rate > 0
    ? mustBeInRange('discountRate', rate, 0, MAX_DISCOUNT_RATE, DECIMAL_HINT)
    : calcInvalidInput(`A diszkontráta pozitív kell legyen (${rate}).`);
}

/** Diszkonttényező = 1 / (1 + r)^t. `t ≥ 0` (lehet tört); `r ∈ (0, 1]`. */
export function discountFactor(input: {
  readonly discountRate: NumericInput;
  readonly period: NumericInput;
}): CalcResult<number> {
  return chainCalc(requireInputs(input), ({ discountRate, period }) => {
    const bad = firstFailure(checkDiscountRate(discountRate), mustBeNonNegative('period', period));
    return bad ?? calcOk(1 / (1 + discountRate) ** period);
  });
}

/** Jelenérték: PV = CF / (1 + r)^t. A pénzáram lehet negatív. */
export function presentValue(input: {
  readonly cashFlow: NumericInput;
  readonly discountRate: NumericInput;
  readonly period: NumericInput;
}): CalcResult<number> {
  return chainCalc(requireInputs({ cashFlow: input.cashFlow }), ({ cashFlow }) =>
    chainCalc(discountFactor(input), (factor) => calcOk(cashFlow * factor)),
  );
}

/**
 * Terminális érték (Gordon-növekedési modell): TV = CF_n × (1 + g) / (r − g).
 * - `r ≤ g` → `INVALID_INPUT` (a végtelen sor nem konvergál – a modell értelmetlen);
 * - `g ≤ −1` → `INVALID_INPUT`.
 * A visszaadott érték az n. év végére vonatkozik; jelenértékre a `presentValue` hozza (t = n).
 */
export function gordonTerminalValue(input: {
  readonly finalYearCashFlow: NumericInput;
  readonly discountRate: NumericInput;
  readonly terminalGrowth: NumericInput;
}): CalcResult<number> {
  return chainCalc(requireInputs(input), ({ finalYearCashFlow, discountRate, terminalGrowth }) => {
    const bad = firstFailure(
      checkDiscountRate(discountRate),
      mustBeAboveMinusOne('terminalGrowth', terminalGrowth),
    );
    if (bad) return bad;
    if (discountRate <= terminalGrowth) {
      return calcInvalidInput(
        `A diszkontráta (${discountRate}) nem nagyobb a terminális növekedésnél (${terminalGrowth}) – a Gordon-modell ekkor nem értelmezhető.`,
      );
    }
    return calcOk((finalYearCashFlow * (1 + terminalGrowth)) / (discountRate - terminalGrowth));
  });
}
