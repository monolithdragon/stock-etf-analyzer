/**
 * ETF-költség (TER) és követési mutatók. DATA_DICTIONARY 5.5, D-058.
 *
 * - TER: tizedes tört (0.0022 = 0,22%/év); józansági határ 0 … 0.10 (mint a domain `Etf.ter`).
 * - Tracking difference (TD) = ETF hozam − index hozam, AZONOS időszakra (tipikusan negatív
 *   ≈ −TER). Mindkettő total return legyen (azonos osztalék-kezeléssel).
 * - Tracking error (TE) = a periódusonkénti hozamkülönbségek MINTA szórása × √(évi periódusszám).
 *   Az évesítés periódusszámát a hívó adja meg (napi: 252, heti: 52, havi: 12) – PHASE 08 dönt.
 */
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
  DECIMAL_HINT,
  firstFailure,
  mustBeAboveMinusOne,
  mustBeInRange,
  mustBeNonNegative,
  mustBePositive,
  sampleStandardDeviation,
} from '../core/numeric';

/** A TER józansági felső határa (megegyezik a domain `Etf.ter` validációjával). */
export const MAX_TER = 0.1;

function checkTer(ter: number) {
  return mustBeInRange('ter', ter, 0, MAX_TER, DECIMAL_HINT);
}

/** Éves TER-költség = befektetett összeg × TER (közelítés: állandó állomány az év során). */
export function annualTerCost(input: {
  readonly investedAmount: NumericInput;
  readonly ter: NumericInput;
}): CalcResult<number> {
  return chainCalc(requireInputs(input), ({ investedAmount, ter }) => {
    const bad = firstFailure(mustBeNonNegative('investedAmount', investedAmount), checkTer(ter));
    return bad ?? calcOk(investedAmount * ter);
  });
}

export interface TerImpact {
  /** Jövőérték költség nélkül: P × (1 + r)^n. */
  readonly futureValueWithoutCost: number;
  /** Jövőérték költséggel: P × (1 + r − TER)^n. */
  readonly futureValueWithCost: number;
  /** A költség miatt elmaradt vagyon (abszolút). */
  readonly costAmount: number;
  /** Az elmaradt vagyon aránya a költség nélküli jövőértékhez képest. */
  readonly costShare: number;
}

/**
 * TER egyszerűsített hosszú távú hatása (DATA_DICTIONARY 5.5): FV `(1 + r − TER)^n` vs `(1 + r)^n`.
 * Egyszerűsítés: állandó bruttó hozam, a TER évente egyszer, a hozamból levonva; a pontosabb
 * `(1 + r)(1 − TER)` alak ettől `r × TER` nagyságrendben tér el (D-058).
 */
export function terLongTermImpact(input: {
  readonly initialAmount: NumericInput;
  readonly annualGrossReturn: NumericInput;
  readonly ter: NumericInput;
  readonly years: NumericInput;
}): CalcResult<TerImpact> {
  return chainCalc(requireInputs(input), ({ initialAmount, annualGrossReturn, ter, years }) => {
    const bad = firstFailure(
      mustBePositive('initialAmount', initialAmount),
      mustBeAboveMinusOne('annualGrossReturn', annualGrossReturn),
      mustBeInRange('annualGrossReturn', annualGrossReturn, -1, 1, DECIMAL_HINT),
      checkTer(ter),
      mustBePositive('years', years),
    );
    if (bad) return bad;
    if (1 + annualGrossReturn - ter <= 0) {
      return calcInvalidInput('A költséggel csökkentett hozam −100% vagy annál rosszabb.');
    }
    const withoutCost = initialAmount * (1 + annualGrossReturn) ** years;
    const withCost = initialAmount * (1 + annualGrossReturn - ter) ** years;
    return calcOk({
      futureValueWithoutCost: withoutCost,
      futureValueWithCost: withCost,
      costAmount: withoutCost - withCost,
      costShare: (withoutCost - withCost) / withoutCost,
    });
  });
}

/** Tracking difference = ETF hozam − index hozam (azonos időszak, tört). */
export function trackingDifference(input: {
  readonly fundReturn: NumericInput;
  readonly indexReturn: NumericInput;
}): CalcResult<number> {
  return chainCalc(requireInputs(input), ({ fundReturn, indexReturn }) => {
    const bad = firstFailure(
      fundReturn < -1 ? calcInvalidInput(`Az ETF hozama −100% alatti (${fundReturn}).`) : null,
      indexReturn < -1 ? calcInvalidInput(`Az index hozama −100% alatti (${indexReturn}).`) : null,
    );
    return bad ?? calcOk(fundReturn - indexReturn);
  });
}

/**
 * Tracking error (évesített) = minta szórás(ETF_t − index_t) × √periodsPerYear.
 * - eltérő hosszú sorok → `INVALID_INPUT` (a hívó dátum szerint igazítsa őket);
 * - 2-nél kevesebb periódus → `INSUFFICIENT_DATA`;
 * - nem véges elem → `INVALID_INPUT`.
 */
export function trackingError(input: {
  readonly fundReturns: readonly number[];
  readonly indexReturns: readonly number[];
  readonly periodsPerYear: number;
}): CalcResult<number> {
  const { fundReturns, indexReturns, periodsPerYear } = input;
  if (fundReturns.length !== indexReturns.length) {
    return calcInvalidInput(
      `Az ETF (${fundReturns.length}) és az index (${indexReturns.length}) hozamsora eltérő hosszú.`,
    );
  }
  if (fundReturns.length < 2) {
    return calcInsufficientData('A tracking errorhoz legalább 2 periódus kell.');
  }
  if (!Number.isInteger(periodsPerYear) || periodsPerYear < 1) {
    return calcInvalidInput(`Az évi periódusszám pozitív egész kell (${periodsPerYear}).`);
  }
  const differences = fundReturns.map((value, index) => value - (indexReturns[index] as number));
  if (differences.some((value) => !Number.isFinite(value))) {
    return calcInvalidInput('Nem véges szám a hozamsorokban.');
  }
  return calcOk(sampleStandardDeviation(differences) * Math.sqrt(periodsPerYear));
}
