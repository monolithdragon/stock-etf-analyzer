import type { CurrencyCode } from './currency';
import { AppErrors } from './errors';
import { err, ok, type Result } from './result';
import { invalid } from './validation';

/**
 * Pénzösszeg fő egységben (pl. USD, nem cent), JS `number` (D-009).
 * Kerekítés csak megjelenítéskor. Különböző pénznemű összegek SOHA nem adhatók össze
 * konverzió nélkül (D-017).
 */
export interface Money {
  readonly amount: number;
  readonly currency: CurrencyCode;
}

export function createMoney(amount: number, currency: CurrencyCode): Result<Money> {
  return Number.isFinite(amount)
    ? ok({ amount, currency })
    : invalid('Az összeg véges szám kell legyen (nem NaN/Infinity).');
}

/** Azonos pénznemű összegek összeadása; eltérő pénznemnél hiba (nincs csendes konverzió). */
export function addMoney(a: Money, b: Money): Result<Money> {
  if (a.currency !== b.currency) {
    return err(
      AppErrors.calculationInvalid(
        `Eltérő pénznemek (${a.currency} és ${b.currency}) nem adhatók össze FX-átváltás nélkül.`,
      ),
    );
  }
  return ok({ amount: a.amount + b.amount, currency: a.currency });
}
