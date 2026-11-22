import { cagr, cagrOverYears, degreeOfOperatingLeverage, growthRate } from './growth';
import { failureReason, okValue } from '../core/testing';

describe('growthRate', () => {
  it('(110 − 100) / 100 = 0.1', () => {
    expect(okValue(growthRate({ current: 110, previous: 100 }))).toBeCloseTo(0.1, 12);
  });
  it('pozitívról negatívra: −150% (OK); 0-ra: −100%', () => {
    expect(okValue(growthRate({ current: -50, previous: 100 }))).toBeCloseTo(-1.5, 12);
    expect(okValue(growthRate({ current: 0, previous: 100 }))).toBe(-1);
  });
  it('nullás bázisév → NOT_MEANINGFUL', () => {
    const result = growthRate({ current: 10, previous: 0 });
    expect(result.status).toBe('NOT_MEANINGFUL');
    expect(failureReason(result)).toContain('0');
  });
  it('negatív bázis → NOT_MEANINGFUL (nincs abszolútérték-trükk)', () => {
    expect(growthRate({ current: 1, previous: -1 }).status).toBe('NOT_MEANINGFUL');
  });
  it('hiányzó → MISSING', () => {
    expect(growthRate({ current: 1, previous: null }).status).toBe('MISSING');
  });
});

describe('cagr', () => {
  it('100 → 200 öt év alatt = 2^(1/5) − 1', () => {
    expect(okValue(cagr({ startValue: 100, endValue: 200, years: 5 }))).toBeCloseTo(
      2 ** 0.2 - 1,
      12,
    );
  });
  it('tört évszám is megengedett: 100 → 121 két év alatt = 10%', () => {
    expect(okValue(cagr({ startValue: 100, endValue: 121, years: 2 }))).toBeCloseTo(0.1, 12);
  });
  it.each([0, -1])('évek = %p → INVALID_INPUT', (years) => {
    expect(cagr({ startValue: 100, endValue: 200, years }).status).toBe('INVALID_INPUT');
  });
  it('nulla/negatív végpont → NOT_MEANINGFUL', () => {
    expect(cagr({ startValue: 0, endValue: 200, years: 5 }).status).toBe('NOT_MEANINGFUL');
    expect(cagr({ startValue: 100, endValue: -5, years: 5 }).status).toBe('NOT_MEANINGFUL');
  });
});

describe('cagrOverYears', () => {
  const series = [
    { fiscalYear: 2020, value: 100 },
    { fiscalYear: 2021, value: 110 },
    { fiscalYear: 2022, value: null },
    { fiscalYear: 2023, value: 133.1 },
    { fiscalYear: 2024, value: 146.41 },
    { fiscalYear: 2025, value: 161.051 },
  ];

  it('5 éves CAGR = 10% (a közbenső hiány nem számít)', () => {
    expect(okValue(cagrOverYears(series, 5))).toBeCloseTo(0.1, 10);
  });
  it('a sorrend nem számít; a legutolsó év a végpont', () => {
    expect(okValue(cagrOverYears([...series].reverse(), 2))).toBeCloseTo(0.1, 10);
  });
  it('hiányzó végpont-év vagy kevés év → INSUFFICIENT_DATA', () => {
    expect(cagrOverYears(series, 3).status).toBe('INSUFFICIENT_DATA'); // 2022 = null
    expect(cagrOverYears(series, 10).status).toBe('INSUFFICIENT_DATA');
    expect(cagrOverYears([], 1).status).toBe('INSUFFICIENT_DATA');
  });
  it('ismétlődő év vagy hibás évszám → INVALID_INPUT', () => {
    expect(cagrOverYears([...series, { fiscalYear: 2025, value: 1 }], 1).status).toBe(
      'INVALID_INPUT',
    );
    expect(cagrOverYears(series, 0).status).toBe('INVALID_INPUT');
    expect(cagrOverYears(series, 1.5).status).toBe('INVALID_INPUT');
  });
});

describe('degreeOfOperatingLeverage', () => {
  it('+20% üzemi eredmény / +10% árbevétel = 2.0', () => {
    expect(
      okValue(
        degreeOfOperatingLeverage({
          operatingIncomeCurrent: 120,
          operatingIncomePrevious: 100,
          revenueCurrent: 1100,
          revenuePrevious: 1000,
        }),
      ),
    ).toBeCloseTo(2, 10);
  });
  it('csökkenésnél is: −30% / −10% = 3.0', () => {
    expect(
      okValue(
        degreeOfOperatingLeverage({
          operatingIncomeCurrent: 70,
          operatingIncomePrevious: 100,
          revenueCurrent: 900,
          revenuePrevious: 1000,
        }),
      ),
    ).toBeCloseTo(3, 10);
  });
  it('1%-nál kisebb árbevétel-változás → NOT_MEANINGFUL', () => {
    expect(
      degreeOfOperatingLeverage({
        operatingIncomeCurrent: 120,
        operatingIncomePrevious: 100,
        revenueCurrent: 1005,
        revenuePrevious: 1000,
      }).status,
    ).toBe('NOT_MEANINGFUL');
  });
  it('veszteséges vagy nulla bázis → NOT_MEANINGFUL; hiány → MISSING', () => {
    const base = {
      operatingIncomeCurrent: 120,
      operatingIncomePrevious: 100,
      revenueCurrent: 1100,
      revenuePrevious: 1000,
    };
    expect(degreeOfOperatingLeverage({ ...base, operatingIncomePrevious: -10 }).status).toBe(
      'NOT_MEANINGFUL',
    );
    expect(degreeOfOperatingLeverage({ ...base, revenuePrevious: 0 }).status).toBe(
      'NOT_MEANINGFUL',
    );
    expect(degreeOfOperatingLeverage({ ...base, revenueCurrent: null }).status).toBe('MISSING');
  });
});
