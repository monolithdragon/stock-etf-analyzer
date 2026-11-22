/**
 * Determinisztikus DEMÓ árfolyam-forrás (`kind: 'mock'`).
 *
 * Szándékosan kitalált, „DEMO” tickerek és kerek árak – nem valós instrumentumok,
 * így véletlenül sem keverhetők össze valós piaci adattal (CLAUDE.md: ne találj ki árfolyamot).
 */
import type { Clock, MarketDataGateway } from '@/application';
import {
  AppErrors,
  createDividendEvent,
  createDividendHistory,
  createFinancialStatement,
  createFinancialStatementSet,
  createFiscalPeriod,
  createInstrumentProfile,
  createInstrumentSearchHit,
  createPriceSeries,
  createQuote,
  err,
  ok,
  metricOk,
  parseCurrencyCode,
  parseSecurityId,
  toIsoTimestamp,
  type DataProvenance,
  type FinancialStatement,
  type InstrumentSearchHit,
  type IsoDate,
  type Isin,
  type ListingId,
  type StatementFrequency,
} from '@/domain';

import { systemClock } from '../system/system-clock';

interface MockQuoteFixture {
  readonly price: number;
  readonly currency: string;
  /** Az ár „kora” a lekérés pillanatában (perc). */
  readonly ageMinutes: number;
}

export const MOCK_QUOTE_FIXTURES: Readonly<Record<string, MockQuoteFixture>> = {
  'DEMO@XNAS': { price: 100, currency: 'USD', ageMinutes: 5 },
  'DEMOETF@XETR': { price: 50, currency: 'EUR', ageMinutes: 5 },
  'DEMOOLD@XNAS': { price: 10, currency: 'USD', ageMinutes: 60 * 24 * 7 },
};

/** Kitalált, rögzített dátumú demó záróárak. */
const MOCK_CLOSES: Readonly<Record<string, readonly (readonly [string, number])[]>> = {
  'DEMO@XNAS': [
    ['2026-11-18', 97],
    ['2026-11-19', 99],
    ['2026-11-20', 100],
  ],
  'DEMOETF@XETR': [
    ['2026-11-19', 49],
    ['2026-11-20', 50],
  ],
};

const MOCK_INSTRUMENTS = [
  { symbol: 'DEMO', mic: 'XNAS', name: 'Demo Corp (kitalált)', kind: 'stock', currency: 'USD' },
  { symbol: 'DEMOETF', mic: 'XETR', name: 'Demo ETF (kitalált)', kind: 'etf', currency: 'EUR' },
] as const;

export const MOCK_SOURCE = {
  sourceId: 'mock',
  sourceName: 'Demóadat (nem valós árfolyam)',
} as const;

