import { parseIsin, type Isin } from '@/domain';

import { createOpenFigiProvider } from './openfigi-provider';
import { fakeFetch, fixedNow, jsonResponse, loadFixture } from '../../testing/test-helpers';

const isin = (value: string): Isin => {
  const parsed = parseIsin(value);
  if (!parsed.ok) throw new Error(value);
  return parsed.value;
};

/** A valós fixture 3 job eredményét tartalmazza; egy kérés egy jobot kap vissza. */
const jobs = loadFixture('openfigi', 'mapping-isin.json') as unknown[];

function provider(route: Parameters<typeof fakeFetch>[0], apiKey: string | null = null) {
  const fetchImpl = fakeFetch(route);
  const p = createOpenFigiProvider({ fetchImpl, now: fixedNow, apiKey, timeoutMs: 50 });
  if (p.getSecurityListings === undefined) throw new Error('nincs listings képesség');
  return { get: p.getSecurityListings.bind(p), fetchImpl };
}

describe('openfigi (valós fixture: VWCE, AAPL, hibás ISIN)', () => {
  it('UCITS ETF: csak igazolt tőzsdék jegyzései, MIC-kel; a kihagyottak megszámolva', async () => {
    const { get, fetchImpl } = provider(() => jsonResponse([jobs[0]]));
    const r = await get(isin('IE00BK5BQT80'));

    expect(JSON.parse(String(fetchImpl.calls[0]?.init?.body))).toEqual([
      { idType: 'ID_ISIN', idValue: 'IE00BK5BQT80' },
    ]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const ids = r.value.listings.map((l) => l.listingId);
    expect(ids).toEqual(
      expect.arrayContaining([
        'VWCE@XETR',
        'VWRA@XLON',
        'VWRP@XLON',
        'VWCE@XAMS',
        'VWCE@XMIL',
        'VWRA@XSWX',
      ]),
    );
    // A pénznemet az OpenFIGI nem adja → null, nem kitalált.
    expect(r.value.listings.every((l) => l.tradingCurrency === null)).toBe(true);
    expect(
      r.value.listings.every((l) => l.kindHint === 'etf' && l.securityId === 'IE00BK5BQT80'),
    ).toBe(true);
    // 179 sor = jegyzések + kihagyott (nem igazolt helyszín / kompozit / hibás ticker).
    const { unmappedVenue, composite, invalidSymbol } = r.value.omitted;
    expect(r.value.listings.length + unmappedVenue + composite + invalidSymbol).toBe(179);
    expect(composite).toBeGreaterThanOrEqual(1); // VWCE „GR” kompozit
    expect(r.value.provenance).toMatchObject({
      sourceId: 'openfigi',
      kind: 'reported',
      asOf: null,
    });
  });

  it('US részvény ISIN-re csak kompozit sor jön → nincs listing, de jelezve', async () => {
    const { get } = provider(() => jsonResponse([jobs[1]]));
    const r = await get(isin('US0378331005'));
    expect(r).toMatchObject({
      ok: true,
      value: { listings: [], omitted: { composite: 1, unmappedVenue: 0, invalidSymbol: 0 } },
    });
  });

  it('„No identifier found.” → NOT_FOUND', async () => {
    const { get } = provider(() => jsonResponse([{ warning: 'No identifier found.' }]));
    expect(await get(isin('US0378331005'))).toMatchObject({
      ok: false,
      error: { kind: 'NOT_FOUND' },
    });
  });

  it('job-szintű „error” → UPSTREAM / HTTP_ERROR', async () => {
    const { get } = provider(() => jsonResponse([jobs[2]]));
    expect(await get(isin('US0378331005'))).toMatchObject({
      ok: false,
      error: { kind: 'UPSTREAM', failure: 'HTTP_ERROR' },
    });
  });

  it('429 → RATE_LIMITED; hibás szerkezet → INVALID_RESPONSE', async () => {
    expect(
      await provider(() => jsonResponse({}, 429, { 'Retry-After': '60' })).get(
        isin('US0378331005'),
      ),
    ).toMatchObject({
      ok: false,
      error: { kind: 'RATE_LIMITED', retryAfterSec: 60 },
    });
    expect(
      await provider(() => jsonResponse({ data: [] })).get(isin('US0378331005')),
    ).toMatchObject({
      ok: false,
      error: { failure: 'INVALID_RESPONSE' },
    });
  });

  it('API-kulcs csak fejlécben megy, ha be van állítva', async () => {
    const { get, fetchImpl } = provider(() => jsonResponse([jobs[1]]), 'teszt-kulcs');
    await get(isin('US0378331005'));
    expect((fetchImpl.calls[0]?.init?.headers as Record<string, string>)['X-OPENFIGI-APIKEY']).toBe(
      'teszt-kulcs',
    );
  });
});
