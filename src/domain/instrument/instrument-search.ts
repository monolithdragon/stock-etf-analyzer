/**
 * Instrumentum-keresés eredménye (PHASE 04B, UF-01): ticker, név vagy ISIN alapján.
 *
 * Egy találat = egy konkrét tőzsdei jegyzés (`ListingId`). Csak igazolt tőzsdekód → MIC
 * leképezésű találat kerül be; a többi okonként megszámolva az `omitted`-be (nem tüntetünk el
 * adatot szó nélkül – ugyanaz az elv, mint a `SecurityListings`-nél).
 */
import {
  createListingId,
  ok,
  parseCurrencyCode,
  parseIsin,
  parseMic,
  parseNullable,
  parseTickerSymbol,
  requireNonEmpty,
  validateFields,
  type CurrencyCode,
  type DataProvenance,
  type Isin,
  type ListingId,
  type Mic,
  type Result,
  type TickerSymbol,
} from '../shared';
import type { InstrumentKind } from './instrument';

export interface InstrumentSearchHit {
  readonly listingId: ListingId;
  readonly symbol: TickerSymbol;
  readonly mic: Mic;
  readonly name: string;
  readonly kindHint: InstrumentKind | null;
  /** `null`, ha a kereső nem közli (pl. FMP szöveges keresés). */
  readonly isin: Isin | null;
  /** A jegyzés pénzneme a kereső szerint (pl. `GBX`); `null`, ha nem közli. */
  readonly tradingCurrency: CurrencyCode | null;
  readonly exchangeName: string | null;
}

export interface InstrumentSearchResult {
  readonly query: string;
  readonly hits: readonly InstrumentSearchHit[];
  readonly omitted: {
    /** Olyan tőzsde, amelyhez nincs igazolt MIC-leképezés (pl. OTC, kétértelmű „AMEX”, „US”). */
    readonly unmappedVenue: number;
    /** A ticker nem felelt meg a formátumunknak. */
    readonly invalidSymbol: number;
    /** Nem részvény / ETF (pl. kripto, index, alap). */
    readonly unsupportedType: number;
    /** A találati korlát (`MAX_SEARCH_HITS`) fölötti, levágott találatok. */
    readonly truncated: number;
  };
  readonly provenance: DataProvenance;
}

export const MAX_SEARCH_HITS = 100;

export interface InstrumentSearchHitInput {
  readonly symbol: string;
  readonly mic: string;
  readonly name: string;
  readonly kindHint: InstrumentKind | null;
  readonly isin: string | null;
  readonly tradingCurrency: string | null;
  readonly exchangeName: string | null;
}

export function createInstrumentSearchHit(
  input: InstrumentSearchHitInput,
): Result<InstrumentSearchHit> {
  const fields = validateFields(
    {
      symbol: parseTickerSymbol(input.symbol),
      mic: parseMic(input.mic),
      name: requireNonEmpty(input.name),
      isin: parseNullable(input.isin, parseIsin),
      tradingCurrency: parseNullable(input.tradingCurrency, parseCurrencyCode),
      exchangeName: parseNullable(input.exchangeName, (v) => requireNonEmpty(v, 100)),
    },
    'Érvénytelen keresési találat.',
  );
  if (!fields.ok) return fields;
  return ok({
    ...fields.value,
    listingId: createListingId(fields.value.symbol, fields.value.mic),
    kindHint: input.kindHint,
  });
}

/** Keresőkifejezés: 1–64 karakter, a felesleges szóközök nélkül. */
export function parseSearchQuery(input: string): Result<string> {
  return requireNonEmpty(input.replace(/\s+/g, ' '), 64);
}
