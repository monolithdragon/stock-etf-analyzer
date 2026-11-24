import {
  AppErrors,
  err,
  ok,
  type AppError,
  type CurrencyCode,
  type FxConversion,
  type InstrumentProfile,
  type IsoDate,
  type ListingId,
  type PriceSeries,
  type Result,
  type Transaction,
} from '@/domain';

import { createAnalyzePortfolio } from './analyze-portfolio';
import type { ConvertMoneyRequest } from './convert-money';
import {
  AAPL,
  EUR,
  GBX,
  ISF,
  NOW,
  PORTFOLIO,
  prov,
  priceSeries,
  quote,
  tx,
  USD,
  VWCE,
  weekdays,
} from '../portfolio/testing';
import type { PortfolioRepository } from '../ports';

function setup(transactions: readonly Transaction[], opts: { seriesNotCovered?: boolean } = {}) {
  // Egyszerű hamis tároló (az application-teszt nem importálhat infrastruktúra-adaptert).
  const stored: Transaction[] = [...transactions];
  const repo: PortfolioRepository = {
    getPortfolio: async (id) => ok(id === PORTFOLIO.id ? PORTFOLIO : null),
    savePortfolio: async () => ok(undefined),
    listTransactions: async () => ok([...stored]),
    addTransaction: async (t) => {
      stored.push(t);
      return ok(undefined);
    },
    listPortfolios: async () => ok([]),
    deleteAll: async () => ok(undefined),
  };
  const calls = {
    quotes: [] as ListingId[],
    profiles: [] as ListingId[],
    series: [] as string[],
    fx: [] as string[],
  };
  const profile = (listingId: ListingId): InstrumentProfile => ({
    listingId,
    name: `${listingId} profil`,
    kindHint: listingId === AAPL ? 'stock' : 'etf',
    isin: null,
    cik: null,
    country: 'US',
    sector: listingId === AAPL ? 'Information Technology' : null,
    industry: null,
    exchangeName: null,
    tradingCurrency: null,
    website: null,
    description: null,
    beta: null,
    provenance: prov({ sourceName: 'FMP' }),
  });
  const dates = weekdays('2026-01-05', 150);
  const analyze = createAnalyzePortfolio({
    portfolioRepository: repo,
    clock: { now: () => NOW },
    getListingQuote: async (rawId) => {
      const id = rawId as ListingId;
      calls.quotes.push(id);
      return id === AAPL
        ? quote(AAPL, 150, USD)
        : id === ISF
          ? quote(ISF, 850, GBX)
          : quote(id, 110, EUR);
    },
    getInstrumentProfile: async (rawId) => {
      const id = rawId as ListingId;
      calls.profiles.push(id);
      return id === ISF ? err(AppErrors.unavailable('PLAN_LIMIT', 'free')) : ok(profile(id));
    },
    getPriceHistory: async (rawId, request) => {
      const id = rawId as ListingId;
      const adjustment = request?.adjustment ?? 'SPLIT';
      calls.series.push(`${id}:${adjustment}:${request?.from}`);
      if (opts.seriesNotCovered && adjustment === 'SPLIT') {
        return err(AppErrors.unavailable('NOT_COVERED', 'nincs split-sor')) as Result<
          PriceSeries,
          AppError
        >;
      }
      return priceSeries(
        id,
        id === AAPL ? USD : id === ISF ? GBX : EUR,
        dates.map((date, i) => ({ date, close: 100 + i })),
        adjustment,
      );
    },
    convertMoney: async (request: ConvertMoneyRequest): Promise<Result<FxConversion, AppError>> => {
      calls.fx.push(`${request.money.currency}@${request.date ?? 'latest'}`);
      if (request.money.currency === ('CHF' as CurrencyCode)) {
        return err(AppErrors.missingData(['fx:CHF/EUR']));
      }
      const rate = request.money.currency === USD ? 0.9 : 1.15;
      return ok({
        original: request.money,
        converted: { amount: rate, currency: EUR },
        rate: {
          base: request.money.currency,
          quote: EUR,
          rate,
          asOf: (request.date ?? '2026-11-20') as IsoDate,
          provenance: prov({ sourceId: 'ecb-fx' }),
        },
        minorUnitDivisor: null,
      });
    },
  });
  return { analyze, calls, repo };
}

