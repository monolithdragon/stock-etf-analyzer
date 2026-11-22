import { parseListingId, type IsoDate, type ListingId } from '@/domain';

import { createFmpProvider } from './fmp-provider';
import { FMP_PLANS, type PlanSpec } from '../../routing/plans';
import { createDailyQuota, unlimitedQuota, type QuotaGuard } from '../../routing/quota';
import { fakeFetch, fixedNow, jsonResponse, loadFixture } from '../../testing/test-helpers';

const KEY = 'fmp-TITKOS-kulcs-123';
const FREE = FMP_PLANS.free as PlanSpec;

const id = (raw: string): ListingId => {
  const parsed = parseListingId(raw);
  if (!parsed.ok) throw new Error(raw);
  return parsed.value;
};
const d = (raw: string) => raw as IsoDate;

function setup(
  route: Parameters<typeof fakeFetch>[0],
  options: { apiKey?: string | null; plan?: PlanSpec; quota?: QuotaGuard } = {},
) {
  const fetchImpl = fakeFetch(route);
  const provider = createFmpProvider({
    fetchImpl,
    now: fixedNow,
    apiKey: options.apiKey === undefined ? KEY : options.apiKey,
    plan: options.plan ?? FREE,
    quota: options.quota ?? unlimitedQuota,
    timeoutMs: 50,
  });
  return { provider, fetchImpl };
}

const fixture = (file: string) => () => jsonResponse(loadFixture('fmp', file));
const textResponse = (status: number, text: string) => new Response(text, { status });

/** Élő próbával rögzített 402-es törzsek (szó szerint). */
const PREMIUM_SYMBOL_402 =
  "Premium Query Parameter: 'Special Endpoint : This value set for 'symbol' is not available under your current subscription please visit our subscription page to upgrade your plan at https://financialmodelingprep.com/";

describe('fmp quote (valós fixture, 2026-11-21)', () => {
  it('AAPL@XNAS: ár, USD (helyszíni szabály), asOf a Unix-időbélyegből, provenance', async () => {
    const { provider, fetchImpl } = setup(fixture('quote-AAPL.json'));
    const result = await provider.getQuote?.(id('AAPL@XNAS'));

    expect(fetchImpl.calls[0]?.url).toBe(
      `https://financialmodelingprep.com/stable/quote?symbol=AAPL&apikey=${KEY}`,
    );
    expect(result).toMatchObject({
      ok: true,
      value: {
        listingId: 'AAPL@XNAS',
        price: { amount: 342.56, currency: 'USD' },
        asOf: new Date(1795208402 * 1000).toISOString(),
        delayMinutes: null,
        provenance: { sourceId: 'fmp', kind: 'reported', fetchedAt: '2026-11-21T12:00:00.000Z' },
      },
    });
    // A kulcs csak az URL-ben van, a normalizált adatban soha.
    expect(JSON.stringify(result)).not.toContain(KEY);
  });

  it('SPY@ARCX: az FMP „AMEX” kódja NYSE Arcát is jelent → elfogadva', async () => {
    const { provider } = setup(fixture('quote-SPY.json'));
    expect(await provider.getQuote?.(id('SPY@ARCX'))).toMatchObject({
      ok: true,
      value: { price: { amount: 689.81, currency: 'USD' } },
    });
  });

  it('rossz tőzsde (AAPL@XNYS): NOT_FOUND – nem adunk másik jegyzés árát', async () => {
    const { provider } = setup(fixture('quote-AAPL.json'));
    expect(await provider.getQuote?.(id('AAPL@XNYS'))).toMatchObject({
      ok: false,
      error: { kind: 'NOT_FOUND' },
    });
  });

  it('share class: BRK.B → BRK-B az FMP felé', async () => {
    const { provider, fetchImpl } = setup(() => textResponse(402, PREMIUM_SYMBOL_402));
    await provider.getQuote?.(id('BRK.B@XNYS'));
    expect(fetchImpl.calls[0]?.url).toContain('symbol=BRK-B');
  });

  it('üres tömb → NOT_FOUND (nem 0-s ár)', async () => {
    const { provider } = setup(() => jsonResponse([]));
    expect(await provider.getQuote?.(id('AAPL@XNAS'))).toMatchObject({
      ok: false,
      error: { kind: 'NOT_FOUND' },
    });
  });
});

