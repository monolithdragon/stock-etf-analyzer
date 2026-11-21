/**
 * Devizaárfolyam (DATA_DICTIONARY 8.): 1 `base` = `rate` `quote`.
 * Példa: base=EUR, quote=USD, rate=1.08 → 1 EUR = 1,08 USD.
 * A keresztárfolyam és az átváltás számítás (PHASE 04A FxService / PHASE 05), nem ide tartozik.
 */
import {
  invalid,
  ok,
  parseIsoDate,
  requirePositive,
  validateFields,
  type CurrencyCode,
  type DataProvenance,
  type IsoDate,
  type Result,
} from '../shared';

export interface FxRate {
  readonly base: CurrencyCode;
  readonly quote: CurrencyCode;
  readonly rate: number;
  /** A referencia-árfolyam napja (hétvégén az utolsó elérhető ECB nap). */
  readonly asOf: IsoDate;
  readonly provenance: DataProvenance;
}

export interface FxRateInput {
  readonly base: CurrencyCode;
  readonly quote: CurrencyCode;
  readonly rate: number;
  readonly asOf: string;
  readonly provenance: DataProvenance;
}

export function createFxRate(input: FxRateInput): Result<FxRate> {
  if (input.base === input.quote) {
    return invalid(`Az alap- és célpénznem nem lehet azonos (${input.base}).`);
  }
  const fields = validateFields(
    { rate: requirePositive(input.rate), asOf: parseIsoDate(input.asOf) },
    'Érvénytelen devizaárfolyam.',
  );
  if (!fields.ok) return fields;
  return ok({
    base: input.base,
    quote: input.quote,
    rate: fields.value.rate,
    asOf: fields.value.asOf,
    provenance: input.provenance,
  });
}
