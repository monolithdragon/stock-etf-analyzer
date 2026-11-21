import type { Brand } from './brand';
import { ok, type Result } from './result';
import { invalid } from './validation';

/**
 * ISO 4217 pénznemkód, pl. `USD`, `EUR`, `HUF` (D-018).
 *
 * Csak a FORMÁTUMOT ellenőrizzük (3 nagybetű), nem egy teljes kódlistát: a lista változik,
 * és a szolgáltatók néha nem szabványos jegyzési kódot is használnak.
 * Ismert ilyen: `GBX` (penny, 1 GBP = 100 GBX) – az átváltás explicit (DATA_DICTIONARY 1.).
 */
export type CurrencyCode = Brand<string, 'CurrencyCode'>;

const CURRENCY_PATTERN = /^[A-Z]{3}$/;

export function parseCurrencyCode(input: string): Result<CurrencyCode> {
  const normalized = input.trim().toUpperCase();
  return CURRENCY_PATTERN.test(normalized)
    ? ok(normalized as CurrencyCode)
    : invalid(`Érvénytelen pénznemkód: "${input}". Formátum: 3 betű (ISO 4217), pl. USD.`);
}
