/**
 * `eodhd` adapter: EODHD REST API (PHASE 04B, D-049…D-052).
 *
 * Képességek a free csomagban (élő próba + `/api/user` 2026-11-21: `subscriptionType: free`,
 * `dailyRateLimit: 20`): késleltetett quote, EOD ártörténet (1 év), osztalék, keresés
 * (ticker/név/ISIN), ISIN → jegyzések PÉNZNEMMEL. Fundamentum (profil, ETF-metaadat):
 * HTTP 403 „Only EOD data allowed for free users” → NINCS megvalósítva.
 *
 * A jegyzés pénzneme: a quote/eod válasz NEM közli. Forrása (D-052):
 * 1. helyszíni szabály (US → USD, Xetra → EUR), vagy
 * 2. az EODHD kereső (`Code` + `Exchange` pontos egyezés), 24 órás memóval. Ez +1 hívás
 *    jegyzésenként és naponta – a kvóta-őr ezt is számolja.
 * Ha egyik sem ad pénznemet, NEM találunk ki: NOT_FOUND.
 *
 * Hibák: 401 → kulcshiba; 402 → QUOTA_EXHAUSTED (közös leképezés); 403 → PLAN_LIMIT;
 * 404 („Ticker Not Found.”, text/html) → NOT_FOUND; 429 → RATE_LIMITED.
 */
import type { ProviderCapability } from '@/contracts';
import {
  AppErrors,
  err,
  ok,
  parseCurrencyCode,
  splitListingId,
  toIsoTimestamp,
  toUtcIsoDate,
  type AppError,
  type CurrencyCode,
  type IsoDate,
  type ListingId,
  type Result,
} from '@/domain';

import {
  EODHD_SOURCE,
  findListingCurrency,
  normalizeEodhdDividends,
  normalizeEodhdHistory,
  normalizeEodhdListings,
  normalizeEodhdQuote,
  normalizeEodhdSearch,
} from './eodhd-normalizer';
import { eodhdVenueOf, toEodhdSymbol } from './eodhd-symbols';
import { DEFAULT_UPSTREAM_TIMEOUT_MS, requestJson, type FetchLike } from '../../http/request-json';
import { createTtlMap } from '../../http/request-scheduler';
import type { PlanSpec } from '../../routing/plans';
import type { QuotaGuard, QuotaPriority } from '../../routing/quota';
import type { MarketDataProvider } from '../market-data-provider';

export const EODHD_BASE_URL = 'https://eodhd.com/api';
const DAY_MS = 24 * 60 * 60 * 1000;
const CURRENCY_TTL_MS = DAY_MS;

export interface EodhdProviderDeps {
  readonly fetchImpl: FetchLike;
  readonly now: () => Date;
  readonly apiKey: string | null;
  readonly plan: PlanSpec;
  readonly quota: QuotaGuard;
  readonly timeoutMs?: number;
}

function mapEodhdStatus(status: number): AppError | null {
  if (status === 403) {
    return AppErrors.unavailable(
      'PLAN_LIMIT',
      'Az EODHD jelenlegi csomagja ezt nem tartalmazza (free: csak EOD-adat).',
    );
  }
  if (status === 401) {
    return AppErrors.upstream(
      'HTTP_ERROR',
      'Az EODHD elutasította a kérést: érvénytelen vagy hiányzó API-kulcs (EODHD_API_KEY).',
      EODHD_SOURCE.sourceId,
    );
  }
  return null;
}

