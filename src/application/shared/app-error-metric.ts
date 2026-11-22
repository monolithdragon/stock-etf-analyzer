/**
 * Sikertelen lekérés leképezése mutató-státuszra – közös a részvény- és az ETF-elemzésben
 * (PHASE 06-ban készült, PHASE 08-ban kiemelve a `stock-analysis` modulból).
 */
import {
  metricError,
  metricMissing,
  metricUnavailable,
  type AppError,
  type Metric,
} from '@/domain';

/**
 * Sikertelen lekérés → mutató-státusz (a többi rész ettől még elkészül):
 * - `UNAVAILABLE` (csomag, kvóta, lefedettség) → `UNAVAILABLE` az ok-kóddal;
 * - `NOT_FOUND`, `MISSING_DATA` → `MISSING`;
 * - minden más (hálózat, időtúllépés, szolgáltatói hiba) → `ERROR` (újrapróbálható).
 */
export function appErrorToMetric<T>(error: AppError, resource: string): Metric<T> {
  const reason = `${resource}: ${error.message}`;
  switch (error.kind) {
    case 'UNAVAILABLE':
      return metricUnavailable(error.reason, reason);
    case 'NOT_FOUND':
    case 'MISSING_DATA':
      return metricMissing(reason);
    default:
      return metricError(reason);
  }
}
