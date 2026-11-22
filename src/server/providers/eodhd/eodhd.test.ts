import { parseIsin, parseListingId, type IsoDate, type Isin, type ListingId } from '@/domain';

import { createEodhdProvider } from './eodhd-provider';
import { EODHD_PLANS, type PlanSpec } from '../../routing/plans';
import { createDailyQuota, unlimitedQuota, type QuotaGuard } from '../../routing/quota';
import { fakeFetch, fixedNow, jsonResponse, loadFixture } from '../../testing/test-helpers';

const KEY = 'eodhd-TITKOS-kulcs-456';
const FREE = EODHD_PLANS.free as PlanSpec;
const PAID = EODHD_PLANS['eod-all-world'] as PlanSpec;

const id = (raw: string): ListingId => {
  const parsed = parseListingId(raw);
  if (!parsed.ok) throw new Error(raw);
  return parsed.value;
};
const isin = (raw: string): Isin => {
  const parsed = parseIsin(raw);
  if (!parsed.ok) throw new Error(raw);
  return parsed.value;
};
const d = (raw: string) => raw as IsoDate;
const fx = (file: string) => jsonResponse(loadFixture('eodhd', file));

function setup(
  route: Parameters<typeof fakeFetch>[0],
  options: { plan?: PlanSpec; quota?: QuotaGuard; apiKey?: string | null } = {},
) {
  const fetchImpl = fakeFetch(route);
  const provider = createEodhdProvider({
    fetchImpl,
    now: fixedNow, // 2026-11-21T12:00:00Z
    apiKey: options.apiKey === undefined ? KEY : options.apiKey,
    plan: options.plan ?? FREE,
    quota: options.quota ?? unlimitedQuota,
    timeoutMs: 50,
  });
  return { provider, fetchImpl };
}

/** Útvonal-alapú hamis EODHD a valós fixture-ökkel. */
function eodhdRoute(url: string): Response {
  const path = new URL(url).pathname;
  const map: Record<string, string> = {
    '/api/real-time/VWCE.XETRA': 'real-time-VWCE.XETRA.json',
    '/api/real-time/ISF.LSE': 'real-time-ISF.LSE.json',
    '/api/real-time/AAPL.US': 'real-time-AAPL.US.json',
    '/api/real-time/ZZZZQX.XETRA': 'real-time-unknown.json',
    '/api/search/ISF': 'search-IE0005042456.json',
    '/api/search/NESN': 'search-NESN-SW.json',
    '/api/search/OTP': 'search-OTP-BUD.json',
    '/api/search/IWDA': 'search-IWDA-AS.json',
    '/api/search/ASML': 'search-ASML-AS.json',
    '/api/search/IE00BK5BQT80': 'search-IE00BK5BQT80.json',
    '/api/search/IE0005042456': 'search-IE0005042456.json',
    '/api/div/ISF.LSE': 'div-ISF.LSE.json',
    '/api/div/SAP.XETRA': 'div-SAP.XETRA.json',
  };
  const eod = path.match(/^\/api\/eod\/(.+)$/);
  if (eod !== null) return fx(`eod-${decodeURIComponent(eod[1] ?? '')}.json`);
  const file = map[path];
  return file === undefined ? new Response('Ticker Not Found.', { status: 404 }) : fx(file);
}

