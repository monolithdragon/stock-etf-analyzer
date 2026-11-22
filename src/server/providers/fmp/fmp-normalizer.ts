/**
 * FMP (stable API) DTO-sémák és normalizálók (PHASE 04B). A szolgáltatói formátum csak itt él.
 *
 * Élő próbával igazolt tények (2026-11-21, free kulcs):
 * - `quote`: tömb; NINCS benne pénznem; `timestamp` Unix-másodperc; `exchange` nem MIC.
 * - `historical-price-eod/full`: a `close` SPLIT-korrigált, osztalékkal NEM (NVDA 2024-06-07:
 *   120.89); `non-split-adjusted`: az `adjClose` mező NYERS ár (1208.9 – a mezőnév félrevezető);
 *   `dividend-adjusted`: `adjClose` split- és osztalék-korrigált (120.55). Csökkenő dátumsorrend.
 * - `dividends`: `dividend` (tényleges) és `adjDividend` (split-korrigált); pénznem nincs.
 * - `profile`: `currency`, `cik`, `isin`, `isEtf`, `isFund`; a hiány gyakran `""`.
 * - `search-symbol`: `symbol` utótaggal (`ISF.L`), `currency` (`GBp` → GBX), `exchange`.
 */
import { z } from 'zod';

import {
  AppErrors,
  createDividendEvent,
  createDividendHistory,
  createInstrumentProfile,
  createInstrumentSearchHit,
  MAX_SEARCH_HITS,
  createPriceSeries,
  createQuote,
  err,
  ok,
  parseCurrencyCode,
  splitListingId,
  toIsoTimestamp,
  type CurrencyCode,
  type DataProvenance,
  type DividendEvent,
  type DividendHistory,
  type InstrumentProfile,
  type InstrumentSearchHit,
  type InstrumentSearchResult,
  type IsoDate,
  type IsoTimestamp,
  type ListingId,
  type PriceAdjustment,
  type PriceSeries,
  type Quote,
  type Result,
} from '@/domain';

import {
  FMP_SEARCH_VENUES,
  FMP_UNSUPPORTED_SEARCH_EXCHANGES,
  fmpExchangeMatchesMic,
  fromFmpSearchSymbol,
} from './fmp-symbols';
import { invalidUpstream } from '../../http/request-json';

export const FMP_SOURCE = { sourceId: 'fmp', sourceName: 'Financial Modeling Prep' } as const;

const text = z.string().max(5000);
/** Az FMP a hiányt `null`-lal, `""`-vel vagy a mező elhagyásával jelzi. */
const optionalText = text.nullish();

const quoteRowSchema = z.object({
  symbol: z.string().max(30),
  price: z.number(),
  exchange: z.string().max(40),
  timestamp: z.number().int().positive(),
});
export const fmpQuoteSchema = z.array(quoteRowSchema).max(10);

const historyFullRowSchema = z.object({ date: z.string(), close: z.number() });
const historyAdjRowSchema = z.object({ date: z.string(), adjClose: z.number() });
const MAX_ROWS = 12_000;

export const fmpDividendsSchema = z
  .array(
    z.object({
      date: z.string(),
      recordDate: optionalText,
      paymentDate: optionalText,
      declarationDate: optionalText,
      adjDividend: z.number().nullish(),
      dividend: z.number().nullish(),
      frequency: optionalText,
    }),
  )
  .max(MAX_ROWS);

export const fmpProfileSchema = z
  .array(
    z.object({
      symbol: z.string().max(30),
      companyName: optionalText,
      currency: optionalText,
      cik: optionalText,
      isin: optionalText,
      exchange: z.string().max(40),
      exchangeFullName: optionalText,
      industry: optionalText,
      sector: optionalText,
      country: optionalText,
      website: optionalText,
      description: optionalText,
      isEtf: z.boolean().nullish(),
      isFund: z.boolean().nullish(),
      /** PHASE 06: szolgáltatói béta (módszertanát az FMP nem közli). Nem szám → `null`. */
      beta: z.number().nullish().catch(null),
    }),
  )
  .max(10);

export const fmpSearchSchema = z
  .array(
    z.object({
      symbol: z.string().max(40),
      name: optionalText,
      currency: optionalText,
      exchange: optionalText,
      exchangeFullName: optionalText,
    }),
  )
  .max(1000);

/** Az US jegyzés pénzneme USD (helyszíni szabály, D-052): az FMP quote nem közli. */
export const FMP_US_TRADING_CURRENCY = 'USD';

export function fmpProvenance(
  fetchedAt: IsoTimestamp,
  extra: Partial<DataProvenance> = {},
): DataProvenance {
  return {
    ...FMP_SOURCE,
    kind: 'reported',
    fetchedAt,
    asOf: null,
    freshness: 'UNKNOWN', // a kliens use case-e ítéli meg a saját órájával
    ...extra,
  };
}

