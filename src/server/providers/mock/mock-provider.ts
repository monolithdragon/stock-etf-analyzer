/**
 * `mock` szolgáltató a proxyn: determinisztikus DEMÓ adat (D-005, PHASE 04 feladat 9.).
 *
 * Nem keverhető éles adattal:
 * - minden provenance `kind: 'mock'`, a név „Demóadat (nem valós …)”;
 * - csak `PROXY_DATA_MODE=mock` mellett regisztrálható (`createProviderRegistry` ellenőrzi);
 * - kitalált `DEMO*` tickerek és kerek számok – nem valós instrumentum, nem valós árfolyam.
 */
import {
  AppErrors,
  createDividendEvent,
  createDividendHistory,
  createFinancialStatement,
  createFinancialStatementSet,
  createFiscalPeriod,
  createFxRate,
  createFxRateSet,
  createInstrumentProfile,
  createInstrumentSearchHit,
  createPriceSeries,
  createQuote,
  err,
  metricOk,
  ok,
  parseCurrencyCode,
  parseIsoDate,
  parseSecurityId,
  toIsoTimestamp,
  toUtcIsoDate,
  type CurrencyCode,
  type DataProvenance,
  type FxRate,
  type IsoDate,
  type InstrumentSearchHit,
  type Metric,
} from '@/domain';

import type { MarketDataProvider } from '../market-data-provider';

export const MOCK_PROVIDER_SOURCE = {
  sourceId: 'mock',
  sourceName: 'Demóadat (nem valós piaci adat)',
} as const;

const DEMO_QUOTES: Readonly<
  Record<string, { price: number; currency: string; ageMinutes: number }>
> = {
  'DEMO@XNAS': { price: 100, currency: 'USD', ageMinutes: 5 },
  'DEMOETF@XETR': { price: 50, currency: 'EUR', ageMinutes: 5 },
};

/** Kitalált, rögzített dátumú demó záróárak (a kért időszakra szűrve). */
const DEMO_CLOSES: Readonly<Record<string, readonly (readonly [string, number])[]>> = {
  'DEMO@XNAS': [
    ['2026-11-16', 96],
    ['2026-11-17', 98],
    ['2026-11-18', 97],
    ['2026-11-19', 99],
    ['2026-11-20', 100],
  ],
  'DEMOETF@XETR': [
    ['2026-11-19', 49],
    ['2026-11-20', 50],
  ],
};

const DEMO_SEARCH: readonly {
  symbol: string;
  mic: string;
  name: string;
  kind: 'stock' | 'etf';
  currency: string;
}[] = [
  { symbol: 'DEMO', mic: 'XNAS', name: 'Demo Corp (kitalált)', kind: 'stock', currency: 'USD' },
  { symbol: 'DEMOETF', mic: 'XETR', name: 'Demo ETF (kitalált)', kind: 'etf', currency: 'EUR' },
];

/** Kerek, nyilvánvalóan kitalált demó ráták (1 EUR = …). */
export const DEMO_EUR_RATES: Readonly<Record<string, number>> = {
  USD: 1.1,
  HUF: 400,
  GBP: 0.85,
  CHF: 0.95,
  JPY: 160,
};

function mockProvenance(now: Date, extra: Partial<DataProvenance> = {}): DataProvenance {
  return {
    ...MOCK_PROVIDER_SOURCE,
    kind: 'mock',
    fetchedAt: toIsoTimestamp(now),
    asOf: null,
    freshness: 'UNKNOWN',
    ...extra,
  };
}

