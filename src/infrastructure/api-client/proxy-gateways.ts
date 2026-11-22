/**
 * A proxyn át dolgozó (élő módú) gateway-ek. A szolgáltatót nem ismerik, csak a saját,
 * verziózott `/api/v1` szerződést (D-005); minden választ a közös contract-sémával validálnak.
 */
import type { FxGateway, MarketDataGateway } from '@/application';
import {
  dividendHistoryDtoSchema,
  financialStatementSetDtoSchema,
  fxRateSetDtoSchema,
  instrumentProfileDtoSchema,
  instrumentSearchResultDtoSchema,
  priceSeriesDtoSchema,
  quoteDtoSchema,
  quoteFromDto,
  securityListingsDtoSchema,
} from '@/contracts';

import type { ProxyHttpClient } from './proxy-http-client';

const API = '/api/v1';
const segment = (value: string) => encodeURIComponent(value);

export function createProxyMarketDataGateway(http: ProxyHttpClient): MarketDataGateway {
  return {
    async getQuote(listingId) {
      const dto = await http.get(`${API}/instruments/${segment(listingId)}/quote`, quoteDtoSchema);
      return dto.ok ? quoteFromDto(dto.value) : dto;
    },
    getSecurityListings(isin) {
      return http.get(`${API}/securities/${segment(isin)}/listings`, securityListingsDtoSchema);
    },
    getFinancialStatements(listingId, frequency) {
      return http.get(
        `${API}/stocks/${segment(listingId)}/financials?period=${frequency}`,
        financialStatementSetDtoSchema,
      );
    },
    getPriceHistory({ listingId, from, to, adjustment }) {
      const params = new URLSearchParams({ from, to, adjustment: adjustment.toLowerCase() });
      return http.get(
        `${API}/instruments/${segment(listingId)}/prices?${params.toString()}`,
        priceSeriesDtoSchema,
      );
    },
    getInstrumentProfile(listingId) {
      return http.get(
        `${API}/instruments/${segment(listingId)}/profile`,
        instrumentProfileDtoSchema,
      );
    },
    getDividends({ listingId, from, to }) {
      const params = new URLSearchParams({ from, to });
      return http.get(
        `${API}/instruments/${segment(listingId)}/dividends?${params.toString()}`,
        dividendHistoryDtoSchema,
      );
    },
    searchInstruments(query) {
      const params = new URLSearchParams({ q: query });
      return http.get(`${API}/search?${params.toString()}`, instrumentSearchResultDtoSchema);
    },
  };
}

export function createProxyFxGateway(http: ProxyHttpClient): FxGateway {
  return {
    getReferenceRates({ quotes, date }) {
      const params = new URLSearchParams({ base: 'EUR', quotes: quotes.join(',') });
      if (date !== null) params.set('date', date);
      return http.get(`${API}/fx?${params.toString()}`, fxRateSetDtoSchema);
    },
  };
}
