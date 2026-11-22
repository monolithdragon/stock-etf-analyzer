/**
 * Közös, CSAK TESZTEKHEZ használt fixture-beállítás: valós SEC + FMP fixture → hamis gateway →
 * valódi use case-ek (PHASE 06 integráció, PHASE 07-ben kiemelve a valuation-teszt számára).
 * Az alkalmazás nem importálja.
 */
import {
  createAnalyzeStockFundamentals,
  createGetDividendHistory,
  createGetFinancialStatements,
  createGetInstrumentProfile,
  createGetListingQuote,
  createGetPriceHistory,
  type AnalyzeStockFundamentals,
  type MarketDataGateway,
} from '@/application';
import {
  AppErrors,
  createPriceSeries,
  err,
  ok,
  parseCik,
  parseListingId,
  parseSecurityId,
  type FinancialStatementSet,
  type FundamentalMetric,
  type IsoTimestamp,
  type ListingId,
  type StatementFrequency,
  type StockFundamentalAnalysis,
} from '@/domain';
import {
  normalizeFmpDividends,
  normalizeFmpProfile,
  normalizeFmpQuote,
} from '@/server/providers/fmp/fmp-normalizer';
import { secCompanyFactsShellSchema } from '@/server/providers/sec-edgar/sec-dto';
import { normalizeSecCompanyFacts } from '@/server/providers/sec-edgar/sec-normalizer';
import { loadFixture } from '@/server/testing/test-helpers';

export const NOW = new Date('2026-11-21T22:00:00Z');
export const clock = { now: () => NOW };
export const FETCHED = '2026-11-21T22:00:00Z' as IsoTimestamp;

export function secSet(ticker: string, frequency: StatementFrequency): FinancialStatementSet {
  const shell = secCompanyFactsShellSchema.parse(
    loadFixture('sec-edgar', `companyfacts-${ticker}.json`),
  );
  const cik = parseCik(String(shell.cik).padStart(10, '0'));
  const securityId = parseSecurityId(`sec-edgar:${String(shell.cik).padStart(10, '0')}`);
  if (!cik.ok || !securityId.ok) throw new Error('setup');
  const result = normalizeSecCompanyFacts(shell, {
    frequency,
    cik: cik.value,
    securityId: securityId.value,
    fetchedAt: FETCHED,
    sourceUrl: 'https://data.sec.gov/…',
  });
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}

export function listing(id: string): ListingId {
  const parsed = parseListingId(id);
  if (!parsed.ok) throw new Error('setup');
  return parsed.value;
}

/** Szintetikus, de érvényes 1 éves napi ártörténet (csak az 52 hetes tartományhoz). */
export function syntheticPrices(listingId: ListingId, low: number, high: number) {
  const points = Array.from({ length: 365 }, (_, i) => {
    const date = new Date(NOW.getTime() - (364 - i) * 86_400_000).toISOString().slice(0, 10);
    const close = i === 100 ? low : i === 300 ? high : (low + high) / 2;
    return { date, close };
  });
  return createPriceSeries({
    listingId,
    currency: 'USD' as never,
    adjustment: 'SPLIT_DIVIDEND',
    points,
    provenance: {
      sourceId: 'test-synthetic',
      sourceName: 'Szintetikus teszt-ártörténet',
      kind: 'reported',
      fetchedAt: FETCHED,
      asOf: points[points.length - 1]!.date as never,
      freshness: 'UNKNOWN',
    },
  });
}

export function gatewayFor(ticker: string, options: { withMarket: boolean }): MarketDataGateway {
  const id = listing(`${ticker}@XNAS`);
  const unavailable = () =>
    Promise.resolve(err(AppErrors.unavailable('PLAN_LIMIT', 'A teszt-gateway nem ad ilyet.')));
  return {
    getFinancialStatements: (_listingId, frequency) =>
      Promise.resolve(ok(secSet(ticker, frequency))),
    getQuote: () =>
      options.withMarket
        ? Promise.resolve(
            normalizeFmpQuote(loadFixture('fmp', 'quote-AAPL.json'), id, 'USD' as never, FETCHED),
          )
        : unavailable(),
    getInstrumentProfile: () =>
      options.withMarket
        ? Promise.resolve(normalizeFmpProfile(loadFixture('fmp', 'profile-AAPL.json'), id, FETCHED))
        : unavailable(),
    getPriceHistory: () =>
      options.withMarket ? Promise.resolve(syntheticPrices(id, 243.42, 360.83)) : unavailable(),
    getDividends: (request) =>
      options.withMarket
        ? Promise.resolve(
            normalizeFmpDividends(
              loadFixture('fmp', 'dividends-AAPL.json'),
              request,
              'USD' as never,
              FETCHED,
            ),
          )
        : unavailable(),
    getSecurityListings: unavailable,
    searchInstruments: unavailable,
  };
}

export function analyzerFor(gateway: MarketDataGateway): AnalyzeStockFundamentals {
  const market = { marketData: gateway, clock };
  return createAnalyzeStockFundamentals({
    getFinancialStatements: createGetFinancialStatements(market),
    getListingQuote: createGetListingQuote(market),
    getInstrumentProfile: createGetInstrumentProfile(market),
    getPriceHistory: createGetPriceHistory(market),
    getDividendHistory: createGetDividendHistory(market),
    clock,
  });
}

export async function analyze(
  ticker: string,
  withMarket = true,
): Promise<StockFundamentalAnalysis> {
  const result = await analyzerFor(gatewayFor(ticker, { withMarket }))(`${ticker}@XNAS`);
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}

export const annualCell = (
  a: StockFundamentalAnalysis,
  id: string,
  column = 0,
): FundamentalMetric => {
  const row = a.periodMetrics.annual.rows.find((r) => r.id === id);
  if (row?.cells[column] === undefined) throw new Error(`nincs ${id}`);
  return row.cells[column];
};
export const valuationOf = (a: StockFundamentalAnalysis, id: string): FundamentalMetric => {
  const m = a.valuation.find((v) => v.id === id);
  if (m === undefined) throw new Error(`nincs ${id}`);
  return m;
};
export const okValue = (m: FundamentalMetric): number => {
  if (m.value.status !== 'OK') throw new Error(`${m.id}: ${m.value.status} – ${m.value.reason}`);
  return m.value.value;
};
