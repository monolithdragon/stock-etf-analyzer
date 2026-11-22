/**
 * PHASE 04B végpontok a VALÓDI adapterekkel és valós fixture-ökkel (hálózat nélkül):
 * routing + fallback, csomagváltás env-ből, kvóta, providers/status, titokmentesség.
 */
import { parseApiResponse, providerStatusDtoSchema } from '@/contracts';

import type { ServerLogEntry } from '../logging';
import { createServerContext, getServerContext } from '../server-context';
import { fakeFetch, fixedNow, jsonResponse, loadFixture } from '../testing/test-helpers';

const FMP_KEY = 'fmp-NAGYON-titkos-111';
const EODHD_KEY = 'eodhd-NAGYON-titkos-222';
const UA = 'StockEtfAnalyzer titkos-kapcsolat@example.com';

const PREMIUM_402 =
  "Premium Query Parameter: 'Special Endpoint : This value set for 'symbol' is not available under your current subscription please visit our subscription page to upgrade your plan at https://financialmodelingprep.com/";

/** A felfelé menő hívások útvonal-alapú hamis válaszai (valós fixture-ök). */
function upstreamRoute(url: string): Response {
  const u = new URL(url);
  const fmp = u.hostname === 'financialmodelingprep.com';
  const path = u.pathname;
  if (fmp) {
    const symbol = u.searchParams.get('symbol');
    if (path === '/stable/quote' && symbol === 'AAPL')
      return jsonResponse(loadFixture('fmp', 'quote-AAPL.json'));
    if (path === '/stable/profile' && symbol === 'AAPL')
      return jsonResponse(loadFixture('fmp', 'profile-AAPL.json'));
    if (path === '/stable/search-symbol')
      return jsonResponse(loadFixture('fmp', 'search-symbol-ISF.json'));
    return new Response(PREMIUM_402, { status: 402 });
  }
  const map: Record<string, string> = {
    '/api/real-time/BRK-B.US': 'real-time-AAPL.US.json', // a fallback-tesztben csak az alak számít
    '/api/real-time/VWCE.XETRA': 'real-time-VWCE.XETRA.json',
    '/api/search/ISF': 'search-IE0005042456.json',
    '/api/search/IE0005042456': 'search-IE0005042456.json',
    '/api/div/ISF.LSE': 'div-ISF.LSE.json',
  };
  const eod = path.match(/^\/api\/eod\/(.+)$/);
  if (eod !== null) return jsonResponse(loadFixture('eodhd', `eod-${eod[1] ?? ''}.json`));
  const file = map[path];
  return file === undefined
    ? new Response('Ticker Not Found.', { status: 404 })
    : jsonResponse(loadFixture('eodhd', file));
}

function liveContext(env: Record<string, string> = {}) {
  const fetchImpl = fakeFetch(upstreamRoute);
  const logs: ServerLogEntry[] = [];
  const ctx = createServerContext({
    rawEnv: {
      PROXY_DATA_MODE: 'live',
      SEC_USER_AGENT: UA,
      FMP_API_KEY: FMP_KEY,
      EODHD_API_KEY: EODHD_KEY,
      FMP_PLAN: 'free',
      EODHD_PLAN: 'free',
      ...env,
    },
    fetchImpl,
    now: fixedNow, // 2026-11-21T12:00:00Z
    logger: { info: (e) => logs.push(e) },
  });
  return { ...ctx, fetchImpl, logs };
}

const get = (path: string) => new Request(`http://localhost:8081${path}`);
const json = async (response: Response) =>
  JSON.parse(await response.text()) as {
    data?: Record<string, unknown> & { provenance?: { sourceId: string } };
    warnings?: string[];
    error?: { code: string; unavailableReason?: string };
  };

describe('quote: routing és fallback a valódi adapterekkel', () => {
  it('US (AAPL@XNAS): FMP adja, nincs figyelmeztetés', async () => {
    const { handlers, fetchImpl } = liveContext();
    const body = await json(await handlers.quote(get('/x'), { id: 'AAPL@XNAS' }));
    expect(body.data?.provenance?.sourceId).toBe('fmp');
    expect(body.warnings).toEqual([]);
    expect(fetchImpl.calls).toHaveLength(1);
  });

  it('US, de az FMP 402-t ad (BRK.B) → EODHD tartalék; warning + napló `fallbackFrom`', async () => {
    const { handlers, logs } = liveContext();
    const response = await handlers.quote(get('/x'), { id: 'BRK.B@XNYS' });
    const body = await json(response);
    expect(response.status).toBe(200);
    expect(body.data?.provenance?.sourceId).toBe('eodhd');
    expect(body.warnings?.[0]).toContain('fmp: Az FMP jelenlegi csomagja');
    expect(body.warnings?.at(-1)).toBe('Az adat forrása: eodhd (tartalék forrás).');
    expect(logs.at(-1)).toMatchObject({
      route: 'instruments/quote',
      provider: 'eodhd',
      fallbackFrom: 'fmp:UNAVAILABLE',
    });
  });

  it('EU (VWCE@XETR): közvetlenül EODHD, az FMP-t meg sem hívja', async () => {
    const { handlers, fetchImpl } = liveContext();
    const body = await json(await handlers.quote(get('/x'), { id: 'VWCE@XETR' }));
    expect(body.data).toMatchObject({ price: 159.34, currency: 'EUR' });
    expect(fetchImpl.calls.every((c) => !c.url.includes('financialmodelingprep'))).toBe(true);
  });
});

