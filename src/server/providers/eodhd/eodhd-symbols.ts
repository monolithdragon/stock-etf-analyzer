/**
 * EODHD ↔ saját azonosító-leképezés (PHASE 04B). Csak igazolt párok (2026-11-21):
 * - `search` válaszok `Exchange` mezője: XETRA, F, LSE, AS, SW (VWCE, ISF ISIN-keresés);
 * - `eod`/`real-time` sikeres hívás: VWCE.XETRA, IWDA.AS, ISF.LSE, SAP.XETRA, ASML.AS,
 *   NESN.SW, OTP.BUD, AAPL.US.
 * Az `US` az EODHD-nél ORSZÁG-szintű kód (nem konkrét tőzsde): ár lekérhető vele, de keresési
 * találatból nem képezünk le MIC-et (nem tudjuk, Nasdaq vagy NYSE).
 */
import { splitListingId, type ListingId } from '@/domain';

import { US_MICS } from '../../routing/markets';

interface EodhdVenue {
  readonly code: string;
  readonly exchangeName: string;
  /**
   * Helyszíni pénznem-szabály (D-052): csak ott, ahol a tőzsde KIZÁRÓLAG egy pénznemben
   * kereskedik. Egyébként `null` → a jegyzés pénznemét az EODHD keresőből kérdezzük le.
   */
  readonly venueCurrency: string | null;
}

export const EODHD_VENUES_BY_MIC: Readonly<Record<string, EodhdVenue>> = {
  XETR: { code: 'XETRA', exchangeName: 'Xetra', venueCurrency: 'EUR' },
  XFRA: { code: 'F', exchangeName: 'Börse Frankfurt', venueCurrency: null },
  // LSE: ugyanaz az ETF GBX-ben, GBP-ben és USD-ben is jegyzett (ISF, ISFU, VWRP, VWRA).
  XLON: { code: 'LSE', exchangeName: 'London Stock Exchange', venueCurrency: null },
  XAMS: { code: 'AS', exchangeName: 'Euronext Amsterdam', venueCurrency: null },
  XSWX: { code: 'SW', exchangeName: 'SIX Swiss Exchange', venueCurrency: null },
  XBUD: { code: 'BUD', exchangeName: 'Budapesti Értéktőzsde', venueCurrency: null },
};

const US_VENUE: EodhdVenue = { code: 'US', exchangeName: 'US', venueCurrency: 'USD' };

/** EODHD keresési `Exchange` → MIC (az `US` szándékosan hiányzik, lásd fent). */
export const MIC_BY_EODHD_EXCHANGE: Readonly<Record<string, string>> = Object.fromEntries(
  Object.entries(EODHD_VENUES_BY_MIC).map(([mic, venue]) => [venue.code, mic]),
);

export const EODHD_COMPOSITE_EXCHANGES: ReadonlySet<string> = new Set(['US']);

export function eodhdVenueOf(listingId: ListingId): EodhdVenue | null {
  const { mic } = splitListingId(listingId);
  if (US_MICS.has(mic)) return US_VENUE;
  return EODHD_VENUES_BY_MIC[mic] ?? null;
}

/** Saját ticker → EODHD kód (US-nél a share class `.` → `-`, pl. `BRK.B` → `BRK-B.US`). */
export function toEodhdSymbol(listingId: ListingId, venue: EodhdVenue): string {
  const { symbol } = splitListingId(listingId);
  const code = venue.code === 'US' ? symbol.replace(/\./g, '-') : symbol;
  return `${code}.${venue.code}`;
}

/** EODHD `Type` → saját instrumentum-fajta; `null` = nem támogatott (alap, index, kötvény…). */
export function kindFromEodhdType(type: string | null | undefined): 'stock' | 'etf' | null {
  if (type === 'ETF') return 'etf';
  if (type === 'Common Stock') return 'stock';
  return null;
}
