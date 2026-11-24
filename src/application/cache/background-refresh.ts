/**
 * Háttérfrissítés (PHASE 13, D-082) – KÜLÖNVÁLASZTVA a kézi frissítéstől és az invalidálástól:
 *
 * | Mechanizmus      | Ki indítja                   | Mit csinál                                         |
 * |------------------|------------------------------|----------------------------------------------------|
 * | Kézi frissítés   | a felhasználó (lehúzás, gomb) | a jegyzés rekordjait jelöli → hálózat előbb, tartalék marad |
 * | Invalidálás      | felhasználó (Beállítások), séma-/payload-verzió, sérült rekord | rekord(ok) TÖRLÉSE |
 * | Háttérfrissítés  | hálózat visszatérése (offline → online), ha a beállítás engedi | figyelőlista + portfólió árfolyamai, CSAK a nem friss rekordok |
 *
 * Kvótakímélés: legfeljebb `maxListings` jegyzés, sorban (nem párhuzamosan), és két futás
 * között legalább `minIntervalMs` telik el. Csak árfolyamot kér (a legolcsóbb és leggyorsabban
 * avuló adat); az elemzéshez szükséges többi adat a képernyő megnyitásakor töltődik.
 */
import { parseListingId } from '@/domain';

import type { Clock, ConnectivityMonitor, MarketDataGateway } from '../ports';
import type { CacheControl } from './market-data-cache';
import type { ConnectivityState } from './types';

export interface BackgroundRefreshReport {
  readonly status: 'ran' | 'throttled' | 'disabled' | 'offline' | 'busy';
  readonly attempted: number;
  readonly refreshed: number;
  readonly failed: number;
  readonly skippedFresh: number;
  /** A célok közül a `maxListings` fölötti rész (nem frissítve). */
  readonly skippedOverLimit: number;
}

export interface BackgroundRefresher {
  /** Egy futás most (a korlátokkal). */
  runOnce(): Promise<BackgroundRefreshReport>;
  /** Feliratkozás a hálózat-visszatérésre; a visszaadott függvény leiratkozik. */
  start(): () => void;
}

export interface BackgroundRefresherDeps {
  readonly control: CacheControl;
  /** A CACHE-elt gateway (így a frissített érték a cache-be kerül). */
  readonly marketData: MarketDataGateway;
  readonly clock: Clock;
  readonly connectivity: ConnectivityMonitor;
  /** A frissítendő jegyzések (figyelőlista + nyitott portfólió-tételek). */
  readonly targets: () => Promise<readonly string[]>;
  /** A felhasználói beállítás (`refresh.refreshOnReconnect`). */
  readonly isEnabled: () => Promise<boolean>;
  readonly minIntervalMs?: number;
  readonly maxListings?: number;
  /** Futás vége (pl. fejlesztői napló) – adat nélkül, csak darabszámok. */
  readonly onReport?: (report: BackgroundRefreshReport) => void;
}

export const DEFAULT_BACKGROUND_MIN_INTERVAL_MS = 5 * 60 * 1000;
export const DEFAULT_BACKGROUND_MAX_LISTINGS = 20;

const empty = (status: BackgroundRefreshReport['status']): BackgroundRefreshReport => ({
  status,
  attempted: 0,
  refreshed: 0,
  failed: 0,
  skippedFresh: 0,
  skippedOverLimit: 0,
});

export function createBackgroundRefresher(deps: BackgroundRefresherDeps): BackgroundRefresher {
  const minInterval = deps.minIntervalMs ?? DEFAULT_BACKGROUND_MIN_INTERVAL_MS;
  const maxListings = deps.maxListings ?? DEFAULT_BACKGROUND_MAX_LISTINGS;
  let lastRunMs: number | null = null;
  let running = false;

  async function runOnce(): Promise<BackgroundRefreshReport> {
    if (running) return empty('busy');
    if (!(await deps.isEnabled())) return empty('disabled');
    if (deps.connectivity.current() === 'offline') return empty('offline');
    const now = deps.clock.now().getTime();
    if (lastRunMs !== null && now - lastRunMs < minInterval) return empty('throttled');

    running = true;
    lastRunMs = now;
    try {
      const unique = [...new Set(await deps.targets())];
      const selected = unique.slice(0, maxListings);
      let refreshed = 0;
      let failed = 0;
      let skippedFresh = 0;
      for (const listingId of selected) {
        if (await deps.control.isQuoteFresh(listingId)) {
          skippedFresh += 1;
          continue;
        }
        const parsed = parseListingId(listingId);
        if (!parsed.ok) {
          failed += 1;
          continue;
        }
        const quote = await deps.marketData.getQuote(parsed.value);
        // A tartalékból kiszolgált (offline_fallback) érték NEM számít frissítésnek.
        if (quote.ok && quote.value.provenance.cache === undefined) refreshed += 1;
        else failed += 1;
      }
      return {
        status: 'ran',
        attempted: selected.length - skippedFresh,
        refreshed,
        failed,
        skippedFresh,
        skippedOverLimit: unique.length - selected.length,
      };
    } finally {
      running = false;
    }
  }

  function start(): () => void {
    let previous: ConnectivityState = deps.connectivity.current();
    return deps.connectivity.subscribe((state) => {
      const reconnected = previous === 'offline' && state === 'online';
      previous = state;
      if (!reconnected) return;
      void runOnce().then(
        (report) => deps.onReport?.(report),
        () => undefined,
      );
    });
  }

  return { runOnce, start };
}
