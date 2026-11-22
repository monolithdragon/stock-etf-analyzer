/**
 * Osztalék-események egy tőzsdei jegyzéshez (PHASE 04B, DATA_DICTIONARY 4.5).
 *
 * Fontos: az osztalék pénzneme ELTÉRHET a jegyzés pénznemétől. Élő próbával igazolt példa:
 * az `ISF@XLON` ára pennyben (`GBX`), az osztaléka fontban (`GBP`) jön. Ezért minden esemény
 * a saját `Money` értékét hordozza; hozamot csak explicit átváltással szabad számolni (PHASE 05).
 */
import {
  createMoney,
  invalid,
  ok,
  parseIsoDate,
  parseNullable,
  requirePositive,
  validateFields,
  type CurrencyCode,
  type DataProvenance,
  type IsoDate,
  type ListingId,
  type Money,
  type Result,
} from '../shared';

export interface DividendEvent {
  /** Ex-dátum: ettől a naptól az új vevő már nem jogosult az osztalékra. */
  readonly exDate: IsoDate;
  readonly paymentDate: IsoDate | null;
  readonly recordDate: IsoDate | null;
  readonly declarationDate: IsoDate | null;
  /** Részvényenként ténylegesen fizetett (NEM split-korrigált) összeg, az osztalék pénznemében. */
  readonly amount: Money;
  /** Split-korrigált összeg ugyanabban a pénznemben; `null`, ha a forrás nem közli. */
  readonly splitAdjustedAmount: number | null;
  /** A forrás besorolása szó szerint (pl. „Quarterly”, „Final”); `null`, ha nincs. */
  readonly frequency: string | null;
}

export interface DividendHistory {
  readonly listingId: ListingId;
  /** Ex-dátum szerint növekvő (azonos napon több esemény lehet, pl. rendkívüli osztalék). */
  readonly events: readonly DividendEvent[];
  readonly notes: readonly string[];
  readonly provenance: DataProvenance;
}

export interface DividendEventInput {
  readonly exDate: string;
  readonly paymentDate: string | null;
  readonly recordDate: string | null;
  readonly declarationDate: string | null;
  readonly amount: number;
  readonly currency: CurrencyCode;
  readonly splitAdjustedAmount: number | null;
  readonly frequency: string | null;
}

export function createDividendEvent(input: DividendEventInput): Result<DividendEvent> {
  const fields = validateFields(
    {
      exDate: parseIsoDate(input.exDate),
      paymentDate: parseNullable(input.paymentDate, parseIsoDate),
      recordDate: parseNullable(input.recordDate, parseIsoDate),
      declarationDate: parseNullable(input.declarationDate, parseIsoDate),
      amount: requirePositive(input.amount),
      splitAdjustedAmount: parseNullable(input.splitAdjustedAmount, requirePositive),
    },
    'Érvénytelen osztalék-esemény.',
  );
  if (!fields.ok) return fields;
  const amount = createMoney(fields.value.amount, input.currency);
  if (!amount.ok) return amount;
  const frequency = input.frequency?.trim() ?? '';
  return ok({
    ...fields.value,
    amount: amount.value,
    frequency: frequency === '' ? null : frequency.slice(0, 50),
  });
}

export function createDividendHistory(input: {
  readonly listingId: ListingId;
  readonly events: readonly DividendEvent[];
  readonly notes?: readonly string[];
  readonly provenance: DataProvenance;
}): Result<DividendHistory> {
  for (let i = 1; i < input.events.length; i += 1) {
    const previous = input.events[i - 1];
    const current = input.events[i];
    if (previous !== undefined && current !== undefined && current.exDate < previous.exDate) {
      return invalid(`Az osztalék-események ex-dátum szerint növekvők kell legyenek (#${i}).`);
    }
  }
  return ok({
    listingId: input.listingId,
    events: [...input.events],
    notes: [...(input.notes ?? [])],
    provenance: input.provenance,
  });
}
