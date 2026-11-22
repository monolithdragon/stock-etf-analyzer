/**
 * Teszt-segédek a számítási motorhoz (csak tesztekből importáljuk; az `index.ts` nem exportálja).
 */
import type { CalcResult } from './calc-result';

/** Az `OK` eredmény értéke; nem-OK esetén érthető hibaüzenettel bukik a teszt. */
export function okValue<T>(result: CalcResult<T>): T {
  if (result.status !== 'OK') {
    throw new Error(`OK eredményt vártunk, de ${result.status}: ${result.reason}`);
  }
  return result.value;
}

/** Az `OK` eredmény megjegyzései. */
export function okNotes<T>(result: CalcResult<T>): readonly string[] {
  if (result.status !== 'OK') {
    throw new Error(`OK eredményt vártunk, de ${result.status}: ${result.reason}`);
  }
  return result.notes;
}

/** A nem-OK eredmény indoka (OK esetén hibával bukik). */
export function failureReason<T>(result: CalcResult<T>): string {
  if (result.status === 'OK') throw new Error('Hibát vártunk, de OK lett.');
  return result.reason;
}
