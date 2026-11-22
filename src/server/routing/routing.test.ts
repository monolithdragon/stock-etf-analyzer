import {
  AppErrors,
  createQuote,
  err,
  parseCurrencyCode,
  parseListingId,
  type AppError,
  type ListingId,
  type Quote,
  type Result,
} from '@/domain';

import { marketOfListing } from './markets';
import { allowsFallback, createProviderRouter } from './provider-router';
import { createDailyQuota } from './quota';
import { createProviderRegistry, type MarketDataProvider } from '../providers/market-data-provider';

const id = (raw: string): ListingId => {
  const parsed = parseListingId(raw);
  if (!parsed.ok) throw new Error(raw);
  return parsed.value;
};

function quoteFrom(sourceId: string, listingId: ListingId): Result<Quote> {
  const usd = parseCurrencyCode('USD');
  if (!usd.ok) throw new Error('setup');
  return createQuote({
    listingId,
    price: 10,
    currency: usd.value,
    asOf: '2026-11-20T21:00:00Z',
    delayMinutes: null,
    provenance: {
      sourceId,
      sourceName: sourceId,
      kind: 'reported',
      fetchedAt: '2026-11-21T12:00:00.000Z' as never,
      asOf: null,
      freshness: 'UNKNOWN',
    },
  });
}

/** Hamis szolgáltató: a `quote` eredményét a teszt adja; a hívásokat számolja. */
function fakeProvider(
  providerId: string,
  outcome: (listingId: ListingId) => Result<Quote>,
  options: { configured?: boolean; covers?: (listingId: ListingId) => Result<true> } = {},
) {
  const calls: string[] = [];
  const provider: MarketDataProvider = {
    info: {
      id: providerId,
      name: providerId,
      kind: 'live',
      configured: options.configured ?? true,
      plan: null,
      coverage: '',
      note: null,
    },
    async getQuote(listingId) {
      calls.push(listingId);
      return outcome(listingId);
    },
  };
  if (options.covers !== undefined) provider.covers = options.covers;
  return { provider, calls };
}

const routerOf = (...providers: MarketDataProvider[]) =>
  createProviderRouter(createProviderRegistry('live', providers));

const runQuote = (router: ReturnType<typeof routerOf>, listing: string) =>
  router.run('quote', marketOfListing(id(listing)), id(listing), (p) => p.getQuote(id(listing)));

