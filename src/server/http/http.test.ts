import { parseServerEnv } from '../env';
import { parseRetryAfter, requestJson } from './request-json';
import { createRequestScheduler, createTtlMemo } from './request-scheduler';
import { fakeFetch, jsonResponse } from '../testing/test-helpers';

const call = (
  route: Parameters<typeof fakeFetch>[0],
  extra: Partial<Parameters<typeof requestJson>[0]> = {},
) =>
  requestJson({
    url: 'https://up.example/x',
    sourceId: 'teszt',
    fetchImpl: fakeFetch(route),
    timeoutMs: 50,
    ...extra,
  });

describe('requestJson – hibaleképezés', () => {
  it('2xx + JSON → ok', async () => {
    expect(await call(() => jsonResponse({ a: 1 }))).toEqual({ ok: true, value: { a: 1 } });
  });

  it('időtúllépés → TIMEOUT', async () => {
    expect(await call(() => 'HANG')).toMatchObject({
      ok: false,
      error: { kind: 'TIMEOUT', timeoutMs: 50 },
    });
  });

  it('hálózati hiba (offline) → NETWORK, az eredeti üzenet nélkül', async () => {
    const r = await call(() => 'NETWORK_ERROR');
    expect(r).toMatchObject({ ok: false, error: { kind: 'NETWORK' } });
    expect(!r.ok && r.error.message).not.toContain('fetch failed');
  });

  it('429 → RATE_LIMITED a Retry-After másodperceivel', async () => {
    const r = await call(() => jsonResponse({}, 429, { 'Retry-After': '42' }));
    expect(r).toMatchObject({ ok: false, error: { kind: 'RATE_LIMITED', retryAfterSec: 42 } });
  });

  it('402 (napi kvóta elfogyott) → UNAVAILABLE / QUOTA_EXHAUSTED (PHASE 04B, EODHD-doksi)', async () => {
    expect(await call(() => jsonResponse({}, 402))).toMatchObject({
      ok: false,
      error: { kind: 'UNAVAILABLE', reason: 'QUOTA_EXHAUSTED' },
    });
  });

  it('404 → NOT_FOUND a hívó erőforrásával (pl. hibás ticker)', async () => {
    const r = await call(() => jsonResponse({}, 404), {
      notFound: { resource: 'ticker', id: 'XXXX' },
    });
    expect(r).toMatchObject({
      ok: false,
      error: { kind: 'NOT_FOUND', resource: 'ticker', id: 'XXXX' },
    });
  });

  it('5xx → UPSTREAM / HTTP_ERROR (újrapróbálható)', async () => {
    expect(await call(() => jsonResponse({}, 503))).toMatchObject({
      ok: false,
      error: { kind: 'UPSTREAM', failure: 'HTTP_ERROR', sourceId: 'teszt' },
    });
  });

  it('2xx, de hibás JSON → UPSTREAM / INVALID_RESPONSE', async () => {
    expect(await call(() => new Response('<html>oops', { status: 200 }))).toMatchObject({
      ok: false,
      error: { kind: 'UPSTREAM', failure: 'INVALID_RESPONSE' },
    });
  });

  it('szolgáltató-specifikus státusz (mapStatus) elsőbbséget kap', async () => {
    const r = await call(() => jsonResponse({ message: 'invalid currency' }, 422), {
      mapStatus: (status) =>
        status === 422 ? { kind: 'VALIDATION', message: 'x', issues: [] } : null,
    });
    expect(r).toMatchObject({ ok: false, error: { kind: 'VALIDATION' } });
  });
});

describe('parseRetryAfter', () => {
  it('másodperc, HTTP-dátum, ismeretlen', () => {
    const now = new Date('2026-11-21T12:00:00Z');
    expect(parseRetryAfter('7', now)).toBe(7);
    expect(parseRetryAfter('Sat, 21 Nov 2026 12:00:30 GMT', now)).toBe(30);
    expect(parseRetryAfter('holnap', now)).toBeNull();
    expect(parseRetryAfter(null, now)).toBeNull();
  });
});

