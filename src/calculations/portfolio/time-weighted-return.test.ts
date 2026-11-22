import type { IsoDate } from '@/domain';

import { timeWeightedReturn, type PortfolioDayValue } from './time-weighted-return';
import { failureReason, okNotes, okValue } from '../core/testing';

const day = (date: string, value: number, netFlow = 0, income = 0): PortfolioDayValue => ({
  date: date as IsoDate,
  value,
  netFlow,
  income,
});

describe('timeWeightedReturn (D-072)', () => {
  it('a befizetés nem hozam; az osztalék igen (kézzel ellenőrizve)', () => {
    const result = okValue(
      timeWeightedReturn([
        day('2026-01-01', 1000, 1000), // nyitó vétel
        day('2026-01-02', 1100), // +10%
        day('2026-01-03', 2100, 1000), // +1000 befizetés, 0% hozam
        day('2026-01-04', 1890), // −10%
        day('2026-01-05', 945, -945, 10), // fele eladva + 10 osztalék → 1900/1890 − 1
      ]),
    );
    const values = result.returns.map((r) => r.value);
    expect(values[0]).toBeCloseTo(0.1, 12);
    expect(values[1]).toBe(0);
    expect(values[2]).toBeCloseTo(-0.1, 12);
    expect(values[3]).toBeCloseTo(1900 / 1890 - 1, 12);
    // 1,1 × 1 × 0,9 × 1900/1890 − 1 = 1881/1890 − 1
    expect(result.cumulativeReturn).toBeCloseTo(1881 / 1890 - 1, 12);
    expect(result.index[0]).toEqual({ date: '2026-01-01', close: 1 });
    expect(result.index.at(-1)?.close).toBeCloseTo(1881 / 1890, 12);
  });

  it('üres portfólió utáni nap nem hozam-megfigyelés (nincs kockáztatott tőke)', () => {
    const result = timeWeightedReturn([
      day('2026-01-01', 0),
      day('2026-01-02', 1000, 1000),
      day('2026-01-03', 1050),
    ]);
    const value = okValue(result);
    expect(value.returns).toHaveLength(1);
    expect(value.uninvestedDays).toBe(1);
    expect(value.cumulativeReturn).toBeCloseTo(0.05, 12);
    expect(okNotes(result)[0]).toContain('üres');
  });

  it('ellentmondó pénzmozgás (a mozgás előtti érték negatív) → INVALID_INPUT', () => {
    const result = timeWeightedReturn([day('2026-01-01', 100), day('2026-01-02', 100, 500)]);
    expect(failureReason(result)).toContain('ellentmond');
  });

  it.each([
    ['kevés nap', [day('2026-01-01', 1)]],
    ['csak üres napok', [day('2026-01-01', 0), day('2026-01-02', 0)]],
  ])('%s → INSUFFICIENT_DATA', (_label, days) => {
    expect(timeWeightedReturn(days).status).toBe('INSUFFICIENT_DATA');
  });

  it.each([
    ['nem növekvő dátum', [day('2026-01-02', 1), day('2026-01-01', 1)]],
    ['negatív érték', [day('2026-01-01', 1), day('2026-01-02', -1)]],
    ['NaN', [day('2026-01-01', 1), day('2026-01-02', Number.NaN)]],
  ])('%s → INVALID_INPUT', (_label, days) => {
    expect(timeWeightedReturn(days).status).toBe('INVALID_INPUT');
  });
});
