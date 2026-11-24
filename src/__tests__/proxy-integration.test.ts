/**
 * Végponttól végpontig (folyamaton belül, hálózat nélkül):
 *   kliens use case → proxy gateway → HTTP-kliens → [hamis fetch] → VALÓDI szerver-handlerek
 *   → szolgáltató-adapter → [hamis felfelé irányuló fetch + valós fixture]
 *
 * Ez igazolja, hogy a szerver kimenete és a kliens contract-validációja ugyanazt a szerződést
 * követi (R-11: korai integrációs teszt), és hogy a hibakódok mindkét irányban leképeződnek.
 */
import { createAppServices } from '@/config/container';
import { parseCurrencyCode } from '@/domain';
import { silentServerLogger } from '@/server/logging';
import { createServerContext, type ServerContext } from '@/server/server-context';
import { fakeFetch, jsonResponse, loadFixture } from '@/server/testing/test-helpers';

const clock = { now: () => new Date('2026-11-21T12:00:00Z') };

/** A kliens „fetch”-e közvetlenül a szerver-handlereket hívja (mintha az Expo dev szerver futna). */
function clientFetchFor(server: ServerContext) {
  const { handlers } = server;
  return async (input: string): Promise<Response> => {
    const url = new URL(input);
    const path = url.pathname;
    const request = new Request(url.toString());
    let m: RegExpMatchArray | null;
    if (path === '/api/v1/health') return handlers.health(request);
    if (path === '/api/v1/fx') return handlers.fx(request);
    if ((m = path.match(/^\/api\/v1\/securities\/([^/]+)\/listings$/))) {
      return handlers.securityListings(request, { isin: decodeURIComponent(m[1] ?? '') });
    }
    if ((m = path.match(/^\/api\/v1\/stocks\/([^/]+)\/financials$/))) {
      return handlers.financials(request, { id: decodeURIComponent(m[1] ?? '') });
    }
    if ((m = path.match(/^\/api\/v1\/instruments\/([^/]+)\/(quote|prices|profile|dividends)$/))) {
      const params = { id: decodeURIComponent(m[1] ?? '') };
      const endpoint = m[2] as 'quote' | 'prices' | 'profile' | 'dividends';
      return handlers[endpoint](request, params);
    }
    if (path === '/api/v1/search') return handlers.search(request);
    return new Response('Not found', { status: 404 });
  };
}

function liveStack() {
  const tickers = loadFixture('sec-edgar', 'company-tickers.json');
  const facts = loadFixture('sec-edgar', 'companyfacts-MSFT.json');
  const figi = loadFixture('openfigi', 'mapping-isin.json') as unknown[];
  const upstream = fakeFetch((url) => {
    if (url.includes('frankfurter'))
      return jsonResponse(loadFixture('ecb-fx', 'rates-latest.json'));
    if (url.includes('openfigi')) return jsonResponse([figi[0]]);
    if (url.endsWith('company_tickers.json')) return jsonResponse(tickers);
    if (url.endsWith('CIK0000789019.json')) return jsonResponse(facts);
    return jsonResponse({}, 404);
  });
  const server = createServerContext({
    rawEnv: { PROXY_DATA_MODE: 'live', SEC_USER_AGENT: 'StockEtfAnalyzer dev@example.com' },
    fetchImpl: upstream,
    now: clock.now,
    logger: silentServerLogger,
  });
  const services = createAppServices(
    { dataMode: 'live', apiBaseUrl: 'http://localhost:8081' },
    { clock, fetchImpl: clientFetchFor(server) },
  );
  return { services, upstream };
}