describe('eodhd quote és jegyzés-pénznem (D-052)', () => {
  it('VWCE@XETR: EUR helyszíni szabályból, 1 hívás; a kulcs nincs az adatban', async () => {
    const { provider, fetchImpl } = setup(eodhdRoute);
    const result = await provider.getQuote?.(id('VWCE@XETR'));
    expect(fetchImpl.calls.map((c) => new URL(c.url).pathname)).toEqual([
      '/api/real-time/VWCE.XETRA',
    ]);
    expect(result).toMatchObject({
      ok: true,
      value: {
        price: { amount: 159.34, currency: 'EUR' },
        asOf: new Date(1795192500 * 1000).toISOString(),
        delayMinutes: null,
        provenance: { sourceId: 'eodhd', kind: 'reported' },
      },
    });
    expect(JSON.stringify(result)).not.toContain(KEY);
  });

  it('ISF@XLON: a pénznem (GBX) az EODHD keresőből; a második hívás memóból (1 hívás)', async () => {
    const { provider, fetchImpl } = setup(eodhdRoute);
    const first = await provider.getQuote?.(id('ISF@XLON'));
    expect(first).toMatchObject({
      ok: true,
      value: { price: { amount: 1010.8, currency: 'GBX' } },
    });
    expect(fetchImpl.calls[0]?.url).toContain('/api/search/ISF?exchange=LSE');
    await provider.getQuote?.(id('ISF@XLON'));
    expect(fetchImpl.calls.map((c) => new URL(c.url).pathname)).toEqual([
      '/api/search/ISF',
      '/api/real-time/ISF.LSE',
      '/api/real-time/ISF.LSE',
    ]);
  });

  it('AAPL@XNAS → AAPL.US, USD', async () => {
    const { provider } = setup(eodhdRoute);
    expect(await provider.getQuote?.(id('AAPL@XNAS'))).toMatchObject({
      ok: true,
      value: { price: { amount: 342.56, currency: 'USD' } },
    });
  });

  it('ismeretlen ticker: HTTP 200 „NA” értékekkel → NOT_FOUND (nem 0-s ár)', async () => {
    const { provider } = setup(eodhdRoute);
    expect(await provider.getQuote?.(id('ZZZZQX@XETR'))).toMatchObject({
      ok: false,
      error: { kind: 'NOT_FOUND' },
    });
  });

  it('nem igazolt tőzsde (XPAR): covers → NOT_COVERED, hívás nincs', async () => {
    const { provider, fetchImpl } = setup(eodhdRoute);
    expect(provider.covers?.(id('MC@XPAR'))).toMatchObject({
      ok: false,
      error: { kind: 'UNAVAILABLE', reason: 'NOT_COVERED' },
    });
    expect(fetchImpl.calls).toHaveLength(0);
  });
});

