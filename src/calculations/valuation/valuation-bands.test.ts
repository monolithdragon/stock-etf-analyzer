import {
  DEFAULT_MOS_THRESHOLDS,
  DEFAULT_MULTIPLE_BANDS,
  VALUATION_BAND_METRICS,
  VALUATION_THRESHOLD_DISCLAIMER,
  classifyMarginOfSafety,
  classifyMultipleBand,
} from './valuation-bands';
import { okValue } from '../core/testing';

describe('classifyMarginOfSafety', () => {
  it.each([
    [0.4, 'DISCOUNT_TO_MODEL'],
    [0.25, 'DISCOUNT_TO_MODEL'], // határ: ≥
    [0.2499, 'NEAR_MODEL'],
    [0, 'NEAR_MODEL'],
    [-0.1, 'NEAR_MODEL'], // határ: < premiumBelow → nem prémium
    [-0.1001, 'PREMIUM_TO_MODEL'],
    [-2, 'PREMIUM_TO_MODEL'],
  ] as const)('MOS %p → %s (alapküszöbök)', (mos, category) => {
    const r = okValue(classifyMarginOfSafety(mos));
    expect(r.category).toBe(category);
    expect(r.thresholds).toBe(DEFAULT_MOS_THRESHOLDS);
  });

  it('a küszöbök felülírhatók, és a kimenet a használt küszöböt adja vissza', () => {
    const custom = { discountAtLeast: 0.1, premiumBelow: 0 };
    const r = okValue(classifyMarginOfSafety(0.15, custom));
    expect(r).toEqual({ category: 'DISCOUNT_TO_MODEL', marginOfSafety: 0.15, thresholds: custom });
  });

  it('hiányzó MOS → MISSING; érvénytelen küszöbök → INVALID_INPUT', () => {
    expect(classifyMarginOfSafety(null).status).toBe('MISSING');
    expect(classifyMarginOfSafety(0.1, { discountAtLeast: 0, premiumBelow: 0.1 }).status).toBe(
      'INVALID_INPUT',
    );
    expect(classifyMarginOfSafety(0.1, { discountAtLeast: 1, premiumBelow: 0 }).status).toBe(
      'INVALID_INPUT',
    );
    expect(
      classifyMarginOfSafety(0.1, { discountAtLeast: Number.NaN, premiumBelow: 0 }).status,
    ).toBe('INVALID_INPUT');
  });
});

describe('classifyMultipleBand', () => {
  it.each([
    [10, 'LOW'],
    [15, 'MODERATE'], // határ: nem < 15
    [25, 'MODERATE'], // határ: nem > 25
    [25.01, 'HIGH'],
  ] as const)('P/E %p → %s', (value, band) => {
    expect(okValue(classifyMultipleBand(value, DEFAULT_MULTIPLE_BANDS.pe)).band).toBe(band);
  });

  it('nem pozitív szorzó → NOT_MEANINGFUL; FCF-hozamnál a negatív érték LOW', () => {
    expect(classifyMultipleBand(-5, DEFAULT_MULTIPLE_BANDS.pe).status).toBe('NOT_MEANINGFUL');
    const y = okValue(classifyMultipleBand(-0.02, DEFAULT_MULTIPLE_BANDS.fcfYield));
    expect(y.band).toBe('LOW');
    expect(y.thresholds.higherIsCheaper).toBe(true);
  });

  it('hiányzó érték → MISSING; fordított határ → INVALID_INPUT', () => {
    expect(classifyMultipleBand(undefined, DEFAULT_MULTIPLE_BANDS.ps).status).toBe('MISSING');
    expect(
      classifyMultipleBand(5, {
        lowBelow: 10,
        highAbove: 5,
        higherIsCheaper: false,
        allowNonPositive: false,
      }).status,
    ).toBe('INVALID_INPUT');
  });

  it('minden sávolt mutatónak van alapküszöbe; a nyilatkozat kimondja, hogy nem objektív', () => {
    for (const id of VALUATION_BAND_METRICS) {
      const t = DEFAULT_MULTIPLE_BANDS[id];
      expect(t.lowBelow).toBeLessThan(t.highAbove);
    }
    expect(VALUATION_THRESHOLD_DISCLAIMER).toContain('nem objektív igazságok');
  });
});
