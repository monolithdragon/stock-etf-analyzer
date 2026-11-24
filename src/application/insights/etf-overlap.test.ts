import {
  analyzeEtfOverlap,
  DOUBLE_COUNT_NOTE,
  MAX_SNAPSHOT_GAP_DAYS,
  stockWeightInEtf,
} from './etf-overlap';
import { holdings, snapshot } from './testing';

const AAPL = 'US0378331005';
const MSFT = 'US5949181045';
const NVDA = 'US67066G1040';

const etf = (id: string, h: ReturnType<typeof holdings>) => snapshot(id, 'etf', { holdings: h });

describe('analyzeEtfOverlap', () => {
  it('azonos dátum: Σ min(w_A, w_B), közös súlyok külön, 50/50 keverék egyszer számol', () => {
    const a = etf(
      'A@XETR',
      holdings('2026-10-31', [
        { isin: AAPL, weight: 0.06 },
        { isin: MSFT, weight: 0.05 },
        { isin: NVDA, weight: 0.04 },
      ]),
    );
    const b = etf(
      'B@XETR',
      holdings('2026-10-31', [
        { isin: AAPL, weight: 0.1 },
        { isin: MSFT, weight: 0.02 },
      ]),
    );
    const r = analyzeEtfOverlap(a, b);
    expect(r.status).toBe('OK');
    expect(r.sameDate).toBe(true);
    expect(r.overlap?.overlapWeight).toBeCloseTo(0.06 + 0.02, 10);
    expect(r.commonWeightInA).toBeCloseTo(0.11, 10);
    expect(r.commonWeightInB).toBeCloseTo(0.12, 10);
    // 50/50: AAPL (0.06+0.1)/2 + MSFT (0.05+0.02)/2 = 0.115 – NEM 0.11 + 0.12 = 0.23
    expect(r.equalMixCommonExposure).toBeCloseTo(0.115, 10);
    expect(r.notes).toContain(DOUBLE_COUNT_NOTE);
    expect(r.isLowerBound).toBe(false);
    expect(r.a.asOf).toBe('2026-10-31');
    expect(r.b.asOf).toBe('2026-10-31');
  });

  it('ugyanaz az ISIN egy alapon belül többször: összevonva, nem duplázva', () => {
    const a = etf(
      'A@XETR',
      holdings('2026-10-31', [
        { isin: AAPL, weight: 0.03 },
        { isin: AAPL, weight: 0.03 },
      ]),
    );
    const b = etf('B@XETR', holdings('2026-10-31', [{ isin: AAPL, weight: 0.05 }]));
    const r = analyzeEtfOverlap(a, b);
    expect(r.overlap?.commonCount).toBe(1);
    expect(r.overlap?.overlapWeight).toBeCloseTo(0.05, 10);
  });

  it(`kompatibilis dátum (≤ ${MAX_SNAPSHOT_GAP_DAYS} nap): számol, de jelzi az eltérést`, () => {
    const a = etf('A@XETR', holdings('2026-10-31', [{ isin: AAPL, weight: 0.05 }]));
    const b = etf('B@XETR', holdings('2026-10-15', [{ isin: AAPL, weight: 0.05 }]));
    const r = analyzeEtfOverlap(a, b);
    expect(r.status).toBe('OK');
    expect(r.dateGapDays).toBe(16);
    expect(r.sameDate).toBe(false);
    expect(r.notes.join(' ')).toMatch(/16 nappal/);
  });

  it('holdings dátumeltérés > 31 nap: NEM számol átfedést, mindkét dátumot mutatja', () => {
    const a = etf('A@XETR', holdings('2026-10-31', [{ isin: AAPL, weight: 0.05 }]));
    const b = etf('B@XETR', holdings('2026-06-30', [{ isin: AAPL, weight: 0.05 }]));
    const r = analyzeEtfOverlap(a, b);
    expect(r.status).toBe('INCOMPATIBLE_DATES');
    expect(r.overlap).toBeNull();
    expect(r.commonWeightInA).toBeNull();
    expect(r.reason).toMatch(/2026-10-31 vs 2026-06-30/);
    expect(r.a.asOf).toBe('2026-10-31');
    expect(r.b.asOf).toBe('2026-06-30');
  });

  it('beállítható tűrés', () => {
    const a = etf('A@XETR', holdings('2026-10-31', [{ isin: AAPL, weight: 0.05 }]));
    const b = etf('B@XETR', holdings('2026-10-21', [{ isin: AAPL, weight: 0.05 }]));
    expect(analyzeEtfOverlap(a, b, { maxGapDays: 5 }).status).toBe('INCOMPATIBLE_DATES');
  });

  it('hiányzó holdings → MISSING az okkal', () => {
    const a = etf('A@XETR', holdings('2026-10-31', [{ isin: AAPL, weight: 0.05 }]));
    const b = snapshot('B@XETR', 'etf');
    const r = analyzeEtfOverlap(a, b);
    expect(r.status).toBe('MISSING');
    expect(r.reason).toMatch(/B@XETR: nincs holdings/);
  });

  it('részleges lista → alsó becslés; ISIN nélküli tétel nem párosítható', () => {
    const a = etf(
      'A@XETR',
      holdings(
        '2026-10-31',
        [
          { isin: AAPL, weight: 0.05 },
          { isin: null, weight: 0.02 },
        ],
        'partial',
      ),
    );
    const b = etf('B@XETR', holdings('2026-10-31', [{ isin: AAPL, weight: 0.04 }]));
    const r = analyzeEtfOverlap(a, b);
    expect(r.isLowerBound).toBe(true);
    expect(r.overlap?.unmatchableWeightA).toBeCloseTo(0.02, 10);
    expect(r.notes.join(' ')).toMatch(/alsó becslés/);
  });

  it('nem ETF vagy önmaga → NOT_APPLICABLE / INVALID_INPUT', () => {
    const a = etf('A@XETR', holdings('2026-10-31', [{ isin: AAPL, weight: 0.05 }]));
    expect(analyzeEtfOverlap(a, snapshot('S@XNAS', 'stock')).status).toBe('NOT_APPLICABLE');
    expect(analyzeEtfOverlap(a, a).status).toBe('INVALID_INPUT');
  });
});

