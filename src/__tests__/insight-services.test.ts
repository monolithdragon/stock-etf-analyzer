/**
 * PHASE 14 use case-ek memóriabeli tárolókkal és hamis betöltőkkel (riasztás, univerzum,
 * screener, összehasonlítás, figyelőlista). Itt van (nem az application alatt), mert
 * infrastruktúra-tárolót használ (ESLint rétegszabály).
 */
import {
  createAlertService,
  createCompareListings,
  createGetWatchlistOverview,
  createListLocalUniverse,
  createLoadInstrumentSnapshots,
  createRunScreen,
  type InstrumentSnapshot,
  type LoadInstrumentSnapshot,
  type LoadMarketSummary,
  type SnapshotTarget,
} from '@/application';
import { metric, okValue, snapshot, T0 } from '@/application/insights/testing';
import { AAPL, PORTFOLIO, tx, USD, VWCE } from '@/application/portfolio/testing';
import { AppErrors, err, ok, type AppError, type Result } from '@/domain';
import { InMemoryPortfolioRepository } from '@/infrastructure/mock/in-memory-portfolio-repository';
import {
  createInMemoryAlertRuleRepository,
  createInMemoryWatchlistRepository,
} from '@/infrastructure/storage/in-memory-stores';

const clock = { now: () => new Date(T0) };
let seq = 0;
const ids = { next: (prefix: string) => `${prefix}-${(seq += 1)}` };

function fakeLoader(map: Record<string, InstrumentSnapshot>) {
  const calls: SnapshotTarget[] = [];
  const load: LoadInstrumentSnapshot = async (target) => {
    calls.push(target);
    const s = map[target.listingId];
    return s === undefined
      ? err(AppErrors.notFound('pillanatkép', target.listingId))
      : (ok(s) as Result<InstrumentSnapshot, AppError>);
  };
  return { load, calls };
}

function fakeSummary(prices: Record<string, number>) {
  const calls: string[] = [];
  const load: LoadMarketSummary = async (listingId) => {
    calls.push(listingId);
    const p = prices[listingId];
    return {
      listingId,
      price:
        p === undefined
          ? { status: 'MISSING', reason: 'nincs ár' }
          : okValue(p, { currency: 'USD' as never }),
      dayChange: { status: 'MISSING', reason: 'nincs' },
    };
  };
  return { load, calls };
}

describe('AlertService', () => {
  function setup() {
    const repository = createInMemoryAlertRuleRepository();
    const snapshots = fakeLoader({
      'A@XNAS': snapshot('A@XNAS', 'stock', { metrics: [metric('pe', okValue(30), 'multiple')] }),
    });
    const summary = fakeSummary({ 'A@XNAS': 120, 'B@XNAS': 50 });
    const service = createAlertService({
      repository,
      loadSnapshot: snapshots.load,
      loadMarketSummary: summary.load,
      clock,
      ids,
    });
    return { repository, service, snapshots, summary };
  }

  it('tartósan menti a szabályt; érvénytelen szabály VALIDATION hibát ad', async () => {
    const { service } = setup();
    const added = await service.add({
      listingId: 'A@XNAS',
      kind: 'stock',
      metric: 'price',
      comparator: 'above',
      threshold: 100,
      currency: 'usd',
    });
    expect(added.ok).toBe(true);
    if (added.ok) expect(added.value.currency).toBe('USD');
    const bad = await service.add({
      listingId: 'A@XNAS',
      kind: 'stock',
      metric: 'ter',
      comparator: 'below',
      threshold: 0.002,
    });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.error.kind).toBe('VALIDATION');
    const list = await service.list();
    expect(list.ok && list.value).toHaveLength(1);
  });

  it('ár-szabályhoz NEM tölt elemzést (kvótakímélés); P/E-hez igen', async () => {
    const { service, snapshots, summary } = setup();
    await service.add({
      listingId: 'B@XNAS',
      kind: 'stock',
      metric: 'price',
      comparator: 'below',
      threshold: 60,
      currency: 'USD',
    });
    await service.add({
      listingId: 'A@XNAS',
      kind: 'stock',
      metric: 'pe',
      comparator: 'above',
      threshold: 25,
    });
    const report = await service.checkNow();
    expect(report.ok).toBe(true);
    if (!report.ok) return;
    expect(report.value.analysesLoaded).toBe(1);
    expect(snapshots.calls.map((c) => c.listingId)).toEqual(['A@XNAS']);
    expect(summary.calls).toEqual(['B@XNAS']);
    expect(report.value.results.map((r) => r.status)).toEqual(['TRIGGERED', 'TRIGGERED']);
    expect(report.value.newlyTriggered).toHaveLength(2);
    // Második ellenőrzés: már nem „újonnan teljesült” (tárolt utolsó állapot)
    const again = await service.checkNow();
    expect(again.ok && again.value.newlyTriggered).toHaveLength(0);
  });

  it('kikapcsolt szabály nem értékelődik ki; betöltési hiba → NOT_EVALUABLE', async () => {
    const { service } = setup();
    const a = await service.add({
      listingId: 'A@XNAS',
      kind: 'stock',
      metric: 'price',
      comparator: 'above',
      threshold: 1,
      currency: 'USD',
    });
    await service.add({
      listingId: 'Z@XNAS',
      kind: 'stock',
      metric: 'pe',
      comparator: 'above',
      threshold: 1,
    });
    if (!a.ok) throw new Error();
    await service.setEnabled(a.value.id, false);
    const report = await service.checkNow();
    if (!report.ok) throw new Error();
    expect(report.value.results).toHaveLength(1);
    expect(report.value.results[0]).toMatchObject({ listingId: 'Z@XNAS', status: 'NOT_EVALUABLE' });
    expect((await service.setEnabled('nincs', true)).ok).toBe(false);
  });

  it('törlés', async () => {
    const { service } = setup();
    const a = await service.add({
      listingId: 'A@XNAS',
      kind: 'stock',
      metric: 'price',
      comparator: 'above',
      threshold: 1,
      currency: 'USD',
    });
    if (!a.ok) throw new Error();
    await service.remove(a.value.id);
    const list = await service.list();
    expect(list.ok && list.value).toEqual([]);
  });
});

