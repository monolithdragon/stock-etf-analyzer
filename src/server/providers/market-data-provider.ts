/**
 * `MarketDataProvider` – a szolgáltató-adapterek közös szerződése (PHASE 04 feladat 1. és 4.).
 *
 * Elvek:
 * - Minden képesség KÜLÖN metódus (quote, ártörténet, profil, osztalék, kimutatások,
 *   jegyzések, keresés, FX), és mind opcionális: egy adapter csak azt valósítja meg (és a
 *   csomagja csak azt kapcsolja be), amit a forrás TÉNYLEGESEN szolgáltat. Nem ígérünk olyan
 *   adatot, amit az API nem ad (pl. ETF-metaadat a free csomagokban – élő próbával igazolva).
 * - A visszatérési érték MINDIG normalizált domain-objektum (a domain konstruktorain átment,
 *   provenance-szel). A szolgáltatói formátum (DTO) az adapter mappáján belül marad.
 * - A `ProviderRouter` (`src/server/routing/`) a `capabilitiesOf()` és a `covers()` alapján
 *   választ, és vált tartalékra (PHASE 04B).
 *
 * Még NINCS metódus: ETF-metaadat, ETF-holdings (nincs igazolt free forrás → PHASE 08).
 */
import type { ProviderCapability, ServerDataMode } from '@/contracts';
import type {
  CurrencyCode,
  DividendHistory,
  FinancialStatementSet,
  FxRateSet,
  InstrumentProfile,
  InstrumentSearchResult,
  IsoDate,
  Isin,
  ListingId,
  PriceAdjustment,
  PriceSeries,
  Quote,
  Result,
  SecurityListings,
  StatementFrequency,
} from '@/domain';

export interface ProviderInfo {
  /** Gépi azonosító; a provenance `sourceId`-ja is ez (pl. `sec-edgar`). */
  readonly id: string;
  readonly name: string;
  /** `mock` szolgáltató csak `PROXY_DATA_MODE=mock` mellett regisztrálható (nincs keverés). */
  readonly kind: ServerDataMode;
  /** Be van-e állítva minden, ami a működéshez kell (pl. SEC User-Agent). */
  readonly configured: boolean;
  /** Csomagszint (pl. `free`); `null`, ha a forrásnak nincs csomagja (SEC, ECB, OpenFIGI). */
  readonly plan: string | null;
  /** Emberi leírás a lefedettségről (providers/status). */
  readonly coverage: string;
  readonly note: string | null;
}

export interface PriceHistoryRequest {
  readonly listingId: ListingId;
  readonly from: IsoDate;
  readonly to: IsoDate;
  readonly adjustment: PriceAdjustment;
}

export interface DividendsRequest {
  readonly listingId: ListingId;
  readonly from: IsoDate;
  readonly to: IsoDate;
}

export interface FxRatesRequest {
  /** Bázis: az ECB-nél csak EUR (a keresztárfolyamot a kliens FxService-e számolja). */
  readonly base: CurrencyCode;
  readonly quotes: readonly CurrencyCode[];
  /** `null` = legutóbbi; egyébként az adott napi (vagy az előtti utolsó közzétett) ráta. */
  readonly date: IsoDate | null;
}

export interface MarketDataProvider {
  readonly info: ProviderInfo;
  /**
   * Kiszolgálja-e ezt a jegyzést (hálózati hívás NÉLKÜL eldönthető: MIC, csomag)?
   * Hiányzó metódus = mindent megpróbál. Hiba: `UNAVAILABLE` (PLAN_LIMIT | NOT_COVERED).
   */
  covers?(listingId: ListingId): Result<true>;
  getQuote?(listingId: ListingId): Promise<Result<Quote>>;
  getPriceHistory?(request: PriceHistoryRequest): Promise<Result<PriceSeries>>;
  getProfile?(listingId: ListingId): Promise<Result<InstrumentProfile>>;
  getDividends?(request: DividendsRequest): Promise<Result<DividendHistory>>;
  getFinancialStatements?(
    listingId: ListingId,
    frequency: StatementFrequency,
  ): Promise<Result<FinancialStatementSet>>;
  getSecurityListings?(isin: Isin): Promise<Result<SecurityListings>>;
  getFxRates?(request: FxRatesRequest): Promise<Result<FxRateSet>>;
  searchInstruments?(query: string): Promise<Result<InstrumentSearchResult>>;
}

export const METHOD_BY_CAPABILITY = {
  quote: 'getQuote',
  priceHistory: 'getPriceHistory',
  profile: 'getProfile',
  dividends: 'getDividends',
  financialStatements: 'getFinancialStatements',
  listings: 'getSecurityListings',
  fxRates: 'getFxRates',
  search: 'searchInstruments',
} as const satisfies Partial<Record<ProviderCapability, keyof MarketDataProvider>>;

export type ImplementableCapability = keyof typeof METHOD_BY_CAPABILITY;

/** Szolgáltató, amelyről tudjuk, hogy az adott képesség metódusa létezik. */
export type ProviderWith<C extends ImplementableCapability> = MarketDataProvider &
  Required<Pick<MarketDataProvider, (typeof METHOD_BY_CAPABILITY)[C]>>;

export function isImplementableCapability(
  capability: ProviderCapability,
): capability is ImplementableCapability {
  return Object.hasOwn(METHOD_BY_CAPABILITY, capability);
}

export function hasCapability<C extends ImplementableCapability>(
  provider: MarketDataProvider,
  capability: C,
): provider is ProviderWith<C> {
  return provider[METHOD_BY_CAPABILITY[capability]] !== undefined;
}

/** A képességlista a ténylegesen megvalósított metódusokból származik – nem lehet „hazudni”. */
export function capabilitiesOf(provider: MarketDataProvider): readonly ProviderCapability[] {
  return (Object.keys(METHOD_BY_CAPABILITY) as ImplementableCapability[]).filter(
    (capability) => provider[METHOD_BY_CAPABILITY[capability]] !== undefined,
  );
}

/** A regisztrált szolgáltatók (élő XOR mock). A választást a `ProviderRouter` végzi. */
export interface ProviderRegistry {
  readonly dataMode: ServerDataMode;
  readonly providers: readonly MarketDataProvider[];
}

export function createProviderRegistry(
  dataMode: ServerDataMode,
  providers: readonly MarketDataProvider[],
): ProviderRegistry {
  // Biztonsági háló: élő módban mock, mock módban élő szolgáltató nem lehet (nincs keverés).
  const foreign = providers.find((p) => p.info.kind !== dataMode);
  if (foreign !== undefined) {
    throw new Error(
      `Programozási hiba: ${foreign.info.id} (${foreign.info.kind}) nem regisztrálható ${dataMode} módban.`,
    );
  }
  return { dataMode, providers };
}
