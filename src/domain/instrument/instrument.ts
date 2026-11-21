/**
 * Instrumentum (= értékpapír, „Security” a D-025 szerint) és tőzsdei jegyzés (Listing).
 *
 * - `Instrument` diszkriminált unió a `kind` mező szerint: `Stock | Etf`.
 *   Ehhez tartozik a fundamentum és az ETF-metaadat.
 * - `Listing` egy konkrét tőzsdei jegyzés: ehhez tartozik az ár és a pozíció.
 *
 * Konvenció: az egyszerű metaadat hiánya explicit `null` (nem opcionális mező, nem üres string).
 * A forrásfüggő, gyakran hiányos ETF-adatok `Metric<T>` típusúak (DATA_DICTIONARY 6.).
 */
import {
  ok,
  parseCik,
  parseCurrencyCode,
  parseIsin,
  parseMic,
  parseNullable,
  parseSecurityId,
  parseTickerSymbol,
  createListingId,
  invalid,
  invalidField,
  requireInRange,
  requireNonEmpty,
  validateFields,
  type Cik,
  type CurrencyCode,
  type DataProvenance,
  type IsoDate,
  type Isin,
  type ListingId,
  type Metric,
  type Mic,
  type Money,
  type Result,
  type SecurityId,
  type TickerSymbol,
} from '../shared';

export const INSTRUMENT_KINDS = ['stock', 'etf'] as const;
export type InstrumentKind = (typeof INSTRUMENT_KINDS)[number];

export type EtfReplication = 'physical_full' | 'physical_sampling' | 'synthetic';
export type EtfDistribution = 'accumulating' | 'distributing';

interface InstrumentBase {
  readonly securityId: SecurityId;
  readonly isin: Isin | null;
  readonly name: string;
  /** Részvénynél székhely, ETF-nél domicil (ISO 3166-1 alpha-2, pl. `US`, `IE`). */
  readonly country: string | null;
  /** Share class szintű OpenFIGI azonosító. */
  readonly figi: string | null;
  readonly provenance: DataProvenance;
}

export interface Stock extends InstrumentBase {
  readonly kind: 'stock';
  readonly cik: Cik | null;
  /** A pénzügyi kimutatások pénzneme (≠ jegyzési pénznem, pl. ADR-nél). */
  readonly reportingCurrency: CurrencyCode | null;
  readonly sector: string | null;
  readonly industry: string | null;
}

export interface Etf extends InstrumentBase {
  readonly kind: 'etf';
  readonly issuer: Metric<string>;
  /** Teljes költséghányad tizedes törtként (0.0007 = 0,07%). */
  readonly ter: Metric<number>;
  readonly aum: Metric<Money>;
  readonly benchmark: Metric<string>;
  readonly replication: Metric<EtfReplication>;
  readonly distribution: Metric<EtfDistribution>;
  readonly ucits: Metric<boolean>;
  readonly currencyHedged: Metric<boolean>;
  readonly inceptionDate: Metric<IsoDate>;
  // A holdings (összetétel) a PHASE 08-ban kerül be, csak igazolt forrással (R-03).
}

export type Instrument = Stock | Etf;

export interface Listing {
  readonly listingId: ListingId;
  readonly securityId: SecurityId;
  readonly symbol: TickerSymbol;
  readonly mic: Mic;
  readonly exchangeName: string;
  /** A jegyzés pénzneme (≠ beszámolási pénznem!). */
  readonly tradingCurrency: CurrencyCode;
  /** Elsődleges listing-e; `null`, ha a forrás nem adja meg. */
  readonly isPrimary: boolean | null;
  readonly figi: string | null;
}

// ---------------------------------------------------------------------------
// Konstruktorok (validált létrehozás)
// ---------------------------------------------------------------------------

const COUNTRY_PATTERN = /^[A-Z]{2}$/;

function parseCountry(input: string): Result<string> {
  const normalized = input.trim().toUpperCase();
  return COUNTRY_PATTERN.test(normalized)
    ? ok(normalized)
    : invalid(`Érvénytelen országkód: "${input}" (ISO 3166-1 alpha-2, pl. US).`);
}

interface InstrumentBaseInput {
  readonly securityId: string;
  readonly isin: string | null;
  readonly name: string;
  readonly country: string | null;
  readonly figi: string | null;
  readonly provenance: DataProvenance;
}

