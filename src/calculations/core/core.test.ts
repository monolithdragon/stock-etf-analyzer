import {
  calcInsufficientData,
  calcNotApplicable,
  calcOk,
  chainCalc,
  isCalcOk,
  mapCalc,
  requireInputs,
} from './calc-result';
import {
  approximatelyEqual,
  decimalToPercentagePoints,
  firstFailure,
  mean,
  mustBeInRange,
  percentToDecimal,
  sampleStandardDeviation,
  snapToZero,
} from './numeric';
import { failureReason, okNotes, okValue } from './testing';

describe('calcOk – biztonsági háló', () => {
  it('véges számot OK-ként ad vissza, üres megjegyzéssel', () => {
    const result = calcOk(5);
    expect(okValue(result)).toBe(5);
    expect(okNotes(result)).toEqual([]);
  });

  it.each([Number.NaN, Infinity, -Infinity])('%p → INVALID_INPUT (soha nem OK)', (value) => {
    expect(calcOk(value).status).toBe('INVALID_INPUT');
  });

  it('objektumban és tömbben is észreveszi a nem véges számot', () => {
    expect(calcOk({ a: 1, b: { c: Number.NaN } }).status).toBe('INVALID_INPUT');
    expect(calcOk([1, Infinity]).status).toBe('INVALID_INPUT');
    expect(calcOk({ a: 'szöveg', b: null }).status).toBe('OK');
  });
});

describe('requireInputs', () => {
  it('a hiányzó bemenet MISSING (minden hiányzó nevével), a 0 érvényes érték', () => {
    expect(okValue(requireInputs({ a: 0, b: -3 }))).toEqual({ a: 0, b: -3 });
    const missing = requireInputs({ a: null, b: undefined, c: 1 });
    expect(missing.status).toBe('MISSING');
    expect(failureReason(missing)).toContain('a, b');
  });

  it('a nem véges szám erősebb hiba, mint a hiány', () => {
    const result = requireInputs({ a: null, b: Number.NaN });
    expect(result.status).toBe('INVALID_INPUT');
    expect(failureReason(result)).toContain('b=NaN');
  });
});

describe('mapCalc / chainCalc', () => {
  it('a megjegyzések megmaradnak és összeadódnak', () => {
    const first = calcOk(2, ['egy']);
    expect(okNotes(mapCalc(first, (v) => v * 2))).toEqual(['egy']);
    const chained = chainCalc(first, (v) => calcOk(v + 1, ['kettő']));
    expect(okValue(chained)).toBe(3);
    expect(okNotes(chained)).toEqual(['egy', 'kettő']);
  });

  it('a hibát változatlanul továbbítja', () => {
    const failed = calcNotApplicable('ETF-re nem értelmezett');
    expect(mapCalc(failed, (v: number) => v)).toBe(failed);
    expect(chainCalc(failed, (v: number) => calcOk(v))).toBe(failed);
    expect(chainCalc(calcOk(1, ['x']), () => calcInsufficientData('kevés')).status).toBe(
      'INSUFFICIENT_DATA',
    );
    expect(isCalcOk(failed)).toBe(false);
  });
});

describe('numerikus konvenciók', () => {
  it('snapToZero: a lebegőpontos zaj 0 lesz (−0 sem marad)', () => {
    expect(Object.is(snapToZero(-1e-15), 0)).toBe(true);
    expect(snapToZero(1e-6)).toBe(1e-6);
  });

  it('százalék ↔ tört átváltás', () => {
    expect(percentToDecimal(15)).toBeCloseTo(0.15, 12);
    expect(decimalToPercentagePoints(0.15)).toBeCloseTo(15, 12);
  });

  it('átlag és minta szórás (n − 1)', () => {
    expect(mean([1, 2, 3])).toBe(2);
    // Ismert példa: 2,4,4,4,5,5,7,9 → minta szórás √(32/7)
    expect(sampleStandardDeviation([2, 4, 4, 4, 5, 5, 7, 9])).toBeCloseTo(Math.sqrt(32 / 7), 12);
    expect(sampleStandardDeviation([1])).toBeNaN();
  });

  it('tartomány- és tűrés-ellenőrzés', () => {
    expect(approximatelyEqual(0.1 + 0.2, 0.3, 1e-12)).toBe(true);
    expect(mustBeInRange('x', 2, 0, 1, 'tipp')?.reason).toContain('tipp');
    expect(mustBeInRange('x', 0.5, 0, 1)).toBeNull();
    expect(firstFailure(null, null)).toBeNull();
  });
});