describe('eodhd ártörténet: 3 UCITS ETF és 4 nem US részvény (valós fixture-ök)', () => {
  const history = (listing: string, adjustment: 'NONE' | 'SPLIT_DIVIDEND' = 'NONE') => ({
    listingId: id(listing),
    from: d('2026-10-20'),
    to: d('2026-11-20'),
    adjustment,
  });

  it.each([
    ['VWCE@XETR', 'EUR', 170.36],
    ['IWDA@XAMS', 'EUR', 130.48],
    ['ISF@XLON', 'GBX', 1045.2],
    ['SAP@XETR', 'EUR', 201.55],
    ['ASML@XAMS', 'EUR', 1455.4],
    ['NESN@XSWX', 'CHF', 83.11],
    ['OTP@XBUD', 'HUF', 41500],
  ])('%s: %s, első záróár %d, növekvő, provenance', async (listing, currency, firstClose) => {
    const { provider } = setup(eodhdRoute);
    const result = await provider.getPriceHistory?.(history(listing));
    expect(result?.ok).toBe(true);
    if (!result?.ok) return;
    expect(result.value.currency).toBe(currency);
    expect(result.value.points[0]).toEqual({ date: '2026-10-20', close: firstClose });
    expect(result.value.points.length).toBeGreaterThan(15);
    expect(result.value.provenance).toMatchObject({ sourceId: 'eodhd', currency });
    expect(result.value.notes).toEqual([]);
  });

  it('SPLIT_DIVIDEND → `adjusted_close` (ASML: osztalékkal korrigált, ≠ close)', async () => {
    const { provider } = setup(eodhdRoute);
    const result = await provider.getPriceHistory?.(history('ASML@XAMS', 'SPLIT_DIVIDEND'));
    expect(result?.ok && result.value.points[0]).toEqual({ date: '2026-10-20', close: 1453.4556 });
  });

  it('SPLIT: az EODHD nem adja → NOT_COVERED hívás nélkül (a router tovább léphet)', async () => {
    const { provider, fetchImpl } = setup(eodhdRoute);
    const result = await provider.getPriceHistory?.({
      ...history('SAP@XETR'),
      adjustment: 'SPLIT',
    });
    expect(result).toMatchObject({
      ok: false,
      error: { kind: 'UNAVAILABLE', reason: 'NOT_COVERED' },
    });
    expect(fetchImpl.calls).toHaveLength(0);
  });

  it('free csomag, 1 évnél régebbi kezdőnap: levágja, és a megjegyzés kimondja', async () => {
    const { provider, fetchImpl } = setup(eodhdRoute);
    const result = await provider.getPriceHistory?.({
      ...history('SAP@XETR'),
      from: d('2020-01-02'),
    });
    expect(fetchImpl.calls[0]?.url).toContain('from=2025-11-21');
    expect(result?.ok && result.value.notes[0]).toContain('(2020-01-02) helyett 2025-11-21');
  });

  it('free csomag, teljesen az ablak előtti időszak: PLAN_LIMIT hívás nélkül', async () => {
    const { provider, fetchImpl } = setup(eodhdRoute);
    const result = await provider.getPriceHistory?.({
      ...history('SAP@XETR'),
      from: d('2020-01-02'),
      to: d('2020-01-10'),
    });
    expect(result).toMatchObject({
      ok: false,
      error: { kind: 'UNAVAILABLE', reason: 'PLAN_LIMIT' },
    });
    expect(fetchImpl.calls).toHaveLength(0);
  });

  it('a „Data is limited by one year” figyelmeztető sort eldobja (valós válasz) – nincs kitalált árpont', async () => {
    const { provider } = setup(() => fx('eod-SAP.XETRA-free-window.json'), { plan: PAID });
    const result = await provider.getPriceHistory?.({
      ...history('SAP@XETR'),
      from: d('2020-01-02'),
      to: d('2020-01-10'),
    });
    expect(result?.ok).toBe(true);
    if (!result?.ok) return;
    expect(result.value.points).toEqual([]);
    expect(result.value.notes.join(' ')).toContain('figyelmeztető sort');
  });

  it('fizetős csomag (env-váltás): nincs ablak-levágás', async () => {
    const { provider, fetchImpl } = setup(eodhdRoute, { plan: PAID });
    await provider.getPriceHistory?.({ ...history('SAP@XETR'), from: d('2020-01-02') });
    expect(fetchImpl.calls[0]?.url).toContain('from=2020-01-02');
  });

  it('hiányzó záróár egy napon: kihagyja és jelzi (nem 0)', async () => {
    const { provider } = setup(() =>
      jsonResponse([
        { date: '2026-11-19', close: null, adjusted_close: null },
        { date: '2026-11-20', close: 10, adjusted_close: 10 },
      ]),
    );
    const result = await provider.getPriceHistory?.(history('SAP@XETR'));
    expect(result?.ok && result.value.points).toEqual([{ date: '2026-11-20', close: 10 }]);
    expect(result?.ok && result.value.notes[0]).toContain('hiányzó záróár');
  });
});

