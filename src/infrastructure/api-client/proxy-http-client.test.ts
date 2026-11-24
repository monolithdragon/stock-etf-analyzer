/**
 * PHASE 15: a kliensoldali HTTP-kliens (bizalmi határ) hibatáblája – eddig csak közvetve,
 * integrációs teszteken át volt lefedve. Hálózatot nem hív (hamis `fetchImpl`).
 */
import { z } from 'zod';

import { API_VERSION } from '@/contracts';

import {
  createProxyHttpClient,
  parseRetryAfterSeconds,
  type ClientFetch,
} from './proxy-http-client';

const schema = z.strictObject({ value: z.number() });
const BASE = 'http://proxy.test';

function clientWith(fetchImpl: ClientFetch, timeoutMs = 1000) {
  return createProxyHttpClient({ baseUrl: BASE, fetchImpl, timeoutMs });
}
const respond =
  (body: string, init: ResponseInit = {}): ClientFetch =>
  () =>
    Promise.resolve(new Response(body, init));
const envelope = (data: unknown) => JSON.stringify({ apiVersion: API_VERSION, data, warnings: [] });

describe('createProxyHttpClient', () => {
  it('siker: a boríték `data` mezője sémán validálva', async () => {
    const result = await clientWith(respond(envelope({ value: 42 }))).get('/x', schema);
    expect(result).toEqual({ ok: true, value: { value: 42 } });
  });

  it('GET: Accept fejléc, a kérés a baseUrl + útvonalra megy; POST: JSON-törzs', async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const fetchImpl: ClientFetch = (url, init) => {
      calls.push({ url, init });
      return Promise.resolve(new Response(envelope({ value: 1 })));
    };
    const client = clientWith(fetchImpl);
    await client.get('/api/v1/a', schema);
    await client.post('/api/v1/b', { q: 1 }, schema);
    expect(calls[0]?.url).toBe(`${BASE}/api/v1/a`);
    expect(calls[0]?.init?.method).toBe('GET');
    expect(calls[1]?.init).toMatchObject({ method: 'POST', body: '{"q":1}' });
    expect(calls[1]?.init?.headers).toMatchObject({ 'Content-Type': 'application/json' });
  });

  it('a séma megsértése → CONTRACT_MISMATCH (nem csendes rossz adat)', async () => {
    const result = await clientWith(respond(envelope({ value: 'x' }))).get('/x', schema);
    expect(!result.ok && result.error).toMatchObject({
      kind: 'UPSTREAM',
      failure: 'CONTRACT_MISMATCH',
    });
  });

  it('érvénytelen JSON 200-zal → CONTRACT_MISMATCH', async () => {
    const result = await clientWith(respond('{"apiVersion":')).get('/x', schema);
    expect(!result.ok && result.error).toMatchObject({
      kind: 'UPSTREAM',
      failure: 'CONTRACT_MISMATCH',
    });
  });

  it('saját hiba-boríték (429 RATE_LIMITED) → RATE_LIMITED a boríték szerint', async () => {
    const body = JSON.stringify({
      apiVersion: API_VERSION,
      error: { code: 'RATE_LIMITED', message: 'kvóta', retryAfterSec: 12 },
    });
    const result = await clientWith(respond(body, { status: 429 })).get('/x', schema);
    expect(!result.ok && result.error).toMatchObject({ kind: 'RATE_LIMITED', retryAfterSec: 12 });
  });

  it.each([
    [429, { 'Retry-After': '30' }, { kind: 'RATE_LIMITED', retryAfterSec: 30 }],
    [
      429,
      { 'Retry-After': 'Wed, 21 Oct 2026 07:28:00 GMT' },
      { kind: 'RATE_LIMITED', retryAfterSec: null },
    ],
    [504, {}, { kind: 'TIMEOUT' }],
    [408, {}, { kind: 'TIMEOUT' }],
    [502, {}, { kind: 'UPSTREAM', failure: 'HTTP_ERROR' }],
    [500, {}, { kind: 'UPSTREAM', failure: 'HTTP_ERROR' }],
    [404, {}, { kind: 'UPSTREAM', failure: 'HTTP_ERROR' }],
  ])('nem-JSON hosztválasz HTTP %s → %j', async (status, headers, expected) => {
    const result = await clientWith(respond('<html>hiba</html>', { status, headers })).get(
      '/x',
      schema,
    );
    expect(!result.ok && result.error).toMatchObject(expected);
  });

  it('idegen JSON hibaoldal (nem a mi borítékunk) 503-mal → HTTP_ERROR, nem szerződéssértés', async () => {
    const result = await clientWith(
      respond('{"message":"Service Unavailable"}', { status: 503 }),
    ).get('/x', schema);
    expect(!result.ok && result.error).toMatchObject({ kind: 'UPSTREAM', failure: 'HTTP_ERROR' });
  });

  it('hálózati hiba → NETWORK (offline)', async () => {
    const result = await clientWith(() =>
      Promise.reject(new TypeError('Network request failed')),
    ).get('/x', schema);
    expect(!result.ok && result.error.kind).toBe('NETWORK');
  });

  it('időtúllépés: az AbortSignal megszakítja a kérést → TIMEOUT a beállított értékkel', async () => {
    const hanging: ClientFetch = (_url, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
      });
    jest.useFakeTimers();
    try {
      const pending = clientWith(hanging, 500).get('/x', schema);
      jest.advanceTimersByTime(500);
      const result = await pending;
      expect(!result.ok && result.error).toMatchObject({ kind: 'TIMEOUT', timeoutMs: 500 });
    } finally {
      jest.useRealTimers();
    }
  });

  it('POST saját timeouttal (AI): a kérésenkénti érték érvényes', async () => {
    const hanging: ClientFetch = (_url, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
      });
    jest.useFakeTimers();
    try {
      const pending = clientWith(hanging, 100).post('/ai', {}, schema, { timeoutMs: 2000 });
      jest.advanceTimersByTime(1999);
      await Promise.resolve();
      jest.advanceTimersByTime(1);
      const result = await pending;
      expect(!result.ok && result.error).toMatchObject({ kind: 'TIMEOUT', timeoutMs: 2000 });
    } finally {
      jest.useRealTimers();
    }
  });
});

describe('parseRetryAfterSeconds', () => {
  it.each([
    [null, null],
    ['', null],
    ['30', 30],
    [' 5 ', 5],
    ['-1', null],
    ['1.5', null],
    ['Wed, 21 Oct 2026 07:28:00 GMT', null],
    ['999999', 86_400],
  ])('%j → %j', (raw, expected) => {
    expect(parseRetryAfterSeconds(raw)).toBe(expected);
  });
});
