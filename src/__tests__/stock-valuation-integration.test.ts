/**
 * PHASE 07 integráció: értékelés + DCF VALÓS SEC- és FMP-fixture-ökön.
 *
 *   fixture → [hamis gateway] → analyzeStockFundamentals (PHASE 06) → buildStockValuation
 *
 * A várt DCF-értékeket ZÁRT ALAKÚ képlettel számoljuk a tesztben (nem a `runDcf`-fel), így a
 * bemenet-kiválasztás és az összerakás is ellenőrzött.
 */
import {
  DEFAULT_DCF_SCENARIOS,
  createAnalyzeStockValuation,
  createRecalculateStockValuation,
  type StockValuationAnalysis,
} from '@/application';
import { type CalcResult } from '@/calculations';
import type { FundamentalMetric, Metric, StockFundamentalAnalysis } from '@/domain';
import {
  NOW,
  analyze,
  analyzerFor,
  annualCell,
  clock,
  gatewayFor,
  okValue,
} from '@/testing/stock-analysis-fixtures';

const recalculate = createRecalculateStockValuation({ clock });

function ok<T>(result: CalcResult<T>): T {
  if (result.status !== 'OK') throw new Error(`${result.status}: ${result.reason}`);
  return result.value;
}

function scenario(v: StockValuationAnalysis, id: 'bear' | 'base' | 'bull') {
  const s = v.dcf.scenarios.find((x) => x.id === id);
  if (s === undefined) throw new Error(id);
  return s;
}

/** Zárt alakú DCF konstans növekedéssel (független a motortól). */
function closedFormIv(p: {
  fcf: number;
  g: number;
  years: number;
  r: number;
  gt: number;
  debt: number;
  cash: number;
  shares: number;
}): number {
  let sum = 0;
  for (let t = 1; t <= p.years; t += 1) sum += (p.fcf * (1 + p.g) ** t) / (1 + p.r) ** t;
  const last = p.fcf * (1 + p.g) ** p.years;
  const pvTv = (last * (1 + p.gt)) / (p.r - p.gt) / (1 + p.r) ** p.years;
  return (sum + pvTv - p.debt + p.cash) / p.shares;
}

/** Az éves tábla első oszlopának egy cellája kicserélve (szélsőeset-szimulációhoz). */
function withAnnualValue(
  a: StockFundamentalAnalysis,
  id: string,
  value: Metric<number>,
): StockFundamentalAnalysis {
  const rows = a.periodMetrics.annual.rows.map((row) =>
    row.id !== id
      ? row
      : {
          ...row,
          cells: row.cells.map((c, i): FundamentalMetric => (i === 0 ? { ...c, value } : c)),
        },
  );
  return {
    ...a,
    periodMetrics: { ...a.periodMetrics, annual: { ...a.periodMetrics.annual, rows } },
  };
}