describe('ProviderRouter – routing-tábla és fallback (DATA_SOURCES 5.2–5.3)', () => {
  it('US: FMP az első; sikernél az EODHD-t meg sem hívja', async () => {
    const fmp = fakeProvider('fmp', (l) => quoteFrom('fmp', l));
    const eodhd = fakeProvider('eodhd', (l) => quoteFrom('eodhd', l));
    const outcome = await runQuote(routerOf(fmp.provider, eodhd.provider), 'AAPL@XNAS');
    expect(outcome.providerId).toBe('fmp');
    expect(outcome.result.ok && outcome.result.value.provenance.sourceId).toBe('fmp');
    expect(eodhd.calls).toEqual([]);
    expect(outcome.warnings).toEqual([]);
  });

  it.each<[string, AppError]>([
    ['402 / PLAN_LIMIT', AppErrors.unavailable('PLAN_LIMIT', 'FMP csomagkorlát')],
    ['429 / RATE_LIMITED', AppErrors.rateLimited('FMP rate limit', 30)],
    ['QUOTA_EXHAUSTED', AppErrors.unavailable('QUOTA_EXHAUSTED', 'FMP kvóta')],
    ['TIMEOUT', AppErrors.timeout('FMP lassú', 10_000)],
    ['NOT_FOUND', AppErrors.notFound('árfolyam', 'AAPL@XNAS')],
    ['UPSTREAM / INVALID_RESPONSE', AppErrors.upstream('INVALID_RESPONSE', 'hibás', 'fmp')],
  ])('FMP %s → EODHD; a provenance a TÉNYLEGES forrás; figyelmeztetés', async (_name, error) => {
    const fmp = fakeProvider('fmp', () => err(error));
    const eodhd = fakeProvider('eodhd', (l) => quoteFrom('eodhd', l));
    const outcome = await runQuote(routerOf(fmp.provider, eodhd.provider), 'AAPL@XNAS');
    expect(outcome.providerId).toBe('eodhd');
    expect(outcome.result.ok && outcome.result.value.provenance.sourceId).toBe('eodhd');
    expect(outcome.attempts.map((a) => [a.providerId, a.outcome])).toEqual([
      ['fmp', error.kind],
      ['eodhd', 'OK'],
    ]);
    expect(outcome.warnings.at(-1)).toBe('Az adat forrása: eodhd (tartalék forrás).');
  });

  it('bemeneti hiba (VALIDATION) esetén NEM vált tartalékra', async () => {
    const fmp = fakeProvider('fmp', () => err(AppErrors.validation('rossz kérés')));
    const eodhd = fakeProvider('eodhd', (l) => quoteFrom('eodhd', l));
    const outcome = await runQuote(routerOf(fmp.provider, eodhd.provider), 'AAPL@XNAS');
    expect(outcome.result).toMatchObject({ ok: false, error: { kind: 'VALIDATION' } });
    expect(eodhd.calls).toEqual([]);
    expect(allowsFallback(AppErrors.validation('x'))).toBe(false);
  });

  it('EU jegyzés: csak az EODHD van a láncban (az FMP-t meg sem kérdezi)', async () => {
    const fmp = fakeProvider('fmp', (l) => quoteFrom('fmp', l));
    const eodhd = fakeProvider('eodhd', (l) => quoteFrom('eodhd', l));
    const outcome = await runQuote(routerOf(fmp.provider, eodhd.provider), 'VWCE@XETR');
    expect(outcome.providerId).toBe('eodhd');
    expect(fmp.calls).toEqual([]);
  });

  it('nem konfigurált és nem lefedő szolgáltató: hívás nélkül átugorva', async () => {
    const fmp = fakeProvider('fmp', (l) => quoteFrom('fmp', l), { configured: false });
    const eodhd = fakeProvider('eodhd', (l) => quoteFrom('eodhd', l), {
      covers: () => err(AppErrors.unavailable('NOT_COVERED', 'nem ismert tőzsde')),
    });
    const outcome = await runQuote(routerOf(fmp.provider, eodhd.provider), 'AAPL@XNAS');
    expect(fmp.calls).toEqual([]);
    expect(eodhd.calls).toEqual([]);
    expect(outcome.result).toMatchObject({
      ok: false,
      error: { kind: 'UNAVAILABLE', reason: 'NOT_COVERED' },
    });
  });

  it('mindkettő elbukik → az utolsó hiba megy tovább, minden kísérlet látszik', async () => {
    const fmp = fakeProvider('fmp', () => err(AppErrors.unavailable('PLAN_LIMIT', 'FMP')));
    const eodhd = fakeProvider('eodhd', () =>
      err(AppErrors.unavailable('QUOTA_EXHAUSTED', 'EODHD')),
    );
    const outcome = await runQuote(routerOf(fmp.provider, eodhd.provider), 'AAPL@XNAS');
    expect(outcome.result).toMatchObject({ ok: false, error: { reason: 'QUOTA_EXHAUSTED' } });
    expect(outcome.warnings).toEqual(['fmp: FMP', 'eodhd: EODHD']);
  });

  it('üres lánc: a táblában rögzített ok (nem US kimutatás → PLAN_LIMIT)', async () => {
    const router = routerOf();
    const outcome = await router.run('financialStatements', 'EU', id('SAP@XETR'), (p) =>
      p.getFinancialStatements(id('SAP@XETR'), 'annual'),
    );
    expect(outcome.result).toMatchObject({
      ok: false,
      error: { kind: 'UNAVAILABLE', reason: 'PLAN_LIMIT' },
    });
    expect(router.resolve('etfHoldings', 'US').chain).toEqual([]);
  });

  it('piaci szegmens a MIC-ből', () => {
    expect(marketOfListing(id('SPY@ARCX'))).toBe('US');
    expect(marketOfListing(id('OTP@XBUD'))).toBe('EU');
    expect(marketOfListing(id('7203@XTKS'))).toBe('GLOBAL');
  });
});

describe('napi kvóta (DATA_SOURCES 5.3/3)', () => {
  it('UTC éjfélkor nullázódik; a snapshot a mai állapotot mutatja', () => {
    let now = new Date('2026-11-21T23:59:00Z');
    const quota = createDailyQuota({ providerId: 'eodhd', dailyLimit: 2, now: () => now });
    expect(quota.consume(1).ok).toBe(true);
    expect(quota.consume(1).ok).toBe(true);
    expect(quota.consume(1)).toMatchObject({
      ok: false,
      error: { kind: 'UNAVAILABLE', reason: 'QUOTA_EXHAUSTED' },
    });
    expect(quota.snapshot()).toEqual({
      dailyLimit: 2,
      usedToday: 2,
      remainingToday: 0,
      resetsAt: '2026-11-22T00:00:00.000Z',
    });
    now = new Date('2026-11-22T00:00:01Z');
    expect(quota.consume(1).ok).toBe(true);
    expect(quota.snapshot()?.usedToday).toBe(1);
  });

  it('ismert napi keret nélkül (null) mindent enged, snapshot nincs', () => {
    const quota = createDailyQuota({ providerId: 'x', dailyLimit: null, now: () => new Date() });
    expect(quota.consume(1000).ok).toBe(true);
    expect(quota.snapshot()).toBeNull();
  });

  it('alacsony prioritás (keresés) csak a keret 75%-áig', () => {
    const quota = createDailyQuota({ providerId: 'eodhd', dailyLimit: 20, now: () => new Date() });
    for (let i = 0; i < 15; i += 1) expect(quota.consume(1, 'low').ok).toBe(true);
    const refused = quota.consume(1, 'low');
    expect(refused.ok).toBe(false);
    expect(!refused.ok && refused.error.message).toContain('keresésre szánt rész');
    expect(quota.consume(1, 'normal').ok).toBe(true);
  });
});