describe('lokális univerzum és screener', () => {
  it('figyelőlista + portfólió; a portfólió típusa a profilból, ismeretlennél nem találgat', async () => {
    const portfolioRepository = new InMemoryPortfolioRepository();
    await portfolioRepository.savePortfolio(PORTFOLIO);
    await portfolioRepository.addTransaction(tx.buy(AAPL, '2026-01-02', 1, 100, USD));
    await portfolioRepository.addTransaction(tx.buy(VWCE, '2026-01-02', 1, 100, USD));
    await portfolioRepository.addTransaction(tx.buy('ZZZ@XNAS' as never, '2026-01-02', 1, 1, USD));
    const watchlistRepository = createInMemoryWatchlistRepository([
      { listingId: 'AAPL@XNAS', name: 'Apple', kind: 'stock' },
    ]);
    const universe = createListLocalUniverse({
      watchlistRepository,
      portfolioRepository,
      getInstrumentProfile: async (id) =>
        id === VWCE ? (ok({ kindHint: 'etf' }) as never) : err(AppErrors.notFound('profil', id)),
    });
    const listed = await universe();
    expect(listed.ok && listed.value).toEqual([
      { listingId: AAPL, kind: 'stock' },
      { listingId: VWCE, kind: 'etf' },
      { listingId: 'ZZZ@XNAS', kind: 'unknown' },
    ]);
  });

  it('a screener csak a szűrt típust tölti be; a többi okkal kimarad', async () => {
    const loader = fakeLoader({
      'S@XNAS': snapshot('S@XNAS', 'stock', { metrics: [metric('pe', okValue(10), 'multiple')] }),
    });
    const run = createRunScreen({
      listUniverse: async () =>
        ok([
          { listingId: 'S@XNAS', kind: 'stock' },
          { listingId: 'E@XETR', kind: 'etf' },
          { listingId: 'U@XNAS', kind: 'unknown' },
          { listingId: 'X@XNAS', kind: 'stock' },
        ]),
      loadSnapshots: createLoadInstrumentSnapshots(loader.load),
    });
    const result = await run({
      universe: 'stock',
      criteria: [{ fieldId: 'pe', operator: 'lte', value: 15 }],
    });
    if (!result.ok) throw new Error(result.error.message);
    expect(loader.calls.map((c) => c.listingId)).toEqual(['S@XNAS', 'X@XNAS']);
    expect(result.value.matches.map((m) => m.listingId)).toEqual(['S@XNAS']);
    expect(result.value.skipped.map((s) => s.listingId)).toEqual(['E@XETR', 'U@XNAS', 'X@XNAS']);
    const invalid = await run({ universe: 'stock', criteria: [] });
    expect(invalid.ok).toBe(false);
  });
});

describe('összehasonlítás és figyelőlista-áttekintés', () => {
  it('a betölthetetlen elem kimarad; ha így kevés marad, érthető VALIDATION hiba', async () => {
    const loader = fakeLoader({ 'A@XNAS': snapshot('A@XNAS', 'stock') });
    const compare = createCompareListings({
      loadSnapshots: createLoadInstrumentSnapshots(loader.load),
    });
    const result = await compare([
      { listingId: 'A@XNAS', kind: 'stock' },
      { listingId: 'Z@XNAS', kind: 'stock' },
    ]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toMatch(/Nem betölthető: Z@XNAS/);
  });

  it('két betölthető elemnél összehasonlít; duplikált cél egyszer töltődik', async () => {
    const loader = fakeLoader({
      'A@XNAS': snapshot('A@XNAS', 'stock'),
      'B@XNAS': snapshot('B@XNAS', 'stock'),
    });
    const compare = createCompareListings({
      loadSnapshots: createLoadInstrumentSnapshots(loader.load),
    });
    const result = await compare([
      { listingId: 'A@XNAS', kind: 'stock' },
      { listingId: 'A@XNAS', kind: 'stock' },
      { listingId: 'B@XNAS', kind: 'stock' },
    ]);
    expect(result.ok).toBe(true);
    expect(loader.calls).toHaveLength(2);
  });

  it('áttekintés: tételenként ár, hiánynál az ok', async () => {
    const summary = fakeSummary({ 'A@XNAS': 10 });
    const overview = createGetWatchlistOverview({ loadMarketSummary: summary.load });
    const rows = await overview([
      { listingId: 'A@XNAS', name: null, kind: 'stock' },
      { listingId: 'B@XNAS', name: null, kind: 'stock' },
    ]);
    expect(rows[0]?.market.price.status).toBe('OK');
    expect(rows[1]?.market.price).toEqual({ status: 'MISSING', reason: 'nincs ár' });
  });
});
