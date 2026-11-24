/**
 * Memóriabeli cache-tároló és figyelőlista (PHASE 13): weben (ahol nincs SQLite, D-082) és
 * tesztekben. Ugyanazt a portot valósítják meg, mint az SQLite-változatok.
 * FIGYELEM: az app újraindításakor az adatok elvesznek.
 */
import type { CacheRecord, CacheStore, WatchlistItem, WatchlistRepository } from '@/application';
import { ok } from '@/domain';

const ms = (v: string) => Date.parse(v);

export function createInMemoryCacheStore(seed: readonly CacheRecord[] = []): CacheStore {
  const records = new Map<string, CacheRecord>(seed.map((r) => [r.key, r]));
  return {
    get: async (key) => ok(records.get(key) ?? null),
    put: async (record) => {
      records.set(record.key, record);
      return ok(undefined);
    },
    delete: async (key) => {
      records.delete(key);
      return ok(undefined);
    },
    list: async (filter = {}) => {
      const ids = filter.listingIds;
      const all = [...records.values()].sort((a, b) => a.key.localeCompare(b.key));
      return ok(
        ids === undefined
          ? all
          : all.filter((r) => r.listingId !== null && ids.includes(r.listingId)),
      );
    },
    markInvalidated: async (listingIds, at) => {
      let count = 0;
      for (const [key, record] of records) {
        if (record.listingId !== null && listingIds.includes(record.listingId)) {
          records.set(key, { ...record, invalidatedAt: at as CacheRecord['invalidatedAt'] });
          count += 1;
        }
      }
      return ok(count);
    },
    clear: async () => {
      const count = records.size;
      records.clear();
      return ok(count);
    },
    prune: async (now) => {
      let count = 0;
      for (const [key, record] of records) {
        if (!(ms(record.retainUntil) >= ms(now))) {
          records.delete(key);
          count += 1;
        }
      }
      return ok(count);
    },
  };
}

export function createInMemoryWatchlistRepository(
  seed: readonly WatchlistItem[] = [],
): WatchlistRepository {
  let items: WatchlistItem[] = [...seed];
  return {
    list: async () => ok([...items]),
    add: async (item) => {
      items = items.some((i) => i.listingId === item.listingId)
        ? items.map((i) => (i.listingId === item.listingId ? item : i))
        : [...items, item];
      return ok(undefined);
    },
    remove: async (listingId) => {
      items = items.filter((i) => i.listingId !== listingId);
      return ok(undefined);
    },
    clear: async () => {
      items = [];
      return ok(undefined);
    },
  };
}
