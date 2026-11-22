/**
 * Alkalmazási réteg: use case-ek és portok. A UI csak ezen keresztül ér el adatot
 * (soha nem hív közvetlenül szolgáltatói API-t vagy `fetch`-et).
 */
import type { AnalyzeStockFundamentals } from './use-cases/analyze-stock-fundamentals';
import type {
  AnalyzeStockValuation,
  RecalculateStockValuation,
} from './use-cases/analyze-stock-valuation';
import type { ConvertMoney } from './use-cases/convert-money';
import type { GetListingQuote } from './use-cases/get-listing-quote';
import type {
  GetDividendHistory,
  GetInstrumentProfile,
  GetPriceHistory,
  SearchInstruments,
} from './use-cases/get-market-data';
import type {
  GetFinancialStatements,
  GetSecurityListings,
} from './use-cases/get-market-reference-data';
import type { RecordTransaction } from './use-cases/record-transaction';

export type * from './ports';
export * from './use-cases/analyze-stock-fundamentals';
export * from './use-cases/analyze-stock-valuation';
export * from './valuation/types';
export { buildStockValuation } from './valuation/stock-valuation';
export { buildDcfInputModel, DCF_INPUT_LABELS } from './valuation/dcf-inputs';
export * from './valuation/defaults';
export * from './use-cases/convert-money';
export * from './use-cases/get-listing-quote';
export * from './use-cases/get-market-data';
export * from './use-cases/get-market-reference-data';
export * from './use-cases/record-transaction';

/** A UI számára elérhető szolgáltatások – a composition root (`src/config/container.ts`) állítja elő. */
export interface AppServices {
  readonly getListingQuote: GetListingQuote;
  readonly getSecurityListings: GetSecurityListings;
  readonly getFinancialStatements: GetFinancialStatements;
  readonly getPriceHistory: GetPriceHistory;
  readonly getInstrumentProfile: GetInstrumentProfile;
  readonly getDividendHistory: GetDividendHistory;
  readonly searchInstruments: SearchInstruments;
  readonly convertMoney: ConvertMoney;
  readonly recordTransaction: RecordTransaction;
  /** PHASE 06: részvény fundamentális elemzés (UI a PHASE 12-ben). */
  readonly analyzeStockFundamentals: AnalyzeStockFundamentals;
  /** PHASE 07: értékelés + DCF (lekéréssel). */
  readonly analyzeStockValuation: AnalyzeStockValuation;
  /** PHASE 07: értékelés újraszámolása meglévő elemzésből, új feltevésekkel (hálózat nélkül). */
  readonly recalculateStockValuation: RecalculateStockValuation;
}
