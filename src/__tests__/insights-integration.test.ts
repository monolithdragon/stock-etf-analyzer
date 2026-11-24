/**
 * PHASE 14 integráció a VALÓDI composition rooton (demó adatmód, rögzített órával):
 * pillanatkép = ugyanazok a számok, mint az értékelésben (nincs duplikált logika), napi változás
 * az ártörténetből, vegyes összehasonlítás, screener a figyelőlistán, riasztás tárolása és
 * kiértékelése, export a riasztásokkal.
 */
import type { AppServices } from '@/application';
import { createAppServices } from '@/config/container';

const clock = { now: () => new Date('2026-11-21T12:00:00.000Z') };

function services(): AppServices {
  return createAppServices({ dataMode: 'mock', apiBaseUrl: null }, { clock });
}

describe('pillanatkép a meglévő use case-ekből', () => {
  it('részvény: a mutatók azonosak az értékelés feature-jeivel; napi változás számított', async () => {
    const s = services();
    const snap = await s.loadInstrumentSnapshot({ listingId: 'DEMO@XNAS', kind: 'stock' });
    const evaluated = await s.evaluateStock('DEMO@XNAS');
    if (!snap.ok || !evaluated.ok) throw new Error('betöltés');
    for (const feature of evaluated.value.evaluation.features) {
      if (feature.kind !== 'numeric') continue;
      expect(snap.value.metrics[feature.id]?.value).toEqual(feature.value);
    }
    expect(snap.value.score?.totalScore).toBe(evaluated.value.evaluation.score.totalScore);
    expect(snap.value.price).toMatchObject({ status: 'OK', value: 100 });
    expect(snap.value.dayChange.status).toBe('OK');
    if (snap.value.dayChange.status === 'OK') {
      expect(snap.value.dayChange.value).toBeCloseTo(100 / 99 - 1, 10);
      expect(snap.value.dayChange.provenance.kind).toBe('mock');
      expect(snap.value.dayChange.provenance.inputs).toEqual([
        'close@2026-11-19',
        'close@2026-11-20',
      ]);
    }
    expect(snap.value.holdings.status).toBe('NOT_APPLICABLE');
  });

  it('ETF: holdings nélkül (free/demó) a hiány oka megmarad; DCF nem alkalmazható', async () => {
    const snap = await services().loadInstrumentSnapshot({
      listingId: 'DEMOETF@XETR',
      kind: 'etf',
    });
    if (!snap.ok) throw new Error(snap.error.message);
    expect(snap.value.kind).toBe('etf');
    expect(snap.value.holdings.status).not.toBe('OK');
    expect(snap.value.valuation.status).toBe('NOT_APPLICABLE');
    expect(snap.value.metrics.ter?.value.status).not.toBe('OK');
  });

  it('ismeretlen típusnál nem találgat', async () => {
    const snap = await services().loadInstrumentSnapshot({
      listingId: 'DEMO@XNAS',
      kind: 'unknown',
    });
    expect(snap.ok).toBe(false);
    if (!snap.ok) expect(snap.error.kind).toBe('VALIDATION');
  });
});

describe('összehasonlítás, screener, figyelőlista', () => {
  it('részvény–ETF: csak a közös mutató (napi változás); ár eltérő pénznem miatt kizárva', async () => {
    const result = await services().compareListings([
      { listingId: 'DEMO@XNAS', kind: 'stock' },
      { listingId: 'DEMOETF@XETR', kind: 'etf' },
    ]);
    if (!result.ok) throw new Error(result.error.message);
    const { comparison } = result.value;
    expect(comparison.mode).toBe('mixed');
    expect(comparison.rows.map((r) => r.metric.id)).toEqual(['dayChange']);
    expect(comparison.excluded.find((e) => e.id === 'price')?.reason).toMatch(/USD, EUR/);
    expect(comparison.excluded.find((e) => e.id === 'pe')?.reason).toMatch(/részvényre/);
    expect(comparison.exposures[0]?.weight.status).toBe('MISSING');
  });

  it('screener a figyelőlista univerzumán: a találat bizonyítéka a pillanatkép értéke', async () => {
    const s = services();
    await s.watchlist.add({ listingId: 'DEMO@XNAS', name: 'Demo Corp', kind: 'stock' });
    await s.watchlist.add({ listingId: 'DEMOETF@XETR', name: 'Demo ETF', kind: 'etf' });
    const snap = await s.loadInstrumentSnapshot({ listingId: 'DEMO@XNAS', kind: 'stock' });
    if (!snap.ok) throw new Error();
    const pe = snap.value.metrics.pe?.value;
    const threshold = pe?.status === 'OK' ? pe.value + 1 : 1000;
    const result = await s.runScreen({
      universe: 'stock',
      criteria: [{ fieldId: 'pe', operator: 'lte', value: threshold }],
    });
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value.skipped.map((x) => x.listingId)).toEqual(['DEMOETF@XETR']);
    const rows = [...result.value.matches, ...result.value.notEvaluable];
    expect(rows.map((r) => r.listingId)).toEqual(['DEMO@XNAS']);
    expect(rows[0]?.evidence[0]?.value).toEqual(pe);
  });

  it('figyelőlista-áttekintés: ár és napi változás jegyzésenként', async () => {
    const rows = await services().getWatchlistOverview([
      { listingId: 'DEMOETF@XETR', name: null, kind: 'etf' },
      { listingId: 'NOPE@XNAS', name: null, kind: 'stock' },
    ]);
    expect(rows[0]?.market.price).toMatchObject({ status: 'OK', value: 50 });
    expect(rows[0]?.market.dayChange.status).toBe('OK');
    expect(rows[1]?.market.price.status).toBe('MISSING');
  });
});

describe('riasztás a valódi szolgáltatással', () => {
  it('ár-riasztás kiértékelése, tartós állapot, export és teljes törlés', async () => {
    const s = services();
    const added = await s.alerts.add({
      listingId: 'DEMO@XNAS',
      kind: 'stock',
      metric: 'price',
      comparator: 'above',
      threshold: 90,
      currency: 'USD',
    });
    expect(added.ok).toBe(true);
    const report = await s.alerts.checkNow();
    if (!report.ok) throw new Error(report.error.message);
    expect(report.value.results[0]).toMatchObject({ status: 'TRIGGERED', newlyTriggered: true });
    expect(report.value.analysesLoaded).toBe(0);
    const listed = await s.alerts.list();
    expect(listed.ok && listed.value[0]?.lastState).toBe('TRIGGERED');
    const exported = await s.localData.exportUserData();
    expect(exported.ok && exported.value.alerts).toHaveLength(1);
    await s.localData.deleteAllLocalData();
    const after = await s.alerts.list();
    expect(after.ok && after.value).toEqual([]);
  });

  it('P/E-riasztás teljes elemzésből', async () => {
    const s = services();
    await s.alerts.add({
      listingId: 'DEMO@XNAS',
      kind: 'stock',
      metric: 'pe',
      comparator: 'above',
      threshold: 0.5,
    });
    const report = await s.alerts.checkNow();
    if (!report.ok) throw new Error(report.error.message);
    expect(report.value.analysesLoaded).toBe(1);
    expect(['TRIGGERED', 'NOT_EVALUABLE']).toContain(report.value.results[0]?.status);
  });
});
