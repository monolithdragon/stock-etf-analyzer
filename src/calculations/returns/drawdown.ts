/**
 * Drawdown (visszaesés a csúcstól) és a szükséges visszapattanás. DATA_DICTIONARY 5.5, D-058.
 *
 * DD_t = P_t / max(P_0..P_t) − 1  (≤ 0);  Max DD = min(DD_t).
 * Szükséges recovery = 1 / (1 + DD) − 1  (pl. −50% → +100%).
 * Az árak legyenek ugyanazon korrekciójú (lehetőleg `SPLIT` vagy `SPLIT_DIVIDEND`) sorozatból:
 * nyers árban egy split hamis visszaesést okoz.
 */
import type { IsoDate, PricePoint } from '@/domain';

import {
  calcInsufficientData,
  calcInvalidInput,
  calcNotMeaningful,
  calcOk,
  chainCalc,
  requireInputs,
  type CalcResult,
  type NumericInput,
} from '../core/calc-result';
import { snapToZero } from '../core/numeric';

function validatePrices(values: readonly number[]): CalcResult<readonly number[]> {
  if (values.length < 2) return calcInsufficientData('A drawdownhoz legalább 2 árpont kell.');
  const badIndex = values.findIndex((value) => !Number.isFinite(value) || value <= 0);
  return badIndex >= 0
    ? calcInvalidInput(`Érvénytelen ár a(z) ${badIndex}. pozíción (${values[badIndex]}); > 0 kell.`)
    : calcOk(values);
}

/** Drawdown-sorozat az árak sorrendjében (az első elem mindig 0). */
export function drawdownSeries(prices: readonly number[]): CalcResult<readonly number[]> {
  return chainCalc(validatePrices(prices), (values) => {
    let peak = -Infinity;
    return calcOk(
      values.map((price) => {
        peak = Math.max(peak, price);
        return snapToZero(price / peak - 1);
      }),
    );
  });
}

export interface MaxDrawdown {
  /** A legnagyobb visszaesés (≤ 0; 0 = soha nem esett a csúcs alá). */
  readonly maxDrawdown: number;
  readonly peakDate: IsoDate;
  readonly troughDate: IsoDate;
  /** Az első nap, amikor az ár újra elérte a csúcsot; `null`, ha még nem állt helyre. */
  readonly recoveryDate: IsoDate | null;
}

/** Maximális drawdown dátumokkal egy (dátum szerint növekvő) ártörténetből. */
export function maxDrawdown(points: readonly PricePoint[]): CalcResult<MaxDrawdown> {
  return chainCalc(
    drawdownSeries(points.map((point) => point.close)),
    (series): CalcResult<MaxDrawdown> => {
      let troughIndex = 0;
      series.forEach((value, index) => {
        if (value < (series[troughIndex] as number)) troughIndex = index;
      });
      // A csúcs: a mélypont előtti utolsó 0 drawdownú nap.
      let peakIndex = troughIndex;
      while (peakIndex > 0 && (series[peakIndex] as number) < 0) peakIndex -= 1;
      const recoveryIndex = series.findIndex((value, index) => index > troughIndex && value === 0);
      const at = (index: number) => (points[index] as PricePoint).date;
      return calcOk({
        maxDrawdown: series[troughIndex] as number,
        peakDate: at(peakIndex),
        troughDate: at(troughIndex),
        recoveryDate: series[troughIndex] === 0 || recoveryIndex < 0 ? null : at(recoveryIndex),
      });
    },
  );
}

/**
 * Szükséges visszapattanás a csúcs eléréséhez = 1 / (1 + DD) − 1.
 * - DD > 0 → `INVALID_INPUT` (a drawdown definíció szerint ≤ 0; tipikus előjelhiba);
 * - DD ≤ −1 → `NOT_MEANINGFUL` (−100%-ról nincs visszapattanás: végtelen).
 */
export function requiredRecovery(input: { readonly drawdown: NumericInput }): CalcResult<number> {
  return chainCalc(requireInputs(input), ({ drawdown }) => {
    if (drawdown > 0) {
      return calcInvalidInput(`A drawdown nem lehet pozitív (${drawdown}); pl. −0.5 = −50%.`);
    }
    if (drawdown <= -1) {
      return calcNotMeaningful(
        '−100%-os visszaesésből nincs visszapattanás (végtelen hozam kellene).',
      );
    }
    return calcOk(snapToZero(1 / (1 + drawdown) - 1));
  });
}