describe('fmp ártörténet: a három korrekció külön végpont (NVDA 10:1 split, 2024-06-10)', () => {
  const request = (adjustment: 'NONE' | 'SPLIT' | 'SPLIT_DIVIDEND') => ({
    listingId: id('NVDA@XNAS'),
    from: d('2024-06-06'),
    to: d('2024-06-11'),
    adjustment,
  });

  it('SPLIT → /full `close`: split-korrigált; növekvő sorrend', async () => {
    const { provider, fetchImpl } = setup(fixture('historical-full-NVDA-2024-06.json'));
    const result = await provider.getPriceHistory?.(request('SPLIT'));
    expect(fetchImpl.calls[0]?.url).toContain('/historical-price-eod/full?symbol=NVDA');
    expect(result?.ok && result.value.points.map((p) => [p.date, p.close])).toEqual([
      ['2024-06-06', 121],
      ['2024-06-07', 120.89],
      ['2024-06-10', 121.79],
      ['2024-06-11', 120.91],
    ]);
    expect(result).toMatchObject({
      ok: true,
      value: { adjustment: 'SPLIT', currency: 'USD', provenance: { asOf: '2024-06-11' } },
    });
  });

  it('NONE → /non-split-adjusted: az `adjClose` itt NYERS ár (split előtt 1208.9)', async () => {
    const { provider } = setup(fixture('historical-nonsplit-NVDA-2024-06.json'));
    const result = await provider.getPriceHistory?.(request('NONE'));
    expect(result?.ok && result.value.points[1]).toEqual({ date: '2024-06-07', close: 1208.9 });
  });

  it('SPLIT_DIVIDEND → /dividend-adjusted (osztalékkal is korrigált, ≠ SPLIT)', async () => {
    const { provider } = setup(fixture('historical-divadj-NVDA-2024-06.json'));
    const result = await provider.getPriceHistory?.(request('SPLIT_DIVIDEND'));
    expect(result?.ok && result.value.points[1]).toEqual({ date: '2024-06-07', close: 120.55 });
  });

  it('hiányzó `close` mező → UPSTREAM / INVALID_RESPONSE (nem 0)', async () => {
    const { provider } = setup(() => jsonResponse([{ symbol: 'NVDA', date: '2024-06-07' }]));
    expect(await provider.getPriceHistory?.(request('SPLIT'))).toMatchObject({
      ok: false,
      error: { kind: 'UPSTREAM', failure: 'INVALID_RESPONSE' },
    });
  });
});

describe('fmp osztalék, profil, keresés', () => {
  it('osztalék: tényleges + split-korrigált összeg, USD, időszakra szűrve, növekvő', async () => {
    const { provider } = setup(fixture('dividends-AAPL.json'));
    const result = await provider.getDividends?.({
      listingId: id('AAPL@XNAS'),
      from: d('2026-01-01'),
      to: d('2026-11-21'),
    });
    expect(result?.ok).toBe(true);
    if (!result?.ok) return;
    const exDates = result.value.events.map((e) => e.exDate);
    expect(exDates).toEqual([...exDates].sort());
    expect(result.value.events.at(-1)).toMatchObject({
      exDate: '2026-11-12',
      paymentDate: '2026-11-16',
      amount: { amount: 0.27, currency: 'USD' },
      splitAdjustedAmount: 0.27,
      frequency: 'Quarterly',
    });
    expect(result.value.events.every((e) => e.exDate >= '2026-01-01')).toBe(true);
  });

  it('profil: AAPL részvény (ISIN, CIK, ország); SPY ETF', async () => {
    const aapl = await setup(fixture('profile-AAPL.json')).provider.getProfile?.(id('AAPL@XNAS'));
    expect(aapl).toMatchObject({
      ok: true,
      value: {
        name: 'Apple Inc.',
        kindHint: 'stock',
        isin: 'US0378331005',
        cik: '0000320193',
        country: 'US',
        tradingCurrency: 'USD',
        exchangeName: 'NASDAQ Global Select',
        // PHASE 06: a szolgáltatói béta átjön (jelentett, tájékoztató).
        beta: 1.089,
      },
    });
    const spy = await setup(fixture('profile-SPY.json')).provider.getProfile?.(id('SPY@ARCX'));
    expect(spy).toMatchObject({ ok: true, value: { kindHint: 'etf', isin: 'US78462F1030' } });
  });

  it('keresés (ISF): csak igazolt tőzsdék, GBp → GBX, a többi megszámolva', async () => {
    const { provider } = setup(fixture('search-symbol-ISF.json'));
    const result = await provider.searchInstruments?.('ISF');
    expect(result?.ok).toBe(true);
    if (!result?.ok) return;
    expect(result.value.hits.map((h) => [h.listingId, h.tradingCurrency])).toEqual([
      ['ISF@XLON', 'GBX'],
      ['ISFD@XLON', 'USD'],
      ['ISFR@XLON', 'GBX'],
      ['ISFE@XLON', 'GBX'],
      ['ISFU@XLON', 'USD'],
      ['ISFA@XAMS', 'EUR'],
    ]);
    // OTC, CNQ (Kanada), BSE/NSE (India): nincs igazolt MIC-leképezés.
    expect(result.value.omitted).toEqual({
      unmappedVenue: 4,
      invalidSymbol: 0,
      unsupportedType: 0,
      truncated: 0,
    });
  });

  it('keresés (SAP): CRYPTO nem támogatott, AMEX kétértelmű → kihagyva', async () => {
    const { provider } = setup(fixture('search-symbol-SAP.json'));
    const result = await provider.searchInstruments?.('SAP');
    if (!result?.ok) throw new Error('setup');
    const ids = result.value.hits.map((h) => h.listingId);
    expect(ids).toEqual(expect.arrayContaining(['SAP@XNYS', 'SAP@XETR', 'SAPE@XLON']));
    expect(ids).not.toContain('SAPH@ARCX');
    expect(result.value.omitted.unsupportedType).toBe(1);
  });

  it('ISIN-keresés: PLAN_LIMIT hívás nélkül (élő próba: search-isin → 402)', async () => {
    const { provider, fetchImpl } = setup(() => 'NETWORK_ERROR');
    expect(await provider.searchInstruments?.('US0378331005')).toMatchObject({
      ok: false,
      error: { kind: 'UNAVAILABLE', reason: 'PLAN_LIMIT' },
    });
    expect(fetchImpl.calls).toHaveLength(0);
  });
});

