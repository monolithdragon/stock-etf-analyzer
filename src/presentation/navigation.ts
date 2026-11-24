/**
 * Útvonal-építők (PHASE 12). A képernyők ezeket használják, így az útvonal-szerkezet egy
 * helyen változtatható. A listing-azonosító (`TICKER@MIC`) útvonal-paraméterként megy át.
 */
import type { InstrumentKind } from '@/presentation/state/watchlist-context';

export function stockHref(listingId: string) {
  return { pathname: '/stock/[listingId]', params: { listingId } } as const;
}

export function etfHref(listingId: string) {
  return { pathname: '/etf/[listingId]', params: { listingId } } as const;
}

/** Ismeretlen típusnál a részvény-nézet nyílik (onnan ETF-re váltható, ha a forrás szerint ETF). */
export function analysisHref(listingId: string, kind: InstrumentKind) {
  return kind === 'etf' ? etfHref(listingId) : stockHref(listingId);
}

/** A szolgáltatói típusjelzés → képernyőtípus. */
export function toInstrumentKind(kindHint: string | null | undefined): InstrumentKind {
  if (kindHint === 'stock') return 'stock';
  if (kindHint === 'etf') return 'etf';
  return 'unknown';
}