const invalid = (issue: { path: readonly PropertyKey[]; message: string } | undefined) =>
  err(invalidUpstream(FMP_SOURCE.sourceId, issue));

function wrongExchange(listingId: ListingId, exchange: string) {
  return err(
    AppErrors.notFound(
      `jegyzés (az FMP szerint a ticker tőzsdéje: ${exchange.slice(0, 40)})`,
      listingId,
    ),
  );
}

export function normalizeFmpQuote(
  json: unknown,
  listingId: ListingId,
  currency: CurrencyCode,
  fetchedAt: IsoTimestamp,
): Result<Quote> {
  const parsed = fmpQuoteSchema.safeParse(json);
  if (!parsed.success) return invalid(parsed.error.issues[0]);
  const row = parsed.data[0];
  if (row === undefined) return err(AppErrors.notFound('árfolyam (FMP)', listingId));
  if (!fmpExchangeMatchesMic(row.exchange, splitListingId(listingId).mic)) {
    return wrongExchange(listingId, row.exchange);
  }
  const asOf = toIsoTimestamp(new Date(row.timestamp * 1000));
  const quote = createQuote({
    listingId,
    price: row.price,
    currency,
    asOf,
    delayMinutes: null, // az FMP nem közli a késleltetést
    provenance: fmpProvenance(fetchedAt, { asOf, currency, reference: 'FMP /stable/quote' }),
  });
  return quote.ok ? quote : invalid({ path: [0, 'price'], message: quote.error.message });
}

/** Az FMP ártörténet-végpontja a kért korrekcióhoz (igazolva, lásd a fájl fejlécét). */
export const FMP_HISTORY_ENDPOINTS: Readonly<Record<PriceAdjustment, string>> = {
  NONE: 'historical-price-eod/non-split-adjusted',
  SPLIT: 'historical-price-eod/full',
  SPLIT_DIVIDEND: 'historical-price-eod/dividend-adjusted',
};

export function normalizeFmpHistory(
  json: unknown,
  request: {
    readonly listingId: ListingId;
    readonly from: IsoDate;
    readonly to: IsoDate;
    readonly adjustment: PriceAdjustment;
  },
  currency: CurrencyCode,
  fetchedAt: IsoTimestamp,
): Result<PriceSeries> {
  const rows: { date: string; close: number }[] = [];
  if (request.adjustment === 'SPLIT') {
    const parsed = z.array(historyFullRowSchema).max(MAX_ROWS).safeParse(json);
    if (!parsed.success) return invalid(parsed.error.issues[0]);
    rows.push(...parsed.data.map((r) => ({ date: r.date, close: r.close })));
  } else {
    const parsed = z.array(historyAdjRowSchema).max(MAX_ROWS).safeParse(json);
    if (!parsed.success) return invalid(parsed.error.issues[0]);
    rows.push(...parsed.data.map((r) => ({ date: r.date, close: r.adjClose })));
  }
  // Csökkenő sorrendben jön → növekvőre; a kért időszakon kívüli sort eldobjuk (védekezés).
  const points = rows
    .filter((r) => r.date >= request.from && r.date <= request.to)
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const last = points[points.length - 1];
  const series = createPriceSeries({
    listingId: request.listingId,
    currency,
    adjustment: request.adjustment,
    points,
    notes: points.length === 0 ? ['A kért időszakban nincs kereskedési nap az FMP-nél.'] : [],
    provenance: fmpProvenance(fetchedAt, {
      asOf: last === undefined ? null : (last.date as IsoDate),
      currency,
      reference: `FMP /stable/${FMP_HISTORY_ENDPOINTS[request.adjustment]}`,
    }),
  });
  return series.ok ? series : invalid({ path: [], message: series.error.message });
}

const blank = (value: string | null | undefined): string | null => {
  const trimmed = value?.trim() ?? '';
  return trimmed === '' ? null : trimmed;
};

