/**
 * A proxyn át dolgozó (élő módú) gateway-ek. A szolgáltatót nem ismerik, csak a saját,
 * verziózott `/api/v1` szerződést (D-005); minden választ a közös contract-sémával validálnak.
 */
import type { FxGateway, MarketDataGateway } from '@/application';
import {
  financialStatementSetDtoSchema,
  fxRateSetDtoSchema,
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
