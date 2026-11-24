/**
 * Figyelőlista-elem (PHASE 13): csak azonosító, név és típus – árfolyamot vagy elemzést NEM
 * tárol (azt a képernyő mindig a use case-ből / cache-ből kéri, frissesség-jelöléssel).
 */
import { z } from 'zod';

export const WATCHLIST_KINDS = ['stock', 'etf', 'unknown'] as const;
export type WatchlistInstrumentKind = (typeof WATCHLIST_KINDS)[number];

export interface WatchlistItem {
  readonly listingId: string;
  readonly name: string | null;
  readonly kind: WatchlistInstrumentKind;
}

export const WATCHLIST_NAME_MAX_LENGTH = 200;

export const watchlistItemSchema = z.strictObject({
  listingId: z.string().min(1).max(64),
  name: z.string().max(WATCHLIST_NAME_MAX_LENGTH).nullable(),
  kind: z.enum(WATCHLIST_KINDS),
});
