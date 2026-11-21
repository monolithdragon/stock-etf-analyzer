/**
 * Elemzési eredmény váza. A score és a döntés (BUY/HOLD/SELL jellegű címke) a PHASE 10-ben,
 * a magyarázat a PHASE 11-ben kerül mellé. Ez NEM befektetési tanács és NEM hozamígéret.
 */
import type { FinancialMetric } from '../fundamentals/financial-metric';
import type { IsoTimestamp, ListingId, PortfolioId, SecurityId } from '../shared';

export type AnalysisSubject =
  | { readonly kind: 'stock'; readonly securityId: SecurityId; readonly listingId: ListingId }
  | { readonly kind: 'etf'; readonly securityId: SecurityId; readonly listingId: ListingId }
  | { readonly kind: 'portfolio'; readonly portfolioId: PortfolioId };

/**
 * Adatteljesség (NEM valószínűség és NEM magabiztosság a hozamban):
 * - COMPLETE: minden releváns mutató `OK`;
 * - PARTIAL: van `OK` és van hiányos mutató is;
 * - INSUFFICIENT: egyetlen releváns mutató sem `OK`.
 * A `NOT_APPLICABLE` mutató nem releváns (pl. P/E egy ETF-nél), ezért nem számít hiánynak.
 */
export type AnalysisCompleteness = 'COMPLETE' | 'PARTIAL' | 'INSUFFICIENT';

export interface DataGap {
  readonly metricId: FinancialMetric['id'];
  readonly status: FinancialMetric['value']['status'];
  readonly reason: string;
}

export interface AnalysisResult {
  readonly subject: AnalysisSubject;
  readonly generatedAt: IsoTimestamp;
  readonly metrics: readonly FinancialMetric[];
  readonly completeness: AnalysisCompleteness;
  readonly dataGaps: readonly DataGap[];
}

export function summarizeCompleteness(metrics: readonly FinancialMetric[]): {
  readonly completeness: AnalysisCompleteness;
  readonly dataGaps: readonly DataGap[];
} {
  const relevant = metrics.filter((m) => m.value.status !== 'NOT_APPLICABLE');
  const dataGaps: DataGap[] = [];
  for (const metric of relevant) {
    if (metric.value.status !== 'OK') {
      dataGaps.push({
        metricId: metric.id,
        status: metric.value.status,
        reason: metric.value.reason,
      });
    }
  }
  const okCount = relevant.length - dataGaps.length;
  const completeness: AnalysisCompleteness =
    okCount === 0 ? 'INSUFFICIENT' : dataGaps.length === 0 ? 'COMPLETE' : 'PARTIAL';
  return { completeness, dataGaps };
}

export function createAnalysisResult(input: {
  readonly subject: AnalysisSubject;
  readonly generatedAt: IsoTimestamp;
  readonly metrics: readonly FinancialMetric[];
}): AnalysisResult {
  return { ...input, ...summarizeCompleteness(input.metrics) };
}