describe('kliens ↔ proxy ↔ adapter (élő mód, fixture-ökkel)', () => {
  it('MSFT éves kimutatásai: domain-objektum a kliensen, frissességgel', async () => {
    const { services } = liveStack();
    const result = await services.getFinancialStatements('MSFT@XNAS', 'annual');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toMatchObject({
      cik: '0000789019',
      frequency: 'annual',
      entityName: 'MICROSOFT CORP',
    });
    expect(result.value.statements.length).toBeGreaterThan(10);
    // A legutolsó filing 2026-10-28 → az éves szabály szerint FRESH (a saját óránkkal számolva).
    expect(result.value.provenance.freshness).toBe('FRESH');
  });

  it('pénzátváltás valós ECB-rátával: natív és kijelzési pénznem külön, ráta + dátum + forrás', async () => {
    const { services } = liveStack();
    const usd = parseCurrencyCode('USD');
    const huf = parseCurrencyCode('HUF');
    if (!usd.ok || !huf.ok) throw new Error('setup');

    const result = await services.convertMoney({
      money: { amount: 100, currency: usd.value },
      target: huf.value,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.original).toEqual({ amount: 100, currency: 'USD' });
    expect(result.value.converted.currency).toBe('HUF');
    expect(result.value.converted.amount).toBeCloseTo((100 / 1.099) * 373.55, 6);
    expect(result.value.rate).toMatchObject({
      base: 'USD',
      quote: 'HUF',
      asOf: '2026-11-20',
      provenance: {
        kind: 'calculated',
        freshness: 'FRESH',
        inputs: ['EUR/HUF@2026-11-20', 'EUR/USD@2026-11-20'],
      },
    });
  });

  it('ISIN → jegyzések a kliensen domain-típusként', async () => {
    const { services } = liveStack();
    const result = await services.getSecurityListings('IE00BK5BQT80');
    expect(result.ok && result.value.listings.map((l) => l.listingId)).toContain('VWCE@XETR');
  });

  it('árfolyam FMP/EODHD kulcs nélkül: őszinte UNAVAILABLE / NOT_COVERED a kliensig, hívás nélkül', async () => {
    const { services, upstream } = liveStack();
    expect(await services.getListingQuote('MSFT@XNAS')).toMatchObject({
      ok: false,
      error: { kind: 'UNAVAILABLE', reason: 'NOT_COVERED' },
    });
    expect(upstream.calls).toHaveLength(0);
  });

  it('nem US részvény kimutatása: UNAVAILABLE / PLAN_LIMIT a kliensen (fizetős csomag kellene)', async () => {
    const { services, upstream } = liveStack();
    expect(await services.getFinancialStatements('SAP@XETR', 'annual')).toMatchObject({
      ok: false,
      error: { kind: 'UNAVAILABLE', reason: 'PLAN_LIMIT' },
    });
    expect(upstream.calls).toHaveLength(0);
  });
});

/** PHASE 04B: FMP + EODHD kulccsal, valós fixture-ökkel (a kulcs a teszt saját értéke). */
function marketStack() {
  const upstream = fakeFetch((url) => {
    const u = new URL(url);
    if (u.hostname === 'financialmodelingprep.com') {
      if (u.pathname === '/stable/profile')
        return jsonResponse(loadFixture('fmp', 'profile-AAPL.json'));
      if (u.pathname === '/stable/historical-price-eod/full')
        return jsonResponse(loadFixture('fmp', 'historical-full-NVDA-2024-06.json'));
      return new Response('Restricted Endpoint', { status: 402 });
    }
    if (u.pathname === '/api/search/ISF')
      return jsonResponse(loadFixture('eodhd', 'search-IE0005042456.json'));
    if (u.pathname === '/api/eod/ISF.LSE')
      return jsonResponse(loadFixture('eodhd', 'eod-ISF.LSE.json'));
    if (u.pathname === '/api/div/ISF.LSE')
      return jsonResponse(loadFixture('eodhd', 'div-ISF.LSE.json'));
    if (u.pathname === '/api/search/IE0005042456')
      return jsonResponse(loadFixture('eodhd', 'search-IE0005042456.json'));
    return new Response('Ticker Not Found.', { status: 404 });
  });
  const server = createServerContext({
    rawEnv: { PROXY_DATA_MODE: 'live', FMP_API_KEY: 'teszt-fmp', EODHD_API_KEY: 'teszt-eodhd' },
    fetchImpl: upstream,
    now: clock.now,
    logger: silentServerLogger,
  });
  return createAppServices(
    { dataMode: 'live', apiBaseUrl: 'http://localhost:8081' },
    { clock, fetchImpl: clientFetchFor(server) },
  );
}

describe('kliens ↔ proxy ↔ FMP/EODHD (PHASE 04B, fixture-ökkel)', () => {
  it('ISF@XLON ártörténet: GBX natív pénznem, EODHD, frissesség a saját óránkkal', async () => {
    const result = await marketStack().getPriceHistory('ISF@XLON', {
      from: '2026-10-20',
      to: '2026-11-20',
      adjustment: 'NONE',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.currency).toBe('GBX');
    expect(result.value.provenance).toMatchObject({ sourceId: 'eodhd', asOf: '2026-11-20' });
    // Az utolsó árpont 2026-11-20, az óra 2026-11-21 → FRESH (4 napos szabály).
    expect(result.value.provenance.freshness).toBe('FRESH');
  });

  it('NVDA split-korrigált ártörténet az FMP-től; régi adat → EXPIRED', async () => {
    const result = await marketStack().getPriceHistory('NVDA@XNAS', {
      from: '2024-06-06',
      to: '2024-06-11',
      adjustment: 'SPLIT',
    });
    expect(result.ok && result.value.points[1]).toEqual({ date: '2024-06-07', close: 120.89 });
    expect(result.ok && result.value.provenance.freshness).toBe('EXPIRED');
  });

  it('profil (US, FMP), osztalék (GBP), ISIN-keresés (EODHD) domain-típusként', async () => {
    const services = marketStack();
    const profile = await services.getInstrumentProfile('AAPL@XNAS');
    expect(profile).toMatchObject({ ok: true, value: { isin: 'US0378331005', kindHint: 'stock' } });
    const dividends = await services.getDividendHistory('ISF@XLON', {
      from: '2025-01-01',
      to: '2026-11-21',
    });
    expect(dividends.ok && dividends.value.events[0]?.amount.currency).toBe('GBP');
    const search = await services.searchInstruments('IE0005042456');
    expect(search.ok && search.value.hits[0]).toMatchObject({
      listingId: 'ISF@XLON',
      tradingCurrency: 'GBX',
    });
  });

  it('nem US profil: UNAVAILABLE / PLAN_LIMIT a kliensen (nem „nincs adat”, nem 0)', async () => {
    expect(await marketStack().getInstrumentProfile('ISF@XLON')).toMatchObject({
      ok: false,
      error: { kind: 'UNAVAILABLE', reason: 'PLAN_LIMIT' },
    });
  });
});

describe('kliens HTTP-hibák', () => {
  const services = (fetchImpl: (url: string) => Promise<Response>) =>
    createAppServices(
      { dataMode: 'live', apiBaseUrl: 'http://localhost:8081' },
      { clock, fetchImpl },
    );

  it('offline (a proxy nem érhető el) → NETWORK, újrapróbálható', async () => {
    const result = await services(async () =>
      Promise.reject(new TypeError('Network request failed')),
    ).getSecurityListings('IE00BK5BQT80');
    expect(result).toMatchObject({ ok: false, error: { kind: 'NETWORK' } });
  });

  // PHASE 15 (D-090): a hoszt HTML-hibalapja a HTTP-státusz szerint képeződik le.
  it('a hoszt HTML-hibalapja (502) → UPSTREAM HTTP_ERROR', async () => {
    const result = await services(
      async () => new Response('<html>502</html>', { status: 502 }),
    ).getSecurityListings('IE00BK5BQT80');
    expect(result).toMatchObject({
      ok: false,
      error: { kind: 'UPSTREAM', failure: 'HTTP_ERROR' },
    });
  });

  it('nem JSON válasz 200-zal → CONTRACT_MISMATCH', async () => {
    const result = await services(
      async () => new Response('<html>ok?</html>', { status: 200 }),
    ).getSecurityListings('IE00BK5BQT80');
    expect(result).toMatchObject({
      ok: false,
      error: { kind: 'UPSTREAM', failure: 'CONTRACT_MISMATCH' },
    });
  });

  it('szerződést sértő adat (pl. hiányzó sortétel-kulcs) → CONTRACT_MISMATCH, nem csendes 0', async () => {
    const broken = {
      apiVersion: '1',
      data: {
        base: 'EUR',
        rates: [{ base: 'EUR', quote: 'USD', asOf: '2026-11-20' }],
        missing: [],
      },
    };
    const usd = parseCurrencyCode('USD');
    const huf = parseCurrencyCode('HUF');
    if (!usd.ok || !huf.ok) throw new Error('setup');
    const result = await services(async () => jsonResponse(broken)).convertMoney({
      money: { amount: 1, currency: usd.value },
      target: huf.value,
    });
    expect(result).toMatchObject({ ok: false, error: { failure: 'CONTRACT_MISMATCH' } });
  });
});