describe('createRequestScheduler', () => {
  it('két kérés között kivárja a minimális időközt (SEC: ≤10/mp)', async () => {
    let clock = 0;
    const waits: number[] = [];
    const scheduler = createRequestScheduler(110, {
      now: () => clock,
      sleep: async (ms) => {
        waits.push(ms);
        clock += ms;
      },
    });
    await Promise.all([1, 2, 3].map((n) => scheduler.schedule(async () => n)));
    expect(waits).toEqual([110, 110]);
  });

  it('egy hibás feladat után a sor tovább halad', async () => {
    const scheduler = createRequestScheduler(0);
    await expect(scheduler.schedule(async () => Promise.reject(new Error('x')))).rejects.toThrow(
      'x',
    );
    await expect(scheduler.schedule(async () => 'ok')).resolves.toBe('ok');
  });
});

describe('createTtlMemo', () => {
  it('lejárat után nem ad értéket', () => {
    let now = 0;
    const memo = createTtlMemo<string>(100, () => now);
    memo.set('a');
    expect(memo.get()).toBe('a');
    now = 101;
    expect(memo.get()).toBeNull();
  });
});

describe('parseServerEnv', () => {
  it('alapértelmezés: live, kulcs és User-Agent nélkül', () => {
    const { env, issues } = parseServerEnv({});
    expect(issues).toEqual([]);
    expect(env).toMatchObject({
      dataMode: 'live',
      secUserAgent: null,
      openFigiApiKey: null,
      fmpApiKey: null,
      eodhdApiKey: null,
    });
    // Csomag nélkül a legszűkebb (free) csomag a kiindulás.
    expect([env.fmpPlan.id, env.eodhdPlan.id]).toEqual(['free', 'free']);
  });

  it('hibás SEC_USER_AGENT: elveti, és az értéket NEM írja a hibaüzenetbe', () => {
    const { env, issues } = parseServerEnv({ SEC_USER_AGENT: 'titkos-nev-email-nelkul' });
    expect(env.secUserAgent).toBeNull();
    expect(issues[0]?.variable).toBe('SEC_USER_AGENT');
    expect(JSON.stringify(issues)).not.toContain('titkos-nev');
  });

  it('érvényes beállítások', () => {
    const { env, issues } = parseServerEnv({
      PROXY_DATA_MODE: 'MOCK',
      SEC_USER_AGENT: 'StockEtfAnalyzer dev@example.com',
      OPENFIGI_API_KEY: ' k ',
    });
    expect(issues).toEqual([]);
    expect(env).toMatchObject({
      dataMode: 'mock',
      secUserAgent: 'StockEtfAnalyzer dev@example.com',
      openFigiApiKey: 'k',
    });
  });

  it('FMP/EODHD kulcs és csomag (PHASE 04B); a kulcs értéke soha nem kerül hibaüzenetbe', () => {
    const { env, issues } = parseServerEnv({
      FMP_API_KEY: ' fmp-titok-123 ',
      FMP_PLAN: 'FREE',
      EODHD_API_KEY: 'eodhd-titok-456',
      EODHD_PLAN: 'nincs-ilyen',
    });
    expect(env.fmpApiKey).toBe('fmp-titok-123');
    expect(env.eodhdApiKey).toBe('eodhd-titok-456');
    expect(env.fmpPlan.id).toBe('free');
    // Ismeretlen csomag → a legszűkebb csomag + figyelmeztetés (nem csendes „fizetős” feltevés).
    expect(env.eodhdPlan.id).toBe('free');
    expect(issues.map((i) => i.variable)).toEqual(['EODHD_PLAN']);
    expect(JSON.stringify(issues)).not.toMatch(/titok/);
  });

  it('nem igazolt fizetős csomag: elfogadja, de figyelmeztet', () => {
    const { env, issues } = parseServerEnv({ EODHD_PLAN: 'eod-all-world' });
    expect(env.eodhdPlan).toMatchObject({ id: 'eod-all-world', historyWindowDays: null });
    expect(issues[0]?.message).toContain('NINCSENEK élő próbával igazolva');
  });
});