export function createMockProvider(deps: { readonly now: () => Date }): MarketDataProvider {
  return {
    info: {
      id: MOCK_PROVIDER_SOURCE.sourceId,
      name: MOCK_PROVIDER_SOURCE.sourceName,
      kind: 'mock',
      configured: true,
      plan: null,
      coverage: 'Csak kitalált DEMO* instrumentumok.',
      note: 'DEMÓ mód: minden adat kitalált és „mock” jelölésű.',
    },

    async getQuote(listingId) {
      const fixture = DEMO_QUOTES[listingId];
      if (fixture === undefined) return err(AppErrors.notFound('demó árfolyam', listingId));
      const currency = parseCurrencyCode(fixture.currency);
      if (!currency.ok) return currency;
      const now = deps.now();
      const asOf = toIsoTimestamp(new Date(now.getTime() - fixture.ageMinutes * 60_000));
      return createQuote({
        listingId,
        price: fixture.price,
        currency: currency.value,
        asOf,
        delayMinutes: null,
        provenance: mockProvenance(now, { asOf, currency: currency.value }),
      });
    },

    async getPriceHistory(request) {
      const closes = DEMO_CLOSES[request.listingId];
      const fixture = DEMO_QUOTES[request.listingId];
      if (closes === undefined || fixture === undefined) {
        return err(AppErrors.notFound('demó ártörténet', request.listingId));
      }
      const currency = parseCurrencyCode(fixture.currency);
      if (!currency.ok) return currency;
      const points = closes
        .filter(([date]) => date >= request.from && date <= request.to)
        .map(([date, close]) => ({ date, close }));
      const last = points[points.length - 1];
      return createPriceSeries({
        listingId: request.listingId,
        currency: currency.value,
        adjustment: request.adjustment,
        points,
        notes: ['Demó adat: kitalált záróárak; a korrekció fajtája csak címke.'],
        provenance: mockProvenance(deps.now(), {
          asOf: last === undefined ? null : (last.date as IsoDate),
          currency: currency.value,
        }),
      });
    },

    async getProfile(listingId) {
      const entry = DEMO_SEARCH.find((d) => `${d.symbol}@${d.mic}` === listingId);
      if (entry === undefined) return err(AppErrors.notFound('demó profil', listingId));
      return createInstrumentProfile({
        listingId,
        name: entry.name,
        kindHint: entry.kind,
        isin: null, // demó módban nincs (kitalált) ISIN
        cik: null,
        country: null,
        sector: null,
        industry: null,
        exchangeName: entry.mic,
        tradingCurrency: entry.currency,
        website: null,
        description: 'Kitalált demó instrumentum – nem valós vállalat vagy alap.',
        provenance: mockProvenance(deps.now()),
      });
    },

    async getDividends(request) {
      if (request.listingId !== 'DEMO@XNAS') {
        return err(AppErrors.notFound('demó osztalék', request.listingId));
      }
      const usd = parseCurrencyCode('USD');
      if (!usd.ok) return usd;
      const event = createDividendEvent({
        exDate: '2026-08-10',
        paymentDate: '2026-08-20',
        recordDate: null,
        declarationDate: null,
        amount: 0.5,
        currency: usd.value,
        splitAdjustedAmount: 0.5,
        frequency: 'Demo',
      });
      if (!event.ok) return event;
      const events =
        event.value.exDate >= request.from && event.value.exDate <= request.to ? [event.value] : [];
      return createDividendHistory({
        listingId: request.listingId,
        events,
        notes: ['Demó adat: kitalált osztalék.'],
        provenance: mockProvenance(deps.now()),
      });
    },

    async searchInstruments(query) {
      const needle = query.toUpperCase();
      const hits: InstrumentSearchHit[] = [];
      for (const entry of DEMO_SEARCH) {
        if (!entry.symbol.includes(needle) && !entry.name.toUpperCase().includes(needle)) continue;
        const hit = createInstrumentSearchHit({
          symbol: entry.symbol,
          mic: entry.mic,
          name: entry.name,
          kindHint: entry.kind,
          isin: null,
          tradingCurrency: entry.currency,
          exchangeName: entry.mic,
        });
        if (!hit.ok) return hit;
        hits.push(hit.value);
      }
      return ok({
        query,
        hits,
        omitted: { unmappedVenue: 0, invalidSymbol: 0, unsupportedType: 0, truncated: 0 },
        provenance: mockProvenance(deps.now()),
      });
    },

    async getFxRates(request) {
      const now = deps.now();
      const asOf = request.date ?? toUtcIsoDate(now);
      const rates: FxRate[] = [];
      const missing: CurrencyCode[] = [];
      for (const quote of request.quotes) {
        const value = request.base === 'EUR' ? DEMO_EUR_RATES[quote] : undefined;
        if (value === undefined) {
          if (quote !== request.base) missing.push(quote);
          continue;
        }
        const rate = createFxRate({
          base: request.base,
          quote,
          rate: value,
          asOf,
          provenance: mockProvenance(now, { reference: 'demó ráta' }),
        });
        if (!rate.ok) return rate;
        rates.push({
          ...rate.value,
          provenance: { ...rate.value.provenance, asOf: rate.value.asOf },
        });
      }
      return createFxRateSet({ base: request.base, rates, missing });
    },

    async getFinancialStatements(listingId, frequency) {
      if (listingId !== 'DEMO@XNAS') return err(AppErrors.notFound('demó kimutatás', listingId));
      const now = deps.now();
      const securityId = parseSecurityId('mock:DEMO');
      const usd = parseCurrencyCode('USD');
      const period = createFiscalPeriod({
        fiscalYear: 2025,
        fiscalPeriod: 'FY',
        start: '2025-01-01',
        end: '2025-12-31',
      });
      const filed = parseIsoDate('2026-02-15');
      if (!securityId.ok || !usd.ok || !period.ok || !filed.ok) {
        return err(AppErrors.validation('Hibás demó-konfiguráció.'));
      }
      const base = mockProvenance(now, { asOf: filed.value, period: period.value });
      const money = (value: number): Metric<number> =>
        metricOk(value, { ...base, unit: 'money', currency: usd.value });

      if (frequency === 'quarterly') {
        return createFinancialStatementSet({
          securityId: securityId.value,
          cik: null,
          entityName: 'Demo Corp (kitalált)',
          frequency,
          statements: [],
          notes: ['Demó módban nincs negyedéves adat.'],
          provenance: base,
        });
      }
      // Szándékosan hiányos: a `costOfRevenue` NINCS megadva → MISSING (nem 0);
      // a `netIncome` 0 – ez JELENTETT nulla, tehát OK státuszú (a kettő nem keverhető).
      const income = createFinancialStatement({
        statementType: 'income',
        securityId: securityId.value,
        period: period.value,
        currency: usd.value,
        provenance: base,
        lineItems: { revenue: money(1_000_000_000), netIncome: money(0) },
      });
      if (!income.ok) return income;
      return ok({
        securityId: securityId.value,
        cik: null,
        entityName: 'Demo Corp (kitalált)',
        frequency,
        statements: [income.value],
        notes: [
          'Demó adat: a costOfRevenue szándékosan hiányzik (MISSING), a nettó eredmény jelentett 0.',
        ],
        provenance: base,
      });
    },
  };
}
