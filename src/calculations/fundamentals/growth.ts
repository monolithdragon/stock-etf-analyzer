/**
 * Növekedés, CAGR és működési tőkeáttétel (DOL). DATA_DICTIONARY 5.1, D-056.
 *
 * Alapelv: nincs „abszolútérték-trükk”. Nulla vagy negatív bázisra a százalékos változás
 * félrevezető (−1-ről +1-re „+200%”?), ezért `NOT_MEANINGFUL`.
 */
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
import { firstFailure, mustBePositive } from '../core/numeric';

/**
 * Növekedés = (X_t − X_{t−1}) / X_{t−1} (tört). Árbevétel, nettó eredmény, EPS közös képlete.
 * - előző érték = 0 → `NOT_MEANINGFUL` („nullás bázisév”);
 * - előző érték < 0 → `NOT_MEANINGFUL`;
 * - pozitív bázisról negatívra fordulás `OK` (−100% alatti érték is lehet, pl. EPS 1 → −0.5 = −150%).
 */
export function growthRate(input: {
  readonly current: NumericInput;
  readonly previous: NumericInput;
}): CalcResult<number> {
  return chainCalc(requireInputs(input), ({ current, previous }) => {
    if (previous === 0) {
      return calcNotMeaningful(
        'A bázisidőszak értéke 0 – a százalékos növekedés nem értelmezhető.',
      );
    }
    if (previous < 0) {
      return calcNotMeaningful(
        `A bázisidőszak értéke negatív (${previous}) – a százalékos növekedés félrevezető.`,
      );
    }
    return calcOk((current - previous) / previous);
  });
}

/**
 * CAGR = (X_end / X_start)^(1/évek) − 1.
 * - évek ≤ 0 → `INVALID_INPUT`;
 * - X_start ≤ 0 vagy X_end ≤ 0 → `NOT_MEANINGFUL` (negatív/nulla végpontra nincs valós gyök).
 * Az évek száma lehet tört (pl. 2.5 év két dátum között).
 */
export function cagr(input: {
  readonly startValue: NumericInput;
  readonly endValue: NumericInput;
  readonly years: NumericInput;
}): CalcResult<number> {
  return chainCalc(requireInputs(input), ({ startValue, endValue, years }) => {
    const bad = firstFailure(
      mustBePositive('years', years),
      mustBePositive(
        'startValue',
        startValue,
        'NOT_MEANINGFUL',
        'Nulla vagy negatív kezdőértékre a CAGR nem értelmezhető.',
      ),
      mustBePositive(
        'endValue',
        endValue,
        'NOT_MEANINGFUL',
        'Nulla vagy negatív végértékre a CAGR nem értelmezhető.',
      ),
    );
    return bad ?? calcOk((endValue / startValue) ** (1 / years) - 1);
  });
}

export interface AnnualValue {
  readonly fiscalYear: number;
  /** `null` = abban az évben hiányzik az adat (NEM nulla). */
  readonly value: number | null;
}

/**
 * N éves CAGR egy éves idősorból: az utolsó év és az N évvel korábbi év értékéből.
 * - nincs N évvel korábbi év, vagy bármelyik végpont értéke hiányzik → `INSUFFICIENT_DATA`;
 * - ismétlődő év → `INVALID_INPUT`;
 * - a közbenső évek hiánya nem akadály (a CAGR csak a végpontokat használja).
 */
export function cagrOverYears(series: readonly AnnualValue[], years: number): CalcResult<number> {
  if (!Number.isInteger(years) || years < 1) {
    return calcInvalidInput(`Az évek száma pozitív egész kell legyen (${years}).`);
  }
  const byYear = new Map<number, number | null>();
  for (const point of series) {
    if (byYear.has(point.fiscalYear)) {
      return calcInvalidInput(`Ismétlődő pénzügyi év az idősorban: ${point.fiscalYear}.`);
    }
    byYear.set(point.fiscalYear, point.value);
  }
  if (byYear.size === 0) return calcInsufficientData('Üres idősor.');
  const lastYear = Math.max(...byYear.keys());
  const firstYear = lastYear - years;
  const endValue = byYear.get(lastYear) ?? null;
  const startValue = byYear.get(firstYear) ?? null;
  if (startValue === null || endValue === null) {
    return calcInsufficientData(
      `${years} éves CAGR-hez a ${firstYear}. és a ${lastYear}. év értéke kell; legalább az egyik hiányzik.`,
    );
  }
  return cagr({ startValue, endValue, years });
}

/** A DOL-nál ennél kisebb abszolút árbevétel-változás → `NOT_MEANINGFUL` (D-056). */
export const DOL_MIN_REVENUE_CHANGE = 0.01;

/**
 * Működési tőkeáttétel (DOL) = %Δ üzemi eredmény / %Δ árbevétel, két egymást követő időszakból.
 * - bármelyik bázis (előző üzemi eredmény vagy árbevétel) ≤ 0 → `NOT_MEANINGFUL`;
 * - |%Δ árbevétel| < 1% → `NOT_MEANINGFUL`: a kis nevező miatt a hányados zajt erősít fel.
 */
export function degreeOfOperatingLeverage(input: {
  readonly operatingIncomeCurrent: NumericInput;
  readonly operatingIncomePrevious: NumericInput;
  readonly revenueCurrent: NumericInput;
  readonly revenuePrevious: NumericInput;
}): CalcResult<number> {
  return chainCalc(requireInputs(input), (v) => {
    const bad = firstFailure(
      mustBePositive(
        'operatingIncomePrevious',
        v.operatingIncomePrevious,
        'NOT_MEANINGFUL',
        'Veszteséges bázisra a DOL nem értelmezhető.',
      ),
      mustBePositive('revenuePrevious', v.revenuePrevious, 'NOT_MEANINGFUL'),
    );
    if (bad) return bad;
    const revenueChange = (v.revenueCurrent - v.revenuePrevious) / v.revenuePrevious;
    if (Math.abs(revenueChange) < DOL_MIN_REVENUE_CHANGE) {
      return calcNotMeaningful(
        `Az árbevétel változása (${revenueChange}) 1%-nál kisebb – a DOL nem értelmezhető.`,
      );
    }
    const incomeChange =
      (v.operatingIncomeCurrent - v.operatingIncomePrevious) / v.operatingIncomePrevious;
    return calcOk(incomeChange / revenueChange);
  });
}
