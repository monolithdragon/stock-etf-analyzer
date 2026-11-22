/**
 * `fmp` adapter: Financial Modeling Prep stable API (PHASE 04B, D-049…D-052).
 *
 * Képességek a free (Basic) csomagban – élő próbával igazolva 2026-11-21:
 *   quote, ártörténet (3 korrekció), profil, osztalék, szöveges keresés – CSAK US jegyzésre
 *   (a US szimbólumoknak is csak egy részére: pl. `BRK-B` → 402).
 * NEM elérhető free csomagban (402 „Restricted Endpoint”): `etf/info`, `etf/holdings`,
 *   `search-isin`. Nem US szimbólum (pl. `SAP.DE`) → 402 „Premium Query Parameter”.
 *
 * Hibaleképezés (a közös `requestJson` felett):
 * - 402 → UNAVAILABLE / PLAN_LIMIT. Az FMP az ISMERETLEN tickerre is 402-t ad (élő próba:
 *   `ZZZZQX`), ezért ez nem különböztethető meg a csomagkorláttól – az üzenet ezt kimondja.
 * - 401/403 → UPSTREAM / HTTP_ERROR „érvénytelen kulcs” (a kulcs értéke soha nem kerül ki).
 *
 * A kulcs az URL `apikey` paramétere (az FMP így várja). Az URL-t sem a napló, sem a
 * hibaüzenet nem tartalmazza (`requestJson`).
 */
import type { ProviderCapability } from '@/contracts';
import {
  AppErrors,
  err,
  ok,
  parseCurrencyCode,
  parseIsin,
  toIsoTimestamp,
  type AppError,
  type Result,
} from '@/domain';

import {
  FMP_HISTORY_ENDPOINTS,
  FMP_SOURCE,
  FMP_US_TRADING_CURRENCY,
  normalizeFmpDividends,
  normalizeFmpHistory,
  normalizeFmpProfile,
  normalizeFmpQuote,
  normalizeFmpSearch,
} from './fmp-normalizer';
import { toFmpSymbol } from './fmp-symbols';
import { DEFAULT_UPSTREAM_TIMEOUT_MS, requestJson, type FetchLike } from '../../http/request-json';
import { isUsListing } from '../../routing/markets';
import type { PlanSpec } from '../../routing/plans';
import type { QuotaGuard, QuotaPriority } from '../../routing/quota';
import type { MarketDataProvider } from '../market-data-provider';

export const FMP_BASE_URL = 'https://financialmodelingprep.com/stable';

export interface FmpProviderDeps {
  readonly fetchImpl: FetchLike;
  readonly now: () => Date;
  readonly apiKey: string | null;
  readonly plan: PlanSpec;
  readonly quota: QuotaGuard;
  readonly timeoutMs?: number;
}

function mapFmpStatus(status: number): AppError | null {
  if (status === 402) {
    return AppErrors.unavailable(
      'PLAN_LIMIT',
      'Az FMP jelenlegi csomagja ezt a végpontot vagy szimbólumot nem tartalmazza (az FMP ismeretlen tickerre is így válaszol).',
    );
  }
  if (status === 401 || status === 403) {
    return AppErrors.upstream(
      'HTTP_ERROR',
      'Az FMP elutasította a kérést: érvénytelen vagy hiányzó API-kulcs (FMP_API_KEY).',
      FMP_SOURCE.sourceId,
    );
  }
  return null;
}