describe('értékelés – AAPL alapfeltevésekkel (valós SEC + FMP fixture)', () => {
  let aapl: StockFundamentalAnalysis;
  let v: StockValuationAnalysis;
  beforeAll(async () => {
    aapl = await analyze('AAPL');
    v = recalculate(aapl);
  });

  it('bemenetek: FY FCF, legfrissebb mérleg, részvényszám, ár – forrással, időszakkal, eredettel', () => {
    const f = v.dcf.inputs.fields;
    expect(f.baseFcf.value).toBe(okValue(annualCell(aapl, 'fcf')));
    expect(f.baseFcf.origin).toBe('calculated');
    expect(f.baseFcf.basis).toContain('FY2026');
    expect(f.totalDebt.value).toBe(80_111_000_000);
    expect(f.cash.value).toBe(okValue(annualCell(aapl, 'cashAndEquivalents')));
    expect(f.sharesOutstanding.value).toBe(okValue(aapl.overview.sharesOutstanding));
    expect(f.marketPrice.value).toBe(342.56);
    expect(f.marketPrice.origin).toBe('stale');
    expect(f.totalDebt.source?.sourceId).toBe('sec-edgar');
    expect(v.dcf.inputs.currency).toBe('USD');
    expect(Object.values(f).every((field) => !field.overridden)).toBe(true);
  });

  it('Base: belső érték = zárt alakú képlet; MOS = (IV − ár) / IV; becslés-jelölés', () => {
    const f = v.dcf.inputs.fields;
    const d = DEFAULT_DCF_SCENARIOS.base;
    const expected = closedFormIv({
      fcf: f.baseFcf.value!,
      g: d.growthRate,
      years: 5,
      r: d.discountRate,
      gt: d.terminalGrowth,
      debt: f.totalDebt.value!,
      cash: f.cash.value!,
      shares: f.sharesOutstanding.value!,
    });
    const base = ok(scenario(v, 'base').result);
    expect(base.intrinsicValuePerShare).toBeCloseTo(expected, 8);
    expect(base.years).toHaveLength(5);
    expect(ok(base.marginOfSafety)).toBeCloseTo((expected - 342.56) / expected, 10);
    expect(v.dcf.provenanceKind).toBe('estimated');
  });

  it('Bear < Base < Bull; a feltevések láthatók és „default” forrásúak', () => {
    const ivs = (['bear', 'base', 'bull'] as const).map(
      (id) => ok(scenario(v, id).result).intrinsicValuePerShare,
    );
    expect(ivs[0]!).toBeLessThan(ivs[1]!);
    expect(ivs[1]!).toBeLessThan(ivs[2]!);
    for (const s of v.dcf.scenarios) {
      expect(s.assumptions.source).toBe('default');
      expect(s.assumptions.explicitYears).toBe(5);
      expect(s.assumptions.discountRate).toBe(DEFAULT_DCF_SCENARIOS[s.id].discountRate);
      expect(s.label).toBe(DEFAULT_DCF_SCENARIOS[s.id].label);
    }
    expect(v.dcf.scenarioNotes).toEqual([]);
  });

  it('nincs hamis pontosság: megjelenítési javaslat 3 értékes jegy / egész %', () => {
    const base = scenario(v, 'base');
    const raw = ok(base.result);
    expect(base.display?.intrinsicValuePerShare).toBe(
      Number(raw.intrinsicValuePerShare.toPrecision(3)),
    );
    expect(base.display?.marginOfSafetyPercent).toBe(Math.round(ok(raw.marginOfSafety) * 100));
  });

  it('kategória a MOS-ból, a használt küszöbbel és nyilatkozattal', () => {
    const cat = ok(scenario(v, 'base').category);
    expect(cat.thresholds).toEqual(v.thresholds.marginOfSafety);
    expect(['DISCOUNT_TO_MODEL', 'NEAR_MODEL', 'PREMIUM_TO_MODEL']).toContain(cat.category);
    expect(v.thresholds.disclaimer).toContain('nem objektív igazságok');
  });

  it('szenzitivitás: 5 × 5 a Base r/g körül; a középső cella = Base belső érték', () => {
    const table = ok(v.dcf.sensitivity.table);
    expect(table.discountRates).toEqual([0.07, 0.08, 0.09, 0.1, 0.11]);
    expect(table.terminalGrowthRates).toEqual([0.015, 0.02, 0.025, 0.03, 0.035]);
    expect(ok(table.rows[2]!.cells[2]!.intrinsicValuePerShare)).toBe(
      ok(scenario(v, 'base').result).intrinsicValuePerShare,
    );
  });

  it('szorzók: a PHASE 06 mutatói + Forward P/E (MISSING, nincs forrás); sávok küszöbbel', () => {
    const pe = v.multiples.bands.find((b) => b.metricId === 'pe');
    expect(pe?.band.status).toBe('OK');
    const fpe = v.multiples.bands.find((b) => b.metricId === 'forwardPe');
    expect(fpe?.band.status).toBe('MISSING');
    expect(v.multiples.metrics.find((m) => m.id === 'forwardPe')?.value.status).toBe('MISSING');
  });

  it('magyarázat: képletek, konvenciók, történeti kontextus, időbélyegek, nyilatkozat', () => {
    expect(v.explanation.formulas.map((f) => f.id)).toEqual(
      expect.arrayContaining(['terminalValue', 'equityValue', 'marginOfSafety']),
    );
    expect(v.explanation.conventions.join(' ')).toContain('D-057');
    expect(v.explanation.conventions.join(' ')).toContain('KI-44');
    expect(v.explanation.context.map((c) => c.label)).toContain('FCF CAGR (3 év)');
    expect(v.generatedAt).toBe(NOW.toISOString());
    expect(v.fundamentalsGeneratedAt).toBe(aapl.generatedAt);
    expect(v.disclaimer).toContain('becslés');
    expect(v.warnings.join(' ')).toContain('Elavult bemenet');
  });
});

