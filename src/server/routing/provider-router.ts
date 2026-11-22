/**
 * `ProviderRouter` (PHASE 04B, DATA_SOURCES 5.2–5.3, D-049): képesség × piac szerinti
 * forrásválasztás, tartalékra váltás (fallback) és átlátható kísérlet-napló.
 *
 * Szabályok:
 * 1. Egy válasz = EGY forrás. A router nem fésül össze két szolgáltató adatát; a provenance
 *    mindig a ténylegesen használt forrást mutatja.
 * 2. Tartalékra csak átmeneti vagy „ez a forrás nem tudja” jellegű hibánál vált:
 *    NOT_FOUND, RATE_LIMITED, TIMEOUT, NETWORK, UPSTREAM (a hibás válasz is: naplózva),
 *    UNAVAILABLE (csomag, lefedettség, kvóta). Bemeneti (VALIDATION) hibánál NEM.
 * 3. A nem konfigurált (kulcs nélküli) és a jegyzést nem lefedő (`covers`) szolgáltatót
 *    hálózati hívás nélkül átugorja.
 * 4. Ha a lánc üres, a válasz `UNAVAILABLE` a táblában rögzített okkal (pl. nem US
 *    kimutatás free csomaggal → PLAN_LIMIT).
 */
import type { ProviderCapability, RoutingMarket } from '@/contracts';
import {
  AppErrors,
  err,
  type AppError,
  type ListingId,
  type Result,
  type UnavailableReason,
} from '@/domain';

import {
  hasCapability,
  isImplementableCapability,
  type ImplementableCapability,
  type MarketDataProvider,
  type ProviderRegistry,
  type ProviderWith,
} from '../providers/market-data-provider';

export interface RouteSpec {
  /** Próbálási sorrend (szolgáltató-azonosítók). */
  readonly chain: readonly string[];
  /** Ha a lánc üres vagy senki nem konfigurált: miért nem elérhető. */
  readonly whenEmpty: UnavailableReason;
}

type RoutingTable = Readonly<
  Record<ProviderCapability, Readonly<Partial<Record<RoutingMarket, RouteSpec>>>>
>;

const PRICE_ROUTES = {
  US: { chain: ['fmp', 'eodhd'], whenEmpty: 'NOT_COVERED' },
  EU: { chain: ['eodhd'], whenEmpty: 'NOT_COVERED' },
  GLOBAL: { chain: ['eodhd'], whenEmpty: 'NOT_COVERED' },
} as const satisfies Partial<Record<RoutingMarket, RouteSpec>>;

/** Nem US fundamentum/profil: fizetős EODHD Fundamentals kellene (D-027) → PLAN_LIMIT. */
const PLAN_LIMITED_OUTSIDE_US = {
  EU: { chain: [], whenEmpty: 'PLAN_LIMIT' },
  GLOBAL: { chain: [], whenEmpty: 'PLAN_LIMIT' },
} as const satisfies Partial<Record<RoutingMarket, RouteSpec>>;

const NOT_AVAILABLE_ANYWHERE = {
  US: { chain: [], whenEmpty: 'PLAN_LIMIT' },
  EU: { chain: [], whenEmpty: 'PLAN_LIMIT' },
  GLOBAL: { chain: [], whenEmpty: 'PLAN_LIMIT' },
} as const satisfies Partial<Record<RoutingMarket, RouteSpec>>;

/**
 * A véglegesített routing-tábla (DATA_SOURCES 5.2, a 2026-11-21-i élő próbák alapján).
 * A `sec-edgar` szándékosan csak US: ticker-ütközés miatt (pl. `SAP@XETR` vs. a US `SAP`
 * ADR) nem US jegyzésre a ticker → CIK leképezés hamis céget adhatna.
 */
export const ROUTING_TABLE: RoutingTable = {
  quote: PRICE_ROUTES,
  priceHistory: PRICE_ROUTES,
  dividends: PRICE_ROUTES,
  profile: { US: { chain: ['fmp'], whenEmpty: 'NOT_COVERED' }, ...PLAN_LIMITED_OUTSIDE_US },
  financialStatements: {
    US: { chain: ['sec-edgar'], whenEmpty: 'NOT_COVERED' },
    ...PLAN_LIMITED_OUTSIDE_US,
  },
  etfMetadata: NOT_AVAILABLE_ANYWHERE,
  etfHoldings: NOT_AVAILABLE_ANYWHERE,
  listings: { ANY: { chain: ['openfigi', 'eodhd'], whenEmpty: 'NOT_COVERED' } },
  fxRates: { ANY: { chain: ['ecb-fx'], whenEmpty: 'NOT_COVERED' } },
  // ISIN-keresés: az FMP free csomagja nem tudja (PLAN_LIMIT) → az EODHD veszi át.
  search: { ANY: { chain: ['fmp', 'eodhd'], whenEmpty: 'NOT_COVERED' } },
};

export interface RouteAttempt {
  readonly providerId: string;
  readonly outcome: 'OK' | 'NOT_CONFIGURED' | AppError['kind'];
  readonly message: string | null;
}

export interface RouteOutcome<T> {
  readonly result: Result<T>;
  /** A ténylegesen választ adó szolgáltató (siker vagy utolsó hiba); `null`, ha senki. */
  readonly providerId: string | null;
  readonly attempts: readonly RouteAttempt[];
  /** A kliensnek szóló, titokmentes figyelmeztetések (pl. „FMP: csomagkorlát → EODHD”). */
  readonly warnings: readonly string[];
}

