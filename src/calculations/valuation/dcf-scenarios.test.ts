import { constantGrowthRates, runDcf, type DcfCompanyInputs, type DcfInput } from './dcf';
import {
  DCF_SENSITIVITY_MAX_AXIS,
  dcfSensitivityTable,
  runDcfScenarios,
  sensitivityAxis,
  type DcfScenarioSet,
} from './dcf-scenarios';
import { failureReason, okValue } from '../core/testing';

const COMPANY: DcfCompanyInputs = {
  baseFcf: 100,
  totalDebt: 50,
  cash: 20,
  sharesOutstanding: 10,
  marketPrice: 80,
};

const SET: DcfScenarioSet = {
  bear: { growthRates: constantGrowthRates(0.02, 5), discountRate: 0.1, terminalGrowth: 0.015 },
  base: { growthRates: constantGrowthRates(0.05, 5), discountRate: 0.09, terminalGrowth: 0.025 },
  bull: { growthRates: constantGrowthRates(0.08, 5), discountRate: 0.08, terminalGrowth: 0.03 },
};

const ivOf = (input: DcfInput): number => okValue(runDcf(input)).intrinsicValuePerShare;

describe('runDcfScenarios', () => {
  it('Bear/Base/Bull: mindhárom ugyanazzal az engine-nel, a feltevések az eredmény mellett', () => {
    const run = runDcfScenarios(COMPANY, SET);
    expect(run.scenarios.map((s) => s.id)).toEqual(['bear', 'base', 'bull']);
    for (const s of run.scenarios) {
      expect(s.assumptions).toBe(SET[s.id]);
      expect(s.result).toEqual(runDcf({ ...COMPANY, ...SET[s.id] }));
    }
    const ivs = run.scenarios.map((s) => okValue(s.result).intrinsicValuePerShare);
    expect(ivs[0]!).toBeLessThan(ivs[1]!);
    expect(ivs[1]!).toBeLessThan(ivs[2]!);
    expect(run.notes).toEqual([]);
  });

  it('nem monoton sorrend → megjegyzés (a címkék nem igazságértékek)', () => {
    const run = runDcfScenarios(COMPANY, { ...SET, bear: SET.bull, bull: SET.bear });
    expect(run.notes.join(' ')).toContain('Bear ≤ Base ≤ Bull');
  });

  it('részleges hiba: az érvénytelen forgatókönyv a saját okával, a többi számol', () => {
    const run = runDcfScenarios(COMPANY, {
      ...SET,
      bull: { ...SET.bull, discountRate: 0.03, terminalGrowth: 0.03 },
    });
    expect(run.scenarios[2]!.result.status).toBe('INVALID_INPUT');
    expect(run.scenarios[0]!.result.status).toBe('OK');
    expect(run.notes.join(' ')).toContain('bull');
  });

  it('közös adathiba (nincs adósság) → mindhárom MISSING, nincs „részleges” megjegyzés', () => {
    const run = runDcfScenarios({ ...COMPANY, totalDebt: null }, SET);
    expect(run.scenarios.every((s) => s.result.status === 'MISSING')).toBe(true);
    expect(run.notes).toEqual([]);
  });
});

