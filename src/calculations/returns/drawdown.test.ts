import type { IsoDate, PricePoint } from '@/domain';

import { drawdownSeries, maxDrawdown, requiredRecovery } from './drawdown';
import { okValue } from '../core/testing';

const points = (...closes: number[]): PricePoint[] =>
  closes.map((close, index) => ({
    date: `2026-01-${String(index + 1).padStart(2, '0')}` as IsoDate,
    close,
  }));

describe('drawdownSeries', () => {
  it('csúcstól mért visszaesés minden napra', () => {
    expect(okValue(drawdownSeries([100, 120, 90, 60, 120, 130]))).toEqual([
      0,
      0,
      expect.closeTo(-0.25, 12),
      expect.closeTo(-0.5, 12),
      0,
      0,
    ]);
  });
  it('a lebegőpontos zaj nem ad hamis visszaesést', () => {
    // 0.1 + 0.2 = 0.30000000000000004 > 0.3 → a nyers hányados −1.1e-16 lenne
    expect(okValue(drawdownSeries([0.1 + 0.2, 0.3]))).toEqual([0, 0]);
  });
  it('kevés pont → INSUFFICIENT_DATA; nem pozitív/nem véges ár → INVALID_INPUT', () => {
    expect(drawdownSeries([100]).status).toBe('INSUFFICIENT_DATA');
    expect(drawdownSeries([100, 0]).status).toBe('INVALID_INPUT');
    expect(drawdownSeries([100, Number.NaN]).status).toBe('INVALID_INPUT');
  });
});

describe('maxDrawdown', () => {
  it('−50%, csúcs: 01-02, mélypont: 01-04, helyreállás: 01-05', () => {
    expect(okValue(maxDrawdown(points(100, 120, 90, 60, 120, 130)))).toEqual({
      maxDrawdown: expect.closeTo(-0.5, 12),
      peakDate: '2026-01-02',
      troughDate: '2026-01-04',
      recoveryDate: '2026-01-05',
    });
  });
  it('még nem állt helyre → recoveryDate: null', () => {
    expect(okValue(maxDrawdown(points(100, 80, 90)))).toEqual({
      maxDrawdown: expect.closeTo(-0.2, 12),
      peakDate: '2026-01-01',
      troughDate: '2026-01-02',
      recoveryDate: null,
    });
  });
  it('folyamatos emelkedés → 0 drawdown, nincs helyreállás', () => {
    const result = okValue(maxDrawdown(points(1, 2, 3)));
    expect(result.maxDrawdown).toBe(0);
    expect(result.recoveryDate).toBeNull();
  });
});

describe('requiredRecovery', () => {
  it.each([
    [-0.5, 1],
    [-0.2, 0.25],
    [0, 0],
  ])('DD = %p → szükséges visszapattanás %p', (drawdown, expected) => {
    expect(okValue(requiredRecovery({ drawdown }))).toBeCloseTo(expected, 12);
  });
  it('pozitív DD (előjelhiba) → INVALID_INPUT; −100% → NOT_MEANINGFUL; hiány → MISSING', () => {
    expect(requiredRecovery({ drawdown: 0.1 }).status).toBe('INVALID_INPUT');
    expect(requiredRecovery({ drawdown: -1 }).status).toBe('NOT_MEANINGFUL');
    expect(requiredRecovery({ drawdown: null }).status).toBe('MISSING');
  });
});
