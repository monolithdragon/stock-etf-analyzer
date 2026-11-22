import {
  annualTerCost,
  terLongTermImpact,
  trackingDifference,
  trackingError,
} from './costs-tracking';
import { failureReason, okValue } from '../core/testing';

describe('TER költség', () => {
  it('10 000 × 0.22% = 22 / év; TER 0 → 0', () => {
    expect(okValue(annualTerCost({ investedAmount: 10_000, ter: 0.0022 }))).toBeCloseTo(22, 10);
    expect(okValue(annualTerCost({ investedAmount: 10_000, ter: 0 }))).toBe(0);
  });
  it('százalékban megadott TER (0.22 = 22%!) → INVALID_INPUT; negatív összeg → INVALID_INPUT', () => {
    const percent = annualTerCost({ investedAmount: 10_000, ter: 0.22 });
    expect(percent.status).toBe('INVALID_INPUT');
    expect(failureReason(percent)).toContain('tizedes tört');
    expect(annualTerCost({ investedAmount: -1, ter: 0.002 }).status).toBe('INVALID_INPUT');
  });

  it('hosszú távú hatás: (1 + r − TER)^n vs (1 + r)^n', () => {
    const impact = okValue(
      terLongTermImpact({ initialAmount: 10_000, annualGrossReturn: 0.07, ter: 0.002, years: 30 }),
    );
    expect(impact.futureValueWithoutCost).toBeCloseTo(10_000 * 1.07 ** 30, 6);
    expect(impact.futureValueWithCost).toBeCloseTo(10_000 * 1.068 ** 30, 6);
    expect(impact.costAmount).toBeCloseTo(
      impact.futureValueWithoutCost - impact.futureValueWithCost,
      6,
    );
    expect(impact.costShare).toBeCloseTo(1 - (1.068 / 1.07) ** 30, 12);
  });
  it('hosszú távú hatás: érvénytelen bemenetek', () => {
    const base = { initialAmount: 10_000, annualGrossReturn: 0.07, ter: 0.002, years: 30 };
    expect(terLongTermImpact({ ...base, years: 0 }).status).toBe('INVALID_INPUT');
    expect(terLongTermImpact({ ...base, ter: 0.5 }).status).toBe('INVALID_INPUT');
    expect(terLongTermImpact({ ...base, annualGrossReturn: 7 }).status).toBe('INVALID_INPUT');
    expect(terLongTermImpact({ ...base, initialAmount: 0 }).status).toBe('INVALID_INPUT');
    expect(terLongTermImpact({ ...base, annualGrossReturn: -0.995, ter: 0.01 }).status).toBe(
      'INVALID_INPUT',
    );
  });
});

describe('tracking difference', () => {
  it('9.5% − 10% = −0.5%', () => {
    expect(okValue(trackingDifference({ fundReturn: 0.095, indexReturn: 0.1 }))).toBeCloseTo(
      -0.005,
      12,
    );
  });
  it('−100% alatti hozam → INVALID_INPUT; hiány → MISSING', () => {
    expect(trackingDifference({ fundReturn: -2, indexReturn: 0.1 }).status).toBe('INVALID_INPUT');
    expect(trackingDifference({ fundReturn: 0.1, indexReturn: -1.5 }).status).toBe('INVALID_INPUT');
    expect(trackingDifference({ fundReturn: 0.1, indexReturn: null }).status).toBe('MISSING');
  });
});

describe('tracking error', () => {
  it('havi különbségek minta szórása × √12 = 0.6%', () => {
    // különbségek: −0.002, 0.002, 0.001, 0.001 → minta szórás √3e-6 → × √12 = 0.006
    expect(
      okValue(
        trackingError({
          fundReturns: [0.01, 0.02, -0.01, 0.005],
          indexReturns: [0.012, 0.018, -0.011, 0.004],
          periodsPerYear: 12,
        }),
      ),
    ).toBeCloseTo(0.006, 12);
  });
  it('tökéletes követés → 0', () => {
    expect(
      okValue(
        trackingError({
          fundReturns: [0.01, 0.02],
          indexReturns: [0.01, 0.02],
          periodsPerYear: 252,
        }),
      ),
    ).toBe(0);
  });
  it('eltérő hossz, kevés periódus, hibás periódusszám, NaN', () => {
    expect(
      trackingError({ fundReturns: [0.01], indexReturns: [0.01, 0.02], periodsPerYear: 12 }).status,
    ).toBe('INVALID_INPUT');
    expect(
      trackingError({ fundReturns: [0.01], indexReturns: [0.01], periodsPerYear: 12 }).status,
    ).toBe('INSUFFICIENT_DATA');
    expect(
      trackingError({ fundReturns: [0.01, 0.02], indexReturns: [0.01, 0.02], periodsPerYear: 0 })
        .status,
    ).toBe('INVALID_INPUT');
    expect(
      trackingError({
        fundReturns: [0.01, Number.NaN],
        indexReturns: [0.01, 0.02],
        periodsPerYear: 12,
      }).status,
    ).toBe('INVALID_INPUT');
  });
});
