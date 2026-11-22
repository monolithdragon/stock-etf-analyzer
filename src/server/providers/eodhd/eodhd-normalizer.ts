/**
 * EODHD DTO-sémák és normalizálók (PHASE 04B). A szolgáltatói formátum csak itt él.
 *
 * Élő próbával igazolt tények (2026-11-21, free kulcs):
 * - `real-time`: `{ code, timestamp (Unix mp), close, … }`; NINCS pénznem. Ismeretlen ticker
 *   esetén az EODHD dokumentáltan `"NA"` értékeket ad.
 * - `eod`: `[{ date, open, high, low, close, adjusted_close, volume }]`; NINCS pénznem.
 *   A `close` nyers (EODHD-doksi), az `adjusted_close` split- ÉS osztalék-korrigált
 *   (ASML: 1455.4 vs 1453.4556). Free csomagban 1 évnél régebbi időszakra HTTP 200 jön,
 *   egyetlen, a kért időszakon KÍVÜLI sorral és `warning` mezővel – ezt el kell dobni.
 * - `div`: `value` (split-korrigált), `unadjustedValue`, `currency` SORONKÉNT (ISF.LSE: az
 *   ár GBX, az osztalék GBP!).
 * - `search`: `Code`, `Exchange`, `Name`, `Type`, `Currency` (GBX is), `ISIN`, `isPrimary`.
 */
import { z } from 'zod';

import {
  AppErrors,
  MAX_SEARCH_HITS,
  createDividendEvent,
  createDividendHistory,
  createInstrumentSearchHit,
  createListingCandidate,
  createPriceSeries,
  createQuote,
  err,
  ok,
  parseCurrencyCode,
  securityIdFromIsin,
  splitListingId,
  toIsoTimestamp,
  type CurrencyCode,
  type DataProvenance,
  type DividendEvent,
  type DividendHistory,
  type InstrumentSearchHit,
  type InstrumentSearchResult,
  type IsoDate,
  type IsoTimestamp,
  type Isin,
  type ListingCandidate,
  type ListingId,
  type PriceAdjustment,
  type PriceSeries,
  type Quote,
  type Result,
  type SecurityListings,
} from '@/domain';

import {
  EODHD_COMPOSITE_EXCHANGES,
  EODHD_VENUES_BY_MIC,
  MIC_BY_EODHD_EXCHANGE,
  kindFromEodhdType,
} from './eodhd-symbols';
import { invalidUpstream } from '../../http/request-json';

export const EODHD_SOURCE = {
  sourceId: 'eodhd',
  sourceName: 'EODHD (EOD Historical Data)',
} as const;

const nullableText = z.string().max(500).nullish();
/** Az EODHD a hiányzó számot `"NA"`-val vagy `null`-lal jelezheti. */
const numberOrNa = z.union([z.number(), z.literal('NA'), z.null()]);

export const eodhdRealTimeSchema = z.object({
  code: z.string().max(40),
  timestamp: numberOrNa,
  close: numberOrNa,
});

const MAX_ROWS = 12_000;
export const eodhdEodSchema = z
  .array(
    z.object({
      date: z.string(),
      close: z.number().nullish(),
      adjusted_close: z.number().nullish(),
      warning: z.string().max(500).optional(),
    }),
  )
  .max(MAX_ROWS);

export const eodhdDividendsSchema = z
  .array(
    z.object({
      date: z.string(),
      declarationDate: nullableText,
      recordDate: nullableText,
      paymentDate: nullableText,
      period: nullableText,
      value: z.number().nullish(),
      unadjustedValue: z.number().nullish(),
      currency: nullableText,
    }),
  )
  .max(MAX_ROWS);

export const eodhdSearchSchema = z
  .array(
    z.object({
      Code: z.string().max(40),
      Exchange: z.string().max(40),
      Name: nullableText,
      Type: nullableText,
      Currency: nullableText,
      ISIN: nullableText,
      isPrimary: z.boolean().nullish(),
    }),
  )
  .max(1000);
export type EodhdSearchRow = z.infer<typeof eodhdSearchSchema>[number];

export function eodhdProvenance(
  fetchedAt: IsoTimestamp,
  extra: Partial<DataProvenance> = {},
): DataProvenance {
  return {
    ...EODHD_SOURCE,
    kind: 'reported',
    fetchedAt,
    asOf: null,
    freshness: 'UNKNOWN',
    ...extra,
  };
}

const invalid = (issue: { path: readonly PropertyKey[]; message: string } | undefined) =>
  err(invalidUpstream(EODHD_SOURCE.sourceId, issue));

const blank = (value: string | null | undefined): string | null => {
  const trimmed = value?.trim() ?? '';
  return trimmed === '' ? null : trimmed;
};

const byDate = <T extends { date: string }>(a: T, b: T) =>
  a.date < b.date ? -1 : a.date > b.date ? 1 : 0;

