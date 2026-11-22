import type { Metric } from '@/domain';

import {
  buildStatementTables,
  buildTtm,
  deriveQ4,
  groupByPeriod,
  lineItem,
} from './statement-periods';
import { TEST_FETCHED_AT, fullYear, statementSet, type PeriodSpec } from './testing';

const q = (
  fp: 'Q1' | 'Q2' | 'Q3' | 'Q4',
  start: string,
  end: string,
  revenue: number,
  extra = {},
): PeriodSpec => ({
  fy: 2025,
  fp,
  start,
  end,
  income: { revenue, netIncome: revenue / 10, epsDiluted: revenue / 1000, ...extra },
  balance: { cashAndEquivalents: revenue },
});

const value = (m: Metric<number>) => (m.status === 'OK' ? m.value : m.status);

const annualSet = statementSet({ frequency: 'annual', periods: [fullYear(2025)] });
const quarters = [
  q('Q1', '2025-01-01', '2025-03-31', 200),
  q('Q2', '2025-04-01', '2025-06-30', 250),
  q('Q3', '2025-07-01', '2025-09-30', 260),
];

describe('groupByPeriod', () => {
  it('időszakonként csoportosít, legfrissebb elöl; a készlet frissessége a tételekre kerül', () => {
    const set = statementSet({
      frequency: 'annual',
      freshness: 'STALE',
      periods: [fullYear(2024), fullYear(2025)],
    });
    const grouped = groupByPeriod(set);
    expect(grouped.map((g) => g.column.label)).toEqual(['FY2025', 'FY2024']);
    const revenue = lineItem(grouped[0]!, 'revenue');
    expect(revenue.status === 'OK' && revenue.provenance.freshness).toBe('STALE');
  });

  it('hiányzó kimutatás vagy tétel → indokolt MISSING, nem 0', () => {
    const set = statementSet({
      frequency: 'annual',
      periods: [{ ...fullYear(2025), cashflow: undefined, income: { revenue: 10 } }],
    });
    const [ps] = groupByPeriod(set);
    expect(lineItem(ps!, 'operatingCashFlow')).toMatchObject({ status: 'MISSING' });
    expect(lineItem(ps!, 'netIncome').status).toBe('MISSING');
    expect(lineItem(null, 'revenue').status).toBe('MISSING');
  });
});

describe('deriveQ4', () => {
  it('Q4 = FY − (Q1+Q2+Q3) additív tételre; EPS MISSING; mérleg = FY mérleg', () => {
    const annual = groupByPeriod(annualSet);
    const quarterly = groupByPeriod(statementSet({ frequency: 'quarterly', periods: quarters }));
    const { derived, notes } = deriveQ4(annual, quarterly, TEST_FETCHED_AT);
    expect(derived).toHaveLength(1);
    const q4 = derived[0]!;
    expect(q4.column).toMatchObject({
      kind: 'Q4',
      start: '2025-10-01',
      end: '2025-12-31',
      derived: true,
    });
    const revenue = lineItem(q4, 'revenue');
    expect(value(revenue)).toBe(1000 - 200 - 250 - 260);
    expect(revenue.status === 'OK' && revenue.provenance.kind).toBe('calculated');
    expect(lineItem(q4, 'epsDiluted').status).toBe('MISSING');
    expect(value(lineItem(q4, 'cashAndEquivalents'))).toBe(300); // FY mérleg
    expect(notes.join(' ')).toContain('restatement');
  });

  it('hiányzó negyedév → nincs Q4 (nem találunk ki adatot)', () => {
    const annual = groupByPeriod(annualSet);
    const quarterly = groupByPeriod(
      statementSet({ frequency: 'quarterly', periods: [quarters[0]!, quarters[2]!] }),
    );
    expect(deriveQ4(annual, quarterly, TEST_FETCHED_AT).derived).toHaveLength(0);
  });

  it('hézagos negyedévek (Q2 nem a Q1 után kezdődik) → nincs Q4, megjegyzéssel', () => {
    const annual = groupByPeriod(annualSet);
    const gapped = [quarters[0]!, q('Q2', '2025-04-08', '2025-06-30', 250), quarters[2]!];
    const quarterly = groupByPeriod(statementSet({ frequency: 'quarterly', periods: gapped }));
    const result = deriveQ4(annual, quarterly, TEST_FETCHED_AT);
    expect(result.derived).toHaveLength(0);
    expect(result.notes[0]).toContain('hézagmentesen');
  });

  it('negatív származtatott árbevétel → INVALID_INPUT (FY és negyedévek ellentmondanak)', () => {
    const annual = groupByPeriod(annualSet);
    const big = [quarters[0]!, quarters[1]!, q('Q3', '2025-07-01', '2025-09-30', 900)];
    const quarterly = groupByPeriod(statementSet({ frequency: 'quarterly', periods: big }));
    const [q4] = deriveQ4(annual, quarterly, TEST_FETCHED_AT).derived;
    expect(lineItem(q4!, 'revenue').status).toBe('INVALID_INPUT');
    // A nettó eredmény lehet negatív a Q4-ben (veszteség) – az nem hiba.
    expect(lineItem(q4!, 'netIncome').status).toBe('OK');
  });

  it('a jelentett Q4-et nem írja felül; eltérő pénznemű negyedévnél nincs Q4', () => {
    const annual = groupByPeriod(annualSet);
    const withQ4 = groupByPeriod(
      statementSet({
        frequency: 'quarterly',
        periods: [...quarters, q('Q4', '2025-10-01', '2025-12-31', 290)],
      }),
    );
    expect(deriveQ4(annual, withQ4, TEST_FETCHED_AT).derived).toHaveLength(0);
    const mixed = groupByPeriod(
      statementSet({
        frequency: 'quarterly',
        periods: [quarters[0]!, quarters[1]!, { ...quarters[2]!, currency: 'EUR' as never }],
      }),
    );
    expect(deriveQ4(annual, mixed, TEST_FETCHED_AT).notes[0]).toContain('pénznem');
  });
});