describe('fmp hibák, lefedettség, kvóta, csomag', () => {
  it('nem US jegyzés: covers → PLAN_LIMIT (free csak US)', () => {
    const { provider } = setup(() => 'NETWORK_ERROR');
    expect(provider.covers?.(id('SAP@XETR'))).toMatchObject({
      ok: false,
      error: { kind: 'UNAVAILABLE', reason: 'PLAN_LIMIT' },
    });
    expect(provider.covers?.(id('AAPL@XNAS'))).toEqual({ ok: true, value: true });
  });

  it('402 → PLAN_LIMIT (ismeretlen tickerre is ezt adja – az üzenet kimondja)', async () => {
    const { provider } = setup(() => textResponse(402, PREMIUM_SYMBOL_402));
    const result = await provider.getQuote?.(id('ZZZZ@XNAS'));
    expect(result).toMatchObject({
      ok: false,
      error: { kind: 'UNAVAILABLE', reason: 'PLAN_LIMIT' },
    });
    expect(JSON.stringify(result)).toContain('ismeretlen tickerre');
  });

  it('401 → kulcshiba, a kulcs értéke NEM kerül az üzenetbe', async () => {
    const { provider } = setup(() =>
      jsonResponse({ 'Error Message': `Invalid API KEY ${KEY}` }, 401),
    );
    const result = await provider.getQuote?.(id('AAPL@XNAS'));
    expect(result).toMatchObject({ ok: false, error: { kind: 'UPSTREAM', failure: 'HTTP_ERROR' } });
    expect(JSON.stringify(result)).not.toContain(KEY);
  });

  it.each([
    ['429 → RATE_LIMITED', () => jsonResponse({}, 429, { 'Retry-After': '30' }), 'RATE_LIMITED'],
    ['offline → NETWORK', () => 'NETWORK_ERROR' as const, 'NETWORK'],
    ['timeout → TIMEOUT', () => 'HANG' as const, 'TIMEOUT'],
    ['hibás JSON → UPSTREAM', () => new Response('<html>', { status: 200 }), 'UPSTREAM'],
  ])('%s', async (_name, route, kind) => {
    const { provider } = setup(route);
    expect(await provider.getQuote?.(id('AAPL@XNAS'))).toMatchObject({
      ok: false,
      error: { kind },
    });
  });

  it('kulcs nélkül: nem konfigurált, hívás nincs', async () => {
    const { provider, fetchImpl } = setup(() => 'NETWORK_ERROR', { apiKey: null });
    expect(provider.info.configured).toBe(false);
    expect(await provider.getQuote?.(id('AAPL@XNAS'))).toMatchObject({
      ok: false,
      error: { kind: 'UNAVAILABLE', reason: 'NOT_COVERED' },
    });
    expect(fetchImpl.calls).toHaveLength(0);
  });

  it('kvóta: a keret elfogyása után NEM indít hívást (QUOTA_EXHAUSTED)', async () => {
    const quota = createDailyQuota({ providerId: 'fmp', dailyLimit: 1, now: fixedNow });
    const { provider, fetchImpl } = setup(fixture('quote-AAPL.json'), { quota });
    expect((await provider.getQuote?.(id('AAPL@XNAS')))?.ok).toBe(true);
    expect(await provider.getQuote?.(id('AAPL@XNAS'))).toMatchObject({
      ok: false,
      error: { kind: 'UNAVAILABLE', reason: 'QUOTA_EXHAUSTED' },
    });
    expect(fetchImpl.calls).toHaveLength(1);
  });

  it('csomag-kapuzás: amit a csomag nem tartalmaz, az a metódus sem létezik', () => {
    const plan: PlanSpec = { ...FREE, capabilities: ['quote'] };
    const { provider } = setup(() => 'NETWORK_ERROR', { plan });
    expect(provider.getQuote).toBeDefined();
    expect(provider.getProfile).toBeUndefined();
    expect(provider.searchInstruments).toBeUndefined();
  });
});
