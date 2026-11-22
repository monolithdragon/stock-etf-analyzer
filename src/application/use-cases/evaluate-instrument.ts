/**
 * Use case-ek: részvény- és ETF-értékelés (score + döntés, PHASE 10).
 *
 * - `evaluateStock(listingId, options)`: PHASE 07 use case (fundamentumok + DCF) → score/döntés.
 * - `evaluateEtf(listingId, options)`: PHASE 08 use case → ETF-score/döntés (külön konfiguráció).
 * - `buildStockEvaluation` / `buildEtfEvaluation` (tiszta): hálózat nélkül, meglévő elemzésből
 *   (a UI ezt hívja, ha a felhasználó a súlyokat vagy a feltevéseket állítja).
 *
 * A UI-ban nincs pontozás; az AI nem hoz döntést.
 */
import type { AppError, Result, StockFundamentalAnalysis } from '@/domain';

import type { AnalyzeEtf } from './analyze-etf';
import type { AnalyzeStockOptions } from './analyze-stock-fundamentals';
import type { AnalyzeStockValuation } from './analyze-stock-valuation';
import type { EtfAnalysis, EtfAnalysisOptions } from '../etf-analysis/types';
import { buildEtfEvaluation } from '../scoring/etf-evaluation';
import { buildStockEvaluation } from '../scoring/stock-evaluation';
import type { EvaluationOptions, InstrumentEvaluation } from '../scoring/types';
import type { StockValuationAnalysis, StockValuationOptions } from '../valuation/types';

export interface StockEvaluationResult {
  readonly fundamentals: StockFundamentalAnalysis;
  readonly valuation: StockValuationAnalysis;
  readonly evaluation: InstrumentEvaluation;
}

export interface EtfEvaluationResult {
  readonly analysis: EtfAnalysis;
  readonly evaluation: InstrumentEvaluation;
}

export type EvaluateStock = (
  listingId: string,
  options?: {
    readonly analysis?: StockValuationOptions & AnalyzeStockOptions;
    readonly evaluation?: EvaluationOptions;
  },
) => Promise<Result<StockEvaluationResult, AppError>>;

export type EvaluateEtf = (
  listingId: string,
  options?: {
    readonly analysis?: EtfAnalysisOptions;
    readonly evaluation?: EvaluationOptions;
  },
) => Promise<Result<EtfEvaluationResult, AppError>>;

export function createEvaluateStock(deps: {
  readonly analyzeStockValuation: AnalyzeStockValuation;
}): EvaluateStock {
  return async (listingId, options = {}) => {
    const analyzed = await deps.analyzeStockValuation(listingId, options.analysis ?? {});
    if (!analyzed.ok) return analyzed;
    const { fundamentals, valuation } = analyzed.value;
    const evaluation = buildStockEvaluation(fundamentals, valuation, options.evaluation ?? {});
    if (!evaluation.ok) return evaluation;
    return { ok: true, value: { fundamentals, valuation, evaluation: evaluation.value } };
  };
}

export function createEvaluateEtf(deps: { readonly analyzeEtf: AnalyzeEtf }): EvaluateEtf {
  return async (listingId, options = {}) => {
    const analysis = await deps.analyzeEtf(listingId, options.analysis ?? {});
    if (!analysis.ok) return analysis;
    const evaluation = buildEtfEvaluation(analysis.value, options.evaluation ?? {});
    if (!evaluation.ok) return evaluation;
    return { ok: true, value: { analysis: analysis.value, evaluation: evaluation.value } };
  };
}