describe('értékelés – állítható feltevések és szélsőesetek', () => {
  let aapl: StockFundamentalAnalysis;
  beforeAll(async () => {
    aapl = await analyze('AAPL');
  });

  it('3 éves explicit időszak: minden forgatókönyv 3 év, „user” forrás', () => {
    const v = recalculate(aapl, { explicitYears: 3 });
    for (const s of v.dcf.scenarios) {
      expect(s.assumptions.explicitYears).toBe(3);
      expect(s.assumptions.source).toBe('user');
      expect(ok(s.result).years).toHaveLength(3);
    }
  });

  it('r ≤ g a Base-ben → invalid emberi magyarázattal; a tábla érvényes cellái megmaradnak', () => {
    const v = recalculate(aapl, {
      scenarios: { base: { discountRate: 0.03, terminalGrowth: 0.03 } },
    });
    const base = scenario(v, 'base');
    expect(base.result.status).toBe('INVALID_INPUT');
    expect(base.result.status !== 'OK' && base.result.reason).toContain('Gordon');
    expect(base.category.status).toBe('INVALID_INPUT');
    expect(base.display).toBeNull();
    expect(scenario(v, 'bear').assumptions.source).toBe('default');
    expect(v.dcf.scenarioNotes.join(' ')).toContain('base');
    const cells = ok(v.dcf.sensitivity.table).rows.flatMap((r) => r.cells);
    expect(cells.some((c) => c.intrinsicValuePerShare.status === 'INVALID_INPUT')).toBe(true);
    expect(cells.some((c) => c.intrinsicValuePerShare.status === 'OK')).toBe(true);
  });

  it('egyedi tengelyek és küszöbök; érvénytelen tengely → INVALID_INPUT', () => {
    const v = recalculate(aapl, {
      sensitivity: { discountRates: [0.08, 0.1], terminalGrowthRates: [0.02] },
      marginOfSafetyThresholds: { discountAtLeast: 0.5, premiumBelow: 0.4 },
      multipleBands: {
        pe: { lowBelow: 1, highAbove: 2, higherIsCheaper: false, allowNonPositive: false },
      },
    });
    expect(ok(v.dcf.sensitivity.table).rows).toHaveLength(2);
    expect(v.thresholds.marginOfSafety.discountAtLeast).toBe(0.5);
    const pe = v.multiples.bands.find((b) => b.metricId === 'pe');
    expect(pe && ok(pe.band).band).toBe('HIGH');
    expect(
      recalculate(aapl, { sensitivity: { discountRates: [] } }).dcf.sensitivity.table.status,
    ).toBe('INVALID_INPUT');
    expect(
      scenario(
        recalculate(aapl, { marginOfSafetyThresholds: { discountAtLeast: 0, premiumBelow: 1 } }),
        'base',
      ).category.status,
    ).toBe('INVALID_INPUT');
  });

  it('negatív FY FCF → NOT_MEANINGFUL; normalizált felhasználói FCF-fel fut (user_input)', () => {
    const fcf = annualCell(aapl, 'fcf').value;
    if (fcf.status !== 'OK') throw new Error('setup');
    const negative = withAnnualValue(aapl, 'fcf', { ...fcf, value: -1_000_000_000 });
    const blocked = recalculate(negative);
    expect(scenario(blocked, 'base').result.status).toBe('NOT_MEANINGFUL');
    expect(blocked.dcf.sensitivity.table.status).toBe('OK'); // cellánként N/M

    const fixed = recalculate(negative, { inputOverrides: { baseFcf: 90_000_000_000 } });
    expect(fixed.dcf.inputs.fields.baseFcf).toMatchObject({
      value: 90_000_000_000,
      origin: 'user_input',
      overridden: true,
    });
    expect(fixed.dcf.inputs.fields.baseFcf.notes.join(' ')).toContain('eredeti: -1000000000');
    expect(scenario(fixed, 'base').result.status).toBe('OK');
  });

  it('nem véges felülírás → a bemenet INVALID_INPUT, a DCF nem fut', () => {
    const v = recalculate(aapl, { inputOverrides: { sharesOutstanding: Number.NaN } });
    expect(v.dcf.inputs.fields.sharesOutstanding.status).toBe('INVALID_INPUT');
    expect(scenario(v, 'base').result.status).toBe('INVALID_INPUT');
    expect(v.warnings.join(' ')).toContain('A DCF nem futtatható');
  });

  it('eltérő jegyzési pénznem → a DCF fut, a MOS MISSING (KI-50); azonos pénznemű ár felülírható', () => {
    const adr = { ...aapl, overview: { ...aapl.overview, tradingCurrency: 'EUR' as never } };
    const v = recalculate(adr);
    const base = ok(scenario(v, 'base').result);
    expect(base.marginOfSafety.status).toBe('MISSING');
    expect(base.marginOfSafety.status !== 'OK' && base.marginOfSafety.reason).toContain('KI-50');
    expect(scenario(v, 'base').category.status).toBe('MISSING');
    expect(v.warnings.join(' ')).toContain('KI-50');
    const withPrice = recalculate(adr, { inputOverrides: { marketPrice: 300 } });
    expect(ok(scenario(withPrice, 'base').result).marginOfSafety.status).toBe('OK');
  });

  it('nem pozitív belső érték (hatalmas adósság) → MOS NOT_MEANINGFUL', () => {
    const v = recalculate(aapl, { inputOverrides: { totalDebt: 1e15 } });
    const base = ok(scenario(v, 'base').result);
    expect(base.intrinsicValuePerShare).toBeLessThan(0);
    expect(base.marginOfSafety.status).toBe('NOT_MEANINGFUL');
    expect(scenario(v, 'base').display?.marginOfSafetyPercent).toBeNull();
  });
});

