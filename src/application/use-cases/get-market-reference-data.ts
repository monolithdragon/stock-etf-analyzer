/**
 * Use case-ek: értékpapír jegyzései (ISIN → listingek) és jelentett kimutatások.
 *
 * Frissítés és frissesség (PHASE 04 feladat 10.): minden hívás friss lekérés (cache a
 * PHASE 13-ban). A kimenet provenance-e tartalmazza a `fetchedAt`/`asOf` mezőt és a SAJÁT
 * óránkkal számolt `freshness`-t – a UI ebből jelzi az elavultságot és ajánl kézi frissítést.
 */
import {
  assessFreshness,
  ok,
  parseIsin,
  parseListingId,
  validateFields,
  type AppError,
  type FinancialStatementSet,
  type FreshnessPolicy,
  type Result,
  type SecurityListings,
  type StatementFrequency,
} from '@/domain';

import type { Clock, MarketDataGateway } from '../ports';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Kimutatás-készlet frissessége a legutolsó felhasznált filing dátumától (`asOf`)
 * `[FELTÉTELEZÉS – PHASE 13]`: negyedévesnél ~1 negyedév + türelmi idő, évesnél ~1 év + türelem.
 */
export const STATEMENT_FRESHNESS_POLICIES: Readonly<Record<StatementFrequency, FreshnessPolicy>> = {
  quarterly: { freshForMs: 120 * DAY_MS, expiresAfterMs: 400 * DAY_MS },
  annual: { freshForMs: 400 * DAY_MS, expiresAfterMs: 800 * DAY_MS },
};

export type GetSecurityListings = (isin: string) => Promise<Result<SecurityListings, AppError>>;
export type GetFinancialStatements = (
  listingId: string,
  frequency: StatementFrequency,
) => Promise<Result<FinancialStatementSet, AppError>>;

export interface MarketReferenceDeps {
  readonly marketData: MarketDataGateway;
  readonly clock: Clock;
}

export function createGetSecurityListings(deps: MarketReferenceDeps): GetSecurityListings {
  return async (rawIsin) => {
    const parsed = validateFields({ isin: parseIsin(rawIsin) }, 'Érvénytelen kérés.');
    if (!parsed.ok) return parsed;
    // Az OpenFIGI nem közöl dátumot (`asOf: null`) → a frissesség UNKNOWN marad, ez őszinte.
    return deps.marketData.getSecurityListings(parsed.value.isin);
  };
}

export function createGetFinancialStatements(deps: MarketReferenceDeps): GetFinancialStatements {
  return async (rawListingId, frequency) => {
    const parsed = validateFields(
      { listingId: parseListingId(rawListingId) },
      'Érvénytelen kérés.',
    );
    if (!parsed.ok) return parsed;
    const result = await deps.marketData.getFinancialStatements(parsed.value.listingId, frequency);
    if (!result.ok) return result;
    const freshness = assessFreshness(
      result.value.provenance.asOf,
      deps.clock.now(),
      STATEMENT_FRESHNESS_POLICIES[frequency],
    );
    return ok({ ...result.value, provenance: { ...result.value.provenance, freshness } });
  };
}