describe('eodhd osztalék, keresés, jegyzések', () => {
  it('ISF@XLON osztalék GBP-ben (az ár GBX!) – a pénznem soronként megmarad', async () => {
    const { provider } = setup(eodhdRoute);
    await provider.getQuote?.(id('ISF@XLON')); // a memó megtanulja a GBX-et
    const result = await provider.getDividends?.({
      listingId: id('ISF@XLON'),
      from: d('2025-01-01'),
      to: d('2026-11-21'),
    });
    expect(result?.ok).toBe(true);
    if (!result?.ok) return;
    expect(result.value.events[0]).toMatchObject({
      exDate: '2025-03-13',
      amount: { amount: 0.0475, currency: 'GBP' },
      recordDate: null,
      frequency: 'Quarterly',
    });
    expect(result.value.notes.join(' ')).toContain('(GBP) eltér a jegyzésétől (GBX)');
  });

  it('SAP@XETR osztalék EUR-ban, nincs pénznem-eltérés megjegyzés', async () => {
    const { provider } = setup(eodhdRoute);
    const result = await provider.getDividends?.({
      listingId: id('SAP@XETR'),
      from: d('2023-01-01'),
      to: d('2026-11-21'),
    });
    expect(result?.ok && result.value.events.map((e) => e.amount)).toEqual(
      expect.arrayContaining([{ amount: 2.05, currency: 'EUR' }]),
    );
    expect(result?.ok && result.value.notes).toEqual([]);
  });

  it('ISIN-keresés (ISF): 6 jegyzés pénznemmel (GBX, USD, EUR, CHF)', async () => {
    const { provider, fetchImpl } = setup(eodhdRoute);
    const result = await provider.searchInstruments?.('IE0005042456');
    expect(fetchImpl.calls[0]?.url).toContain('/api/search/IE0005042456');
    expect(result?.ok && result.value.hits.map((h) => [h.listingId, h.tradingCurrency])).toEqual([
      ['ISF@XLON', 'GBX'],
      ['ISFU@XLON', 'USD'],
      ['IUSZ@XETR', 'EUR'],
      ['ISF@XSWX', 'CHF'],
      ['ISFA@XAMS', 'EUR'],
      ['IUSZ@XFRA', 'EUR'],
    ]);
    expect(result?.ok && result.value.hits[0]).toMatchObject({
      kindHint: 'etf',
      isin: 'IE0005042456',
    });
  });

  it('ISIN → jegyzések (KI-22): a VWCE jegyzései pénznemmel', async () => {
    const { provider } = setup(eodhdRoute);
    const result = await provider.getSecurityListings?.(isin('IE00BK5BQT80'));
    expect(
      result?.ok && result.value.listings.map((l) => [l.listingId, l.tradingCurrency]),
    ).toEqual([
      ['VWRP@XLON', 'GBP'],
      ['VWCE@XETR', 'EUR'],
      ['VWRA@XLON', 'USD'],
      ['VWCE@XFRA', 'EUR'],
    ]);
  });

  it('kvóta: a keresés csak a keret 75%-áig fogyaszthat (prioritás)', async () => {
    const quota = createDailyQuota({ providerId: 'eodhd', dailyLimit: 4, now: fixedNow });
    const { provider, fetchImpl } = setup(eodhdRoute, { quota });
    for (let i = 0; i < 3; i += 1) await provider.searchInstruments?.('IE0005042456');
    expect(await provider.searchInstruments?.('IE0005042456')).toMatchObject({
      ok: false,
      error: { kind: 'UNAVAILABLE', reason: 'QUOTA_EXHAUSTED' },
    });
    // A maradék 1 hívás az árfolyamé.
    expect((await provider.getQuote?.(id('VWCE@XETR')))?.ok).toBe(true);
    expect(fetchImpl.calls).toHaveLength(4);
  });
});

describe('eodhd hibák', () => {
  it.each([
    [
      '404 (text/html) → NOT_FOUND',
      () => new Response('Ticker Not Found.', { status: 404 }),
      'NOT_FOUND',
      undefined,
    ],
    [
      '402 → QUOTA_EXHAUSTED',
      () => new Response('API Rate Limit Exceeded.', { status: 402 }),
      'UNAVAILABLE',
      'QUOTA_EXHAUSTED',
    ],
    [
      '403 → PLAN_LIMIT',
      () => new Response('Only EOD data allowed for free users.', { status: 403 }),
      'UNAVAILABLE',
      'PLAN_LIMIT',
    ],
    ['429 → RATE_LIMITED', () => jsonResponse({}, 429), 'RATE_LIMITED', undefined],
    ['offline → NETWORK', () => 'NETWORK_ERROR' as const, 'NETWORK', undefined],
    ['timeout → TIMEOUT', () => 'HANG' as const, 'TIMEOUT', undefined],
    ['hibás JSON → UPSTREAM', () => new Response('{', { status: 200 }), 'UPSTREAM', undefined],
    [
      'séma-eltérés → UPSTREAM',
      () => jsonResponse({ code: 'X', timestamp: 'tegnap', close: 1 }),
      'UPSTREAM',
      undefined,
    ],
  ])('%s', async (_name, route, kind, reason) => {
    const { provider } = setup(route);
    const result = await provider.getQuote?.(id('VWCE@XETR'));
    expect(result).toMatchObject({
      ok: false,
      error: reason === undefined ? { kind } : { kind, reason },
    });
    expect(JSON.stringify(result)).not.toContain(KEY);
  });

  it('kulcs nélkül: nem konfigurált, hívás nincs', async () => {
    const { provider, fetchImpl } = setup(eodhdRoute, { apiKey: null });
    expect(provider.info.configured).toBe(false);
    expect((await provider.getQuote?.(id('VWCE@XETR')))?.ok).toBe(false);
    expect(fetchImpl.calls).toHaveLength(0);
  });
});
