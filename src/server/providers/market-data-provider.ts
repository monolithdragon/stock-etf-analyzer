/**
 * `MarketDataProvider` – a szolgáltató-adapterek közös szerződése (PHASE 04 feladat 1. és 4.).
 *
 * Elvek:
 * - Minden képesség KÜLÖN metódus (quote, ártörténet, kimutatások, jegyzések, FX…), és mind
 *   opcionális: egy adapter csak azt valósítja meg, amit a forrás TÉNYLEGESEN szolgáltat.
 *   Nem ígérünk olyan adatot, amit az API nem ad (pl. az ECB nem ad árfolyamot).
 * - A visszatérési érték MINDIG normalizált domain-objektum (a domain konstruktorain átment,
 *   provenance-szel). A szolgáltatói formátum (DTO) az adapter mappáján belül marad.
 * - A PHASE 04B `ProviderRouter`-e a `capabilitiesOf()` alapján választ és vált tartalékra.
 *
 * Még NINCS metódus (nincs hozzá domain-típus és igazolt ingyenes forrás): profil, osztalék/split,
 * ETF-metaadat, ETF-holdings. Ezeket a PHASE 04B (FMP/EODHD) és a PHASE 08 vezeti be
 * a saját domain-típusukkal együtt; addig a health végpont „nem elérhető” képességként jelzi.
 */
import type { ProviderCapability, ServerDataMode } from '@/contracts';
import type {
  CurrencyCode,
  FinancialStatementSet,
  FxRateSet,
  IsoDate,
  Isin,
  ListingId,
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
  readonly note: string | null;
}

export interface PriceHistoryRequest {
  readonly listingId: ListingId;
  readonly from: IsoDate;
  readonly to: IsoDate;
  readonly adjusted: boolean;
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
  getQuote?(listingId: ListingId): Promise<Result<Quote>>;
  getPriceHistory?(request: PriceHistoryRequest): Promise<Result<PriceSeries>>;
  getFinancialStatements?(
    listingId: ListingId,
    frequency: StatementFrequency,
  ): Promise<Result<FinancialStatementSet>>;
  getSecurityListings?(isin: Isin): Promise<Result<SecurityListings>>;
  getFxRates?(request: FxRatesRequest): Promise<Result<FxRateSet>>;
}

const METHOD_BY_CAPABILITY = {
  quote: 'getQuote',
  priceHistory: 'getPriceHistory',
  financialStatements: 'getFinancialStatements',
  listings: 'getSecurityListings',
  fxRates: 'getFxRates',
} as const satisfies Partial<Record<ProviderCapability, keyof MarketDataProvider>>;

type ImplementableCapability = keyof typeof METHOD_BY_CAPABILITY;

/** A képességlista a ténylegesen megvalósított metódusokból származik – nem lehet „hazudni”. */
export function capabilitiesOf(provider: MarketDataProvider): readonly ProviderCapability[] {
  return (Object.keys(METHOD_BY_CAPABILITY) as ImplementableCapability[]).filter(
    (capability) => provider[METHOD_BY_CAPABILITY[capability]] !== undefined,
  );
}

/** A regisztrált szolgáltatók; a PHASE 04B-ben ProviderRouter váltja (prioritás, fallback, kvóta). */
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

/** Az első szolgáltató, amely az adott képességet megvalósítja (04A: nincs még prioritási lista). */
export function findProvider<C extends ImplementableCapability>(
  registry: ProviderRegistry,
  capability: C,
):
  | (MarketDataProvider & Required<Pick<MarketDataProvider, (typeof METHOD_BY_CAPABILITY)[C]>>)
  | null {
  const method = METHOD_BY_CAPABILITY[capability];
  const found = registry.providers.find((p) => p[method] !== undefined);
  // A `find` feltétele garantálja, hogy a metódus létezik – a szűkítés biztonságos.
  return (found ?? null) as
    | (MarketDataProvider & Required<Pick<MarketDataProvider, (typeof METHOD_BY_CAPABILITY)[C]>>)
    | null;
}
