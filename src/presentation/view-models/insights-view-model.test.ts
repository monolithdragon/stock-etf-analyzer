import { analyzeEtfOverlap, compareInstruments, runScreener } from '@/application';
import { holdings, metric, missing, okValue, snapshot, T0 } from '@/application/insights/testing';

import {
  alertRuleText,
  buildAlertRow,
  buildComparisonViewModel,
  buildOverlapViewModel,
  buildScreenerViewModel,
  buildWatchlistRow,
  parseThresholdInput,
  valuationText,
} from './insights-view-model';

describe('küszöb-bevitel', () => {
  it('százalékos mezőnél a bevitt % → tört; tizedesvessző; hibás → NaN', () => {
    expect(parseThresholdInput('0,25', 'ratio')).toBeCloseTo(0.0025, 10);
    expect(parseThresholdInput('15', 'multiple')).toBe(15);
    expect(parseThresholdInput('abc', 'ratio')).toBeNaN();
  });
});

describe('figyelőlista-sor', () => {
  const item = { listingId: 'A@XNAS', name: 'Alfa', kind: 'stock' as const };

  it('ár, előjeles napi változás, frissesség és utolsó frissítés', () => {
    const row = buildWatchlistRow(item, {
      listingId: 'A@XNAS',
      price: okValue(100, { currency: 'USD' as never, freshness: 'STALE' }),
      dayChange: okValue(-0.0123, { kind: 'calculated' }),
    });
    expect(row.rows.map((r) => r.text)).toEqual([expect.stringContaining('100'), '-1,23%']);
    expect(row.badges[0]).toMatchObject({ tone: 'warning' });
    expect(row.updatedText).toMatch(/^Frissítve:/);
    expect(row.scoreText).toBeNull();
  });

  it('hiányzó napi változás N/A (nem 0); offline tartalék kiemelve', () => {
    const row = buildWatchlistRow(item, {
      listingId: 'A@XNAS',
      price: okValue(100, { cache: { mode: 'offline_fallback', storedAt: T0 } }),
      dayChange: missing('egy záróár van'),
    });
    expect(row.rows[1]?.text).toBe('N/A');
    expect(row.badges[0]?.label).toMatch(/Offline/);
  });

  it('pillanatképpel: score és értékelési státusz', () => {
    const row = buildWatchlistRow(item, null, snapshot('A@XNAS', 'stock', { score: 62.5 }));
    expect(row.scoreText).toBe('Score: 62,5 / 100 · Tartás');
    expect(row.valuationText).toMatch(/Modellérték közelében/);
    expect(valuationText({ status: 'NOT_APPLICABLE', reason: 'x' })).toMatch(/ETF/);
  });
});

describe('összehasonlítás és átfedés', () => {
  it('csoportosítás, kedvezőbb jelölés, kizártak okkal', () => {
    const a = snapshot('A@XNAS', 'stock', { metrics: [metric('pe', okValue(10), 'multiple')] });
    const b = snapshot('B@XNAS', 'stock', { metrics: [metric('pe', okValue(20), 'multiple')] });
    const result = compareInstruments([a, b]);
    if (!result.ok) throw new Error();
    const vm = buildComparisonViewModel(result.value);
    const pe = vm.groups.find((g) => g.title === 'Értékelés')?.rows.find((r) => r.key === 'pe');
    expect(pe?.cells.map((c) => c.favorable)).toEqual([true, false]);
    expect(pe?.cells[0]?.row.hint).toMatch(/kedvezőbb/);
    expect(vm.excluded.some((e) => e.label === 'TER')).toBe(true);
  });

  it('átfedés: mindkét adatdátum, alsó becslés, nem számolható eset indokkal', () => {
    const ok = analyzeEtfOverlap(
      snapshot('E1', 'etf', {
        holdings: holdings('2026-10-31', [{ isin: 'US0378331005', weight: 0.05 }], 'partial'),
      }),
      snapshot('E2', 'etf', {
        holdings: holdings('2026-10-30', [{ isin: 'US0378331005', weight: 0.04 }]),
      }),
    );
    const vm = buildOverlapViewModel(ok, (id) => id);
    expect(vm.lines.map((l) => l.value)).toEqual(
      expect.arrayContaining([
        expect.stringContaining('2026-10-31'),
        expect.stringContaining('2026-10-30'),
      ]),
    );
    expect(vm.lines.some((l) => /alsó becslés/.test(l.label))).toBe(true);
    const bad = analyzeEtfOverlap(
      snapshot('E1', 'etf', {
        holdings: holdings('2026-10-31', [{ isin: 'US0378331005', weight: 0.05 }]),
      }),
      snapshot('E2', 'etf', {
        holdings: holdings('2026-01-31', [{ isin: 'US0378331005', weight: 0.05 }]),
      }),
    );
    expect(buildOverlapViewModel(bad, (id) => id)).toMatchObject({ ok: false });
  });
});

describe('screener és riasztás', () => {
  it('a bizonyíték-sor tartalmazza a feltételt, az értéket és a státuszt', () => {
    const r = runScreener(
      { universe: 'stock', criteria: [{ fieldId: 'pe', operator: 'lte', value: 20 }] },
      [snapshot('A@XNAS', 'stock', { metrics: [metric('pe', okValue(12), 'multiple')] })],
    );
    const vm = buildScreenerViewModel(r);
    expect(vm.summary).toMatch(/^1 találat/);
    expect(vm.matches[0]?.evidence[0]).toMatchObject({
      label: 'P/E ≤ 20,0x',
      text: '12,0x',
      hint: '✓ megfelel',
    });
  });

  it('riasztás-szöveg és állapot', () => {
    const rule = {
      id: 'r1',
      listingId: 'E@XETR',
      kind: 'etf' as const,
      metric: 'ter' as const,
      comparator: 'below' as const,
      threshold: 0.002,
      currency: null,
      enabled: false,
      createdAt: T0,
      lastState: 'TRIGGERED' as const,
      lastEvaluatedAt: T0,
      lastTriggeredAt: T0,
    };
    expect(alertRuleText(rule)).toBe('TER alatt: 0,2%');
    const row = buildAlertRow(rule, null);
    expect(row.badge?.label).toBe('Teljesült');
    expect(row.lines[0]).toMatch(/Kikapcsolva/);
  });
});
