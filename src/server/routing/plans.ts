/**
 * Csomagszint-mátrix (PHASE 04B, DATA_SOURCES 5.3/4, D-027, D-051).
 *
 * A fizetős csomagra váltás CSAK env-módosítás (`FMP_PLAN`, `EODHD_PLAN`) + proxy-újraindítás:
 * a csomag határozza meg a megvalósított képességek közül a bekapcsoltakat, a lefedettséget,
 * a napi kvótát és az ártörténet mélységét. Appkiadás nem kell.
 *
 * `verified: true` = a 2026-11-21-i élő próbahívásokkal (a tulajdonos free kulcsaival)
 * igazolt. A fizetős sorok a szolgáltatói árlista alapján készültek, élő próbájuk NINCS –
 * ezért a proxy induláskor figyelmeztet, ha ilyen csomag van beállítva.
 */
import type { ProviderCapability } from '@/contracts';

export interface PlanSpec {
  readonly id: string;
  readonly label: string;
  readonly verified: boolean;
  /** Napi hívás-keret; `null` = nincs ismert napi keret (pl. csak percenkénti limit). */
  readonly dailyQuota: number | null;
  /** Ártörténet maximális mélysége napban; `null` = nincs ismert korlát. */
  readonly historyWindowDays: number | null;
  /** Mely jegyzéseket szolgálja ki: csak US, vagy a forrás teljes (igazolt) tőzsdelistáját. */
  readonly coverage: 'US' | 'ALL_MAPPED';
  /** A MEGVALÓSÍTOTT képességek közül ezek vannak bekapcsolva ebben a csomagban. */
  readonly capabilities: readonly ProviderCapability[];
}

export const FMP_PLANS: Readonly<Record<string, PlanSpec>> = {
  free: {
    id: 'free',
    label: 'FMP Basic (free)',
    verified: true,
    // A 250/nap az FMP árlistájából [HARMADIK FÉL]; a hivatalos oldal 403-at ad (DATA_SOURCES 11.).
    dailyQuota: 250,
    historyWindowDays: null, // élő próba: 2010-es adat is jön
    coverage: 'US', // élő próba: SAP.DE, VWCE.DE → 402; a BRK-B is 402 (a US-nak is csak egy része)
    capabilities: ['quote', 'priceHistory', 'profile', 'dividends', 'search'],
  },
  starter: {
    id: 'starter',
    label: 'FMP Starter (fizetős, NEM igazolt)',
    verified: false,
    dailyQuota: null,
    historyWindowDays: null,
    coverage: 'US',
    capabilities: ['quote', 'priceHistory', 'profile', 'dividends', 'search'],
  },
};

export const EODHD_PLANS: Readonly<Record<string, PlanSpec>> = {
  free: {
    id: 'free',
    label: 'EODHD Free',
    verified: true,
    dailyQuota: 20, // /api/user: dailyRateLimit 20 (az egyszeri bónusz-keretet nem számoljuk)
    historyWindowDays: 365, // élő próba: régebbi időszakra „Data is limited by one year” sor
    coverage: 'ALL_MAPPED',
    capabilities: ['quote', 'priceHistory', 'dividends', 'search', 'listings'],
  },
  'eod-all-world': {
    id: 'eod-all-world',
    label: 'EODHD EOD All World (fizetős, NEM igazolt)',
    verified: false,
    dailyQuota: 100_000,
    historyWindowDays: null,
    coverage: 'ALL_MAPPED',
    capabilities: ['quote', 'priceHistory', 'dividends', 'search', 'listings'],
  },
};

export const PLAN_TABLES = { fmp: FMP_PLANS, eodhd: EODHD_PLANS } as const;
export type PlannedProviderId = keyof typeof PLAN_TABLES;

/** Ismeretlen / hiányzó csomagnév → a legszűkebb (`free`) csomag, figyelmeztetéssel. */
export const DEFAULT_PLAN_ID = 'free';
