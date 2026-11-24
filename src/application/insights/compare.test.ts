import { compareInstruments, COMPARISON_METRICS, MAX_COMPARE } from './compare';
import { holdings, metric, missing, okValue, snapshot } from './testing';

function rowIds(result: ReturnType<typeof compareInstruments>) {
  if (!result.ok) throw new Error(result.error.message);
  return result.value.rows.map((r) => r.metric.id);
}

describe('compareInstruments – típus szerinti szűrés', () => {
  it('részvény–részvény: P/E megjelenik, ETF-mutató (TER) nem', () => {
    const a = snapshot('A@XNAS', 'stock', { metrics: [metric('pe', okValue(15), 'multiple')] });
    const b = snapshot('B@XNAS', 'stock', { metrics: [metric('pe', okValue(25), 'multiple')] });
    const result = compareInstruments([a, b]);
    const ids = rowIds(result);
    expect(ids).toContain('pe');
    expect(ids).not.toContain('ter');
    if (!result.ok) return;
    expect(result.value.mode).toBe('stock');
    expect(result.value.rows.find((r) => r.metric.id === 'pe')?.favorable).toBe('A@XNAS');
    expect(result.value.excluded.find((e) => e.id === 'ter')?.reason).toMatch(/Csak ETF-re/);
  });

  it('ETF–ETF: TER megjelenik, vállalati P/E soha', () => {
    const a = snapshot('E1@XETR', 'etf', {
      currency: 'EUR',
      metrics: [metric('ter', okValue(0.002)), metric('pe', okValue(10), 'multiple')],
    });
    const b = snapshot('E2@XETR', 'etf', {
      currency: 'EUR',
      metrics: [metric('ter', okValue(0.007))],
    });
    const result = compareInstruments([a, b]);
    const ids = rowIds(result);
    expect(ids).toContain('ter');
    expect(ids).not.toContain('pe');
    if (!result.ok) return;
    expect(result.value.rows.find((r) => r.metric.id === 'ter')?.favorable).toBe('E1@XETR');
  });

  it('vegyes (részvény–ETF): csak a közös piaci adatok; score nem összemérhető', () => {
    const stock = snapshot('A@XNAS', 'stock', { metrics: [metric('pe', okValue(15), 'multiple')] });
    const etf = snapshot('E@XNAS', 'etf', { metrics: [metric('ter', okValue(0.001))] });
    const result = compareInstruments([stock, etf]);
    expect(rowIds(result)).toEqual(['price', 'dayChange']);
    if (!result.ok) return;
    expect(result.value.mode).toBe('mixed');
    expect(result.value.excluded.find((e) => e.id === 'totalScore')?.reason).toMatch(
      /score-rendszer/,
    );
    expect(result.value.exposures).toHaveLength(1);
    expect(result.value.notes.join(' ')).toMatch(/nem hasonlítható/);
  });

  it('minden katalógusmutató kizárólag a deklarált típusokra érvényes', () => {
    for (const def of COMPARISON_METRICS) expect(def.appliesTo.length).toBeGreaterThan(0);
  });
});

describe('compareInstruments – összehasonlíthatósági feltételek', () => {
  it('eltérő pénznemű ár nem hasonlítható (átváltás nélkül)', () => {
    const a = snapshot('A@XNAS', 'stock', { currency: 'USD' });
    const b = snapshot('B@XETR', 'stock', { currency: 'EUR' });
    const result = compareInstruments([a, b]);
    expect(rowIds(result)).not.toContain('price');
    if (!result.ok) return;
    expect(result.value.excluded.find((e) => e.id === 'price')?.reason).toMatch(/USD, EUR/);
  });

  it('ETF-hozam csak total return alapon: az egyik csak árhozam → kizárva', () => {
    const w = { start: '2025-11-24' as never, end: '2026-11-23' as never };
    const a = snapshot('E1@XETR', 'etf', {
      metrics: [metric('annualizedTotalReturn', okValue(0.08), 'ratio', w)],
    });
    const b = snapshot('E2@XETR', 'etf', {
      returnBasis: 'price_return_only',
      metrics: [metric('annualizedTotalReturn', okValue(0.05), 'ratio', w)],
    });
    const result = compareInstruments([a, b]);
    expect(rowIds(result)).not.toContain('annualizedTotalReturn');
    if (!result.ok) return;
    expect(result.value.excluded.find((e) => e.id === 'annualizedTotalReturn')?.reason).toMatch(
      /total return/,
    );
  });

  it('eltérő mérési ablak (időszakos hozam) → kizárva; ±7 nap belül megmarad', () => {
    const a = snapshot('E1@XETR', 'etf', {
      metrics: [
        metric('totalReturn', okValue(0.1), 'ratio', {
          start: '2025-01-02' as never,
          end: '2026-11-20' as never,
        }),
      ],
    });
    const far = snapshot('E2@XETR', 'etf', {
      metrics: [
        metric('totalReturn', okValue(0.1), 'ratio', {
          start: '2025-11-20' as never,
          end: '2026-11-20' as never,
        }),
      ],
    });
    const near = snapshot('E3@XETR', 'etf', {
      metrics: [
        metric('totalReturn', okValue(0.2), 'ratio', {
          start: '2025-01-06' as never,
          end: '2026-11-23' as never,
        }),
      ],
    });
    expect(rowIds(compareInstruments([a, far]))).not.toContain('totalReturn');
    expect(rowIds(compareInstruments([a, near]))).toContain('totalReturn');
  });

  it('eltérő pénzügyi év → a sor marad, megjegyzéssel', () => {
    const period = (y: number) => ({
      fiscalYear: y,
      fiscalPeriod: 'FY',
      start: `${y}-01-01`,
      end: `${y}-12-31`,
    });
    const a = snapshot('A@XNAS', 'stock', {
      metrics: [metric('roic', okValue(0.2, { period: period(2025) as never }))],
    });
    const b = snapshot('B@XNAS', 'stock', {
      metrics: [metric('roic', okValue(0.1, { period: period(2024) as never }))],
    });
    const result = compareInstruments([a, b]);
    if (!result.ok) throw new Error();
    expect(result.value.rows.find((r) => r.metric.id === 'roic')?.notes.join(' ')).toMatch(
      /Eltérő jelentési időszak/,
    );
  });
});