export function normalizeEodhdQuote(
  json: unknown,
  listingId: ListingId,
  currency: CurrencyCode,
  fetchedAt: IsoTimestamp,
): Result<Quote> {
  const parsed = eodhdRealTimeSchema.safeParse(json);
  if (!parsed.success) return invalid(parsed.error.issues[0]);
  const { timestamp, close } = parsed.data;
  if (typeof timestamp !== 'number' || typeof close !== 'number') {
    return err(AppErrors.notFound('árfolyam (EODHD: „NA”)', listingId));
  }
  const asOf = toIsoTimestamp(new Date(timestamp * 1000));
  const quote = createQuote({
    listingId,
    price: close,
    currency,
    asOf,
    // Az EODHD „15–20 perc” késleltetést ír – nem pontos szám, ezért nem állítunk értéket.
    delayMinutes: null,
    provenance: eodhdProvenance(fetchedAt, {
      asOf,
      currency,
      reference: 'EODHD /api/real-time (késleltetett, 15–20 perc a doksi szerint)',
    }),
  });
  return quote.ok ? quote : invalid({ path: ['close'], message: quote.error.message });
}

export function normalizeEodhdHistory(
  json: unknown,
  request: {
    readonly listingId: ListingId;
    readonly from: IsoDate;
    readonly to: IsoDate;
    readonly adjustment: Exclude<PriceAdjustment, 'SPLIT'>;
  },
  currency: CurrencyCode,
  fetchedAt: IsoTimestamp,
  initialNotes: readonly string[],
): Result<PriceSeries> {
  const parsed = eodhdEodSchema.safeParse(json);
  if (!parsed.success) return invalid(parsed.error.issues[0]);
  const notes = [...initialNotes];
  const points: { date: string; close: number }[] = [];
  let warnings = 0;
  let outside = 0;
  let missing = 0;
  for (const row of parsed.data) {
    if (row.warning !== undefined) {
      warnings += 1;
      continue;
    }
    if (row.date < request.from || row.date > request.to) {
      outside += 1;
      continue;
    }
    const close = request.adjustment === 'NONE' ? row.close : row.adjusted_close;
    if (close === null || close === undefined) {
      missing += 1;
      continue;
    }
    points.push({ date: row.date, close });
  }
  points.sort(byDate);
  if (warnings > 0) {
    notes.push(
      `${warnings} figyelmeztető sort (pl. „Data is limited by one year…”) eldobtunk: nem valós árpont.`,
    );
  }
  if (outside > 0) notes.push(`${outside} sor a kért időszakon kívül esett, eldobtuk.`);
  if (missing > 0) notes.push(`${missing} napon hiányzó záróár (nem 0-ként kezelve).`);
  if (points.length === 0) notes.push('A kért időszakban nincs árpont az EODHD-nél.');
  const last = points[points.length - 1];
  const series = createPriceSeries({
    listingId: request.listingId,
    currency,
    adjustment: request.adjustment,
    points,
    notes,
    provenance: eodhdProvenance(fetchedAt, {
      asOf: last === undefined ? null : (last.date as IsoDate),
      currency,
      reference: `EODHD /api/eod (${request.adjustment === 'NONE' ? 'close' : 'adjusted_close'})`,
    }),
  });
  return series.ok ? series : invalid({ path: [], message: series.error.message });
}

export function normalizeEodhdDividends(
  json: unknown,
  request: { readonly listingId: ListingId; readonly from: IsoDate; readonly to: IsoDate },
  tradingCurrency: CurrencyCode | null,
  fetchedAt: IsoTimestamp,
): Result<DividendHistory> {
  const parsed = eodhdDividendsSchema.safeParse(json);
  if (!parsed.success) return invalid(parsed.error.issues[0]);
  const events: DividendEvent[] = [];
  let skipped = 0;
  for (const [index, row] of parsed.data.entries()) {
    if (row.date < request.from || row.date > request.to) continue;
    const currency = parseCurrencyCode(blank(row.currency) ?? '');
    const amount = row.unadjustedValue;
    if (!currency.ok || amount === null || amount === undefined || amount <= 0) {
      skipped += 1; // pénznem vagy tényleges összeg nélkül nem tároljuk (nem találjuk ki)
      continue;
    }
    const event = createDividendEvent({
      exDate: row.date,
      paymentDate: blank(row.paymentDate),
      recordDate: blank(row.recordDate),
      declarationDate: blank(row.declarationDate),
      amount,
      currency: currency.value,
      splitAdjustedAmount:
        row.value !== null && row.value !== undefined && row.value > 0 ? row.value : null,
      frequency: blank(row.period),
    });
    if (!event.ok) return invalid({ path: [index], message: event.error.message });
    events.push(event.value);
  }
  events.sort((a, b) => (a.exDate < b.exDate ? -1 : a.exDate > b.exDate ? 1 : 0));
  const notes: string[] = [];
  if (skipped > 0) notes.push(`${skipped} sor hiányzó pénznemmel vagy összeggel kihagyva.`);
  const foreign = [...new Set(events.map((e) => e.amount.currency))].filter(
    (c) => tradingCurrency !== null && c !== tradingCurrency,
  );
  if (foreign.length > 0) {
    notes.push(
      `Az osztalék pénzneme (${foreign.join(', ')}) eltér a jegyzésétől (${tradingCurrency ?? '?'}) – hozamhoz átváltás kell.`,
    );
  }
  const last = events[events.length - 1];
  const history = createDividendHistory({
    listingId: request.listingId,
    events,
    notes,
    provenance: eodhdProvenance(fetchedAt, {
      asOf: last?.exDate ?? null,
      reference: 'EODHD /api/div',
    }),
  });
  return history.ok ? history : invalid({ path: [], message: history.error.message });
}

