/**
 * FMP ↔ saját azonosító-leképezés (PHASE 04B). Csak a 2026-11-21-i élő próbákkal IGAZOLT
 * párok szerepelnek; minden más tőzsde „nem leképezett” (nem találgatunk).
 */
import { splitListingId, type ListingId, type Mic } from '@/domain';

/**
 * A quote/profile `exchange` mezője → mely MIC-ek tartozhatnak hozzá.
 * Bizonyíték: AAPL `NASDAQ` (exchangeFullName „NASDAQ Global Select”), TSM/JPM `NYSE`,
 * SPY `AMEX` + „New York Stock Exchange Arca”. Az `AMEX` kétértelmű (NYSE Arca VAGY NYSE
 * American), ezért mindkét MIC elfogadott, de keresésben NEM képezzük le.
 */
export const FMP_QUOTE_EXCHANGE_MICS: Readonly<Record<string, readonly string[]>> = {
  NASDAQ: ['XNAS'],
  NYSE: ['XNYS'],
  AMEX: ['ARCX', 'XASE'],
};

/**
 * A `search-symbol` `exchange` mezője → MIC + az FMP ticker-utótagja.
 * Bizonyíték (search-symbol, 2026-11-21): `SAP.DE` XETRA „Deutsche Börse”, `ISF.L` LSE,
 * `ISFA.AS` AMS „Euronext Amsterdam”, `SWDA.MI` MIL „Italian Stock Exchange”,
 * `AISF.F` FSX „Frankfurt Stock Exchange”, `SAP` NYSE, `USAP` NASDAQ.
 */
export const FMP_SEARCH_VENUES: Readonly<
  Record<string, { readonly mic: string; readonly suffix: string }>
> = {
  NASDAQ: { mic: 'XNAS', suffix: '' },
  NYSE: { mic: 'XNYS', suffix: '' },
  XETRA: { mic: 'XETR', suffix: '.DE' },
  LSE: { mic: 'XLON', suffix: '.L' },
  AMS: { mic: 'XAMS', suffix: '.AS' },
  MIL: { mic: 'XMIL', suffix: '.MI' },
  FSX: { mic: 'XFRA', suffix: '.F' },
};

/** Nem részvény / ETF jellegű FMP „tőzsdék” a keresőben. */
export const FMP_UNSUPPORTED_SEARCH_EXCHANGES: ReadonlySet<string> = new Set(['CRYPTO', 'FOREX']);

/**
 * Saját ticker → FMP ticker (csak US): a share class elválasztója nálunk `.`, az FMP-nél `-`
 * (pl. `BRK.B` → `BRK-B`).
 */
export function toFmpSymbol(listingId: ListingId): string {
  return splitListingId(listingId).symbol.replace(/\./g, '-');
}

/** FMP keresési ticker → saját ticker (az utótag levágása; US-nél `-` → `.`). `null` = nem illeszkedik. */
export function fromFmpSearchSymbol(symbol: string, suffix: string): string | null {
  if (suffix === '') return symbol.replace(/-/g, '.');
  return symbol.endsWith(suffix) ? symbol.slice(0, -suffix.length) : null;
}

export function fmpExchangeMatchesMic(exchange: string, mic: Mic): boolean {
  return FMP_QUOTE_EXCHANGE_MICS[exchange]?.includes(mic) ?? false;
}