/** Az alapmezők validálási eredményei – a konkrét konstruktor a saját mezőivel EGYÜTT értékeli ki. */
function baseFieldResults(input: InstrumentBaseInput) {
  return {
    securityId: parseSecurityId(input.securityId),
    isin: parseNullable(input.isin, parseIsin),
    name: requireNonEmpty(input.name),
    country: parseNullable(input.country, parseCountry),
    figi: parseNullable(input.figi, (v) => requireNonEmpty(v, 20)),
  };
}

/** D-025: ha van ISIN, az a security-azonosító. */
function checkIsinConsistency(base: { securityId: SecurityId; isin: Isin | null }): Result<true> {
  return base.isin !== null && (base.securityId as string) !== base.isin
    ? invalidField(
        'securityId',
        `Ha van ISIN, a securityId-nak azzal egyeznie kell (${base.isin}).`,
      )
    : ok(true);
}

export interface StockInput extends InstrumentBaseInput {
  readonly cik: string | null;
  readonly reportingCurrency: string | null;
  readonly sector: string | null;
  readonly industry: string | null;
}

export function createStock(input: StockInput): Result<Stock> {
  const fields = validateFields(
    {
      ...baseFieldResults(input),
      cik: parseNullable(input.cik, parseCik),
      reportingCurrency: parseNullable(input.reportingCurrency, parseCurrencyCode),
    },
    'Érvénytelen részvény.',
  );
  if (!fields.ok) return fields;
  const consistent = checkIsinConsistency(fields.value);
  if (!consistent.ok) return consistent;
  return ok({
    kind: 'stock',
    ...fields.value,
    sector: input.sector?.trim() || null,
    industry: input.industry?.trim() || null,
    provenance: input.provenance,
  });
}

/** TER józansági határ: 0–10%. Kiszűri a „százalék vs. tört” hibát (pl. 7 a 0.07 helyett). */
export const TER_SANITY_RANGE = { min: 0, max: 0.1 } as const;

export interface EtfInput extends InstrumentBaseInput {
  readonly issuer: Metric<string>;
  readonly ter: Metric<number>;
  readonly aum: Metric<Money>;
  readonly benchmark: Metric<string>;
  readonly replication: Metric<EtfReplication>;
  readonly distribution: Metric<EtfDistribution>;
  readonly ucits: Metric<boolean>;
  readonly currencyHedged: Metric<boolean>;
  readonly inceptionDate: Metric<IsoDate>;
}

export function createEtf(input: EtfInput): Result<Etf> {
  const base = validateFields(baseFieldResults(input), 'Érvénytelen ETF.');
  if (!base.ok) return base;
  const consistent = checkIsinConsistency(base.value);
  if (!consistent.ok) return consistent;
  if (input.ter.status === 'OK') {
    const ter = requireInRange(input.ter.value, TER_SANITY_RANGE.min, TER_SANITY_RANGE.max);
    if (!ter.ok) return invalidField('ter', ter.error.message, 'Érvénytelen ETF.');
  }
  if (input.aum.status === 'OK' && input.aum.value.amount < 0) {
    return invalid('Az AUM nem lehet negatív.');
  }
  const { provenance, issuer, ter, aum, benchmark, replication, distribution } = input;
  const { ucits, currencyHedged, inceptionDate } = input;
  return ok({
    kind: 'etf',
    ...base.value,
    provenance,
    issuer,
    ter,
    aum,
    benchmark,
    replication,
    distribution,
    ucits,
    currencyHedged,
    inceptionDate,
  });
}

export interface ListingInput {
  readonly securityId: string;
  readonly symbol: string;
  readonly mic: string;
  readonly exchangeName: string;
  readonly tradingCurrency: string;
  readonly isPrimary: boolean | null;
  readonly figi: string | null;
}

export function createListing(input: ListingInput): Result<Listing> {
  const fields = validateFields(
    {
      securityId: parseSecurityId(input.securityId),
      symbol: parseTickerSymbol(input.symbol),
      mic: parseMic(input.mic),
      exchangeName: requireNonEmpty(input.exchangeName),
      tradingCurrency: parseCurrencyCode(input.tradingCurrency),
      figi: parseNullable(input.figi, (v) => requireNonEmpty(v, 20)),
    },
    'Érvénytelen tőzsdei jegyzés.',
  );
  if (!fields.ok) return fields;
  const { symbol, mic } = fields.value;
  return ok({
    ...fields.value,
    listingId: createListingId(symbol, mic),
    isPrimary: input.isPrimary,
  });
}
