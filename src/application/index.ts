/**
 * Alkalmazási réteg: use case-ek és portok. A UI csak ezen keresztül ér el adatot
 * (soha nem hív közvetlenül szolgáltatói API-t vagy `fetch`-et).
 */
import type { AnalyzeEtf } from './use-cases/analyze-etf';
import type { AnalyzePortfolio } from './use-cases/analyze-portfolio';
import type { AnalyzeStockFundamentals } from './use-cases/analyze-stock-fundamentals';
import type {
  AnalyzeStockValuation,
  RecalculateStockValuation,
} from './use-cases/analyze-stock-valuation';
import type { ConvertMoney } from './use-cases/convert-money';
import type { CreatePortfolio } from './use-cases/create-portfolio';
import type { EvaluateEtf, EvaluateStock } from './use-cases/evaluate-instrument';
import type { ExplainAnalysis } from './use-cases/explain-analysis';
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
export * from './use-cases/analyze-etf';
export * from './etf-analysis/types';
export {
  buildEtfAnalysis,
  ETF_ANALYSIS_DISCLAIMER,
  ETF_NOT_APPLICABLE,
} from './etf-analysis/etf-analysis';
export { DEFAULT_TER_IMPACT } from './etf-analysis/etf-costs';
export { DEFAULT_MIN_RISK_OBSERVATIONS } from './etf-analysis/etf-risk';
export * from './use-cases/convert-money';
export * from './use-cases/get-listing-quote';
export * from './use-cases/get-market-data';
export * from './use-cases/get-market-reference-data';
export * from './use-cases/record-transaction';
export * from './use-cases/create-portfolio';
export * from './use-cases/analyze-portfolio';
export * from './portfolio/types';
export {
  buildPortfolioAnalysis,
  ACCOUNTING_METHOD,
  PORTFOLIO_ANALYSIS_DISCLAIMER,
} from './portfolio/portfolio-analysis';
export { MAX_FORWARD_FILL_DAYS, MAX_CORRELATION_POSITIONS } from './portfolio/portfolio-history';
export * from './use-cases/evaluate-instrument';
export * from './scoring/types';
export {
  buildStockEvaluation,
  buildStockFeatures,
  buildStockFlags,
  stockPriceInvalidation,
} from './scoring/stock-evaluation';
export { buildEtfEvaluation, buildEtfFeatures } from './scoring/etf-evaluation';
export { portfolioWeightFeature } from './scoring/portfolio-context';
export * from './use-cases/explain-analysis';
export {
  aiRef,
  buildInstrumentAiInput,
  buildPortfolioAiInput,
  formatAiDisplay,
  type InstrumentAiInputOptions,
} from './explanation/build-ai-input';

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
  /** PHASE 12: portfólió létrehozása (a UI első lépése a tranzakció-rögzítés előtt). */
  readonly createPortfolio: CreatePortfolio;
  /** PHASE 06: részvény fundamentális elemzés (UI a PHASE 12-ben). */
  readonly analyzeStockFundamentals: AnalyzeStockFundamentals;
  /** PHASE 07: értékelés + DCF (lekéréssel). */
  readonly analyzeStockValuation: AnalyzeStockValuation;
  /** PHASE 07: értékelés újraszámolása meglévő elemzésből, új feltevésekkel (hálózat nélkül). */
  readonly recalculateStockValuation: RecalculateStockValuation;
  /** PHASE 08: ETF-elemzés (a részvénylogikától különválasztva; UI a PHASE 12-ben). */
  readonly analyzeEtf: AnalyzeEtf;
  /** PHASE 09: portfólióelemzés (pozíciók, P/L két nézetben, kitettség, koncentráció, historikus). */
  readonly analyzePortfolio: AnalyzePortfolio;
  /** PHASE 10: részvény-score és determinisztikus döntés (fundamentumok + DCF lekéréssel). */
  readonly evaluateStock: EvaluateStock;
  /** PHASE 10: ETF-score és döntés (külön konfiguráció, a részvénytől elválasztva). */
  readonly evaluateEtf: EvaluateEtf;
  /**
   * PHASE 11: magyarázat. Alapból szabályalapú (offline, ingyenes); `mode: 'llm'` esetén a proxyn
   * át LLM is – hibánál a szabályalapú marad megjelenítve.
   */
  readonly explainAnalysis: ExplainAnalysis;
}