describe('stockWeightInEtf', () => {
  const full = etf('E@XETR', holdings('2026-10-31', [{ isin: AAPL, weight: 0.07 }]));

  it('ISIN-egyezés → a súly, a holdings dátumával', () => {
    const w = stockWeightInEtf(snapshot('AAPL@XNAS', 'stock', { isin: AAPL }), full);
    expect(w.status).toBe('OK');
    if (w.status === 'OK') {
      expect(w.value).toBeCloseTo(0.07, 10);
      expect(w.provenance.asOf).toBe('2026-10-31');
    }
  });

  it('teljes listán nem szereplő részvény → valódi 0', () => {
    const w = stockWeightInEtf(snapshot('M@XNAS', 'stock', { isin: MSFT }), full);
    expect(w).toMatchObject({ status: 'OK', value: 0 });
  });

  it('részleges listán nem szereplő → MISSING (nem 0)', () => {
    const partial = etf(
      'E@XETR',
      holdings('2026-10-31', [{ isin: AAPL, weight: 0.07 }], 'partial'),
    );
    expect(stockWeightInEtf(snapshot('M@XNAS', 'stock', { isin: MSFT }), partial).status).toBe(
      'MISSING',
    );
  });

  it('ismeretlen ISIN vagy hiányzó holdings → MISSING; név alapján nem párosít', () => {
    expect(stockWeightInEtf(snapshot('X@XNAS', 'stock'), full).status).toBe('MISSING');
    expect(
      stockWeightInEtf(snapshot('A@XNAS', 'stock', { isin: AAPL }), snapshot('E@XETR', 'etf'))
        .status,
    ).toBe('MISSING');
  });
});
