/**
 * PHASE 13: cache-szabályok – konzisztencia, adatfajtánként eltérő TTL, érvényességi időpontok.
 */
import { capFreshnessForCache, type IsoTimestamp } from '@/domain';

import {
  CACHE_DATA_KINDS,
  CACHE_POLICIES,
  cacheValidity,
  validateCachePolicies,
} from './cache-policy';

describe('CACHE_POLICIES', () => {
  it('minden adatfajtához van szabály, és mind konzisztens', () => {
    expect(Object.keys(CACHE_POLICIES).sort()).toEqual([...CACHE_DATA_KINDS].sort());
    expect(validateCachePolicies(CACHE_POLICIES)).toEqual([]);
  });

  it('a TTL nem egységes: az ár gyorsabban avul, mint a kimutatás vagy a holdings', () => {
    const p = CACHE_POLICIES;
    expect(p.quote.freshForMs).toBeLessThan(p.price_history.freshForMs);
    expect(p.price_history.freshForMs).toBeLessThan(p.financial_statements.freshForMs);
    expect(p.financial_statements.freshForMs).toBeLessThan(p.etf_holdings.freshForMs);
    expect(p.fx_latest.freshForMs).toBeLessThan(p.fx_historical.freshForMs);
    expect(new Set(CACHE_DATA_KINDS.map((k) => p[k].freshForMs)).size).toBeGreaterThan(5);
  });

  it('a hibás szabályt a validátor jelzi', () => {
    const broken = {
      ...CACHE_POLICIES,
      quote: { ...CACHE_POLICIES.quote, freshForMs: 0, expiresAfterMs: -1, retainForMs: -1 },
    };
    expect(validateCachePolicies(broken)).toEqual([
      'quote: freshForMs > 0 kell',
      'quote: expiresAfterMs ≥ freshForMs kell',
      'quote: retainForMs ≥ freshForMs kell',
    ]);
  });

  it('cacheValidity: a lekérés idejéhez adja a határokat', () => {
    const t = Date.parse('2026-11-24T10:00:00Z');
    const v = cacheValidity(CACHE_POLICIES.quote, t);
    expect(new Date(v.freshUntilMs).toISOString()).toBe('2026-11-24T10:15:00.000Z');
    expect(new Date(v.staleUntilMs).toISOString()).toBe('2026-11-27T10:00:00.000Z');
    expect(new Date(v.retainUntilMs).toISOString()).toBe('2026-12-24T10:00:00.000Z');
  });
});

describe('capFreshnessForCache (domain)', () => {
  const storedAt = '2026-11-24T10:00:00Z' as IsoTimestamp;
  it('offline tartalék soha nem FRESH', () => {
    expect(capFreshnessForCache('FRESH', { mode: 'offline_fallback', storedAt })).toBe('STALE');
    expect(capFreshnessForCache('EXPIRED', { mode: 'offline_fallback', storedAt })).toBe('EXPIRED');
    expect(capFreshnessForCache('UNKNOWN', { mode: 'offline_fallback', storedAt })).toBe('UNKNOWN');
  });
  it('friss cache-találat és hálózati adat változatlan', () => {
    expect(capFreshnessForCache('FRESH', { mode: 'cache_hit', storedAt })).toBe('FRESH');
    expect(capFreshnessForCache('FRESH', undefined)).toBe('FRESH');
  });
});
