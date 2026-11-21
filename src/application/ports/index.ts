/**
 * Portok = az alkalmazási réteg által elvárt képességek interfészei.
 * A konkrét megvalósítás (adapter) az `src/infrastructure`-ben van, a `src/config` köti össze.
 *
 * Csak olyan port létezik, amelyet ténylegesen használ egy use case (D-040).
 * Az `AiGateway` (PHASE 11) és a kliensoldali `Logger` a saját fázisában kerül be.
 */
import type {
  AppError,
  CurrencyCode,
  FinancialStatementSet,
  FxRateSet,
  IsoDate,
  Isin,
  ListingId,
  Portfolio,
  PortfolioId,
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
