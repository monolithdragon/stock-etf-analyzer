/**
 * Portfólió-FX: mely rátákra van szükség, és hogyan oldjuk fel őket (D-072/3).
 *
 * Ráta-elsőbbség egy tranzakciónál (fő pénznem → bázis):
 *   1. azonos fő pénznem → nincs átváltás (azonosság);
 *   2. a tranzakcióhoz rögzített `fxRateToBase` (pl. a bróker tényleges rátája) – `transaction`;
 *   3. referencia (ECB) ráta az ügylet napjára – `market` (a `convertMoney` use case-en át);
 *   4. különben HIÁNY (okkal) – soha nem becsüljük és nem helyettesítjük a mai rátával.
 * A piaci érték a MAI (legutóbbi) rátával számol; a dátuma a kimenetben látszik.
 */
import {
  toMajor,
  type CurrencyCode,
  type IsoDate,
  type ListingId,
  type Transaction,
} from '@/domain';

import type { UsedFxRate } from './types';

/** `rate: null` = nem kellett átváltani (azonos fő pénznem). */
export type FxEntry =
  | { readonly ok: true; readonly rate: UsedFxRate | null }
  | { readonly ok: false; readonly reason: string };

export interface FxLookup {
  readonly base: CurrencyCode;
  /** Mai ráta fő pénznemenként. */
  readonly current: ReadonlyMap<CurrencyCode, FxEntry>;
  /** Ügyleti napi ráta, kulcs: `fxKey(fő pénznem, dátum)`. */
  readonly historical: ReadonlyMap<string, FxEntry>;
}

export interface FxRequest {
  readonly currency: CurrencyCode;
  /** `null` = mai (legutóbbi) ráta. */
  readonly date: IsoDate | null;
}

export const fxKey = (currency: CurrencyCode, date: IsoDate): string => `${currency}@${date}`;

export const IDENTITY: FxEntry = { ok: true, rate: null };

/** Az alegység osztója (GBX: 100), fő pénznemnél 1. */
export function unitDivisor(currency: CurrencyCode): number {
  return toMajor(currency).divisor ?? 1;
}

export function majorOf(currency: CurrencyCode): CurrencyCode {
  return toMajor(currency).major;
}

/** Összeg átváltása bázisra egy feloldott rátával (alegység → fő pénznem → bázis). */
export function toBaseAmount(
  amount: number,
  currency: CurrencyCode,
  entry: FxEntry,
): number | null {
  if (!entry.ok) return null;
  return (amount / unitDivisor(currency)) * (entry.rate?.rate ?? 1);
}

/** Azonos fő pénznemű összeg átírása egy másik egységre (pl. GBP díj → GBX). */
export function toUnitsOf(amount: number, from: CurrencyCode, to: CurrencyCode): number {
  return (amount / unitDivisor(from)) * unitDivisor(to);
}

function transactionCurrencies(transaction: Transaction): readonly CurrencyCode[] {
  switch (transaction.type) {
    case 'BUY':
    case 'SELL':
      return [transaction.price.currency, transaction.fees.currency];
    case 'DIVIDEND':
    case 'FEE':
      return [transaction.amount.currency];
    case 'SPLIT':
      return [];
  }
}

function recordedRate(transaction: Transaction, major: CurrencyCode, base: CurrencyCode) {
  const fx = transaction.fxRateToBase;
  return fx !== null && fx.base === major && fx.quote === base && fx.rate > 0 ? fx : null;
}

/** Ráta egy tranzakció napjára az adott fő pénznemhez (elsőbbség: lásd a fájl elején). */
export function rateForTransaction(
  lookup: FxLookup,
  transaction: Transaction,
  currency: CurrencyCode,
): FxEntry {
  const major = majorOf(currency);
  if (major === majorOf(lookup.base)) return IDENTITY;
  const recorded = recordedRate(transaction, major, lookup.base);
  if (recorded !== null) {
    return {
      ok: true,
      rate: {
        currency: major,
        rate: recorded.rate,
        asOf: recorded.asOf,
        source: 'transaction',
        provenance: recorded.provenance,
      },
    };
  }
  return (
    lookup.historical.get(fxKey(major, transaction.tradeDate)) ?? {
      ok: false,
      reason: `Nincs ${major} → ${lookup.base} árfolyam a(z) ${transaction.tradeDate} napra.`,
    }
  );
}

export function currentRate(lookup: FxLookup, currency: CurrencyCode): FxEntry {
  const major = majorOf(currency);
  if (major === majorOf(lookup.base)) return IDENTITY;
  return (
    lookup.current.get(major) ?? {
      ok: false,
      reason: `Nincs mai ${major} → ${lookup.base} árfolyam.`,
    }
  );
}

/**
 * A szükséges FX-lekérések (duplikátum nélkül): minden tranzakció-deviza az ügylet napjára
 * (ha nincs rögzített ráta), valamint a nyitott pozíciók pénzneme mai rátára.
 */
export function collectFxRequests(
  base: CurrencyCode,
  transactions: readonly Transaction[],
  openListingCurrencies: ReadonlyMap<ListingId, CurrencyCode>,
): readonly FxRequest[] {
  const baseMajor = majorOf(base);
  const seen = new Set<string>();
  const requests: FxRequest[] = [];
  const push = (currency: CurrencyCode, date: IsoDate | null) => {
    const key = `${currency}@${date ?? 'latest'}`;
    if (seen.has(key)) return;
    seen.add(key);
    requests.push({ currency, date });
  };
  for (const transaction of transactions) {
    for (const currency of transactionCurrencies(transaction)) {
      const major = majorOf(currency);
      if (major === baseMajor || recordedRate(transaction, major, base) !== null) continue;
      push(major, transaction.tradeDate);
    }
  }
  for (const currency of openListingCurrencies.values()) {
    const major = majorOf(currency);
    if (major !== baseMajor) push(major, null);
  }
  return requests;
}
