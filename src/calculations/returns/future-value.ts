/**
 * Rendszeres befizetés jövőértéke (annuitás). DATA_DICTIONARY 5.5, D-058.
 *
 * Időszaki ráta (EFFEKTÍV, nem nominális osztás): i = (1 + r_éves)^(1/m) − 1, ahol m az évi
 * befizetések száma (alap: 12). Így 12 havi kamatozás pontosan r_éves éves hozamot ad.
 *
 *   időszak VÉGI befizetés (ordinary annuity):  FV = PMT × ((1 + i)^n − 1) / i
 *   időszak ELEJI befizetés (annuity due):      FV = PMT × ((1 + i)^n − 1) / i × (1 + i)
 *   i = 0 esetén:                                FV = PMT × n
 *   kezdőösszeggel:                             + PV × (1 + i)^n
 *
 * n = évek × m, egész szám kell legyen. Az eredmény becslés (állandó hozam feltevése).
 */
import {
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
  mustBeInRange,
  mustBeNonNegative,
  mustBePositive,
  ROUNDING_EPSILON,
} from '../core/numeric';

export type ContributionTiming = 'end' | 'begin';

/** Az éves hozam józansági tartománya: (−1, 1]. 1 fölött szinte biztosan százalék-hiba. */
export const MAX_ANNUAL_RATE = 1;

export interface FutureValueResult {
  /** Jövőérték az időszak végén. */
  readonly futureValue: number;
  /** Összes befizetett tőke (kezdőösszeg + befizetések), hozam nélkül. */
  readonly totalContributed: number;
  /** Hozamból származó rész = jövőérték − befizetett tőke. */
  readonly growth: number;
  readonly periodicRate: number;
  readonly periods: number;
}

export function futureValueOfContributions(input: {
  readonly periodicPayment: NumericInput;
  readonly annualRate: NumericInput;
  readonly years: NumericInput;
  readonly timing: ContributionTiming;
  readonly initialAmount?: NumericInput;
  readonly periodsPerYear?: number;
}): CalcResult<FutureValueResult> {
  const periodsPerYear = input.periodsPerYear ?? 12;
  return chainCalc(
    requireInputs({
      periodicPayment: input.periodicPayment,
      annualRate: input.annualRate,
      years: input.years,
      initialAmount: input.initialAmount ?? 0,
    }),
    ({ periodicPayment, annualRate, years, initialAmount }) => {
      const bad = firstFailure(
        Number.isInteger(periodsPerYear) && periodsPerYear >= 1
          ? null
          : calcInvalidInput(`Az évi befizetések száma pozitív egész kell (${periodsPerYear}).`),
        mustBeNonNegative('periodicPayment', periodicPayment),
        mustBeNonNegative('initialAmount', initialAmount),
        mustBePositive('years', years),
        annualRate > -1
          ? mustBeInRange('annualRate', annualRate, -1, MAX_ANNUAL_RATE, DECIMAL_HINT)
          : calcInvalidInput(`Az éves hozam ≤ −1 (${annualRate}).`),
      );
      if (bad) return bad;
      const rawPeriods = years * periodsPerYear;
      const periods = Math.round(rawPeriods);
      if (Math.abs(rawPeriods - periods) > 1e-9) {
        return calcInvalidInput(
          `Az évek × évi befizetések (${rawPeriods}) nem egész szám – a befizetések száma nem egyértelmű.`,
        );
      }
      const i = (1 + annualRate) ** (1 / periodsPerYear) - 1;
      const growthFactor = (1 + i) ** periods;
      const annuityFactor = Math.abs(i) < ROUNDING_EPSILON ? periods : (growthFactor - 1) / i;
      const timingFactor = input.timing === 'begin' ? 1 + i : 1;
      const futureValue =
        periodicPayment * annuityFactor * timingFactor + initialAmount * growthFactor;
      const totalContributed = initialAmount + periodicPayment * periods;
      return calcOk({
        futureValue,
        totalContributed,
        growth: futureValue - totalContributed,
        periodicRate: i,
        periods,
      });
    },
  );
}