export function createFmpProvider(deps: FmpProviderDeps): MarketDataProvider {
  const { plan } = deps;
  const usd = parseCurrencyCode(FMP_US_TRADING_CURRENCY);
  if (!usd.ok) throw new Error('Programozási hiba: USD');
  const fetchedAt = () => toIsoTimestamp(deps.now());

  async function call(
    path: string,
    params: Record<string, string>,
    priority: QuotaPriority = 'normal',
  ): Promise<Result<unknown>> {
    if (deps.apiKey === null) {
      return err(AppErrors.unavailable('NOT_COVERED', 'Az FMP nincs konfigurálva (FMP_API_KEY).'));
    }
    const budget = deps.quota.consume(1, priority);
    if (!budget.ok) return budget;
    // A kulcs az utolsó paraméter; a teljes URL soha nem kerül naplóba vagy hibaüzenetbe.
    const query = new URLSearchParams({ ...params, apikey: deps.apiKey });
    return requestJson({
      url: `${FMP_BASE_URL}/${path}?${query.toString()}`,
      sourceId: FMP_SOURCE.sourceId,
      fetchImpl: deps.fetchImpl,
      timeoutMs: deps.timeoutMs ?? DEFAULT_UPSTREAM_TIMEOUT_MS,
      notFound: { resource: 'FMP adat', id: params.symbol ?? params.query ?? '' },
      mapStatus: (status) => mapFmpStatus(status),
    });
  }

  const enabled = (capability: ProviderCapability) => plan.capabilities.includes(capability);

  const provider: MarketDataProvider = {
    info: {
      id: FMP_SOURCE.sourceId,
      name: FMP_SOURCE.sourceName,
      kind: 'live',
      configured: deps.apiKey !== null,
      plan: plan.id,
      coverage:
        plan.coverage === 'US'
          ? 'Csak US jegyzések (XNAS, XNYS, ARCX, XASE), és azoknak is csak egy része a free csomagban.'
          : 'A csomag szerinti tőzsdék.',
      note: `${plan.label}. ETF-metaadat/holdings és ISIN-keresés: csomagkorlát (402).`,
    },

    covers(listingId) {
      if (plan.coverage === 'US' && !isUsListing(listingId)) {
        return err(
          AppErrors.unavailable(
            'PLAN_LIMIT',
            `Az FMP (${plan.id}) csak US jegyzést szolgál ki; ${listingId} nem US tőzsde.`,
          ),
        );
      }
      return ok(true);
    },
  };

  const methods: Partial<MarketDataProvider> = {
    async getQuote(listingId) {
      const json = await call('quote', { symbol: toFmpSymbol(listingId) });
      if (!json.ok) return json;
      return normalizeFmpQuote(json.value, listingId, usd.value, fetchedAt());
    },

    async getPriceHistory(request) {
      const json = await call(FMP_HISTORY_ENDPOINTS[request.adjustment], {
        symbol: toFmpSymbol(request.listingId),
        from: request.from,
        to: request.to,
      });
      if (!json.ok) return json;
      return normalizeFmpHistory(json.value, request, usd.value, fetchedAt());
    },

    async getProfile(listingId) {
      const json = await call('profile', { symbol: toFmpSymbol(listingId) });
      if (!json.ok) return json;
      return normalizeFmpProfile(json.value, listingId, fetchedAt());
    },

    async getDividends(request) {
      const json = await call('dividends', { symbol: toFmpSymbol(request.listingId) });
      if (!json.ok) return json;
      return normalizeFmpDividends(json.value, request, usd.value, fetchedAt());
    },

    async searchInstruments(query) {
      if (parseIsin(query).ok) {
        // Élő próba: `search-isin` → 402 a free csomagban. Hívás nélkül jelezzük.
        return err(
          AppErrors.unavailable('PLAN_LIMIT', 'Az FMP ISIN-keresése a csomagban nem elérhető.'),
        );
      }
      const json = await call('search-symbol', { query }, 'low');
      if (!json.ok) return json;
      return normalizeFmpSearch(json.value, query, fetchedAt());
    },
  };

  if (enabled('quote')) provider.getQuote = methods.getQuote;
  if (enabled('priceHistory')) provider.getPriceHistory = methods.getPriceHistory;
  if (enabled('profile')) provider.getProfile = methods.getProfile;
  if (enabled('dividends')) provider.getDividends = methods.getDividends;
  if (enabled('search')) provider.searchInstruments = methods.searchInstruments;
  return provider;
}