describe('értékelés – hiányos valós adatok', () => {
  it('BRK-B: a teljes adósság nem rakható össze → a DCF nem fut, az ok megnevezve; felülírással fut', async () => {
    const brk = await analyze('BRK-B', false);
    const v = recalculate(brk);
    expect(v.dcf.inputs.fields.totalDebt.status).toBe('MISSING');
    for (const s of v.dcf.scenarios) {
      expect(s.result.status).toBe('MISSING');
      expect(s.result.status !== 'OK' && s.result.reason).toContain('Teljes adósság');
    }
    expect(v.dcf.sensitivity.table.status).toBe('MISSING');
    expect(v.dcf.scenarioNotes).toEqual([]);

    // Csak az adósság felülírva → a következő hiányzó bemenet (pénzeszközök) neveződik meg.
    const debtOnly = recalculate(brk, { inputOverrides: { totalDebt: 120_000_000_000 } });
    expect(debtOnly.dcf.inputs.fields.totalDebt.origin).toBe('user_input');
    const blocked = scenario(debtOnly, 'base').result;
    expect(blocked.status).toBe('MISSING');
    expect(blocked.status !== 'OK' && blocked.reason).toContain('Pénzeszközök');

    // Minden hiányzó bemenet felülírva (illusztratív felhasználói értékek) → a DCF fut, ár nélkül.
    const all = recalculate(brk, {
      inputOverrides: { totalDebt: 120e9, cash: 40e9, sharesOutstanding: 2.15e9 },
    });
    const base = ok(scenario(all, 'base').result);
    expect(all.dcf.inputs.fields.baseFcf.value).toBe(25_042_000_000); // FY2025 SEC FCF
    expect(base.intrinsicValuePerShare).toBeGreaterThan(0);
    expect(base.marginOfSafety.status).toBe('MISSING'); // nincs ár (PLAN_LIMIT)
  });

  it('MSFT (ár nélkül, becsült adósság): a DCF fut, a MOS indokoltan MISSING, becslés-figyelmeztetés', async () => {
    const msft = await analyze('MSFT', false);
    const v = recalculate(msft);
    expect(v.dcf.inputs.fields.totalDebt.origin).toBe('estimated');
    expect(v.warnings.join(' ')).toContain('D-059');
    const base = ok(scenario(v, 'base').result);
    expect(base.marginOfSafety.status).toBe('MISSING');
    expect(base.marginOfSafety.status !== 'OK' && base.marginOfSafety.reason).toContain(
      'biztonsági sáv nem számolható',
    );
  });
});

