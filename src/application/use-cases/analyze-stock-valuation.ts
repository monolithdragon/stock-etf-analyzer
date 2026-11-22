/**
 * Use case-ek: részvény értékelés és DCF (PHASE 07).
 *
 * - `analyzeStockValuation(listingId, options)`: lekéri a fundamentális elemzést (PHASE 06 use
 *   case) és felépíti az értékelést (szorzók, sávok, DCF Bear/Base/Bull, szenzitivitás).
 * - `recalculateStockValuation(fundamentals, options)`: ugyanaz hálózat nélkül, egy már
 *   meglévő elemzésből – a UI ezt hívja, amikor a felhasználó a feltevéseket állítja.
 *   A UI-komponensben így nincs DCF-számítás.
 */
import {
  toIsoTimestamp,
  type AppError,
  type Result,
  type StockFundamentalAnalysis,
} from '@/domain';

import type { Clock } from '../ports';
import type { AnalyzeStockFundamentals, AnalyzeStockOptions } from './analyze-stock-fundamentals';
import { buildStockValuation } from '../valuation/stock-valuation';
import type { StockValuationAnalysis, StockValuationOptions } from '../valuation/types';

export interface StockValuationResult {
  readonly fundamentals: StockFundamentalAnalysis;
  readonly valuation: StockValuationAnalysis;
}

export type AnalyzeStockValuation = (
  listingId: string,
  options?: StockValuationOptions & AnalyzeStockOptions,
) => Promise<Result<StockValuationResult, AppError>>;

export type RecalculateStockValuation = (
  fundamentals: StockFundamentalAnalysis,
  options?: StockValuationOptions,
) => StockValuationAnalysis;

export function createRecalculateStockValuation(deps: {
  readonly clock: Clock;
}): RecalculateStockValuation {
  return (fundamentals, options = {}) =>
    buildStockValuation(fundamentals, options, toIsoTimestamp(deps.clock.now()));
}

export function createAnalyzeStockValuation(deps: {
  readonly analyzeStockFundamentals: AnalyzeStockFundamentals;
  readonly clock: Clock;
}): AnalyzeStockValuation {
  const recalculate = createRecalculateStockValuation(deps);
  return async (listingId, options = {}) => {
    const { qualitativeFindings, ...valuationOptions } = options;
    const fundamentals = await deps.analyzeStockFundamentals(
      listingId,
      qualitativeFindings === undefined ? {} : { qualitativeFindings },
    );
    if (!fundamentals.ok) return fundamentals;
    return {
      ok: true,
      value: {
        fundamentals: fundamentals.value,
        valuation: recalculate(fundamentals.value, valuationOptions),
      },
    };
  };
}
