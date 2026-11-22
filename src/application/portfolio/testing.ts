/**
 * CSAK TESZTEKHEZ: determinisztikus portfólió-bemenetek. Az alkalmazás nem importálja.
 */
import {
  AppErrors,
  createEtfHoldingsSnapshot,
  createPortfolioAssetMetadata,
  createTransaction,
  err,
  ok,
  type AppError,
  type CurrencyCode,
  type DataProvenance,
  type EtfHoldingInput,
  type EtfHoldingsSnapshot,
  type FxRate,
  type IsoDate,
  type IsoTimestamp,
  type ListingId,
  type Portfolio,
  type PortfolioAssetMetadata,
  type PortfolioAssetMetadataInput,
  type PortfolioId,
  type PriceAdjustment,
  type PriceSeries,
  type Quote,
  type Result,
  type Transaction,
} from '@/domain';

import type { FxEntry, FxLookup } from './fx-lookup';
import type { PortfolioAnalysisInput } from './portfolio-analysis';

export const NOW = new Date('2026-11-22T12:00:00Z');
export const FETCHED = '2026-11-22T12:00:00Z' as IsoTimestamp;
export const EUR = 'EUR' as CurrencyCode;
export const USD = 'USD' as CurrencyCode;
export const GBP = 'GBP' as CurrencyCode;
export const GBX = 'GBX' as CurrencyCode;
export const AAPL = 'AAPL@XNAS' as ListingId;
export const VWCE = 'VWCE@XETR' as ListingId;
export const ISF = 'ISF@XLON' as ListingId;

export const PORTFOLIO: Portfolio = {
  id: 'p1' as PortfolioId,
  name: 'Teszt',
  baseCurrency: EUR,
  createdAt: '2026-01-01T00:00:00Z' as IsoTimestamp,
};

export const prov = (overrides: Partial<DataProvenance> = {}): DataProvenance => ({
  sourceId: 'test',
  sourceName: 'Teszt-forrás',
  kind: 'reported',
  fetchedAt: FETCHED,
  asOf: null,
  freshness: 'FRESH',
  ...overrides,
});

let counter = 0;
function make(input: Parameters<typeof createTransaction>[0]): Transaction {
  const result = createTransaction(input, { today: '2026-11-22' as IsoDate });
  if (!result.ok) throw new Error(JSON.stringify(result.error));
  return result.value;
}
const nextId = () => `t${(counter += 1)}`;

export function fxRate(base: CurrencyCode, rate: number, asOf: string): FxRate {
  return {
    base,
    quote: EUR,
    rate,
    asOf: asOf as IsoDate,
    provenance: prov({ sourceName: 'Bróker' }),
  };
}

export const tx = {
  buy: (
    listingId: ListingId,
    date: string,
    quantity: number,
    price: number,
    currency: CurrencyCode,
    fees = 0,
    feesCurrency: CurrencyCode = currency,
    extra: { id?: string; fxRateToBase?: FxRate } = {},
  ) =>
    make({
      id: extra.id ?? nextId(),
      portfolioId: 'p1',
      listingId,
      type: 'BUY',
      tradeDate: date,
      quantity,
      price,
      priceCurrency: currency,
      fees,
      feesCurrency,
      fxRateToBase: extra.fxRateToBase ?? null,
    }),
  sell: (
    listingId: ListingId,
    date: string,
    quantity: number,
    price: number,
    currency: CurrencyCode,
    fees = 0,
    extra: { id?: string } = {},
  ) =>
    make({
      id: extra.id ?? nextId(),
      portfolioId: 'p1',
      listingId,
      type: 'SELL',
      tradeDate: date,
      quantity,
      price,
      priceCurrency: currency,
      fees,
      feesCurrency: currency,
    }),
  dividend: (listingId: ListingId, date: string, amount: number, currency: CurrencyCode) =>
    make({
      id: nextId(),
      portfolioId: 'p1',
      listingId,
      type: 'DIVIDEND',
      tradeDate: date,
      amount,
      currency,
    }),
  fee: (listingId: ListingId, date: string, amount: number, currency: CurrencyCode) =>
    make({
      id: nextId(),
      portfolioId: 'p1',
      listingId,
      type: 'FEE',
      tradeDate: date,
      amount,
      currency,
    }),
  split: (listingId: ListingId, date: string, ratioFrom: number, ratioTo: number) =>
    make({
      id: nextId(),
      portfolioId: 'p1',
      listingId,
      type: 'SPLIT',
      tradeDate: date,
      ratioFrom,
      ratioTo,
    }),
};