describe('use case: analyzeStockValuation', () => {
  it('lekér + számol; a fundamentális elemzés is visszajön', async () => {
    const analyzeStockValuation = createAnalyzeStockValuation({
      analyzeStockFundamentals: analyzerFor(gatewayFor('AAPL', { withMarket: true })),
      clock,
    });
    const result = await analyzeStockValuation('AAPL@XNAS', { explicitYears: 3 });
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value.fundamentals.overview.ticker).toBe('AAPL');
    expect(result.value.valuation.dcf.scenarios[1]!.assumptions.explicitYears).toBe(3);
  });

  it('érvénytelen azonosító → a fundamentális use case VALIDATION hibája megy tovább', async () => {
    const analyzeStockValuation = createAnalyzeStockValuation({
      analyzeStockFundamentals: analyzerFor(gatewayFor('AAPL', { withMarket: true })),
      clock,
    });
    const result = await analyzeStockValuation('nem jó azonosító');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe('VALIDATION');
  });

  it('kvalitatív leletek a fundamentális elemzéshez továbbítódnak', async () => {
    const analyze = jest.fn(analyzerFor(gatewayFor('AAPL', { withMarket: true })));
    const analyzeStockValuation = createAnalyzeStockValuation({
      analyzeStockFundamentals: analyze,
      clock,
    });
    await analyzeStockValuation('AAPL@XNAS', { qualitativeFindings: [] });
    expect(analyze).toHaveBeenCalledWith('AAPL@XNAS', { qualitativeFindings: [] });
  });
});

describe('DCF-bemenet kiválasztás – ágak', () => {
  it('nincs FY (XOM) → a kiinduló FCF MISSING indokkal, a DCF nem fut', async () => {
    const xom = await analyze('XOM', false);
    const v = recalculate(xom);
    expect(v.dcf.inputs.fields.baseFcf.status).toBe('MISSING');
    expect(v.dcf.inputs.fields.baseFcf.reason).toContain('FY');
    expect(scenario(v, 'base').result.status).toBe('MISSING');
    expect(v.warnings.join(' ')).toContain('hiányosak');
  });

  it('a negyedéves mérleg frissebb → az adósság/pénz onnan jön (az időszak megnevezve)', async () => {
    const aapl = await analyze('AAPL');
    const q = aapl.periodMetrics.quarterly;
    const later = {
      ...aapl,
      periodMetrics: {
        ...aapl.periodMetrics,
        quarterly: {
          ...q,
          columns: q.columns.map((c, i) => (i === 0 ? { ...c, end: '2099-12-31' as never } : c)),
        },
      },
    };
    const f = recalculate(later).dcf.inputs.fields;
    expect(f.totalDebt.basis).toContain('2099-12-31');
    expect(f.baseFcf.basis).toContain('FY2026');
  });

  it('a beszámolói pénznemtől eltérő pénzű tétel → INVALID_INPUT (nincs csendes FX)', async () => {
    const aapl = await analyze('AAPL');
    const eur = { ...aapl, overview: { ...aapl.overview, reportingCurrency: 'EUR' as never } };
    const f = recalculate(eur).dcf.inputs.fields;
    expect(f.baseFcf.status).toBe('INVALID_INPUT');
    expect(f.baseFcf.reason).toContain('Eltérő pénznem');
    expect(f.sharesOutstanding.status).toBe('OK'); // darabszám, nincs pénzneme
  });
});
