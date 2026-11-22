/**
 * Jegyzés → piaci szegmens (DATA_SOURCES 5.2): a routing-tábla oszlopai.
 * Csak a MIC-ből dönt (hálózati hívás nélkül). Üzemeltetői MIC-ek (D-042).
 */
import type { RoutingMarket } from '@/contracts';
import { splitListingId, type ListingId, type Mic } from '@/domain';

/** US tőzsdék (üzemeltetői MIC): Nasdaq, NYSE, NYSE Arca, NYSE American, Cboe BZX. */
export const US_MICS: ReadonlySet<string> = new Set(['XNAS', 'XNYS', 'ARCX', 'XASE', 'BATS']);

/** Európai tőzsdék (EGT + UK + Svájc), amelyekre a routing az európai láncot használja. */
export const EU_MICS: ReadonlySet<string> = new Set([
  'XETR',
  'XFRA',
  'XSTU',
  'XDUS',
  'XMUN',
  'XHAM',
  'XLON',
  'XAMS',
  'XPAR',
  'XBRU',
  'XLIS',
  'XMIL',
  'XMAD',
  'XSWX',
  'XWBO',
  'XSTO',
  'XCSE',
  'XHEL',
  'XOSL',
  'XDUB',
  'XWAR',
  'XPRA',
  'XBUD',
]);

export function marketOfMic(mic: Mic | string): Exclude<RoutingMarket, 'ANY'> {
  if (US_MICS.has(mic)) return 'US';
  if (EU_MICS.has(mic)) return 'EU';
  return 'GLOBAL';
}

export function marketOfListing(listingId: ListingId): Exclude<RoutingMarket, 'ANY'> {
  return marketOfMic(splitListingId(listingId).mic);
}

export const isUsListing = (listingId: ListingId): boolean => marketOfListing(listingId) === 'US';
