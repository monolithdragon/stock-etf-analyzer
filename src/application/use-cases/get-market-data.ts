/**
 * Use case-ek: ártörténet, instrumentum-profil, osztalék, keresés (PHASE 04B).
 *
 * Kézi frissítés és frissesség (PHASE 04 feladat 10.): a cache-t (PHASE 13, D-082) a gateway-
 * dekorátor kezeli, a use case nem tud róla. A kimenet provenance-e hordozza a forrást, a `fetchedAt`-ot és az `asOf`-ot;
 * a `freshness`-t a SAJÁT óránkkal számoljuk (nem bízzuk a forrásra). A UI ebből jelzi az
 * elavultságot és kínál „Frissítés” gombot – a frissítés egyszerűen a use case újrahívása.
 */
import {
  assessFreshness,
  capFreshnessForCache,
  ok,
  parseIsoDate,
  parseListingId,
  parseNullable,
  parseSearchQuery,
  toUtcIsoDate,
  validateFields,
  type AppError,
  type DividendHistory,
  type FreshnessPolicy,
  type InstrumentProfile,
  type InstrumentSearchResult,
  type PriceAdjustment,
  type PriceSeries,
  type Result,
} from '@/domain';

import type { Clock, MarketDataGateway } from '../ports';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Napi (EOD) ártörténet frissessége az utolsó árpont napjától `[FELTÉTELEZÉS – PHASE 13]`:
 * 4 napig FRESH (hétvége + ünnep), 14 napig STALE, utána EXPIRED.
 */
export const PRICE_HISTORY_FRESHNESS_POLICY: FreshnessPolicy = {
  freshForMs: 4 * DAY_MS,
  expiresAfterMs: 14 * DAY_MS,
};

export interface MarketDataDeps {
  readonly marketData: MarketDataGateway;
  readonly clock: Clock;
}

export interface PriceHistoryOptions {
  /** ÉÉÉÉ-HH-NN; alapértelmezés: `to` − 365 nap. */
  readonly from?: string;
  /** ÉÉÉÉ-HH-NN; alapértelmezés: ma (UTC). */
  readonly to?: string;
  /** Alapértelmezés: `SPLIT_DIVIDEND` (mindkét élő forrás adja). */
  readonly adjustment?: PriceAdjustment;
}

export type GetPriceHistory = (
  listingId: string,
  options?: PriceHistoryOptions,
) => Promise<Result<PriceSeries, AppError>>;
export type GetInstrumentProfile = (
  listingId: string,
) => Promise<Result<InstrumentProfile, AppError>>;
export type GetDividendHistory = (
  listingId: string,
  options?: { readonly from?: string; readonly to?: string },
) => Promise<Result<DividendHistory, AppError>>;
export type SearchInstruments = (
  query: string,
) => Promise<Result<InstrumentSearchResult, AppError>>;

export function createGetPriceHistory(deps: MarketDataDeps): GetPriceHistory {
  return async (rawListingId, options = {}) => {
    const now = deps.clock.now();
    const fields = validateFields(
      {
        listingId: parseListingId(rawListingId),
        to: parseNullable(options.to, parseIsoDate),
        from: parseNullable(options.from, parseIsoDate),
      },
      'Érvénytelen kérés.',
    );
    if (!fields.ok) return fields;
    const to = fields.value.to ?? toUtcIsoDate(now);
    const from = fields.value.from ?? toUtcIsoDate(new Date(Date.parse(to) - 365 * DAY_MS));
    const series = await deps.marketData.getPriceHistory({
      listingId: fields.value.listingId,
      from,
      to,
      adjustment: options.adjustment ?? 'SPLIT_DIVIDEND',
    });
    if (!series.ok) return series;
    const freshness = capFreshnessForCache(
      assessFreshness(series.value.provenance.asOf, now, PRICE_HISTORY_FRESHNESS_POLICY),
      series.value.provenance.cache,
    );
    return ok({ ...series.value, provenance: { ...series.value.provenance, freshness } });
  };
}

export function createGetInstrumentProfile(deps: MarketDataDeps): GetInstrumentProfile {
  return async (rawListingId) => {
    const fields = validateFields(
      { listingId: parseListingId(rawListingId) },
      'Érvénytelen kérés.',
    );
    if (!fields.ok) return fields;
    // A profil-forrás nem közöl dátumot (`asOf: null`) → a frissesség UNKNOWN marad (őszinte).
    return deps.marketData.getInstrumentProfile(fields.value.listingId);
  };
}

export function createGetDividendHistory(deps: MarketDataDeps): GetDividendHistory {
  return async (rawListingId, options = {}) => {
    const fields = validateFields(
      {
        listingId: parseListingId(rawListingId),
        to: parseNullable(options.to, parseIsoDate),
        from: parseNullable(options.from, parseIsoDate),
      },
      'Érvénytelen kérés.',
    );
    if (!fields.ok) return fields;
    const to = fields.value.to ?? toUtcIsoDate(deps.clock.now());
    const from = fields.value.from ?? toUtcIsoDate(new Date(Date.parse(to) - 5 * 365 * DAY_MS));
    return deps.marketData.getDividends({ listingId: fields.value.listingId, from, to });
  };
}

export function createSearchInstruments(deps: MarketDataDeps): SearchInstruments {
  return async (rawQuery) => {
    const fields = validateFields({ query: parseSearchQuery(rawQuery) }, 'Érvénytelen keresés.');
    if (!fields.ok) return fields;
    return deps.marketData.searchInstruments(fields.value.query);
  };
}
