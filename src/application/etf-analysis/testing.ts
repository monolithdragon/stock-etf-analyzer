/**
 * CSAK TESZTEKHEZ: szintetikus, determinisztikus bemenetek az ETF-elemzés összerakójához.
 * Az alkalmazás nem importálja.
 */
import {
  AppErrors,
  err,
  ok,
  type AppError,
  type CurrencyCode,
  type DataProvenance,
  type DividendHistory,
  type IsoDate,
  type IsoTimestamp,
  type ListingId,
  type PriceAdjustment,
  type PriceSeries,
  type Result,
} from '@/domain';

import type { EtfAnalysisInputs } from './etf-analysis';
import type { EtfMetadataInput } from './types';

export const NOW = new Date('2026-11-22T12:00:00Z');
export const FETCHED = '2026-11-22T12:00:00Z' as IsoTimestamp;
export const LISTING = 'VWCE@XETR' as ListingId;
const DAY_MS = 86_400_000;

export const provenance = (overrides: Partial<DataProvenance> = {}): DataProvenance => ({
  sourceId: 'test',
  sourceName: 'Teszt-forrás',
  kind: 'reported',
  fetchedAt: FETCHED,
  asOf: null,
  freshness: 'FRESH',
  ...overrides,
});

/** Munkanapok (h–p) visszafelé `NOW`-tól, növekvő sorrendben. */
export function tradingDates(count: number, endOffsetDays = 0): IsoDate[] {
  const dates: IsoDate[] = [];
  let t = NOW.getTime() - endOffsetDays * DAY_MS;
  while (dates.length < count) {
    const day = new Date(t).getUTCDay();
    if (day !== 0 && day !== 6) dates.push(new Date(t).toISOString().slice(0, 10) as IsoDate);
    t -= DAY_MS;
  }
  return dates.reverse();
}

/** Determinisztikus napi hozam: 1% amplitúdójú szinusz + kis sodródás. */
export const dailyReturn = (i: number) => 0.01 * Math.sin(i * 0.7) + 0.0003;

export function series(options: {
  readonly count: number;
  readonly adjustment?: PriceAdjustment;
  readonly currency?: string;
  readonly start?: number;
  readonly endOffsetDays?: number;
  readonly returnAt?: (i: number) => number;
  readonly notes?: readonly string[];
}): PriceSeries {
  const returnAt = options.returnAt ?? dailyReturn;
  const dates = tradingDates(options.count, options.endOffsetDays ?? 0);
  let close = options.start ?? 100;
  const points = dates.map((date, i) => {
    if (i > 0) close *= 1 + returnAt(i);
    return { date, close };
  });
  const currency = (options.currency ?? 'EUR') as CurrencyCode;
  return {
    listingId: LISTING,
    currency,
    adjustment: options.adjustment ?? 'SPLIT_DIVIDEND',
    points,
    notes: options.notes ?? [],
    provenance: provenance({ asOf: dates[dates.length - 1] ?? null, currency }),
  };
}

export function dividends(
  events: readonly {
    readonly exDate: string;
    readonly amount: number;
    readonly currency?: string;
  }[],
): DividendHistory {
  return {
    listingId: LISTING,
    events: events.map((e) => ({
      exDate: e.exDate as IsoDate,
      paymentDate: null,
      recordDate: null,
      declarationDate: null,
      amount: { amount: e.amount, currency: (e.currency ?? 'EUR') as CurrencyCode },
      splitAdjustedAmount: e.amount,
      frequency: 'Quarterly',
    })),
    notes: [],
    provenance: provenance(),
  };
}

export const unavailable = <T>(message = 'A teszt-forrás nem ad ilyet.'): Result<T, AppError> =>
  err(AppErrors.unavailable('PLAN_LIMIT', message));

export const metadata = (fields: Partial<EtfMetadataInput> = {}): EtfMetadataInput => ({
  source: {
    kind: 'user_input',
    sourceId: 'user',
    sourceName: 'Factsheet (kézi)',
    asOf: '2026-10-31',
  },
  ...fields,
});

export function inputs(overrides: Partial<EtfAnalysisInputs> = {}): EtfAnalysisInputs {
  return {
    listingId: LISTING,
    now: NOW,
    options: {},
    quote: unavailable(),
    instrumentProfile: unavailable(),
    totalSeries: ok(series({ count: 300 })),
    priceSeries: ok(series({ count: 300, adjustment: 'SPLIT' })),
    dividends: ok(dividends([])),
    aumConversion: null,
    ...overrides,
  };
}

/** N azonos súlyú holdings-tétel a megadott országgal és devizával. */
export function holdingsList(
  count: number,
  weight: number,
  fields: { readonly country?: string; readonly currency?: string; readonly sector?: string } = {},
) {
  return Array.from({ length: count }, (_, i) => ({ name: `Pozíció ${i + 1}`, weight, ...fields }));
}
