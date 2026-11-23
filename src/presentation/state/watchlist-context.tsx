/**
 * Figyelőlista (PHASE 12 – váz).
 *
 * Csak a kiválasztott jegyzések listája (azonosító, név, típus) – árfolyamot vagy elemzést
 * NEM tárol, azt a képernyő mindig a use case-ből kéri (nincs elavult adat frissként).
 * MVP: memóriában; tartós tárolás: PHASE 13, riasztások/screener: PHASE 14 (KI-97).
 */
import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';

export type InstrumentKind = 'stock' | 'etf' | 'unknown';

export interface WatchlistItem {
  readonly listingId: string;
  readonly name: string | null;
  readonly kind: InstrumentKind;
}

interface WatchlistContextValue {
  readonly items: readonly WatchlistItem[];
  readonly has: (listingId: string) => boolean;
  readonly add: (item: WatchlistItem) => void;
  readonly remove: (listingId: string) => void;
}

const WatchlistContext = createContext<WatchlistContextValue | null>(null);

export function WatchlistProvider({
  initial = [],
  children,
}: {
  readonly initial?: readonly WatchlistItem[];
  readonly children: ReactNode;
}) {
  const [items, setItems] = useState<readonly WatchlistItem[]>(initial);
  const value = useMemo<WatchlistContextValue>(
    () => ({
      items,
      has: (listingId) => items.some((i) => i.listingId === listingId),
      add: (item) =>
        setItems((current) =>
          current.some((i) => i.listingId === item.listingId) ? current : [...current, item],
        ),
      remove: (listingId) =>
        setItems((current) => current.filter((i) => i.listingId !== listingId)),
    }),
    [items],
  );
  return <WatchlistContext.Provider value={value}>{children}</WatchlistContext.Provider>;
}

export function useWatchlist(): WatchlistContextValue {
  const value = useContext(WatchlistContext);
  if (value === null) {
    throw new Error('useWatchlist: hiányzó <WatchlistProvider> a komponensfa tetején.');
  }
  return value;
}
