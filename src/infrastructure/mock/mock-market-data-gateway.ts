/**
 * Determinisztikus DEMÓ árfolyam-forrás (`kind: 'mock'`).
 *
 * Szándékosan kitalált, „DEMO” tickerek és kerek árak – nem valós instrumentumok,
 * így véletlenül sem keverhetők össze valós piaci adattal (CLAUDE.md: ne találj ki árfolyamot).
 */
import type { Clock, MarketDataGateway } from '@/application';
import {
  AppErrors,
  createQuote,
  err,
  parseCurrencyCode,
  toIsoTimestamp,
  type DataProvenance,
  type ListingId,
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
  };
}
