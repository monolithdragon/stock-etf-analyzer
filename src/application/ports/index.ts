/**
 * Portok = az alkalmazási réteg által elvárt képességek interfészei.
 * A konkrét megvalósítás (adapter) az `src/infrastructure`-ben van, a `src/config` köti össze.
 *
 * Csak olyan port létezik, amelyet ténylegesen használ egy use case (D-040).
 * A `FxGateway` (PHASE 04A), az `AiGateway` (PHASE 11) és a `Logger` a saját fázisában kerül be.
 */
import type {
  AppError,
  ListingId,
  Portfolio,
  PortfolioId,
  Quote,
  Result,
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

/** Piaci adatok forrása. Élő módban a proxy kliens (PHASE 04A), demó módban a mock adapter. */
export interface MarketDataGateway {
  getQuote(listingId: ListingId): Promise<Result<Quote, AppError>>;
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