describe('dcfSensitivityTable', () => {
  const base: DcfInput = { ...COMPANY, ...SET.base };
  const discountRates = [0.07, 0.08, 0.09, 0.1, 0.11];
  const terminalGrowthRates = [0.01, 0.02, 0.03, 0.08];

  it('minden cella = runDcf ugyanazzal a bemenettel (r, g felülírva)', () => {
    const table = okValue(dcfSensitivityTable({ base, discountRates, terminalGrowthRates }));
    expect(table.rows).toHaveLength(5);
    for (const row of table.rows) {
      expect(row.cells).toHaveLength(4);
      for (const cell of row.cells) {
        expect(cell.discountRate).toBe(row.discountRate);
        const direct = runDcf({
          ...base,
          discountRate: cell.discountRate,
          terminalGrowth: cell.terminalGrowth,
        });
        if (direct.status === 'OK') {
          expect(okValue(cell.intrinsicValuePerShare)).toBe(direct.value.intrinsicValuePerShare);
        } else {
          expect(cell.intrinsicValuePerShare).toEqual(direct);
        }
      }
    }
  });

  it('r ≤ g cella → INVALID_INPUT magyarázattal, a többi cella érvényes', () => {
    const table = okValue(dcfSensitivityTable({ base, discountRates, terminalGrowthRates }));
    const invalid = table.rows[0]!.cells[3]!; // r = 7%, g = 8%
    expect(invalid.intrinsicValuePerShare.status).toBe('INVALID_INPUT');
    expect(failureReason(invalid.intrinsicValuePerShare)).toContain('Gordon');
    expect(table.rows[0]!.cells[0]!.intrinsicValuePerShare.status).toBe('OK');
  });

  it('a középső cella egyezik a Base forgatókönyv belső értékével', () => {
    const table = okValue(
      dcfSensitivityTable({ base, discountRates: [0.09], terminalGrowthRates: [0.025] }),
    );
    expect(okValue(table.rows[0]!.cells[0]!.intrinsicValuePerShare)).toBe(ivOf(base));
  });

  it('monoton: magasabb r → alacsonyabb, magasabb g → magasabb belső érték', () => {
    const table = okValue(
      dcfSensitivityTable({ base, discountRates, terminalGrowthRates: [0.01, 0.02, 0.03] }),
    );
    const grid = table.rows.map((row) => row.cells.map((c) => okValue(c.intrinsicValuePerShare)));
    for (let i = 1; i < grid.length; i += 1) expect(grid[i]![0]!).toBeLessThan(grid[i - 1]![0]!);
    expect(grid[2]![2]!).toBeGreaterThan(grid[2]![0]!);
  });

  it('közös bemeneti hiba minden cellába ugyanazzal az okkal kerül', () => {
    const table = okValue(
      dcfSensitivityTable({ base: { ...base, baseFcf: -5 }, discountRates, terminalGrowthRates }),
    );
    expect(
      table.rows.flatMap((r) => r.cells).every((c) => c.intrinsicValuePerShare.status !== 'OK'),
    ).toBe(true);
  });

  it.each([
    ['üres tengely', [], [0.02]],
    [
      'túl hosszú tengely',
      Array.from({ length: DCF_SENSITIVITY_MAX_AXIS + 1 }, (_, i) => 0.05 + i / 100),
      [0.02],
    ],
    ['nem véges érték', [0.09, Number.NaN], [0.02]],
    ['ismétlődő érték', [0.09], [0.02, 0.02]],
  ])('%s → INVALID_INPUT', (_label, rates, growths) => {
    expect(
      dcfSensitivityTable({ base, discountRates: rates, terminalGrowthRates: growths }).status,
    ).toBe('INVALID_INPUT');
  });
});

describe('sensitivityAxis', () => {
  it('szimmetrikus tengely lebegőpontos zaj nélkül', () => {
    expect(okValue(sensitivityAxis(0.09, 0.01, 2))).toEqual([0.07, 0.08, 0.09, 0.1, 0.11]);
    expect(okValue(sensitivityAxis(0.025, 0.005, 1))).toEqual([0.02, 0.025, 0.03]);
    expect(okValue(sensitivityAxis(0.09, 0.01, 0))).toEqual([0.09]);
  });
  it('érvénytelen lépésköz vagy lépésszám → INVALID_INPUT', () => {
    expect(sensitivityAxis(0.09, 0, 2).status).toBe('INVALID_INPUT');
    expect(sensitivityAxis(0.09, -0.01, 2).status).toBe('INVALID_INPUT');
    expect(sensitivityAxis(0.09, 0.01, 6).status).toBe('INVALID_INPUT');
    expect(sensitivityAxis(0.09, 0.01, 1.5).status).toBe('INVALID_INPUT');
    expect(sensitivityAxis(Number.NaN, 0.01, 1).status).toBe('INVALID_INPUT');
  });
});
