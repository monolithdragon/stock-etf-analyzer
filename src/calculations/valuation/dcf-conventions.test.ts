import { discountFactor, gordonTerminalValue, presentValue } from './dcf-conventions';
import { failureReason, okValue } from '../core/testing';

describe('discountFactor', () => {
  it('1 / (1 + r)^t, év végi konvenció; t = 0 → 1; tört periódus megengedett', () => {
    expect(okValue(discountFactor({ discountRate: 0.1, period: 1 }))).toBeCloseTo(1 / 1.1, 12);
    expect(okValue(discountFactor({ discountRate: 0.1, period: 0 }))).toBe(1);
    expect(okValue(discountFactor({ discountRate: 0.1, period: 0.5 }))).toBeCloseTo(
      1 / Math.sqrt(1.1),
      12,
    );
  });
  it('r ≤ 0, százalékban megadott ráta (10), negatív periódus → INVALID_INPUT', () => {
    expect(discountFactor({ discountRate: 0, period: 1 }).status).toBe('INVALID_INPUT');
    const percent = discountFactor({ discountRate: 10, period: 1 });
    expect(percent.status).toBe('INVALID_INPUT');
    expect(failureReason(percent)).toContain('tizedes tört');
    expect(discountFactor({ discountRate: 0.1, period: -1 }).status).toBe('INVALID_INPUT');
  });
});

describe('presentValue', () => {
  it('110 egy év múlva 10%-on = 100; negatív pénzáram is diszkontálható', () => {
    expect(okValue(presentValue({ cashFlow: 110, discountRate: 0.1, period: 1 }))).toBeCloseTo(
      100,
      10,
    );
    expect(okValue(presentValue({ cashFlow: -110, discountRate: 0.1, period: 1 }))).toBeCloseTo(
      -100,
      10,
    );
  });
  it('hiányzó pénzáram → MISSING', () => {
    expect(presentValue({ cashFlow: null, discountRate: 0.1, period: 1 }).status).toBe('MISSING');
  });
});

describe('gordonTerminalValue', () => {
  it('TV = 100 × 1.02 / (0.10 − 0.02) = 1275', () => {
    expect(
      okValue(
        gordonTerminalValue({ finalYearCashFlow: 100, discountRate: 0.1, terminalGrowth: 0.02 }),
      ),
    ).toBeCloseTo(1275, 9);
  });
  it.each([0.1, 0.12])('r ≤ g (g = %p) → INVALID_INPUT emberi magyarázattal', (g) => {
    const result = gordonTerminalValue({
      finalYearCashFlow: 100,
      discountRate: 0.1,
      terminalGrowth: g,
    });
    expect(result.status).toBe('INVALID_INPUT');
    expect(failureReason(result)).toContain('Gordon');
  });
  it('g ≤ −1 vagy hiányzó bemenet', () => {
    expect(
      gordonTerminalValue({ finalYearCashFlow: 100, discountRate: 0.1, terminalGrowth: -1 }).status,
    ).toBe('INVALID_INPUT');
    expect(
      gordonTerminalValue({ finalYearCashFlow: null, discountRate: 0.1, terminalGrowth: 0.02 })
        .status,
    ).toBe('MISSING');
  });
});
