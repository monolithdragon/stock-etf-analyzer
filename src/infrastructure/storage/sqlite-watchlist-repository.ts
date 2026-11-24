/**
 * SQLite figyelőlista (PHASE 13). Sérült sor: kimarad és törlődik – a figyelőlista csak
 * azonosítókat tárol (nincs pénzügyi összeg), a felhasználó újra felveheti; az app nem akad el.
 */
import { watchlistItemSchema, type WatchlistItem, type WatchlistRepository } from '@/application';
import { ok } from '@/domain';

import { withDatabase, type DatabaseProvider } from './database-provider';

interface Row {
  readonly listing_id: string;
  readonly json: string;
}

function decode(json: string): WatchlistItem | null {
  try {
    const parsed = watchlistItemSchema.safeParse(JSON.parse(json));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export function createSqliteWatchlistRepository(provider: DatabaseProvider): WatchlistRepository {
  return {
    list: () =>
      withDatabase(provider, 'figyelőlista olvasása', async (db) => {
        const rows = await db.getAll<Row>(
          'SELECT listing_id, json FROM watchlist ORDER BY seq ASC',
        );
        const items: WatchlistItem[] = [];
        for (const row of rows) {
          const item = decode(row.json);
          if (item === null) {
            await db.run('DELETE FROM watchlist WHERE listing_id = ?', [row.listing_id]);
          } else {
            items.push(item);
          }
        }
        return ok(items);
      }),
    add: (item, addedAt) =>
      withDatabase(provider, 'figyelőlista mentése', async (db) => {
        // Már szereplő elemnél a sorrend és a dátum marad (idempotens hozzáadás).
        await db.run(
          `INSERT INTO watchlist (listing_id, json, added_at, seq)
           VALUES (?, ?, ?, (SELECT COALESCE(MAX(seq), 0) + 1 FROM watchlist))
           ON CONFLICT(listing_id) DO UPDATE SET json = excluded.json`,
          [item.listingId, JSON.stringify(item), addedAt],
        );
        return ok(undefined);
      }),
    remove: (listingId) =>
      withDatabase(provider, 'figyelőlista törlése', async (db) => {
        await db.run('DELETE FROM watchlist WHERE listing_id = ?', [listingId]);
        return ok(undefined);
      }),
    clear: () =>
      withDatabase(provider, 'figyelőlista ürítése', async (db) => {
        await db.run('DELETE FROM watchlist');
        return ok(undefined);
      }),
  };
}