describe('compareInstruments – eltérő adatlefedettség', () => {
  it('csak egy instrumentumnál elérhető mutató kizárva, indokkal', () => {
    const a = snapshot('A@XNAS', 'stock', { metrics: [metric('roic', okValue(0.2))] });
    const b = snapshot('B@XNAS', 'stock', { metrics: [metric('roic', missing('nincs EBIT'))] });
    const result = compareInstruments([a, b]);
    expect(rowIds(result)).not.toContain('roic');
    if (!result.ok) return;
    expect(result.value.excluded.find((e) => e.id === 'roic')?.reason).toMatch(/Csak 1/);
  });

  it('3-ból 2 értéknél a sor megmarad; a hiányzó cella N/A az okkal (nem 0)', () => {
    const a = snapshot('A@XNAS', 'stock', { metrics: [metric('roic', okValue(0.2))] });
    const b = snapshot('B@XNAS', 'stock', { metrics: [metric('roic', okValue(0.1))] });
    const c = snapshot('C@XNAS', 'stock', { metrics: [metric('roic', missing('nincs EBIT'))] });
    const result = compareInstruments([a, b, c]);
    if (!result.ok) throw new Error();
    const row = result.value.rows.find((r) => r.metric.id === 'roic')!;
    expect(row.cells[2]?.value).toEqual({ status: 'MISSING', reason: 'nincs EBIT' });
    expect(row.notes.join(' ')).toMatch(/N\/A, nem 0/);
  });

  it('a pillanatképben nem szereplő mutató MISSING, nem 0', () => {
    const a = snapshot('A@XNAS', 'stock');
    const b = snapshot('B@XNAS', 'stock');
    const result = compareInstruments([a, b]);
    if (!result.ok) throw new Error();
    expect(result.value.rows.some((r) => r.metric.id === 'pe')).toBe(false);
  });

  it('holtversenynél nincs „kedvezőbb” jelölés', () => {
    const a = snapshot('A@XNAS', 'stock', { metrics: [metric('pe', okValue(15), 'multiple')] });
    const b = snapshot('B@XNAS', 'stock', { metrics: [metric('pe', okValue(15), 'multiple')] });
    const result = compareInstruments([a, b]);
    if (!result.ok) throw new Error();
    expect(result.value.rows.find((r) => r.metric.id === 'pe')?.favorable).toBeNull();
  });
});

describe('compareInstruments – bemenet-validáció és ETF-átfedés', () => {
  it('1 vagy túl sok instrumentum, illetve duplikátum → VALIDATION', () => {
    const a = snapshot('A@XNAS', 'stock');
    expect(compareInstruments([a]).ok).toBe(false);
    expect(compareInstruments([a, a]).ok).toBe(false);
    const many = Array.from({ length: MAX_COMPARE + 1 }, (_, i) => snapshot(`S${i}@XNAS`, 'stock'));
    const result = compareInstruments(many);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe('VALIDATION');
  });

  it('két ETF-nél minden párra fut az átfedés', () => {
    const h = holdings('2026-10-31', [{ isin: 'US0378331005', weight: 0.05 }]);
    const etfs = ['E1@XETR', 'E2@XETR', 'E3@XETR'].map((id) =>
      snapshot(id, 'etf', { holdings: h }),
    );
    const result = compareInstruments(etfs);
    if (!result.ok) throw new Error();
    expect(result.value.overlaps).toHaveLength(3);
    expect(result.value.overlaps.every((o) => o.status === 'OK')).toBe(true);
  });
});
