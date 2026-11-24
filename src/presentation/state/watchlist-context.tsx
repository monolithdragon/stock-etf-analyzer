/**
 * Figyelőlista (PHASE 12 váz → PHASE 13: tartós, SQLite).
 *
 * Csak a kiválasztott jegyzések listája (azonosító, név, típus) – árfolyamot vagy elemzést
 * NEM tárol, azt a képernyő mindig a use case-ből kéri (cache-ből, frissesség-jelöléssel).
 * A hook-interfész nem változott: a módosítás azonnal látszik (optimista), és a háttérben
 * mentődik; mentési hibánál a lista visszaáll a tárolt állapotra. Riasztások: PHASE 14.
 */
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import type { WatchlistInstrumentKind, WatchlistItem } from '@/application';
import { useAppServices } from '@/presentation/di/app-services-context';

export type InstrumentKind = WatchlistInstrumentKind;
export type { WatchlistItem };

interface WatchlistContextValue {
  readonly items: readonly WatchlistItem[];
  readonly has: (listingId: string) => boolean;
  readonly add: (item: WatchlistItem) => void;
  readonly remove: (listingId: string) => void;
  /** Utolsó tárolási hiba üzenete (`null`, ha nincs). */
  readonly storageError: string | null;
  /** Teljes törlés után a memóriabeli lista ürítése (a tároló már üres). */
  readonly clearLocal: () => void;
}

const WatchlistContext = createContext<WatchlistContextValue | null>(null);

export function WatchlistProvider({
  initial = [],
  children,
}: {
  readonly initial?: readonly WatchlistItem[];
  readonly children: ReactNode;
}) {
  const services = useAppServices();
  const [items, setItems] = useState<readonly WatchlistItem[]>(initial);
  const [storageError, setStorageError] = useState<string | null>(null);
  const touched = useRef(false);

  const reloadFromStore = useMemo(
    () => async () => {
      const listed = await services.watchlist.list();
      if (listed.ok) setItems(listed.value);
      else setStorageError(listed.error.message);
    },
    [services],
  );

  useEffect(() => {
    let active = true;
    services.watchlist
      .list()
      .then((listed) => {
        if (!active) return;
        if (!listed.ok) {
          setStorageError(listed.error.message);
          return;
        }
        if (!touched.current) setItems(listed.value);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [services]);

  const value = useMemo<WatchlistContextValue>(() => {
    const persist = (
      operation: Promise<{ readonly ok: boolean; readonly error?: { readonly message: string } }>,
    ) => {
      operation
        .then(async (result) => {
          if (result.ok) {
            setStorageError(null);
            return;
          }
          setStorageError(result.error?.message ?? 'Tárolási hiba.');
          await reloadFromStore();
        })
        .catch(() => undefined);
    };
    return {
      items,
      storageError,
      clearLocal: () => {
        touched.current = true;
        setItems([]);
      },
      has: (listingId) => items.some((i) => i.listingId === listingId),
      add: (item) => {
        touched.current = true;
        if (items.some((i) => i.listingId === item.listingId)) return;
        setItems([...items, item]);
        persist(services.watchlist.add(item));
      },
      remove: (listingId) => {
        touched.current = true;
        setItems(items.filter((i) => i.listingId !== listingId));
        persist(services.watchlist.remove(listingId));
      },
    };
  }, [items, storageError, services, reloadFromStore]);
  return <WatchlistContext.Provider value={value}>{children}</WatchlistContext.Provider>;
}

export function useWatchlist(): WatchlistContextValue {
  const value = useContext(WatchlistContext);
  if (value === null) {
    throw new Error('useWatchlist: hiányzó <WatchlistProvider> a komponensfa tetején.');
  }
  return value;
}
