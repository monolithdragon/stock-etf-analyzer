/**
 * Tőzsdei jegyzés-JELÖLT egy értékpapírhoz (D-025), azonosítási szinten.
 *
 * Miért nem `Listing`? Az azonosító-forrás (OpenFIGI) a jegyzés pénznemét NEM közli,
 * a `Listing` viszont kötelezően tartalmazza (pozíció, P/L ehhez kötődik). A pénznemet nem
 * találjuk ki: a jelöltben `tradingCurrency: null`, amíg egy árforrás (PHASE 04B) meg nem adja.
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
  securityIdFromIsin,
  validateFields,
  type CurrencyCode,
  type DataProvenance,
  type Isin,
  type ListingId,
  type Mic,
  type Result,
  type SecurityId,
  type TickerSymbol,
} from '../shared';
import type { InstrumentKind } from './instrument';

export interface ListingCandidate {
  readonly listingId: ListingId;
  readonly securityId: SecurityId;
  readonly symbol: TickerSymbol;
  readonly mic: Mic;
  readonly exchangeName: string;
  /** `null`: a forrás nem közölte (OpenFIGI). Árforrás nélkül nem pótoljuk. */
  readonly tradingCurrency: CurrencyCode | null;
  readonly figi: string | null;
  /** Az ország-szintű (kompozit) FIGI – ugyanannak az országnak a jegyzéseit köti össze. */
  readonly compositeFigi: string | null;
  /** A forrás besorolása alapján; `null`, ha nem egyértelmű. */
  readonly kindHint: InstrumentKind | null;
  /** A forrásbeli (gyakran rövidített) név, pl. „VANG FTSE AW USDA”. */
  readonly sourceName: string | null;
}

export interface SecurityListings {
  readonly isin: Isin;
  readonly securityId: SecurityId;
  /** Csak az ismert (MIC-re leképezhető) tőzsdék jegyzései. */
  readonly listings: readonly ListingCandidate[];
  /** Kihagyott sorok száma okonként – átláthatóság: nem tüntetünk el adatot szó nélkül. */
  readonly omitted: {
    /** Olyan kereskedési helyszín, amelyhez nincs igazolt MIC-leképezés (pl. MTF, OTC). */
    readonly unmappedVenue: number;
    /** Ország-szintű összesítő (pl. „US”, „GR”), nem konkrét tőzsde. */
    readonly composite: number;
    /** A ticker nem felelt meg a formátumunknak. */
    readonly invalidSymbol: number;
  };
  readonly provenance: DataProvenance;
}

export interface ListingCandidateInput {
  readonly isin: string;
  readonly symbol: string;
  readonly mic: string;
  readonly exchangeName: string;
  readonly tradingCurrency: string | null;
  readonly figi: string | null;
  readonly compositeFigi: string | null;
  readonly kindHint: InstrumentKind | null;
  readonly sourceName: string | null;
}

const optionalText = (v: string) => requireNonEmpty(v, 200);

export function createListingCandidate(input: ListingCandidateInput): Result<ListingCandidate> {
  const fields = validateFields(
    {
      isin: parseIsin(input.isin),
      symbol: parseTickerSymbol(input.symbol),
      mic: parseMic(input.mic),
      exchangeName: requireNonEmpty(input.exchangeName),
      tradingCurrency: parseNullable(input.tradingCurrency, parseCurrencyCode),
      figi: parseNullable(input.figi, (v) => requireNonEmpty(v, 20)),
      compositeFigi: parseNullable(input.compositeFigi, (v) => requireNonEmpty(v, 20)),
      sourceName: parseNullable(input.sourceName, optionalText),
    },
    'Érvénytelen jegyzés-jelölt.',
  );
  if (!fields.ok) return fields;
  const { isin, symbol, mic, ...rest } = fields.value;
  return ok({
    ...rest,
    listingId: createListingId(symbol, mic),
    securityId: securityIdFromIsin(isin),
    symbol,
    mic,
    kindHint: input.kindHint,
  });
}
