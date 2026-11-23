/**
 * Portok = az alkalmazási réteg által elvárt képességek interfészei.
 * A konkrét megvalósítás (adapter) az `src/infrastructure`-ben van, a `src/config` köti össze.
 *
 * Csak olyan port létezik, amelyet ténylegesen használ egy use case (D-040).
 * PHASE 11: `AiGateway` (opcionális LLM-magyarázat a proxyn át). A kliensoldali `Logger` később.
 */
import type { AiExplainRequestDto, AiExplanationDto } from '@/contracts';
import type {
  AppError,
  CurrencyCode,
  DividendHistory,
  FinancialStatementSet,
  FxRateSet,
  InstrumentProfile,
  InstrumentSearchResult,
  IsoDate,
  Isin,
  ListingId,
  Portfolio,
  PortfolioId,
  PriceAdjustment,
  PriceSeries,
  Quote,
  Result,
  SecurityListings,
  StatementFrequency,
  Transaction,
} from '@/domain';

/** Az aktuális idő forrása – injektálva, hogy a frissesség és a „ma” tesztelhető legyen. */
export interface Clock {
  now(): Date;
}

/** Lokális azonosító-generátor (tranzakció, portfólió). */
export interface IdGenerator {
  next(prefix: string): string;
}

/**
 * Piaci adatok forrása. Élő módban a proxy kliens, demó módban a mock adapter.
 * Minden visszaadott érték provenance-t hordoz (forrás, `fetchedAt`, `asOf`) – ebből
 * számolja a use case a frissességet, és ebből tud a UI kézi frissítést ajánlani.
 */
export interface MarketDataGateway {
  getQuote(listingId: ListingId): Promise<Result<Quote, AppError>>;
  /** Egy értékpapír (ISIN) ismert tőzsdei jegyzései (D-025). */
  getSecurityListings(isin: Isin): Promise<Result<SecurityListings, AppError>>;
  /** Jelentett kimutatások egy forrásból (US: SEC). */
  getFinancialStatements(
    listingId: ListingId,
    frequency: StatementFrequency,
  ): Promise<Result<FinancialStatementSet, AppError>>;
  /** Napi ártörténet (PHASE 04B). A free EODHD csak 1 évet ad – ezt a `notes` jelzi. */
  getPriceHistory(request: {
    readonly listingId: ListingId;
    readonly from: IsoDate;
    readonly to: IsoDate;
    readonly adjustment: PriceAdjustment;
  }): Promise<Result<PriceSeries, AppError>>;
  /** Instrumentum-profil (free: csak US). Nem US → `UNAVAILABLE / PLAN_LIMIT`. */
  getInstrumentProfile(listingId: ListingId): Promise<Result<InstrumentProfile, AppError>>;
  getDividends(request: {
    readonly listingId: ListingId;
    readonly from: IsoDate;
    readonly to: IsoDate;
  }): Promise<Result<DividendHistory, AppError>>;
  /** Keresés ticker, név vagy ISIN alapján. */
  searchInstruments(query: string): Promise<Result<InstrumentSearchResult, AppError>>;
}

/** Referencia-devizaárfolyamok (ECB, EUR pivot). A keresztárfolyamot a domain számolja. */
export interface FxGateway {
  getReferenceRates(request: {
    readonly quotes: readonly CurrencyCode[];
    /** `null` = legutóbbi közzétett. */
    readonly date: IsoDate | null;
  }): Promise<Result<FxRateSet, AppError>>;
}

/**
 * Portfólió-tároló. Az MVP-ben memóriában (mock), a PHASE 13-tól SQLite.
 * Hiányzó rekord = `ok(null)` (nem hiba); a use case dönti el, hogy ez `NOT_FOUND`-e.
 * Tárolási hiba = `STORAGE` AppError.
 */
export interface PortfolioRepository {
  getPortfolio(id: PortfolioId): Promise<Result<Portfolio | null, AppError>>;
  savePortfolio(portfolio: Portfolio): Promise<Result<void, AppError>>;
  listTransactions(portfolioId: PortfolioId): Promise<Result<readonly Transaction[], AppError>>;
  addTransaction(transaction: Transaction): Promise<Result<void, AppError>>;
}

/**
 * Opcionális LLM-magyarázat a proxyn át (PHASE 11, D-078). A kulcs és a szolgáltató a szerveren
 * van; a kliens csak a validált `AiInputDto`-t küldi. Hiba (kikapcsolt AI, timeout, rate limit,
 * érvénytelen válasz) esetén `AI`/`TIMEOUT`/`RATE_LIMITED` AppError – az app ettől használható marad.
 */
export interface AiGateway {
  explain(request: AiExplainRequestDto): Promise<Result<AiExplanationDto, AppError>>;
}
