import { parseCurrencyCode, type Money } from '@/domain';

import { portfolioWeights, weightedReturn } from './portfolio-basics';
import { failureReason, okNotes, okValue } from '../core/testing';

const money = (amount: number, currency = 'EUR'): Money => {
  const code = parseCurrencyCode(currency);
  if (!code.ok) throw new Error(currency);
  return { amount, currency: code.value };
};

describe('portfolioWeights', () => {
  it('súly = érték / árazott összérték; az ár nélküli pozíció kimarad (nem 0 súllyal)', () => {
    const result = portfolioWeights([
      { id: 'A', value: money(600) },
      { id: 'B', value: money(400) },
      { id: 'C', value: null },
    ]);
    expect(okValue(result)).toEqual({
      currency: 'EUR',
      totalValue: 1000,
      weights: [
        { id: 'A', weight: 0.6 },
        { id: 'B', weight: 0.4 },
      ],
      unpriced: ['C'],
    });
    expect(okNotes(result)[0]).toContain('nem 0 súllyal');
  });
  it('a 0 értékű pozíció érvényes, 0 súllyal', () => {
    const result = okValue(
      portfolioWeights([
        { id: 'A', value: money(100) },
        { id: 'B', value: money(0) },
      ]),
    );
    expect(result.weights).toEqual([
      { id: 'A', weight: 1 },
      { id: 'B', weight: 0 },
    ]);
  });
  it('eltérő pénznem (FX előbb) → INVALID_INPUT', () => {
    const result = portfolioWeights([
      { id: 'A', value: money(100, 'EUR') },
      { id: 'B', value: money(100, 'USD') },
    ]);
    expect(result.status).toBe('INVALID_INPUT');
    expect(failureReason(result)).toContain('kijelzési pénznem');
  });
  it('hibás esetek', () => {
    expect(portfolioWeights([]).status).toBe('INSUFFICIENT_DATA');
    expect(portfolioWeights([{ id: 'A', value: null }]).status).toBe('MISSING');
    expect(portfolioWeights([{ id: 'A', value: money(-5) }]).status).toBe('INVALID_INPUT');
    expect(portfolioWeights([{ id: 'A', value: money(Number.NaN) }]).status).toBe('INVALID_INPUT');
    expect(portfolioWeights([{ id: 'A', value: money(0) }]).status).toBe('NOT_MEANINGFUL');
    expect(
      portfolioWeights([
        { id: 'A', value: money(1) },
        { id: 'A', value: money(2) },
      ]).status,
    ).toBe('INVALID_INPUT');
  });
});

describe('weightedReturn', () => {
  it('0.6 × 10% + 0.4 × 5% = 8%', () => {
    expect(
      okValue(
        weightedReturn([
          { id: 'A', weight: 0.6, return: 0.1 },
          { id: 'B', weight: 0.4, return: 0.05 },
        ]),
      ),
    ).toBeCloseTo(0.08, 12);
  });
  it('kerekített súlyok (1/3) összege tűrésen belül', () => {
    expect(
      weightedReturn([
        { id: 'A', weight: 1 / 3, return: 0.03 },
        { id: 'B', weight: 1 / 3, return: 0.06 },
        { id: 'C', weight: 1 / 3, return: 0.09 },
      ]).status,
    ).toBe('OK');
  });
  it('százalékban megadott súly (60 + 40) → INVALID_INPUT, utalással', () => {
    const result = weightedReturn([
      { id: 'A', weight: 60, return: 0.1 },
      { id: 'B', weight: 40, return: 0.05 },
    ]);
    expect(result.status).toBe('INVALID_INPUT');
    expect(failureReason(result)).toContain('százalék');
  });
  it('hibás esetek', () => {
    expect(weightedReturn([]).status).toBe('INSUFFICIENT_DATA');
    expect(weightedReturn([{ id: 'A', weight: 0.9, return: 0.1 }]).status).toBe('INVALID_INPUT');
    expect(
      weightedReturn([
        { id: 'A', weight: 1.5, return: 0.1 },
        { id: 'B', weight: -0.5, return: 0.1 },
      ]).status,
    ).toBe('INVALID_INPUT');
    expect(weightedReturn([{ id: 'A', weight: 1, return: Number.NaN }]).status).toBe(
      'INVALID_INPUT',
    );
    const missing = weightedReturn([
      { id: 'A', weight: 0.5, return: 0.1 },
      { id: 'B', weight: 0.5, return: null },
    ]);
    expect(missing.status).toBe('MISSING');
    expect(failureReason(missing)).toContain('B');
  });
});
