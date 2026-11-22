import { holdingsOverlap } from './overlap';
import { okNotes, okValue } from '../core/testing';

describe('holdingsOverlap (D-072)', () => {
  it('Σ min(w_A, w_B) a közös ISIN-ekre; ISIN nélküli tétel nem párosítható', () => {
    const result = holdingsOverlap({
      a: [
        { key: 'X', weight: 0.3 },
        { key: 'Y', weight: 0.2 },
        { key: null, weight: 0.1 },
      ],
      b: [
        { key: 'X', weight: 0.1 },
        { key: 'Z', weight: 0.4 },
        { key: 'Y', weight: 0.15 },
        { key: 'Y', weight: 0.1 }, // ugyanaz az ISIN két sorban → összeadódik
      ],
      bothComplete: false,
    });
    const value = okValue(result);
    expect(value.overlapWeight).toBeCloseTo(0.3, 12); // min(.3,.1) + min(.2,.25)
    expect(value.commonCount).toBe(2);
    expect(value.common[0]?.key).toBe('Y');
    expect(value.unmatchableWeightA).toBeCloseTo(0.1, 12);
    expect(okNotes(result).join(' ')).toContain('alsó becslés');
  });

  it('azonos összetétel → 1; negatív (short) súly kimarad', () => {
    const items = [
      { key: 'A', weight: 0.5 },
      { key: 'B', weight: 0.5 },
      { key: 'C', weight: -0.1 },
    ];
    const value = okValue(holdingsOverlap({ a: items, b: items, bothComplete: true }));
    expect(value.overlapWeight).toBeCloseTo(1, 12);
  });

  it('üres oldal → INSUFFICIENT_DATA; százalékos súly → INVALID_INPUT', () => {
    expect(
      holdingsOverlap({ a: [], b: [{ key: 'A', weight: 1 }], bothComplete: true }).status,
    ).toBe('INSUFFICIENT_DATA');
    expect(
      holdingsOverlap({
        a: [{ key: 'A', weight: 30 }],
        b: [{ key: 'A', weight: 1 }],
        bothComplete: true,
      }).status,
    ).toBe('INVALID_INPUT');
  });
});
