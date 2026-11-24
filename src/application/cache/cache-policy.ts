/**
 * Eszköz-cache szabályok adatfajtánként (PHASE 13, D-082; ARCHITECTURE 11. véglegesítve).
 *
 * Három határ minden fajtánál, a rekord `fetchedAt`-jától (eredeti lekérés) mérve:
 * - `freshForMs`: eddig a cache hálózat nélkül kiszolgálja (`cache_hit`) → nincs új kérés;
 * - `expiresAfterMs`: eddig a cache-ből kiszolgált adat `STALE`, utána `EXPIRED` címkét kap;
 * - `retainForMs`: eddig őrizzük meg offline tartaléknak; utána a takarítás (`prune`) törli.
 *
 * A TTL-ek SZÁNDÉKOSAN eltérők: az árfolyam percek alatt, a kimutatás negyedévente, a
 * történeti FX-ráta soha nem változik. `[FELTÉTELEZÉS]` – a tőzsdei naptár (nyitvatartás,
 * ünnepnap) nincs modellezve; az értékek konzervatív konvenciók (KI-110).
 */
import type { FreshnessPolicy } from '@/domain';

export const CACHE_DATA_KINDS = [
  'quote',
  'price_history',
  'financial_statements',
  'instrument_profile',
  'etf_metadata',
  'etf_holdings',
  'dividends',
  'fx_latest',
  'fx_historical',
  'security_listings',
  'search',
] as const;
export type CacheDataKind = (typeof CACHE_DATA_KINDS)[number];

export interface CachePolicy extends FreshnessPolicy {
  /** Eddig marad meg offline tartaléknak (≥ `expiresAfterMs`). */
  readonly retainForMs: number;
  /** Emberi indoklás (dokumentáció és Beállítások-nézet). */
  readonly rationale: string;
}

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export const CACHE_POLICIES: Readonly<Record<CacheDataKind, CachePolicy>> = {
  quote: {
    freshForMs: 15 * MINUTE,
    expiresAfterMs: 3 * DAY,
    retainForMs: 30 * DAY,
    rationale:
      'Késleltetett/EOD árfolyam: 15 percig újrahasználjuk (kvótakímélés), 3 napig elavult, utána lejárt.',
  },
  price_history: {
    freshForMs: 12 * HOUR,
    expiresAfterMs: 14 * DAY,
    retainForMs: 60 * DAY,
    rationale: 'Napi záróárak: naponta egyszer változnak; 12 óra után újra lekérjük.',
  },
  financial_statements: {
    freshForMs: 7 * DAY,
    expiresAfterMs: 120 * DAY,
    retainForMs: 400 * DAY,
    rationale: 'Negyedéves/éves jelentések: hetente ellenőrizzük, hogy jött-e új beadvány.',
  },
  instrument_profile: {
    freshForMs: 7 * DAY,
    expiresAfterMs: 30 * DAY,
    retainForMs: 180 * DAY,
    rationale: 'Profil (név, szektor, ország) ritkán változik.',
  },
  etf_metadata: {
    freshForMs: 7 * DAY,
    expiresAfterMs: 30 * DAY,
    retainForMs: 180 * DAY,
    rationale: 'ETF-profil (a forrás ETF-nek jelölte): mint a profil; TER/AUM változhat.',
  },
  etf_holdings: {
    freshForMs: 30 * DAY,
    expiresAfterMs: 90 * DAY,
    retainForMs: 365 * DAY,
    rationale:
      'Holdings: havi/negyedéves közzététel. Free csomagban ma nincs forrása (KI-65); a szabály a holdings-importhoz (D-071) kész.',
  },
  dividends: {
    freshForMs: 1 * DAY,
    expiresAfterMs: 30 * DAY,
    retainForMs: 180 * DAY,
    rationale: 'Osztaléktörténet: új esemény ritkán, naponta egyszer ellenőrizzük.',
  },
  fx_latest: {
    freshForMs: 12 * HOUR,
    expiresAfterMs: 3 * DAY,
    retainForMs: 30 * DAY,
    rationale: 'ECB referencia: munkanaponként ~16:00 CET egyszer; 12 óránként ellenőrizzük.',
  },
  fx_historical: {
    freshForMs: 365 * DAY,
    expiresAfterMs: 3650 * DAY,
    retainForMs: 365 * DAY,
    rationale: 'Adott napi (múltbeli) ECB ráta utólag nem változik.',
  },
  security_listings: {
    freshForMs: 30 * DAY,
    expiresAfterMs: 180 * DAY,
    retainForMs: 365 * DAY,
    rationale: 'ISIN → jegyzések leképezés ritkán változik.',
  },
  search: {
    freshForMs: 1 * DAY,
    expiresAfterMs: 7 * DAY,
    retainForMs: 7 * DAY,
    rationale: 'Keresési találatok: offline is visszakereshető a korábban beírt kifejezés.',
  },
};

/** Egy rekord érvényességi időpontjai (epoch ms) a lekérés idejéből. */
export function cacheValidity(
  policy: CachePolicy,
  fetchedAtMs: number,
): {
  readonly freshUntilMs: number;
  readonly staleUntilMs: number;
  readonly retainUntilMs: number;
} {
  return {
    freshUntilMs: fetchedAtMs + policy.freshForMs,
    staleUntilMs: fetchedAtMs + policy.expiresAfterMs,
    retainUntilMs: fetchedAtMs + Math.max(policy.retainForMs, policy.freshForMs),
  };
}

/** A szabályok belső konzisztenciája (teszt és indulási ellenőrzés). */
export function validateCachePolicies(
  policies: Readonly<Record<CacheDataKind, CachePolicy>>,
): readonly string[] {
  const problems: string[] = [];
  for (const kind of CACHE_DATA_KINDS) {
    const p = policies[kind];
    if (!(p.freshForMs > 0)) problems.push(`${kind}: freshForMs > 0 kell`);
    if (!(p.expiresAfterMs >= p.freshForMs)) {
      problems.push(`${kind}: expiresAfterMs ≥ freshForMs kell`);
    }
    if (!(p.retainForMs >= p.freshForMs)) problems.push(`${kind}: retainForMs ≥ freshForMs kell`);
  }
  return problems;
}
