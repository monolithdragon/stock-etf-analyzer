import type { IsoDate, PricePoint } from '@/domain';

import {
  RISK_MIN_OBSERVATIONS,
  RISK_STANDARD_OBSERVATIONS,
  TRADING_DAYS_PER_YEAR,
  riskReliability,
  alignByDate,
  annualizedVolatility,
  beta,
  downsideDeviation,
  periodicReturns,
  sharpeRatio,
  sortinoRatio,
} from './risk';

const point = (date: string, close: number): PricePoint => ({ date: date as IsoDate, close });

describe('periodicReturns', () => {
  it('egyszerű periódushozamok', () => {
    const result = periodicReturns([100, 110, 99]);
    expect(result.status).toBe('OK');
    if (result.status === 'OK') {
      expect(result.value[0]).toBeCloseTo(0.1, 12);
      expect(result.value[1]).toBeCloseTo(-0.1, 12);
    }
  });

  it('kevés ár → INSUFFICIENT_DATA; nem pozitív ár → INVALID_INPUT', () => {
    expect(periodicReturns([100]).status).toBe('INSUFFICIENT_DATA');
    expect(periodicReturns([100, 0, 5]).status).toBe('INVALID_INPUT');
    expect(periodicReturns([100, Number.NaN]).status).toBe('INVALID_INPUT');
  });
});

describe('alignByDate', () => {
  it('csak a közös dátumok maradnak (eltérő ünnepnapok)', () => {
    const a = [point('2026-01-02', 1), point('2026-01-05', 2), point('2026-01-06', 3)];
    const b = [point('2026-01-02', 10), point('2026-01-06', 30), point('2026-01-07', 40)];
    expect(alignByDate(a, b)).toEqual({
      dates: ['2026-01-02', '2026-01-06'],
      first: [1, 3],
      second: [10, 30],
    });
  });
});

describe('annualizedVolatility', () => {
  it('minta szórás × √periódusszám (kézzel: [0.01, −0.01] → s = 0.014142…)', () => {
    const result = annualizedVolatility({
      returns: [0.01, -0.01],
      periodsPerYear: TRADING_DAYS_PER_YEAR,
      minObservations: 2,
    });
    expect(result.status).toBe('OK');
    if (result.status === 'OK')
      expect(result.value).toBeCloseTo(Math.SQRT2 * 0.01 * Math.sqrt(252), 12);
  });

  it('kevés megfigyelés → INSUFFICIENT_DATA (indokkal); rossz paraméter → INVALID_INPUT', () => {
    const short = annualizedVolatility({
      returns: [0.01, 0.02],
      periodsPerYear: 252,
      minObservations: 126,
    });
    expect(short.status).toBe('INSUFFICIENT_DATA');
    expect(short.status !== 'OK' && short.reason).toContain('126');
    expect(
      annualizedVolatility({ returns: [0.1, 0.2], periodsPerYear: 0, minObservations: 2 }).status,
    ).toBe('INVALID_INPUT');
    expect(
      annualizedVolatility({ returns: [0.1, 0.2], periodsPerYear: 252, minObservations: 1 }).status,
    ).toBe('INVALID_INPUT');
    expect(
      annualizedVolatility({ returns: [0.1, Infinity], periodsPerYear: 252, minObservations: 2 })
        .status,
    ).toBe('INVALID_INPUT');
  });
});

describe('downsideDeviation', () => {
  it('MAR = 0: √(Σ min(0, r)² / N) × √m – az N az összes megfigyelés', () => {
    // [0.02, −0.01, −0.03, 0.04] → (0.0001 + 0.0009) / 4 = 0.00025 → √ = 0.0158114
    const result = downsideDeviation({
      returns: [0.02, -0.01, -0.03, 0.04],
      periodsPerYear: 12,
      minimumAcceptableReturn: 0,
      minObservations: 2,
    });
    expect(result.status).toBe('OK');
    if (result.status === 'OK')
      expect(result.value).toBeCloseTo(Math.sqrt(0.00025) * Math.sqrt(12), 12);
  });

  it('pozitív MAR a periódusra váltva (1 periódus/év → MAR változatlan)', () => {
    const result = downsideDeviation({
      returns: [0.05, 0.01],
      periodsPerYear: 1,
      minimumAcceptableReturn: 0.03,
      minObservations: 2,
    });
    // csak 0.01 van a 0.03 alatt: (−0.02)² / 2 = 0.0002
    expect(result.status === 'OK' && result.value).toBeCloseTo(Math.sqrt(0.0002), 12);
  });

  it('érvénytelen küszöb és kevés adat', () => {
    expect(
      downsideDeviation({
        returns: [0.1, 0.2],
        periodsPerYear: 12,
        minimumAcceptableReturn: -1,
        minObservations: 2,
      }).status,
    ).toBe('INVALID_INPUT');
    expect(
      downsideDeviation({
        returns: [0.1, 0.2],
        periodsPerYear: 12,
        minimumAcceptableReturn: Number.NaN,
        minObservations: 2,
      }).status,
    ).toBe('INVALID_INPUT');
    expect(
      downsideDeviation({
        returns: [0.1],
        periodsPerYear: 12,
        minimumAcceptableReturn: 0,
        minObservations: 2,
      }).status,
    ).toBe('INSUFFICIENT_DATA');
  });
});

