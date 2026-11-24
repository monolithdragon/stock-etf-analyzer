/**
 * Cache-kulcsok (PHASE 13, D-082). Determinisztikusak: ugyanaz a kérés ugyanazt a kulcsot adja.
 *
 * Ártörténet és osztalék: ha az ablak vége „friss” (≤ 3 nap a mai naptól), a kulcs az ablak
 * HOSSZÁT tartalmazza a dátumok helyett – különben a „365 nap máig” kérés minden nap új kulcsot
 * kapna, és offline másnap nem lenne tartalék. A régi (lezárt) ablak pontos dátumokkal kulcsol.
 */
import type { CurrencyCode, IsoDate, PriceAdjustment, StatementFrequency } from '@/domain';

const DAY_MS = 24 * 60 * 60 * 1000;
/** Eddig számít „friss végű” ablaknak (hétvége + ünnep). */
export const RECENT_WINDOW_TOLERANCE_DAYS = 3;

function spanDays(from: IsoDate, to: IsoDate): number {
  return Math.round((Date.parse(to) - Date.parse(from)) / DAY_MS);
}

function isRecent(to: IsoDate, today: IsoDate): boolean {
  return Date.parse(today) - Date.parse(to) <= RECENT_WINDOW_TOLERANCE_DAYS * DAY_MS;
}

function windowKey(from: IsoDate, to: IsoDate, today: IsoDate): string {
  return isRecent(to, today) ? `recent:${spanDays(from, to)}d` : `${from}:${to}`;
}

export const cacheKeys = {
  quote: (listingId: string) => `quote:${listingId}`,
  priceHistory: (
    listingId: string,
    adjustment: PriceAdjustment,
    from: IsoDate,
    to: IsoDate,
    today: IsoDate,
  ) => `prices:${listingId}:${adjustment}:${windowKey(from, to, today)}`,
  dividends: (listingId: string, from: IsoDate, to: IsoDate, today: IsoDate) =>
    `dividends:${listingId}:${windowKey(from, to, today)}`,
  financials: (listingId: string, frequency: StatementFrequency) =>
    `financials:${listingId}:${frequency}`,
  profile: (listingId: string) => `profile:${listingId}`,
  listings: (isin: string) => `listings:${isin}`,
  search: (query: string) => `search:${query.trim().toLowerCase()}`,
  fx: (quotes: readonly CurrencyCode[], date: IsoDate | null) =>
    `fx:${date ?? 'latest'}:${[...quotes].sort().join(',')}`,
};
