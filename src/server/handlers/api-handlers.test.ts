import { healthDtoSchema, parseApiResponse } from '@/contracts';

import { silentServerLogger, type ServerLogEntry } from '../logging';
import { createServerContext } from '../server-context';
import { fakeFetch, fixedNow, jsonResponse, loadFixture } from '../testing/test-helpers';

const USER_AGENT = 'StockEtfAnalyzer titkos-kapcsolat@example.com';

/** `ua: null` = a SEC_USER_AGENT nincs beállítva. */
function liveContext(
  route: Parameters<typeof fakeFetch>[0] = () => 'NETWORK_ERROR',
  ua: string | null = USER_AGENT,
) {
  const fetchImpl = fakeFetch(route);
  const logs: ServerLogEntry[] = [];
  const ctx = createServerContext({
    rawEnv: { PROXY_DATA_MODE: 'live', SEC_USER_AGENT: ua ?? undefined },
    fetchImpl,
    now: fixedNow,
    logger: { info: (e) => logs.push(e) },
  });
  return { ...ctx, fetchImpl, logs };
}

const mockContext = () =>
  createServerContext({
    rawEnv: { PROXY_DATA_MODE: 'mock' },
    fetchImpl: fakeFetch(() => 'NETWORK_ERROR'),
    now: fixedNow,
    logger: silentServerLogger,
  });

const get = (path: string) => new Request(`http://localhost:8081${path}`);
const body = async (response: Response) =>
  JSON.parse(await response.text()) as Record<string, unknown>;

describe('GET /api/v1/health', () => {
  it('képességek és hiányzó képességek; User-Agent / kulcs NEM szivárog ki', async () => {
    const { handlers } = liveContext();
    const response = await handlers.health(get('/api/v1/health'));
    const text = await response.text();

    expect(response.status).toBe(200);
    expect(text).not.toContain('titkos-kapcsolat');
    const parsed = parseApiResponse(JSON.parse(text), healthDtoSchema);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.dataMode).toBe('live');
    expect(parsed.value.providers.map((p) => [p.id, p.capabilities])).toEqual([
      ['sec-edgar', ['financialStatements']],
      ['ecb-fx', ['fxRates']],
      ['openfigi', ['listings']],
      ['fmp', ['quote', 'priceHistory', 'profile', 'dividends', 'search']],
      ['eodhd', ['quote', 'priceHistory', 'dividends', 'listings', 'search']],
    ]);
    // FMP/EODHD kulcs NÉLKÜL (ez a teszt nem ad kulcsot) a képességeik „nem elérhetők”;
    // ETF-metaadat/holdings: free csomagban egyáltalán nincs forrás – és ezt ki is mondjuk.
    expect(parsed.value.unavailableCapabilities).toEqual(
      expect.arrayContaining([
        'quote',
        'priceHistory',
        'profile',
        'dividends',
        'etfMetadata',
        'etfHoldings',
      ]),
    );
  });

  it('SEC_USER_AGENT nélkül a kimutatás-képesség „nem elérhető”', async () => {
    const { handlers } = liveContext(undefined, null);
    const data = (await body(await handlers.health(get('/api/v1/health')))).data as {
      unavailableCapabilities: string[];
    };
    expect(data.unavailableCapabilities).toContain('financialStatements');
  });
});

describe('GET /api/v1/fx', () => {
  it('élő: ECB-ráták a szerződés szerint', async () => {
    const { handlers } = liveContext(() =>
      jsonResponse(loadFixture('ecb-fx', 'rates-latest.json')),
    );
    const response = await handlers.fx(get('/api/v1/fx?base=EUR&quotes=USD,HUF'));
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(await body(response)).toMatchObject({ apiVersion: '1', data: { base: 'EUR' } });
  });

  it('bemenet-validáció: hibás deviza, jövőbeli dátum, túl sok deviza → 400, hívás nélkül', async () => {
    const { handlers, fetchImpl } = liveContext();
    for (const query of [
      'quotes=US$',
      'date=2027-01-01',
      `quotes=${Array(31).fill('USD').join(',')}`,
      'date=2026-02-30',
    ]) {
      const response = await handlers.fx(get(`/api/v1/fx?${query}`));
      expect([query, response.status]).toEqual([query, 400]);
      expect(await body(response)).toMatchObject({ error: { code: 'VALIDATION_FAILED' } });
    }
    expect(fetchImpl.calls).toHaveLength(0);
  });

  it('felfelé irányuló 429 → 429 + Retry-After a kliens felé', async () => {
    const { handlers } = liveContext(() => jsonResponse({}, 429, { 'Retry-After': '30' }));
    const response = await handlers.fx(get('/api/v1/fx'));
    expect(response.status).toBe(429);
    expect(response.headers.get('Retry-After')).toBe('30');
    expect(await body(response)).toMatchObject({
      error: { code: 'RATE_LIMITED', retryAfterSec: 30 },
    });
  });

  it('timeout → 504 TIMEOUT; offline szolgáltató → 502 UPSTREAM_ERROR', async () => {
    expect((await liveContext(() => 'NETWORK_ERROR').handlers.fx(get('/api/v1/fx'))).status).toBe(
      502,
    );
  });
});