export function normalizeFmpDividends(
  json: unknown,
  request: { readonly listingId: ListingId; readonly from: IsoDate; readonly to: IsoDate },
  currency: CurrencyCode,
  fetchedAt: IsoTimestamp,
): Result<DividendHistory> {
  const parsed = fmpDividendsSchema.safeParse(json);
  if (!parsed.success) return invalid(parsed.error.issues[0]);
  const events: DividendEvent[] = [];
  let skipped = 0;
  for (const [index, row] of parsed.data.entries()) {
    if (row.date < request.from || row.date > request.to) continue;
    if (row.dividend === null || row.dividend === undefined || row.dividend <= 0) {
      skipped += 1; // nem 0-ként tároljuk: kihagyjuk és megszámoljuk
      continue;
    }
    const event = createDividendEvent({
      exDate: row.date,
      paymentDate: blank(row.paymentDate),
      recordDate: blank(row.recordDate),
      declarationDate: blank(row.declarationDate),
      amount: row.dividend,
      currency,
      splitAdjustedAmount:
        row.adjDividend !== null && row.adjDividend !== undefined && row.adjDividend > 0
          ? row.adjDividend
          : null,
      frequency: blank(row.frequency),
    });
    if (!event.ok) return invalid({ path: [index], message: event.error.message });
    events.push(event.value);
  }
  events.sort((a, b) => (a.exDate < b.exDate ? -1 : a.exDate > b.exDate ? 1 : 0));
  const notes = [
    `Pénznem: ${currency} (US jegyzés; az FMP osztalék-válasza nem közli).`,
    ...(skipped > 0 ? [`${skipped} sor hiányzó vagy nem pozitív összeggel kihagyva.`] : []),
  ];
  const last = events[events.length - 1];
  const history = createDividendHistory({
    listingId: request.listingId,
    events,
    notes,
    provenance: fmpProvenance(fetchedAt, {
      asOf: last?.exDate ?? null,
      currency,
      reference: 'FMP /stable/dividends',
    }),
  });
  return history.ok ? history : invalid({ path: [], message: history.error.message });
}

/** Szigorú domain-szabályok előtt: a nem szabványos forrásértéket `null`-ra tesszük. */
const ifMatches = (value: string | null, pattern: RegExp): string | null =>
  value !== null && pattern.test(value) ? value : null;

export function normalizeFmpProfile(
  json: unknown,
  listingId: ListingId,
  fetchedAt: IsoTimestamp,
): Result<InstrumentProfile> {
  const parsed = fmpProfileSchema.safeParse(json);
  if (!parsed.success) return invalid(parsed.error.issues[0]);
  const row = parsed.data[0];
  if (row === undefined) return err(AppErrors.notFound('profil (FMP)', listingId));
  if (!fmpExchangeMatchesMic(row.exchange, splitListingId(listingId).mic)) {
    return wrongExchange(listingId, row.exchange);
  }
  const name = blank(row.companyName);
  if (name === null) return invalid({ path: [0, 'companyName'], message: 'Hiányzó név.' });
  const profile = createInstrumentProfile({
    listingId,
    name,
    kindHint: row.isEtf === true ? 'etf' : row.isFund === true ? null : 'stock',
    isin: ifMatches(blank(row.isin), /^[A-Z]{2}[A-Z0-9]{9}\d$/),
    cik: ifMatches(blank(row.cik), /^\d{10}$/),
    country: ifMatches(blank(row.country), /^[A-Z]{2}$/),
    sector: blank(row.sector),
    industry: blank(row.industry),
    exchangeName: blank(row.exchangeFullName) ?? row.exchange,
    tradingCurrency: blank(row.currency),
    website: blank(row.website),
    description: blank(row.description),
    beta: typeof row.beta === 'number' && Number.isFinite(row.beta) ? row.beta : null,
    provenance: fmpProvenance(fetchedAt, { reference: 'FMP /stable/profile' }),
  });
  return profile.ok ? profile : invalid({ path: [0], message: profile.error.message });
}

export function normalizeFmpSearch(
  json: unknown,
  query: string,
  fetchedAt: IsoTimestamp,
): Result<InstrumentSearchResult> {
  const parsed = fmpSearchSchema.safeParse(json);
  if (!parsed.success) return invalid(parsed.error.issues[0]);
  const hits: InstrumentSearchHit[] = [];
  const omitted = { unmappedVenue: 0, invalidSymbol: 0, unsupportedType: 0, truncated: 0 };
  for (const row of parsed.data) {
    const exchange = blank(row.exchange) ?? '';
    if (FMP_UNSUPPORTED_SEARCH_EXCHANGES.has(exchange)) {
      omitted.unsupportedType += 1;
      continue;
    }
    const venue = FMP_SEARCH_VENUES[exchange];
    if (venue === undefined) {
      omitted.unmappedVenue += 1;
      continue;
    }
    const symbol = fromFmpSearchSymbol(row.symbol, venue.suffix);
    const currency = blank(row.currency);
    const hit =
      symbol === null
        ? null
        : createInstrumentSearchHit({
            symbol,
            mic: venue.mic,
            name: blank(row.name) ?? symbol,
            kindHint: null, // az FMP kereső nem ad típust
            isin: null,
            tradingCurrency: currency !== null && parseCurrencyCode(currency).ok ? currency : null,
            exchangeName: blank(row.exchangeFullName),
          });
    if (hit === null || !hit.ok) {
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
    provenance: fmpProvenance(fetchedAt, { reference: 'FMP /stable/search-symbol' }),
  });
}
