/**
 * Use case: legutóbbi ár lekérése egy tőzsdei jegyzéshez, frissesség-értékeléssel.
 *
 * A gateway hibái (NETWORK, TIMEOUT, RATE_LIMITED, NOT_FOUND, UPSTREAM) változatlanul
 * továbbmennek – a UI ezek alapján jelez és ajánl újrapróbálást (`isRetryable`).
 */
import {
  assessFreshness,
  capFreshnessForCache,
  ok,
  parseListingId,
  validateFields,
  type AppError,
  type FreshnessPolicy,
  type Quote,
  type Result,
} from '@/domain';

import type { Clock, MarketDataGateway } from '../ports';

/**
 * Kiinduló frissesség-szabály árfolyamhoz (ARCHITECTURE 11.):
 * 15 percig FRESH, 3 napig STALE, utána EXPIRED.
 * `[FELTÉTELEZÉS]` – a piaci naptárt is figyelembe vevő végleges szabály a PHASE 13 feladata.
 */
export const QUOTE_FRESHNESS_POLICY: FreshnessPolicy = {
  freshForMs: 15 * 60 * 1000,
  expiresAfterMs: 3 * 24 * 60 * 60 * 1000,
};

export type GetListingQuote = (listingId: string) => Promise<Result<Quote, AppError>>;

export interface GetListingQuoteDeps {
  readonly marketData: MarketDataGateway;
  readonly clock: Clock;
  readonly freshnessPolicy?: FreshnessPolicy;
}

export function createGetListingQuote(deps: GetListingQuoteDeps): GetListingQuote {
  const policy = deps.freshnessPolicy ?? QUOTE_FRESHNESS_POLICY;

  return async (rawListingId) => {
    const parsed = validateFields(
      { listingId: parseListingId(rawListingId) },
      'Érvénytelen kérés.',
    );
    if (!parsed.ok) return parsed;

    const quote = await deps.marketData.getQuote(parsed.value.listingId);
    if (!quote.ok) return quote;

    // A frissességet MI számoljuk a saját óránkkal, nem bízzuk a forrásra.
    // PHASE 13: offline tartalékból kiszolgált ár soha nem FRESH (D-082).
    const freshness = capFreshnessForCache(
      assessFreshness(quote.value.asOf, deps.clock.now(), policy),
      quote.value.provenance.cache,
    );
    return ok({ ...quote.value, provenance: { ...quote.value.provenance, freshness } });
  };
}