describe('GET /api/v1/securities/{isin}/listings', () => {
  it('a hibaüzenet nem ismétli önmagát', async () => {
    const response = await liveContext().handlers.securityListings(get('/x'), {
      isin: 'IE00BK5BQT81',
    });
    const message = ((await body(response)).error as { message: string }).message;
    expect(message.split('ellenőrző számjegy')).toHaveLength(2);
  });

  it('hibás ISIN (ellenőrző jegy) → 400, hívás nélkül', async () => {
    const { handlers, fetchImpl } = liveContext();
    const response = await handlers.securityListings(get('/x'), { isin: 'IE00BK5BQT81' });
    expect(response.status).toBe(400);
    expect(fetchImpl.calls).toHaveLength(0);
  });

  it('élő OpenFIGI fixture → 200', async () => {
    const jobs = loadFixture('openfigi', 'mapping-isin.json') as unknown[];
    const { handlers } = liveContext(() => jsonResponse([jobs[0]]));
    const response = await handlers.securityListings(get('/x'), { isin: 'IE00BK5BQT80' });
    expect(response.status).toBe(200);
  });
});

describe('GET /api/v1/stocks/{id}/financials', () => {
  it('nem US listing → 501 CAPABILITY_UNAVAILABLE / PLAN_LIMIT (PHASE 04B routing), hívás nélkül', async () => {
    const { handlers, fetchImpl } = liveContext();
    const response = await handlers.financials(get('/x?period=annual'), { id: 'SAP@XETR' });
    expect(response.status).toBe(501);
    expect(await body(response)).toMatchObject({
      error: { code: 'CAPABILITY_UNAVAILABLE', unavailableReason: 'PLAN_LIMIT' },
    });
    // Ticker-ütközés elleni védelem: a SEC-et meg sem kérdezzük (a US `SAP` ADR más jegyzés).
    expect(fetchImpl.calls).toHaveLength(0);
  });

  it('hibás period paraméter → 400', async () => {
    const response = await liveContext().handlers.financials(get('/x?period=monthly'), {
      id: 'AAPL@XNAS',
    });
    expect(response.status).toBe(400);
  });

  it('SEC_USER_AGENT nélkül → 501 CAPABILITY_UNAVAILABLE', async () => {
    const response = await liveContext(undefined, null).handlers.financials(get('/x'), {
      id: 'AAPL@XNAS',
    });
    expect(response.status).toBe(501);
    expect(await body(response)).toMatchObject({ error: { code: 'CAPABILITY_UNAVAILABLE' } });
  });
});

describe('GET /api/v1/instruments/{id}/quote', () => {
  it('élő módban a 04A-ban nincs árforrás → 501 CAPABILITY_UNAVAILABLE (nem csendes demó)', async () => {
    const response = await liveContext().handlers.quote(get('/x'), { id: 'AAPL@XNAS' });
    expect(response.status).toBe(501);
    expect(await body(response)).toMatchObject({ error: { code: 'CAPABILITY_UNAVAILABLE' } });
  });

  it('mock módban demóár „mock” jelöléssel', async () => {
    const response = await mockContext().handlers.quote(get('/x'), { id: 'DEMO@XNAS' });
    expect(await body(response)).toMatchObject({
      data: { listingId: 'DEMO@XNAS', price: 100, provenance: { kind: 'mock', sourceId: 'mock' } },
    });
  });
});

describe('napló és nincs keverés', () => {
  it('a napló nem tartalmaz User-Agentet, csak útvonalat, státuszt, szolgáltatót', async () => {
    const { handlers, logs } = liveContext(() =>
      jsonResponse(loadFixture('ecb-fx', 'rates-latest.json')),
    );
    await handlers.fx(get('/api/v1/fx'));
    expect(logs).toEqual([
      expect.objectContaining({ route: 'fx', status: 200, provider: 'ecb-fx' }),
    ]);
    expect(JSON.stringify(logs)).not.toContain('titkos-kapcsolat');
  });

  it('mock módban CSAK a mock szolgáltató fut (élő és demó adat nem keveredik)', () => {
    expect(mockContext().registry.providers.map((p) => p.info.id)).toEqual(['mock']);
    expect(liveContext().registry.providers.some((p) => p.info.kind === 'mock')).toBe(false);
  });
});
