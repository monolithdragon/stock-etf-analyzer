import { parseCurrencyCode, type CurrencyCode, type IsoDate } from '@/domain';

import { createEcbFxProvider } from './ecb-fx-provider';
import { fakeFetch, fixedNow, jsonResponse, loadFixture } from '../../testing/test-helpers';

const c = (code: string): CurrencyCode => {
  const parsed = parseCurrencyCode(code);
  if (!parsed.ok) throw new Error(code);
  return parsed.value;
};
const DISPLAY = ['HUF', 'EUR', 'USD', 'GBP', 'CHF', 'JPY'].map(c);

function provider(route: Parameters<typeof fakeFetch>[0]) {
  const fetchImpl = fakeFetch(route);
  const p = createEcbFxProvider({ fetchImpl, now: fixedNow, timeoutMs: 50 });
  if (p.getFxRates === undefined) throw new Error('nincs FX képesség');
  return { getFxRates: p.getFxRates.bind(p), fetchImpl, info: p.info };
}

describe('ecb-fx (valós Frankfurter v2 fixture, 2026-11-20)', () => {
  it('normalizál: ECB-ráta, dátum, forrás, reported; az EUR nem hiányzó', async () => {
    const { getFxRates, fetchImpl } = provider(() =>
      jsonResponse(loadFixture('ecb-fx', 'rates-latest.json')),
    );
    const r = await getFxRates({ base: c('EUR'), quotes: DISPLAY, date: null });

    expect(fetchImpl.calls[0]?.url).toBe(
      'https://api.frankfurter.dev/v2/providers/ecb/rates?base=EUR&quotes=HUF%2CUSD%2CGBP%2CCHF%2CJPY',
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.missing).toEqual([]);
    expect(r.value.rates).toHaveLength(5);
    expect(r.value.rates.find((x) => x.quote === 'HUF')).toMatchObject({
      base: 'EUR',
      rate: 373.55,
      asOf: '2026-11-20',
      provenance: {
        sourceId: 'ecb-fx',
        kind: 'reported',
        asOf: '2026-11-20',
        fetchedAt: '2026-11-21T12:00:00.000Z',
      },
    });
  });

  it('az EUR→EUR = 1 sort eldobja (nem információ)', async () => {
    const { getFxRates } = provider(() =>
      jsonResponse(loadFixture('ecb-fx', 'rates-all-latest.json')),
    );
    const r = await getFxRates({ base: c('EUR'), quotes: [c('USD')], date: null });
    expect(r.ok && r.value.rates.some((x) => x.quote === 'EUR')).toBe(false);
  });

  it('az ECB által nem közölt deviza → „missing” (üres válasz, HTTP 200), nem 0', async () => {
    const { getFxRates } = provider(() => jsonResponse([]));
    const r = await getFxRates({ base: c('EUR'), quotes: [c('AED')], date: null });
    expect(r).toMatchObject({ ok: true, value: { rates: [], missing: ['AED'] } });
  });

  it('történeti dátumot továbbít; a válasz asOf-ja a tényleges ECB-nap (hétvége → péntek)', async () => {
    const { getFxRates, fetchImpl } = provider(() =>
      jsonResponse([{ date: '2026-11-13', base: 'EUR', quote: 'USD', rate: 1.1052 }]),
    );
    const r = await getFxRates({
      base: c('EUR'),
      quotes: [c('USD')],
      date: '2026-11-15' as IsoDate,
    });
    expect(fetchImpl.calls[0]?.url).toContain('date=2026-11-15');
    expect(r.ok && r.value.rates[0]?.asOf).toBe('2026-11-13');
  });

  it('HTTP 422 → VALIDATION a szolgáltató üzenetével', async () => {
    const { getFxRates } = provider(() =>
      jsonResponse({ status: 422, message: 'invalid currency: XXX' }, 422),
    );
    const r = await getFxRates({ base: c('EUR'), quotes: [c('XXX')], date: null });
    expect(r).toMatchObject({ ok: false, error: { kind: 'VALIDATION' } });
    expect(JSON.stringify(r)).toContain('invalid currency');
  });

  it('hibás szerkezet / negatív ráta → UPSTREAM / INVALID_RESPONSE', async () => {
    const { getFxRates: g1 } = provider(() => jsonResponse({ rates: { USD: 1.1 } }));
    expect(await g1({ base: c('EUR'), quotes: [c('USD')], date: null })).toMatchObject({
      ok: false,
      error: { failure: 'INVALID_RESPONSE' },
    });
    const { getFxRates: g2 } = provider(() =>
      jsonResponse([{ date: '2026-11-20', base: 'EUR', quote: 'USD', rate: -1 }]),
    );
    expect(await g2({ base: c('EUR'), quotes: [c('USD')], date: null })).toMatchObject({
      ok: false,
      error: { failure: 'INVALID_RESPONSE' },
    });
  });

  it('nem EUR bázis → VALIDATION, hálózati hívás nélkül', async () => {
    const { getFxRates, fetchImpl } = provider(() => jsonResponse([]));
    expect(await getFxRates({ base: c('USD'), quotes: [c('HUF')], date: null })).toMatchObject({
      ok: false,
      error: { kind: 'VALIDATION' },
    });
    expect(fetchImpl.calls).toHaveLength(0);
  });

  it('timeout és offline állapot', async () => {
    expect(
      await provider(() => 'HANG').getFxRates({ base: c('EUR'), quotes: [c('USD')], date: null }),
    ).toMatchObject({
      ok: false,
      error: { kind: 'TIMEOUT' },
    });
    expect(
      await provider(() => 'NETWORK_ERROR').getFxRates({
        base: c('EUR'),
        quotes: [c('USD')],
        date: null,
      }),
    ).toMatchObject({ ok: false, error: { kind: 'NETWORK' } });
  });
});