export function quote(
  listingId: ListingId,
  amount: number,
  currency: CurrencyCode,
  overrides: Partial<DataProvenance> = {},
): Result<Quote, AppError> {
  return ok({
    listingId,
    price: { amount, currency },
    asOf: FETCHED,
    delayMinutes: null,
    provenance: prov(overrides),
  });
}

export const quoteError = (): Result<Quote, AppError> =>
  err(AppErrors.unavailable('QUOTA_EXHAUSTED', 'Elfogyott a napi keret.'));

export function marketFx(currency: CurrencyCode, rate: number, asOf: string): FxEntry {
  return {
    ok: true,
    rate: {
      currency,
      rate,
      asOf: asOf as IsoDate,
      source: 'market',
      provenance: prov({ sourceId: 'ecb-fx' }),
    },
  };
}

export function lookup(
  current: Readonly<Record<string, number>>,
  historical: Readonly<Record<string, number>> = {},
): FxLookup {
  return {
    base: EUR,
    current: new Map(
      Object.entries(current).map(([c, r]) => [
        c as CurrencyCode,
        marketFx(c as CurrencyCode, r, '2026-11-20'),
      ]),
    ),
    historical: new Map(
      Object.entries(historical).map(([key, r]) => {
        const [c, date] = key.split('@') as [string, string];
        return [key, marketFx(c as CurrencyCode, r, date)];
      }),
    ),
  };
}

export function meta(
  listingId: ListingId,
  input: Omit<PortfolioAssetMetadataInput, 'listingId' | 'source'>,
): PortfolioAssetMetadata {
  const result = createPortfolioAssetMetadata({
    ...input,
    listingId,
    source: { kind: 'user_input', sourceName: 'Teszt' },
  });
  if (!result.ok) throw new Error(JSON.stringify(result.error));
  return result.value;
}

export function holdings(
  items: readonly EtfHoldingInput[],
  declaredComplete = false,
  asOf = '2026-10-31',
): EtfHoldingsSnapshot {
  const result = createEtfHoldingsSnapshot({
    asOf,
    holdings: items,
    declaredComplete,
    provenance: prov({ kind: 'user_input' }),
  });
  if (!result.ok) throw new Error(JSON.stringify(result.error));
  return result.value;
}

export function priceSeries(
  listingId: ListingId,
  currency: CurrencyCode,
  points: readonly { readonly date: string; readonly close: number }[],
  adjustment: PriceAdjustment = 'SPLIT',
): Result<PriceSeries, AppError> {
  return ok({
    listingId,
    currency,
    adjustment,
    points: points.map((p) => ({ date: p.date as IsoDate, close: p.close })),
    notes: [],
    provenance: prov(),
  });
}

/** Munkanapok (h–p) egy kezdőnaptól. */
export function weekdays(start: string, count: number): IsoDate[] {
  const dates: IsoDate[] = [];
  let t = new Date(`${start}T00:00:00Z`).getTime();
  while (dates.length < count) {
    const d = new Date(t);
    if (d.getUTCDay() !== 0 && d.getUTCDay() !== 6)
      dates.push(d.toISOString().slice(0, 10) as IsoDate);
    t += 86_400_000;
  }
  return dates;
}

export function baseInput(overrides: Partial<PortfolioAnalysisInput> = {}): PortfolioAnalysisInput {
  return {
    portfolio: PORTFOLIO,
    transactions: [],
    now: NOW,
    quotes: new Map(),
    fx: lookup({}),
    metadata: new Map(),
    holdings: new Map(),
    history: { enabled: false, from: null, priceSeries: new Map(), fxSeries: new Map() },
    riskFreeRate: null,
    minRiskObservations: 126,
    ...overrides,
  };
}
