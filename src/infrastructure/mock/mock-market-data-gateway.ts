/**
 * Determinisztikus DEMÓ árfolyam-forrás (`kind: 'mock'`).
 *
 * Szándékosan kitalált, „DEMO” tickerek és kerek árak – nem valós instrumentumok,
 * így véletlenül sem keverhetők össze valós piaci adattal (CLAUDE.md: ne találj ki árfolyamot).
 */
import type { Clock, MarketDataGateway } from '@/application';
import {
  AppErrors,
  createFinancialStatement,
  createFinancialStatementSet,
  createFiscalPeriod,
  createQuote,
  err,
  metricOk,
  parseCurrencyCode,
  parseSecurityId,
  toIsoTimestamp,
  type DataProvenance,
  type FinancialStatement,
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

export const MOCK_SOURCE = {
  sourceId: 'mock',
  sourceName: 'Demóadat (nem valós árfolyam)',
} as const;

export function createMockMarketDataGateway(clock: Clock = systemClock): MarketDataGateway {
  return {
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