describe('prices / profile / dividends / search', () => {
  it('prices EU: alapértelmezett korrekció SPLIT_DIVIDEND (adjusted_close)', async () => {
    const { handlers } = liveContext();
    const response = await handlers.prices(get('/x?from=2026-10-20&to=2026-11-20'), {
      id: 'ASML@XAMS',
    });
    // A pénznemhez kereső kell → a fixture-ben nincs ASML-kereső → őszinte 404, nem kitalált EUR.
    expect(response.status).toBe(404);
    const vwce = await json(
      await handlers.prices(get('/x?from=2026-10-20&to=2026-11-20'), { id: 'VWCE@XETR' }),
    );
    expect(vwce.data).toMatchObject({ adjustment: 'SPLIT_DIVIDEND', currency: 'EUR' });
  });

  it.each([
    ['?adjustment=monthly', 'adjustment'],
    ['?from=2026-11-20&to=2026-11-01', 'kezdőnap'],
    ['?to=2027-01-01', 'Jövőbeli'],
    ['?from=1900-01-01&to=2026-11-20', '40 éves'],
  ])('prices hibás paraméter %s → 400', async (query, fragment) => {
    const { handlers, fetchImpl } = liveContext();
    const response = await handlers.prices(get(`/x${query}`), { id: 'VWCE@XETR' });
    expect(response.status).toBe(400);
    expect(JSON.stringify(await json(response))).toContain(fragment);
    expect(fetchImpl.calls).toHaveLength(0);
  });

  it('profile: US → FMP; EU → 501 PLAN_LIMIT hívás nélkül (ETF-metaadat a free-ben nincs)', async () => {
    const { handlers, fetchImpl } = liveContext();
    const us = await json(await handlers.profile(get('/x'), { id: 'AAPL@XNAS' }));
    expect(us.data).toMatchObject({ name: 'Apple Inc.', isin: 'US0378331005' });
    const callsBefore = fetchImpl.calls.length;
    const eu = await handlers.profile(get('/x'), { id: 'VWCE@XETR' });
    expect(eu.status).toBe(501);
    expect((await json(eu)).error).toMatchObject({
      code: 'CAPABILITY_UNAVAILABLE',
      unavailableReason: 'PLAN_LIMIT',
    });
    expect(fetchImpl.calls.length).toBe(callsBefore);
  });

  it('dividends ISF@XLON: GBP összegek', async () => {
    const { handlers } = liveContext();
    const body = await json(
      await handlers.dividends(get('/x?from=2025-01-01&to=2026-11-21'), { id: 'ISF@XLON' }),
    );
    expect(body.data?.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ amount: { amount: 0.0475, currency: 'GBP' } }),
      ]),
    );
  });

  it('search: szöveg → FMP; ISIN → EODHD (az FMP ISIN-keresése PLAN_LIMIT, hívás nélkül)', async () => {
    const { handlers, fetchImpl } = liveContext();
    const text = await json(await handlers.search(get('/api/v1/search?q=ISF')));
    expect(text.data?.provenance?.sourceId).toBe('fmp');
    const before = fetchImpl.calls.length;
    const byIsin = await json(await handlers.search(get('/api/v1/search?q=IE0005042456')));
    expect(byIsin.data?.provenance?.sourceId).toBe('eodhd');
    expect(fetchImpl.calls.slice(before).map((c) => new URL(c.url).hostname)).toEqual([
      'eodhd.com',
    ]);
    expect(byIsin.warnings?.[0]).toContain('fmp: Az FMP ISIN-keresése');
  });

  it('search üres q → 400', async () => {
    const { handlers } = liveContext();
    expect((await handlers.search(get('/api/v1/search?q=%20'))).status).toBe(400);
  });
});

