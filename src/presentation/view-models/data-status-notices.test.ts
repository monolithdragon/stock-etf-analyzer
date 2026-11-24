/**
 * PHASE 13: cache-/offline-jelzések – offline adat soha nem jelenik meg jelzés nélkül, és az
 * „utoljára frissítve” a LEGRÉGEBBI felhasznált adat ideje.
 */
import type { CachedDataEntry, DataStatus } from '@/application';
import type { IsoTimestamp } from '@/domain';

import { buildDataStatusNotices } from './data-status-notices';

const entry = (overrides: Partial<CachedDataEntry> = {}): CachedDataEntry => ({
  kind: 'quote',
  listingId: 'AAPL@XNAS',
  sourceName: 'FMP',
  provenanceKind: 'reported',
  fetchedAt: '2026-11-24T10:00:00Z' as IsoTimestamp,
  asOf: null,
  period: null,
  freshness: 'FRESH',
  invalidated: false,
  lastServed: 'network',
  ...overrides,
});

const status = (overrides: Partial<DataStatus> = {}): DataStatus => ({
  connectivity: 'online',
  entries: [entry()],
  oldestFetchedAt: '2026-11-24T10:00:00Z' as IsoTimestamp,
  newestFetchedAt: '2026-11-24T10:00:00Z' as IsoTimestamp,
  servedOffline: false,
  hasStale: false,
  ...overrides,
});

describe('buildDataStatusNotices', () => {
  it('friss hálózati adat: nincs jelzés; hiányzó állapot: nincs jelzés', () => {
    expect(buildDataStatusNotices(status())).toEqual([]);
    expect(buildDataStatusNotices(null)).toEqual([]);
  });

  it('cache-találat: info a legrégebbi lekérési idővel', () => {
    const [notice] = buildDataStatusNotices(
      status({
        entries: [entry({ lastServed: 'cache_hit' })],
        oldestFetchedAt: '2026-11-20T08:30:00Z' as IsoTimestamp,
      }),
    );
    expect(notice?.id).toBe('cache');
    expect(notice?.tone).toBe('info');
    expect(notice?.message).toMatch(/Utoljára frissítve: 2026\. 11\. 20\./);
  });

  it('offline tartalék: figyelmeztetés „elavult lehet” szöveggel', () => {
    const [notice] = buildDataStatusNotices(
      status({ entries: [entry({ lastServed: 'offline_fallback' })], servedOffline: true }),
    );
    expect(notice).toMatchObject({ id: 'offline', tone: 'warning' });
    expect(notice?.title).toMatch(/elavult lehet/);
  });

  it('ismerten offline, cache nélkül: „nincs korábban letöltött” jelzés', () => {
    const [notice] = buildDataStatusNotices(
      status({ connectivity: 'offline', entries: [], oldestFetchedAt: null }),
    );
    expect(notice?.message).toMatch(/nincs korábban letöltött/);
  });
});