describe('analyzePortfolio use case', () => {
  const transactions = [
    tx.buy(AAPL, '2026-01-05', 10, 100, USD),
    tx.buy(VWCE, '2026-01-05', 10, 100, EUR),
    tx.sell(VWCE, '2026-02-02', 10, 105, EUR),
    tx.buy(ISF, '2026-01-06', 100, 800, GBX),
  ];

  it('csak a nyitott pozíciókra kér árat; FX az ügyleti napokra és mára, duplikátum nélkül', async () => {
    const { analyze, calls } = setup(transactions);
    const result = await analyze('p1');
    expect(result.ok).toBe(true);
    expect(calls.quotes.sort()).toEqual([AAPL, ISF].sort()); // a zárt VWCE-re nem
    expect(calls.fx.sort()).toEqual(
      ['GBP@2026-01-06', 'GBP@latest', 'USD@2026-01-05', 'USD@latest'].sort(),
    );
    expect(calls.series).toEqual([]); // historikus csak kérésre
    if (!result.ok) return;
    expect(result.value.positions.map((p) => [p.listingId, p.status])).toEqual([
      [AAPL, 'open'],
      [VWCE, 'closed'],
      [ISF, 'open'],
    ]);
    expect(result.value.totals.marketValue.value.status).toBe('OK');
  });

  it('profil → metaadat; a kézi bevitel elsőbbséget élvez és kiegészít; a profilhiba nem állítja meg', async () => {
    const { analyze } = setup(transactions);
    const result = await analyze('p1', {
      assets: [
        {
          listingId: 'ISF@XLON',
          kind: 'etf',
          assetClass: 'equity',
          source: { kind: 'user_input', sourceName: 'KID' },
        },
        {
          listingId: 'AAPL@XNAS',
          isin: 'US0378331005',
          source: { kind: 'user_input', sourceName: 'Kézi' },
        },
      ],
    });
    if (!result.ok) throw new Error(result.error.message);
    const byId = new Map(result.value.positions.map((p) => [p.listingId, p.metadata]));
    expect(byId.get(AAPL)).toMatchObject({
      kind: 'stock',
      isin: 'US0378331005',
      sector: 'Information Technology',
      assetClass: 'equity',
      source: { kind: 'user_input', sourceName: 'Kézi + FMP' },
    });
    expect(byId.get(ISF)).toMatchObject({
      kind: 'etf',
      assetClass: 'equity',
      source: { sourceName: 'KID' },
    });
  });

  it('fetchProfiles: false → nincs profilhívás', async () => {
    const { analyze, calls } = setup(transactions);
    await analyze('p1', { fetchProfiles: false });
    expect(calls.profiles).toEqual([]);
  });

  it('historikus kérésre: SPLIT ársor az első tranzakciótól; NOT_COVERED esetén nyers sor', async () => {
    const first = setup(transactions);
    await first.analyze('p1', { history: { enabled: true } });
    expect(first.calls.series).toContain(`${AAPL}:SPLIT:2026-01-05`);
    const fallback = setup(transactions, { seriesNotCovered: true });
    const result = await fallback.analyze('p1', { history: { enabled: true, from: '2026-01-05' } });
    expect(fallback.calls.series).toContain(`${AAPL}:NONE:2026-01-05`);
    if (!result.ok) throw new Error(result.error.message);
    // többdevizás, FX-idősor nélkül → MISSING (KI-77)
    expect(result.value.history.status.status).toBe('MISSING');
  });

  it('ETF holdings és FX-idősor opcióból, validálva; hibás opció → VALIDATION mezőútvonallal', async () => {
    const { analyze } = setup(transactions);
    const okResult = await analyze('p1', {
      etfHoldings: [
        {
          listingId: 'ISF@XLON',
          sourceName: 'iShares holdings CSV',
          snapshot: {
            asOf: '2026-10-31',
            declaredComplete: false,
            holdings: [{ name: 'HSBC', isin: 'GB0005405286', weight: 0.08, country: 'GB' }],
          },
        },
      ],
    });
    if (!okResult.ok) throw new Error(okResult.error.message);
    const lt = okResult.value.exposures.find(
      (e) => e.dimension === 'country' && e.method === 'look_through',
    );
    expect(lt?.groups.status).toBe('OK');

    const bad = await analyze('p1', {
      assets: [
        { listingId: 'AAPL@XNAS', isin: 'XX123', source: { kind: 'user_input', sourceName: 'K' } },
      ],
      etfHoldings: [
        {
          listingId: 'ISF@XLON',
          sourceName: 'x',
          snapshot: {
            asOf: '2026-10-31',
            declaredComplete: false,
            holdings: [{ name: 'A', weight: 8 }],
          },
        },
      ],
      history: { enabled: true, fxSeries: { USD: [{ date: '2026-01-02', rate: 0 }], GBX: [] } },
      riskFreeRate: 3,
    });
    expect(bad.ok).toBe(false);
    if (bad.ok || bad.error.kind !== 'VALIDATION') return;
    const paths = bad.error.issues.map((i) => i.path);
    expect(paths).toEqual(
      expect.arrayContaining([
        'assets.0.isin',
        'etfHoldings.0',
        'history.fxSeries.USD.0.rate',
        'history.fxSeries.GBX',
        'riskFreeRate',
      ]),
    );
  });

  it('nem létező portfólió → NOT_FOUND; azonosító-ütközés → VALIDATION (sérült napló)', async () => {
    const { analyze, repo } = setup([
      tx.buy(AAPL, '2026-01-05', 1, 100, USD, 0, USD, { id: 'dup' }),
    ]);
    expect(await analyze('nincs')).toMatchObject({ ok: false, error: { kind: 'NOT_FOUND' } });
    await repo.addTransaction(tx.buy(AAPL, '2026-01-06', 1, 100, USD, 0, USD, { id: 'dup' }));
    expect(await analyze('p1')).toMatchObject({
      ok: false,
      error: { kind: 'VALIDATION', issues: [{ path: 'transactions.dup' }] },
    });
    expect(await analyze('rossz id!')).toMatchObject({ ok: false, error: { kind: 'VALIDATION' } });
  });
});