export function createEodhdProvider(deps: EodhdProviderDeps): MarketDataProvider {
  const { plan } = deps;
  const fetchedAt = () => toIsoTimestamp(deps.now());
  const currencyMemo = createTtlMap<ListingId, CurrencyCode>(CURRENCY_TTL_MS, () =>
    deps.now().getTime(),
  );

  async function call(
    path: string,
    params: Record<string, string>,
    notFoundId: string,
    priority: QuotaPriority = 'normal',
  ): Promise<Result<unknown>> {
    if (deps.apiKey === null) {
      return err(
        AppErrors.unavailable('NOT_COVERED', 'Az EODHD nincs konfigurálva (EODHD_API_KEY).'),
      );
    }
    const budget = deps.quota.consume(1, priority);
    if (!budget.ok) return budget;
    const query = new URLSearchParams({ ...params, fmt: 'json', api_token: deps.apiKey });
    return requestJson({
      url: `${EODHD_BASE_URL}/${path}?${query.toString()}`,
      sourceId: EODHD_SOURCE.sourceId,
      fetchImpl: deps.fetchImpl,
      timeoutMs: deps.timeoutMs ?? DEFAULT_UPSTREAM_TIMEOUT_MS,
      notFound: { resource: 'EODHD ticker', id: notFoundId },
      mapStatus: (status) => mapEodhdStatus(status),
    });
  }

  function venueOrError(listingId: ListingId) {
    const venue = eodhdVenueOf(listingId);
    return venue === null
      ? err(
          AppErrors.unavailable(
            'NOT_COVERED',
            `Az EODHD-leképezés ezt a tőzsdét (${splitListingId(listingId).mic}) még nem ismeri (nincs igazolt kód).`,
          ),
        )
      : ok(venue);
  }

  async function tradingCurrency(listingId: ListingId): Promise<Result<CurrencyCode>> {
    const venue = venueOrError(listingId);
    if (!venue.ok) return venue;
    if (venue.value.venueCurrency !== null) return parseCurrencyCode(venue.value.venueCurrency);
    const cached = currencyMemo.get(listingId);
    if (cached !== null) return ok(cached);
    const { symbol } = splitListingId(listingId);
    const json = await call(
      `search/${encodeURIComponent(symbol)}`,
      { exchange: venue.value.code, limit: '50' },
      listingId,
    );
    if (!json.ok) return json;
    const found = findListingCurrency(json.value, listingId, venue.value.code);
    if (!found.ok) return found;
    if (found.value === null) {
      return err(AppErrors.notFound('jegyzés pénzneme (EODHD kereső)', listingId));
    }
    currencyMemo.set(listingId, found.value);
    return ok(found.value);
  }

  /** A free csomag történeti ablaka: a kért kezdőnapot levágjuk, és ezt jelezzük. */
  function applyHistoryWindow(
    from: IsoDate,
    to: IsoDate,
  ): Result<{ from: IsoDate; notes: string[] }> {
    if (plan.historyWindowDays === null) return ok({ from, notes: [] });
    const earliest = toUtcIsoDate(new Date(deps.now().getTime() - plan.historyWindowDays * DAY_MS));
    if (to < earliest) {
      return err(
        AppErrors.unavailable(
          'PLAN_LIMIT',
          `Az EODHD ${plan.id} csomag csak az utolsó ${plan.historyWindowDays} napot adja (legkorábban ${earliest}).`,
        ),
      );
    }
    if (from >= earliest) return ok({ from, notes: [] });
    return ok({
      from: earliest,
      notes: [
        `A kért kezdőnap (${from}) helyett ${earliest}: az EODHD ${plan.id} csomag csak ${plan.historyWindowDays} napot ad.`,
      ],
    });
  }

  const provider: MarketDataProvider = {
    info: {
      id: EODHD_SOURCE.sourceId,
      name: EODHD_SOURCE.sourceName,
      kind: 'live',
      configured: deps.apiKey !== null,
      plan: plan.id,
      coverage:
        'US (ország-szinten) + igazolt európai tőzsdék: Xetra, Frankfurt, LSE, Amszterdam, SIX, Budapest.',
      note: `${plan.label}. Fundamentum/ETF-metaadat: csomagkorlát (403).${plan.historyWindowDays === null ? '' : ` Ártörténet: ${plan.historyWindowDays} nap.`}`,
    },
    covers(listingId) {
      const venue = venueOrError(listingId);
      return venue.ok ? ok(true) : venue;
    },
  };

  const methods: Partial<MarketDataProvider> = {
    async getQuote(listingId) {
      const venue = venueOrError(listingId);
      if (!venue.ok) return venue;
      const currency = await tradingCurrency(listingId);
      if (!currency.ok) return currency;
      const symbol = toEodhdSymbol(listingId, venue.value);
      const json = await call(`real-time/${encodeURIComponent(symbol)}`, {}, listingId);
      if (!json.ok) return json;
      return normalizeEodhdQuote(json.value, listingId, currency.value, fetchedAt());
    },

    async getPriceHistory(request) {
      if (request.adjustment === 'SPLIT') {
        return err(
          AppErrors.unavailable(
            'NOT_COVERED',
            'Az EODHD nem ad csak split-korrigált sort (close = nyers, adjusted_close = split + osztalék). Kérj NONE vagy SPLIT_DIVIDEND korrekciót.',
          ),
        );
      }
      const venue = venueOrError(request.listingId);
      if (!venue.ok) return venue;
      const window = applyHistoryWindow(request.from, request.to);
      if (!window.ok) return window;
      const currency = await tradingCurrency(request.listingId);
      if (!currency.ok) return currency;
      const symbol = toEodhdSymbol(request.listingId, venue.value);
      const json = await call(
        `eod/${encodeURIComponent(symbol)}`,
        { from: window.value.from, to: request.to, period: 'd', order: 'a' },
        request.listingId,
      );
      if (!json.ok) return json;
      return normalizeEodhdHistory(
        json.value,
        { ...request, from: window.value.from, adjustment: request.adjustment },
        currency.value,
        fetchedAt(),
        window.value.notes,
      );
    },

    async getDividends(request) {
      const venue = venueOrError(request.listingId);
      if (!venue.ok) return venue;
      const symbol = toEodhdSymbol(request.listingId, venue.value);
      const json = await call(
        `div/${encodeURIComponent(symbol)}`,
        { from: request.from, to: request.to },
        request.listingId,
      );
      if (!json.ok) return json;
      // A jegyzés pénznemét csak összehasonlításra használjuk; ha nincs (memo), nem kérdezzük le.
      const known =
        venue.value.venueCurrency !== null
          ? parseCurrencyCode(venue.value.venueCurrency)
          : ok(currencyMemo.get(request.listingId));
      return normalizeEodhdDividends(
        json.value,
        request,
        known.ok ? known.value : null,
        fetchedAt(),
      );
    },

    async searchInstruments(query) {
      const json = await call(`search/${encodeURIComponent(query)}`, { limit: '50' }, query, 'low');
      if (!json.ok) return json;
      return normalizeEodhdSearch(json.value, query, fetchedAt());
    },

    async getSecurityListings(isin) {
      const json = await call(`search/${encodeURIComponent(isin)}`, { limit: '50' }, isin, 'low');
      if (!json.ok) return json;
      return normalizeEodhdListings(json.value, isin, fetchedAt());
    },
  };

  const enabled = (capability: ProviderCapability) => plan.capabilities.includes(capability);
  if (enabled('quote')) provider.getQuote = methods.getQuote;
  if (enabled('priceHistory')) provider.getPriceHistory = methods.getPriceHistory;
  if (enabled('dividends')) provider.getDividends = methods.getDividends;
  if (enabled('search')) provider.searchInstruments = methods.searchInstruments;
  if (enabled('listings')) provider.getSecurityListings = methods.getSecurityListings;
  return provider;
}
