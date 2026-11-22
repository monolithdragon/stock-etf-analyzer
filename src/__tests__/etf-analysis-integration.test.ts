/**
 * Integráció: VALÓS, megvágott EODHD-fixture (VWCE@XETR, ISF@XLON) → hamis gateway → valódi
 * use case-ek → ETF-elemzés. Élő API-t nem hív.
 */
import {
  createAnalyzeEtf,
  createGetDividendHistory,
  createGetInstrumentProfile,
  createGetListingQuote,
  createGetPriceHistory,
  type ConvertMoney,
  type MarketDataGateway,
} from '@/application';
import {
  AppErrors,
  err,
  ok,
  parseListingId,
  type AppError,
  type CurrencyCode,
  type IsoDate,
  type IsoTimestamp,
  type ListingId,
  type PriceAdjustment,
  type Result,
} from '@/domain';
import {
  normalizeEodhdDividends,
  normalizeEodhdHistory,
  normalizeEodhdQuote,
} from '@/server/providers/eodhd/eodhd-normalizer';
import { normalizeFmpProfile } from '@/server/providers/fmp/fmp-normalizer';
import { loadFixture } from '@/server/testing/test-helpers';

const NOW = new Date('2026-11-21T22:00:00Z');
const FETCHED = '2026-11-21T22:00:00Z' as IsoTimestamp;
const clock = { now: () => NOW };

function id(raw: string): ListingId {
  const parsed = parseListingId(raw);
  if (!parsed.ok) throw new Error('setup');
  return parsed.value;
}

const FIXTURES: Record<string, { eod: string; div: string | null; rt: string; currency: string }> =
  {
    'VWCE@XETR': {
      eod: 'eod-VWCE.XETRA.json',
      div: null,
      rt: 'real-time-VWCE.XETRA.json',
      currency: 'EUR',
    },
    'ISF@XLON': {
      eod: 'eod-ISF.LSE.json',
      div: 'div-ISF.LSE.json',
      rt: 'real-time-ISF.LSE.json',
      currency: 'GBX',
    },
  };

interface Calls {
  readonly history: PriceAdjustment[];
}

/** Az EODHD viselkedését utánzó gateway: SPLIT → NOT_COVERED, nem US profil → PLAN_LIMIT. */
function eodhdGateway(
  calls: Calls,
  profileOverride?: () => ReturnType<MarketDataGateway['getInstrumentProfile']>,
): MarketDataGateway {
  const unavailable = (message: string) =>
    Promise.resolve(err(AppErrors.unavailable('PLAN_LIMIT', message)));
  const fixture = (listingId: ListingId) => {
    const f = FIXTURES[listingId];
    if (f === undefined) throw new Error(`nincs fixture: ${listingId}`);
    return f;
  };
  return {
    getQuote: (listingId) => {
      const f = fixture(listingId);
      return Promise.resolve(
        normalizeEodhdQuote(
          loadFixture('eodhd', f.rt),
          listingId,
          f.currency as CurrencyCode,
          FETCHED,
        ),
      );
    },
    getPriceHistory: (request) => {
      calls.history.push(request.adjustment);
      if (request.adjustment === 'SPLIT') {
        return Promise.resolve(
          err(AppErrors.unavailable('NOT_COVERED', 'Az EODHD nem ad csak split-korrigált sort.')),
        );
      }
      const f = fixture(request.listingId);
      return Promise.resolve(
        normalizeEodhdHistory(
          loadFixture('eodhd', f.eod),
          { ...request, adjustment: request.adjustment },
          f.currency as CurrencyCode,
          FETCHED,
          ['A free csomag csak 1 évet ad: a kért időszak eleje le van vágva.'],
        ),
      );
    },
    getDividends: (request) => {
      const f = fixture(request.listingId);
      return f.div === null
        ? Promise.resolve(
            ok({
              listingId: request.listingId,
              events: [],
              notes: [],
              provenance: {
                sourceId: 'eodhd',
                sourceName: 'EODHD',
                kind: 'reported',
                fetchedAt: FETCHED,
                asOf: null,
                freshness: 'UNKNOWN',
              },
            }),
          )
        : Promise.resolve(
            normalizeEodhdDividends(
              loadFixture('eodhd', f.div),
              request,
              f.currency as CurrencyCode,
              FETCHED,
            ),
          );
    },
    getInstrumentProfile:
      profileOverride ?? (() => unavailable('Nem US profil: a free FMP nem adja.')),
    getFinancialStatements: () => unavailable('nincs'),
    getSecurityListings: () => unavailable('nincs'),
    searchInstruments: () => unavailable('nincs'),
  };
}

function analyzer(gateway: MarketDataGateway, convertMoney?: ConvertMoney) {
  const market = { marketData: gateway, clock };
  return createAnalyzeEtf({
    getListingQuote: createGetListingQuote(market),
    getPriceHistory: createGetPriceHistory(market),
    getDividendHistory: createGetDividendHistory(market),
    getInstrumentProfile: createGetInstrumentProfile(market),
    convertMoney:
      convertMoney ?? (() => Promise.resolve(err(AppErrors.missingData(['fx'], 'nincs FX')))),
    clock,
  });
}