describe('csomagváltás CSAK env-módosítással (D-027, D-051)', () => {
  const pricesFrom2020 = async (plan: string) => {
    const { handlers, fetchImpl } = liveContext({ EODHD_PLAN: plan });
    await handlers.prices(get('/x?from=2020-01-02&to=2026-11-20'), { id: 'VWCE@XETR' });
    return fetchImpl.calls
      .map((c) => new URL(c.url))
      .find((u) => u.pathname.startsWith('/api/eod/'));
  };

  it('EODHD_PLAN=free → a kezdőnap 1 évre vágva; eod-all-world → a kért kezdőnap megy', async () => {
    expect((await pricesFrom2020('free'))?.searchParams.get('from')).toBe('2025-11-21');
    expect((await pricesFrom2020('eod-all-world'))?.searchParams.get('from')).toBe('2020-01-02');
  });

  it('a kvóta is a csomagból jön: free → 20/nap, a status mutatja', async () => {
    const { handlers } = liveContext();
    await handlers.quote(get('/x'), { id: 'VWCE@XETR' });
    const parsed = parseApiResponse(
      JSON.parse(await (await handlers.providerStatus(get('/api/v1/providers/status'))).text()),
      providerStatusDtoSchema,
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const eodhd = parsed.value.providers.find((p) => p.id === 'eodhd');
    expect(eodhd).toMatchObject({
      plan: 'free',
      configured: true,
      quota: { dailyLimit: 20, usedToday: 1, remainingToday: 19, scope: 'instance' },
    });
    expect(parsed.value.routing).toEqual(
      expect.arrayContaining([
        { capability: 'quote', market: 'US', chain: ['fmp', 'eodhd'], unavailableReason: null },
        { capability: 'profile', market: 'EU', chain: [], unavailableReason: 'PLAN_LIMIT' },
        { capability: 'etfHoldings', market: 'US', chain: [], unavailableReason: 'PLAN_LIMIT' },
      ]),
    );
  });
});

describe('titokmentesség (CLAUDE.md Biztonság)', () => {
  it('sem válasz, sem napló, sem env-figyelmeztetés nem tartalmaz kulcsot vagy User-Agentet', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const { handlers, logs } = liveContext({ EODHD_PLAN: 'nincs-ilyen' });
      const texts: string[] = [];
      const calls: [keyof typeof handlers, string, Record<string, string>?][] = [
        ['health', '/api/v1/health'],
        ['providerStatus', '/api/v1/providers/status'],
        ['quote', '/x', { id: 'AAPL@XNAS' }],
        ['quote', '/x', { id: 'BRK.B@XNYS' }],
        ['quote', '/x', { id: 'ZZZZ@XETR' }],
        ['profile', '/x', { id: 'VWCE@XETR' }],
        ['search', '/api/v1/search?q=ISF'],
        ['prices', '/x?adjustment=hibas', { id: 'VWCE@XETR' }],
      ];
      for (const [name, path, params] of calls) {
        texts.push(await (await handlers[name](get(path), params)).text());
      }
      const everything = [...texts, JSON.stringify(logs), JSON.stringify(warn.mock.calls)].join(
        '\n',
      );
      for (const secret of [FMP_KEY, EODHD_KEY, 'titkos-kapcsolat']) {
        expect(everything).not.toContain(secret);
      }
    } finally {
      warn.mockRestore();
    }
  });
});

describe('mock mód: minden új végpont demóadat, `kind: mock`', () => {
  const mock = () =>
    createServerContext({
      rawEnv: { PROXY_DATA_MODE: 'mock', FMP_API_KEY: FMP_KEY },
      fetchImpl: fakeFetch(() => 'NETWORK_ERROR'),
      now: fixedNow,
      logger: { info: () => {} },
    });

  it('prices, profile, dividends, search → mock provenance; élő szolgáltató nincs regisztrálva', async () => {
    const { handlers, registry } = mock();
    expect(registry.providers.map((p) => p.info.id)).toEqual(['mock']);
    const bodies = await Promise.all(
      [
        handlers.prices(get('/x?from=2026-11-01&to=2026-11-20'), { id: 'DEMO@XNAS' }),
        handlers.profile(get('/x'), { id: 'DEMO@XNAS' }),
        handlers.dividends(get('/x?from=2026-01-01&to=2026-11-20'), { id: 'DEMO@XNAS' }),
        handlers.search(get('/api/v1/search?q=demo')),
      ].map(async (r) => json(await r)),
    );
    for (const body of bodies) {
      expect(body.data?.provenance).toMatchObject({ sourceId: 'mock', kind: 'mock' });
    }
  });
});

describe('getServerContext (KI-31)', () => {
  it('a példány a globalThis-en él: minden route-bundle ugyanazt a kvóta-számlálót látja', () => {
    // Csak összeállítás történik (hálózati hívás nincs); az env-figyelmeztetést elnyeljük.
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const holder = globalThis as Record<string, unknown>;
    delete holder.__stockEtfAnalyzerServerContext;
    try {
      const first = getServerContext();
      expect(getServerContext()).toBe(first);
      expect(holder.__stockEtfAnalyzerServerContext).toBe(first);
    } finally {
      delete holder.__stockEtfAnalyzerServerContext;
      warn.mockRestore();
    }
  });
});