/** Vált-e tartalékra ennél a hibánál? (DATA_SOURCES 5.3/2) */
export function allowsFallback(error: AppError): boolean {
  switch (error.kind) {
    case 'NOT_FOUND':
    case 'RATE_LIMITED':
    case 'TIMEOUT':
    case 'NETWORK':
    case 'UPSTREAM':
    case 'UNAVAILABLE':
      return true;
    case 'VALIDATION':
    case 'MISSING_DATA':
    case 'CALCULATION_INVALID':
    case 'STORAGE':
    case 'AI':
      return false;
  }
}

const shorten = (text: string) => (text.length > 300 ? `${text.slice(0, 297)}…` : text);

export interface ProviderRouter {
  /** A konfigurált lánc (mock módban: minden mock szolgáltató, amely tudja a képességet). */
  resolve(
    capability: ProviderCapability,
    market: RoutingMarket,
  ): { readonly chain: readonly MarketDataProvider[]; readonly whenEmpty: UnavailableReason };
  run<C extends ImplementableCapability, T>(
    capability: C,
    market: RoutingMarket,
    listingId: ListingId | null,
    invoke: (provider: ProviderWith<C>) => Promise<Result<T>>,
  ): Promise<RouteOutcome<T>>;
}

export function createProviderRouter(
  registry: ProviderRegistry,
  table: RoutingTable = ROUTING_TABLE,
): ProviderRouter {
  const byId = new Map(registry.providers.map((p) => [p.info.id, p]));

  function spec(capability: ProviderCapability, market: RoutingMarket): RouteSpec {
    return table[capability][market] ?? { chain: [], whenEmpty: 'NOT_COVERED' };
  }

  function resolve(capability: ProviderCapability, market: RoutingMarket) {
    const { chain, whenEmpty } = spec(capability, market);
    const implementsIt = (p: MarketDataProvider) =>
      isImplementableCapability(capability) && hasCapability(p, capability);
    // Demó módban nincs routing-tábla: a mock szolgáltató mindent kiszolgál, amit tud.
    const candidates =
      registry.dataMode === 'mock'
        ? registry.providers
        : chain.map((id) => byId.get(id)).filter((p) => p !== undefined);
    return { chain: candidates.filter(implementsIt), whenEmpty };
  }

  return {
    resolve,
    async run(capability, market, listingId, invoke) {
      const { chain, whenEmpty } = resolve(capability, market);
      const attempts: RouteAttempt[] = [];
      let last: { providerId: string; error: AppError } | null = null;

      for (const provider of chain) {
        const id = provider.info.id;
        if (!provider.info.configured) {
          attempts.push({ providerId: id, outcome: 'NOT_CONFIGURED', message: null });
          continue;
        }
        if (listingId !== null && provider.covers !== undefined) {
          const covered = provider.covers(listingId);
          if (!covered.ok) {
            attempts.push({
              providerId: id,
              outcome: covered.error.kind,
              message: covered.error.message,
            });
            last = { providerId: id, error: covered.error };
            continue;
          }
        }
        // A `resolve` csak olyan szolgáltatót ad, amely a képességet megvalósítja.
        const result = await invoke(provider as ProviderWith<typeof capability>);
        if (result.ok) {
          attempts.push({ providerId: id, outcome: 'OK', message: null });
          return { result, providerId: id, attempts, warnings: warningsFor(attempts, id) };
        }
        attempts.push({
          providerId: id,
          outcome: result.error.kind,
          message: result.error.message,
        });
        last = { providerId: id, error: result.error };
        if (!allowsFallback(result.error)) break;
      }

      if (last !== null) {
        return {
          result: err(last.error),
          providerId: last.providerId,
          attempts,
          warnings: warningsFor(attempts, null),
        };
      }
      const anyUnconfigured = attempts.some((a) => a.outcome === 'NOT_CONFIGURED');
      const message = anyUnconfigured
        ? `Ehhez (${capability}) a forrás nincs konfigurálva (hiányzó API-kulcs a proxy env-ben).`
        : whenEmpty === 'PLAN_LIMIT'
          ? `Ehhez (${capability}, ${market}) a jelenlegi (free) csomagokban nincs forrás; fizetős csomaggal bekapcsolható (D-027).`
          : `Ehhez (${capability}, ${market}) nincs bekötött forrás.`;
      return {
        result: err(AppErrors.unavailable(anyUnconfigured ? 'NOT_COVERED' : whenEmpty, message)),
        providerId: null,
        attempts,
        warnings: [],
      };
    },
  };
}

function warningsFor(attempts: readonly RouteAttempt[], usedId: string | null): string[] {
  const failed = attempts.filter((a) => a.outcome !== 'OK');
  if (failed.length === 0) return [];
  const lines = failed.map((a) =>
    a.outcome === 'NOT_CONFIGURED'
      ? `${a.providerId}: nincs konfigurálva.`
      : shorten(`${a.providerId}: ${a.message ?? a.outcome}`),
  );
  if (usedId !== null) lines.push(`Az adat forrása: ${usedId} (tartalék forrás).`);
  return lines;
}