describe('analyzeEtf – VWCE@XETR (akkumuláló, EUR, valós EODHD-fixture)', () => {
  it('total return a korrigált sorból; 1 hónap → kockázat és évesítés INSUFFICIENT_DATA', async () => {
    const calls: Calls = { history: [] };
    const result = await analyzer(eodhdGateway(calls))('VWCE@XETR', {
      metadata: {
        source: {
          kind: 'user_input',
          sourceId: 'user',
          sourceName: 'Vanguard factsheet',
          asOf: '2026-10-31',
        },
        ter: 0.0019,
        distribution: 'accumulating',
        currencyHedged: false,
        domicile: 'IE',
      },
      displayCurrency: 'HUF',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const a = result.value;
    // SPLIT → NOT_COVERED → tartalék NONE (hívásszám: SPLIT_DIVIDEND, SPLIT, NONE).
    expect(calls.history.sort()).toEqual(['NONE', 'SPLIT', 'SPLIT_DIVIDEND']);
    expect(a.profile.tradingCurrency.status === 'OK' && a.profile.tradingCurrency.value).toBe(
      'EUR',
    );
    expect(a.returns.totalReturnMethod).toBe('adjusted_series');
    expect(a.returns.totalReturn.window?.start).toBe('2026-10-20');
    expect(a.returns.annualizedTotalReturn.value.status).toBe('INSUFFICIENT_DATA');
    expect(a.returns.distributionYieldTtm.value.status).toBe('NOT_APPLICABLE');
    expect(a.risk.volatility.value.status).toBe('INSUFFICIENT_DATA');
    expect(a.risk.volatility.value.status !== 'OK' && a.risk.volatility.value.reason).toContain(
      '126',
    );
    expect(a.coverage.limitations.join(' ')).toContain('1 évet ad');
    expect(
      a.costs.annualCostPer10k.value.status === 'OK' && a.costs.annualCostPer10k.value.value,
    ).toBeCloseTo(19, 10);
    // Holdings nélkül a devizakockázat nem számolható (nem a jegyzési devizából találjuk ki):
    // metaadat van, de holdings nincs benne → MISSING.
    expect(a.currency.unhedgedForeignShare.value.status).toBe('MISSING');
    expect(a.profile.name.status).toBe('MISSING');
  });
});

describe('analyzeEtf – ISF@XLON (disztribúciós, GBX ár + GBP osztalék)', () => {
  it('TTM osztalékhozam GBX → GBP normalizálással', async () => {
    const result = await analyzer(eodhdGateway({ history: [] }))('ISF@XLON', {
      metadata: {
        source: {
          kind: 'user_input',
          sourceId: 'user',
          sourceName: 'iShares factsheet',
          asOf: null,
        },
        distribution: 'distributing',
      },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const a = result.value;
    // Utolsó záró: 1010.8 GBX = 10.108 GBP; TTM (2025-11-20, 2026-11-20]: 0.0528+0.0492+0.1288+0.0865
    const ttm = 0.0528 + 0.0492 + 0.1288 + 0.0865;
    const yieldMetric = a.returns.distributionYieldTtm;
    expect(yieldMetric.value.status === 'OK' && yieldMetric.value.value).toBeCloseTo(
      ttm / 10.108,
      10,
    );
    expect(a.profile.tradingCurrency.status === 'OK' && a.profile.tradingCurrency.value).toBe(
      'GBX',
    );
    expect(a.returns.comparisonBasis).toBe('total_return');
  });
});

describe('analyzeEtf – elválasztás és hibák', () => {
  it('a szolgáltató szerint részvény → VALIDATION (a részvényelemzés kezeli)', async () => {
    const stockProfile = () =>
      Promise.resolve(
        normalizeFmpProfile(loadFixture('fmp', 'profile-AAPL.json'), id('AAPL@XNAS'), FETCHED),
      );
    const result = await analyzer(eodhdGateway({ history: [] }, stockProfile))('VWCE@XETR');
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error.kind).toBe('VALIDATION');
    expect(!result.ok && result.error.message).toContain('részvény');
  });

  it('érvénytelen listing-azonosító → VALIDATION', async () => {
    const result = await analyzer(eodhdGateway({ history: [] }))('nem-jo');
    expect(!result.ok && result.error.kind).toBe('VALIDATION');
  });

  it('AUM átváltás: a convertMoney a megadott AUM-mal és kijelzési pénznemmel hívódik', async () => {
    const convert = jest.fn<ReturnType<ConvertMoney>, Parameters<ConvertMoney>>(() =>
      Promise.resolve(err(AppErrors.missingData(['fx'], 'nincs ráta')) as Result<never, AppError>),
    );
    const result = await analyzer(eodhdGateway({ history: [] }), convert)('VWCE@XETR', {
      displayCurrency: 'EUR',
      metadata: {
        source: { kind: 'user_input', sourceId: 'user', sourceName: 'x', asOf: '2026-10-31' },
        aum: { amount: 30e9, currency: 'USD', asOf: '2026-10-31' as IsoDate },
      },
    });
    expect(convert).toHaveBeenCalledWith({
      money: { amount: 30e9, currency: 'USD' },
      target: 'EUR',
    });
    expect(result.ok && result.value.currency.aumInDisplayCurrency.status).toBe('MISSING');
  });

  it('nincs átváltás, ha nincs kijelzési pénznem vagy érvénytelen az AUM pénzneme', async () => {
    const convert = jest.fn<ReturnType<ConvertMoney>, Parameters<ConvertMoney>>();
    await analyzer(eodhdGateway({ history: [] }), convert)('VWCE@XETR', {
      metadata: {
        source: { kind: 'user_input', sourceId: 'user', sourceName: 'x', asOf: null },
        aum: { amount: 1, currency: 'USD' },
      },
    });
    const invalid = await analyzer(eodhdGateway({ history: [] }), convert)('VWCE@XETR', {
      displayCurrency: 'EUR',
      metadata: {
        source: { kind: 'user_input', sourceId: 'user', sourceName: 'x', asOf: null },
        aum: { amount: 1, currency: 'dollar' },
      },
    });
    expect(convert).not.toHaveBeenCalled();
    expect(!invalid.ok && invalid.error.kind).toBe('VALIDATION');
  });
});