export function createMockMarketDataGateway(clock: Clock = systemClock): MarketDataGateway {
  const provenance = (extra: Partial<DataProvenance> = {}): DataProvenance => ({
    ...MOCK_SOURCE,
    kind: 'mock',
    fetchedAt: toIsoTimestamp(clock.now()),
    asOf: null,
    freshness: 'UNKNOWN',
    ...extra,
  });

  return {
    async getPriceHistory({ listingId, from, to, adjustment }) {
      const closes = MOCK_CLOSES[listingId];
      const fixture = MOCK_QUOTE_FIXTURES[listingId];
      if (closes === undefined || fixture === undefined) {
        return err(AppErrors.notFound('demó ártörténet', listingId));
      }
      const currency = parseCurrencyCode(fixture.currency);
      if (!currency.ok) return currency;
      const points = closes
        .filter(([date]) => date >= from && date <= to)
        .map(([date, close]) => ({ date, close }));
      const last = points[points.length - 1];
      return createPriceSeries({
        listingId,
        currency: currency.value,
        adjustment,
        points,
        notes: ['Demóadat – kitalált záróárak.'],
        provenance: provenance({
          asOf: last === undefined ? null : (last.date as IsoDate),
          currency: currency.value,
        }),
      });
    },

    async getInstrumentProfile(listingId) {
      const entry = MOCK_INSTRUMENTS.find((i) => `${i.symbol}@${i.mic}` === listingId);
      if (entry === undefined) return err(AppErrors.notFound('demó profil', listingId));
      return createInstrumentProfile({
        listingId,
        name: entry.name,
        kindHint: entry.kind,
        isin: null,
        cik: null,
        country: null,
        sector: null,
        industry: null,
        exchangeName: entry.mic,
        tradingCurrency: entry.currency,
        website: null,
        description: 'Kitalált demó instrumentum.',
        provenance: provenance(),
      });
    },

    async getDividends({ listingId, from, to }) {
      if (listingId !== 'DEMO@XNAS') return err(AppErrors.notFound('demó osztalék', listingId));
      const usd = parseCurrencyCode('USD');
      if (!usd.ok) return usd;
      const event = createDividendEvent({
        exDate: '2026-08-10',
        paymentDate: null,
        recordDate: null,
        declarationDate: null,
        amount: 0.5,
        currency: usd.value,
        splitAdjustedAmount: null,
        frequency: null,
      });
      if (!event.ok) return event;
      const inRange = event.value.exDate >= from && event.value.exDate <= to;
      return createDividendHistory({
        listingId,
        events: inRange ? [event.value] : [],
        notes: ['Demóadat – kitalált osztalék.'],
        provenance: provenance(),
      });
    },

    async searchInstruments(query) {
      const needle = query.toUpperCase();
      const hits: InstrumentSearchHit[] = [];
      for (const entry of MOCK_INSTRUMENTS) {
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
        provenance: provenance(),
      });
    },

    async getQuote(listingId: ListingId) {
      const fixture = MOCK_QUOTE_FIXTURES[listingId];
      if (fixture === undefined) return err(AppErrors.notFound('demó árfolyam', listingId));

      const currency = parseCurrencyCode(fixture.currency);
      if (!currency.ok) return currency;

      const now = clock.now();
      const asOf = toIsoTimestamp(new Date(now.getTime() - fixture.ageMinutes * 60_000));
      const provenance: DataProvenance = {
        ...MOCK_SOURCE,
        kind: 'mock',
        fetchedAt: toIsoTimestamp(now),
        asOf,
        currency: currency.value,
        freshness: 'UNKNOWN', // a use case számolja ki a saját szabálya szerint
      };
      return createQuote({
        listingId,
        price: fixture.price,
        currency: currency.value,
        asOf,
        delayMinutes: null,
        provenance,
      });
    },

    async getSecurityListings(isin: Isin) {
      // Demó módban nincs (kitalált) ISIN: valós azonosítóhoz nem gyártunk jegyzést.
      return err(AppErrors.notFound('demó jegyzés (ISIN)', isin));
    },

    async getFinancialStatements(listingId: ListingId, frequency: StatementFrequency) {
      if (listingId !== 'DEMO@XNAS') return err(AppErrors.notFound('demó kimutatás', listingId));
      const securityId = parseSecurityId('mock:DEMO');
      const usd = parseCurrencyCode('USD');
      const period = createFiscalPeriod({
        fiscalYear: 2025,
        fiscalPeriod: 'FY',
        start: '2025-01-01',
        end: '2025-12-31',
      });
      if (!securityId.ok || !usd.ok || !period.ok) {
        return err(AppErrors.validation('Hibás demó-konfiguráció.'));
      }
      const provenance: DataProvenance = {
        ...MOCK_SOURCE,
        kind: 'mock',
        fetchedAt: toIsoTimestamp(clock.now()),
        asOf: period.value.end,
        freshness: 'UNKNOWN',
        period: period.value,
        currency: usd.value,
      };
      const statements: FinancialStatement[] = [];
      if (frequency === 'annual') {
        // A `costOfRevenue` szándékosan nincs megadva → MISSING (nem 0).
        const income = createFinancialStatement({
          statementType: 'income',
          securityId: securityId.value,
          period: period.value,
          currency: usd.value,
          provenance,
          lineItems: { revenue: metricOk(1_000_000_000, { ...provenance, unit: 'money' }) },
        });
        if (!income.ok) return income;
        statements.push(income.value);
      }
      return createFinancialStatementSet({
        securityId: securityId.value,
        cik: null,
        entityName: 'Demo Corp (kitalált)',
        frequency,
        statements,
        notes: ['Demóadat – nem valós vállalat.'],
        provenance,
      });
    },
  };
}
