/**
 * Árfolyam-adatok egy konkrét tőzsdei jegyzéshez (Listing).
 */
import {
  createMoney,
  invalid,
  ok,
  parseIsoDate,
  parseIsoTimestamp,
  parseNullable,
  requirePositive,
  validateFields,
  type DataProvenance,
  type IsoDate,
  type IsoTimestamp,
  type ListingId,
  type Money,
  type Result,
  type CurrencyCode,
} from '../shared';

/** Legutóbbi (késleltetett vagy záró) ár. */
export interface Quote {
  readonly listingId: ListingId;
  readonly price: Money;
  /** Az ár tényleges időpontja (nem a lekérésé – az a `provenance.fetchedAt`). */
  readonly asOf: IsoTimestamp;
  /** Késleltetés percben; `null`, ha a forrás nem közli. EOD adatnál pl. a zárás óta eltelt idő nem ide tartozik. */
  readonly delayMinutes: number | null;
  readonly provenance: DataProvenance;
}

export interface QuoteInput {
  readonly listingId: ListingId;
  readonly price: number;
  readonly currency: CurrencyCode;
  readonly asOf: string;
  readonly delayMinutes: number | null;
  readonly provenance: DataProvenance;
}

export function createQuote(input: QuoteInput): Result<Quote> {
  const fields = validateFields(
    {
      price: requirePositive(input.price),
      asOf: parseIsoTimestamp(input.asOf),
      delayMinutes: parseNullable(input.delayMinutes, (v) =>
        Number.isInteger(v) && v >= 0 ? ok(v) : invalid('Nemnegatív egész szám kell.'),
      ),
    },
    'Érvénytelen árfolyam.',
  );
  if (!fields.ok) return fields;
  const price = createMoney(fields.value.price, input.currency);
  if (!price.ok) return price;
  return ok({
    listingId: input.listingId,
    price: price.value,
    asOf: fields.value.asOf,
    delayMinutes: fields.value.delayMinutes,
    provenance: input.provenance,
  });
}

/** Egy napi ár (split-korrigált vagy nem – a sorozat `adjusted` mezője jelzi). */
export interface PricePoint {
  readonly date: IsoDate;
  readonly close: number;
}

export interface PriceSeries {
  readonly listingId: ListingId;
  readonly currency: CurrencyCode;
  /** `true` = split-korrigált záróárak (osztalék-korrekció NEM feltételezett). */
  readonly adjusted: boolean;
  /** Dátum szerint szigorúan növekvő, ismétlődés nélkül. */
  readonly points: readonly PricePoint[];
  readonly provenance: DataProvenance;
}

export interface PriceSeriesInput {
  readonly listingId: ListingId;
  readonly currency: CurrencyCode;
  readonly adjusted: boolean;
  readonly points: readonly { readonly date: string; readonly close: number }[];
  readonly provenance: DataProvenance;
}

export function createPriceSeries(input: PriceSeriesInput): Result<PriceSeries> {
  const points: PricePoint[] = [];
  for (const [index, raw] of input.points.entries()) {
    const fields = validateFields(
      { date: parseIsoDate(raw.date), close: requirePositive(raw.close) },
      `Érvénytelen árpont (#${index}).`,
    );
    if (!fields.ok) return fields;
    const previous = points[points.length - 1];
    if (previous !== undefined && fields.value.date <= previous.date) {
      return invalid(`Az árpontok dátuma szigorúan növekvő kell legyen (#${index}: ${raw.date}).`);
    }
    points.push(fields.value);
  }
  return ok({
    listingId: input.listingId,
    currency: input.currency,
    adjusted: input.adjusted,
    points,
    provenance: input.provenance,
  });
}
