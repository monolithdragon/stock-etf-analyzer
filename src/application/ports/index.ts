/**
 * Portok = az alkalmazási réteg által elvárt képességek interfészei.
 * A konkrét megvalósítás (adapter) az `src/infrastructure`-ben van, a `src/config` köti össze.
 *
 * Csak olyan port létezik, amelyet ténylegesen használ egy use case (D-040).
 * PHASE 11: `AiGateway` (opcionális LLM-magyarázat a proxyn át). A kliensoldali `Logger` később.
 * PHASE 13 (D-082, D-083): `CacheStore`, `WatchlistRepository`, `PreferencesRepository`,
 * `ConnectivityMonitor`; a `PortfolioRepository` listázással és törléssel bővült.
 * PHASE 14 (D-088): `AlertRuleRepository`.
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

import type { CacheRecord, ConnectivityState } from '../cache/types';
import type { AlertRule } from '../insights/alerts';
import type { UserPreferences } from '../preferences/user-preferences';
import type { WatchlistItem } from '../watchlist/types';

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
 * Portfólió-tároló. PHASE 13-tól SQLite (natív), memóriában (web, tesztek).
 * Hiányzó rekord = `ok(null)` (nem hiba); a use case dönti el, hogy ez `NOT_FOUND`-e.
 * Tárolási hiba vagy SÉRÜLT rekord = `STORAGE` AppError – sérült tranzakciót soha nem hagyunk
 * ki csendben (a portfólió-összegek hamisak lennének).
 */
export interface PortfolioRepository {
  getPortfolio(id: PortfolioId): Promise<Result<Portfolio | null, AppError>>;
  savePortfolio(portfolio: Portfolio): Promise<Result<void, AppError>>;
  listTransactions(portfolioId: PortfolioId): Promise<Result<readonly Transaction[], AppError>>;
  addTransaction(transaction: Transaction): Promise<Result<void, AppError>>;
  /** PHASE 13: export és törlés miatt. */
  listPortfolios(): Promise<Result<readonly Portfolio[], AppError>>;
  /** PHASE 13: minden portfólió és tranzakció végleges törlése (felhasználói kérésre). */
  deleteAll(): Promise<Result<void, AppError>>;
}

/**
 * Eszköz-cache tároló (PHASE 13, D-082). Csak tárol – a szabályokat (TTL, offline tartalék,
 * invalidálás) a `createMarketDataCache` alkalmazza. Sérült rekordnál a tároló `ok(null)`-t ad
 * és törli a rekordot (a cache újratölthető, a hiba nem blokkolhatja az appot).
 */
export interface CacheStore {
  get(key: string): Promise<Result<CacheRecord | null, AppError>>;
  put(record: CacheRecord): Promise<Result<void, AppError>>;
  delete(key: string): Promise<Result<void, AppError>>;
  /** Rekordok jegyzés szerint (`listingIds` nélkül: mind). */
  list(filter?: {
    readonly listingIds?: readonly string[];
  }): Promise<Result<readonly CacheRecord[], AppError>>;
  /** Kézi frissítés: a rekordok megmaradnak (offline tartalék), de a következő olvasás a hálózatot próbálja. */
  markInvalidated(listingIds: readonly string[], at: string): Promise<Result<number, AppError>>;
  /** Teljes invalidálás: minden rekord törlése. */
  clear(): Promise<Result<number, AppError>>;
  /** A megőrzési időn túli rekordok törlése (`retainUntil < now`). */
  prune(now: string): Promise<Result<number, AppError>>;
}

/** Figyelőlista tárolása (PHASE 13). A sorrend a hozzáadás sorrendje. */
export interface WatchlistRepository {
  list(): Promise<Result<readonly WatchlistItem[], AppError>>;
  add(item: WatchlistItem, addedAt: string): Promise<Result<void, AppError>>;
  remove(listingId: string): Promise<Result<void, AppError>>;
  clear(): Promise<Result<void, AppError>>;
}

/**
 * Riasztási szabályok tárolása (PHASE 14, D-088). `save` = beszúrás vagy felülírás azonosító
 * szerint (a sorrend a létrehozás sorrendje). Sérült sor: kimarad és törlődik (újra felvehető).
 */
export interface AlertRuleRepository {
  list(): Promise<Result<readonly AlertRule[], AppError>>;
  save(rule: AlertRule): Promise<Result<void, AppError>>;
  remove(id: string): Promise<Result<void, AppError>>;
  clear(): Promise<Result<void, AppError>>;
}

/**
 * Beállítások tárolása (PHASE 13, D-083). `ok(null)` = még nincs mentve (alapértékek).
 * Sérült tárolt érték → `ok(null)` + a nyers érték biztonsági mentése (nem dob kivételt).
 */
export interface PreferencesRepository {
  load(): Promise<Result<UserPreferences | null, AppError>>;
  save(preferences: UserPreferences): Promise<Result<void, AppError>>;
  clear(): Promise<Result<void, AppError>>;
}

/** Hálózati állapot (PHASE 13). `unknown` = nem tudjuk (pl. induláskor) → a hálózatot próbáljuk. */
export interface ConnectivityMonitor {
  current(): ConnectivityState;
  /** Feliratkozás állapotváltozásra; a visszaadott függvény leiratkozik. */
  subscribe(listener: (state: ConnectivityState) => void): () => void;
}

/**
 * Opcionális LLM-magyarázat a proxyn át (PHASE 11, D-078). A kulcs és a szolgáltató a szerveren
 * van; a kliens csak a validált `AiInputDto`-t küldi. Hiba (kikapcsolt AI, timeout, rate limit,
 * érvénytelen válasz) esetén `AI`/`TIMEOUT`/`RATE_LIMITED` AppError – az app ettől használható marad.
 */
export interface AiGateway {
  explain(request: AiExplainRequestDto): Promise<Result<AiExplanationDto, AppError>>;
}