describe('sharpeRatio / sortinoRatio', () => {
  it('(hozam − rf) / kockázat', () => {
    expect(sharpeRatio({ annualReturn: 0.08, riskFreeRate: 0.02, annualVolatility: 0.15 })).toEqual(
      expect.objectContaining({ status: 'OK', value: expect.closeTo(0.4, 12) }),
    );
    expect(
      sortinoRatio({ annualReturn: 0.08, riskFreeRate: 0.02, downsideDeviation: 0.1 }),
    ).toEqual(expect.objectContaining({ status: 'OK', value: expect.closeTo(0.6, 12) }));
  });

  it('nulla kockázat → NOT_MEANINGFUL; negatív → INVALID_INPUT; hiányzó rf → MISSING', () => {
    expect(
      sharpeRatio({ annualReturn: 0.08, riskFreeRate: 0.02, annualVolatility: 0 }).status,
    ).toBe('NOT_MEANINGFUL');
    expect(
      sharpeRatio({ annualReturn: 0.08, riskFreeRate: 0.02, annualVolatility: -0.1 }).status,
    ).toBe('INVALID_INPUT');
    expect(
      sharpeRatio({ annualReturn: 0.08, riskFreeRate: null, annualVolatility: 0.1 }).status,
    ).toBe('MISSING');
    expect(
      sortinoRatio({ annualReturn: 0.08, riskFreeRate: 0.02, downsideDeviation: 0 }).status,
    ).toBe('NOT_MEANINGFUL');
    expect(
      sortinoRatio({ annualReturn: 0.08, riskFreeRate: 0.02, downsideDeviation: -1 }).status,
    ).toBe('INVALID_INPUT');
  });
});

describe('beta', () => {
  it('kétszeres tőkeáttétel → béta 2, korreláció 1', () => {
    const bench = [0.01, -0.02, 0.015, 0.005, -0.01];
    const result = beta({
      assetReturns: bench.map((r) => 2 * r),
      benchmarkReturns: bench,
      minObservations: 3,
    });
    expect(result.status).toBe('OK');
    if (result.status === 'OK') {
      expect(result.value.beta).toBeCloseTo(2, 12);
      expect(result.value.correlation).toBeCloseTo(1, 12);
      expect(result.value.observations).toBe(5);
    }
  });

  it('eltérő hossz → INVALID_INPUT; állandó benchmark → NOT_MEANINGFUL; kevés → INSUFFICIENT_DATA', () => {
    expect(
      beta({ assetReturns: [0.1, 0.2], benchmarkReturns: [0.1], minObservations: 2 }).status,
    ).toBe('INVALID_INPUT');
    expect(
      beta({
        assetReturns: [0.1, 0.2, 0.3],
        benchmarkReturns: [0.01, 0.01, 0.01],
        minObservations: 2,
      }).status,
    ).toBe('NOT_MEANINGFUL');
    expect(
      beta({ assetReturns: [0.1, 0.2], benchmarkReturns: [0.1, 0.3], minObservations: 10 }).status,
    ).toBe('INSUFFICIENT_DATA');
  });

  it('állandó eszközhozam → béta 0, korreláció 0', () => {
    const result = beta({
      assetReturns: [0.01, 0.01, 0.01],
      benchmarkReturns: [0.01, 0.02, 0.03],
      minObservations: 2,
    });
    expect(result.status === 'OK' && result.value).toEqual({
      beta: 0,
      correlation: 0,
      observations: 3,
    });
  });
});

describe('riskReliability (D-070)', () => {
  it('a küszöbök: minimum 126, standard 240 (egy év ünnepnapokkal is átlépi)', () => {
    expect(RISK_MIN_OBSERVATIONS).toBe(126);
    expect(RISK_STANDARD_OBSERVATIONS).toBe(240);
    expect(RISK_STANDARD_OBSERVATIONS).toBeLessThan(TRADING_DAYS_PER_YEAR);
  });

  it('240-től standard, alatta rövid ablak', () => {
    expect(riskReliability(126)).toBe('short_window');
    expect(riskReliability(239)).toBe('short_window');
    expect(riskReliability(240)).toBe('standard');
    expect(riskReliability(251)).toBe('standard');
    expect(riskReliability(756)).toBe('standard');
  });
});