export function normalizeEodhdSearch(
  json: unknown,
  query: string,
  fetchedAt: IsoTimestamp,
): Result<InstrumentSearchResult> {
  const parsed = eodhdSearchSchema.safeParse(json);
  if (!parsed.success) return invalid(parsed.error.issues[0]);
  const hits: InstrumentSearchHit[] = [];
  const omitted = { unmappedVenue: 0, invalidSymbol: 0, unsupportedType: 0, truncated: 0 };
  for (const row of parsed.data) {
    const kind = kindFromEodhdType(row.Type);
    if (kind === null) {
      omitted.unsupportedType += 1;
      continue;
    }
    const mic = MIC_BY_EODHD_EXCHANGE[row.Exchange];
    if (mic === undefined) {
      omitted.unmappedVenue += 1;
      continue;
    }
    const isin = blank(row.ISIN);
    const currency = blank(row.Currency);
    const hit = createInstrumentSearchHit({
      symbol: row.Code,
      mic,
      name: blank(row.Name) ?? row.Code,
      kindHint: kind,
      isin,
      tradingCurrency: currency,
      exchangeName: EODHD_VENUES_BY_MIC[mic]?.exchangeName ?? null,
    });
    if (!hit.ok) {
      omitted.invalidSymbol += 1;
      continue;
    }
    if (hits.length < MAX_SEARCH_HITS) hits.push(hit.value);
    else omitted.truncated += 1;
  }
  return ok({
    query,
    hits,
    omitted,
    provenance: eodhdProvenance(fetchedAt, { reference: 'EODHD /api/search' }),
  });
}

/** ISIN → jegyzések az EODHD keresőből (a jegyzés pénznemével – ezt az OpenFIGI nem adja). */
export function normalizeEodhdListings(
  json: unknown,
  isin: Isin,
  fetchedAt: IsoTimestamp,
): Result<SecurityListings> {
  const parsed = eodhdSearchSchema.safeParse(json);
  if (!parsed.success) return invalid(parsed.error.issues[0]);
  const listings: ListingCandidate[] = [];
  const omitted = { unmappedVenue: 0, composite: 0, invalidSymbol: 0 };
  for (const row of parsed.data) {
    if (blank(row.ISIN) !== isin) continue; // a kereső más (hasonló) találatot is adhat
    if (EODHD_COMPOSITE_EXCHANGES.has(row.Exchange)) {
      omitted.composite += 1;
      continue;
    }
    const mic = MIC_BY_EODHD_EXCHANGE[row.Exchange];
    const venue = mic === undefined ? undefined : EODHD_VENUES_BY_MIC[mic];
    if (mic === undefined || venue === undefined) {
      omitted.unmappedVenue += 1;
      continue;
    }
    const candidate = createListingCandidate({
      isin,
      symbol: row.Code,
      mic,
      exchangeName: venue.exchangeName,
      tradingCurrency: blank(row.Currency),
      figi: null,
      compositeFigi: null,
      kindHint: kindFromEodhdType(row.Type),
      sourceName: blank(row.Name)?.slice(0, 200) ?? null,
    });
    if (!candidate.ok) {
      omitted.invalidSymbol += 1;
      continue;
    }
    listings.push(candidate.value);
  }
  if (listings.length === 0 && omitted.composite === 0 && omitted.unmappedVenue === 0) {
    return err(AppErrors.notFound('értékpapír (EODHD ISIN-keresés)', isin));
  }
  return ok({
    isin,
    securityId: securityIdFromIsin(isin),
    listings,
    omitted,
    provenance: eodhdProvenance(fetchedAt, { reference: 'EODHD /api/search (ISIN)' }),
  });
}

/** A keresőből a jegyzés pénzneme: pontos `Code` + `Exchange` egyezés kell. */
export function findListingCurrency(
  json: unknown,
  listingId: ListingId,
  exchangeCode: string,
): Result<CurrencyCode | null> {
  const parsed = eodhdSearchSchema.safeParse(json);
  if (!parsed.success) return invalid(parsed.error.issues[0]);
  const { symbol } = splitListingId(listingId);
  const row = parsed.data.find((r) => r.Code === symbol && r.Exchange === exchangeCode);
  if (row === undefined) return ok(null);
  const currency = parseCurrencyCode(blank(row.Currency) ?? '');
  return ok(currency.ok ? currency.value : null);
}