describe('buildTtm', () => {
  const quarterly = () => {
    const annual = groupByPeriod(annualSet);
    const reported = groupByPeriod(statementSet({ frequency: 'quarterly', periods: quarters }));
    const { derived } = deriveQ4(annual, reported, TEST_FETCHED_AT);
    return [...derived, ...reported];
  };

  it('4 egymást követő negyedév összege; mérleg = legutolsó negyedév; TTM EPS a Q4 miatt MISSING', () => {
    const ttm = buildTtm(quarterly(), TEST_FETCHED_AT);
    expect(ttm?.column).toMatchObject({ kind: 'TTM', start: '2025-01-01', end: '2025-12-31' });
    expect(ttm?.column.constituents).toHaveLength(4);
    expect(value(lineItem(ttm!, 'revenue'))).toBe(1000);
    expect(lineItem(ttm!, 'epsDiluted').status).toBe('MISSING');
    expect(lineItem(ttm!, 'weightedSharesDiluted').status).toBe('MISSING');
    expect(value(lineItem(ttm!, 'cashAndEquivalents'))).toBe(300);
  });

  it('3 negyedév vagy hézag → nincs TTM', () => {
    const reported = groupByPeriod(statementSet({ frequency: 'quarterly', periods: quarters }));
    expect(buildTtm(reported, TEST_FETCHED_AT)).toBeNull();
    const all = quarterly();
    expect(buildTtm([all[0]!, all[1]!, all[3]!, all[2]!], TEST_FETCHED_AT)).toBeNull();
  });
});

describe('buildStatementTables', () => {
  it('3 tábla, a cellák az időszakokhoz igazítva, a származtatott oszlop jelölve', () => {
    const annual = groupByPeriod(annualSet);
    const reported = groupByPeriod(statementSet({ frequency: 'quarterly', periods: quarters }));
    const { derived } = deriveQ4(annual, reported, TEST_FETCHED_AT);
    const tables = buildStatementTables('quarterly', [...derived, ...reported], ['n']);
    expect(tables.map((t) => t.statementType)).toEqual(['income', 'balance', 'cashflow']);
    const income = tables[0]!;
    expect(income.currency).toBe('USD');
    expect(income.periods).toHaveLength(4);
    expect(income.derived).toEqual([true, false, false, false]);
    // Q4 (származtatott), majd Q3, Q2, Q1 – legfrissebb elöl.
    expect(income.rows.find((r) => r.item === 'revenue')?.cells.map(value)).toEqual([
      290, 260, 250, 200,
    ]);
    // Nincs cash flow kimutatás → üres tábla, pénznem nélkül.
    expect(tables[2]!.periods).toHaveLength(0);
    expect(tables[2]!.currency).toBeNull();
  });

  it('több pénznem a készletben → a tábla pénzneme null + figyelmeztetés', () => {
    const set = statementSet({
      frequency: 'annual',
      periods: [fullYear(2024), { ...fullYear(2025), currency: 'EUR' as never }],
    });
    const [income] = buildStatementTables('annual', groupByPeriod(set), []);
    expect(income!.currency).toBeNull();
    expect(income!.notes[0]).toContain('Több pénznem');
  });
});
