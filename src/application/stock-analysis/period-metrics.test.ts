import type { FundamentalMetric, FundamentalMetricId } from '@/domain';

import { computePeriodMetrics, splitBasisCheck } from './period-metrics';
import { groupByPeriod, type PeriodStatements } from './statement-periods';
import { TEST_FETCHED_AT, fullYear, statementSet, type PeriodSpec } from './testing';

function columns(...periods: PeriodSpec[]): PeriodStatements[] {
  return groupByPeriod(statementSet({ frequency: 'annual', periods }));
}

function metrics(
  current: PeriodStatements,
  previous: PeriodStatements | null,
  basis: 'annual' | 'quarterly' | 'ttm' = 'annual',
) {
  const list = computePeriodMetrics({
    current,
    comparable: previous,
    previousBalance: previous,
    basis,
    calculatedAt: TEST_FETCHED_AT,
  });
  return (id: FundamentalMetricId): FundamentalMetric => {
    const m = list.find((x) => x.id === id);
    if (m === undefined) throw new Error(id);
    return m;
  };
}

const v = (m: FundamentalMetric) => (m.value.status === 'OK' ? m.value.value : m.value.status);

describe('computePeriodMetrics – normál eset (pontos definíciók)', () => {
  const [fy2025, fy2024] = columns(fullYear(2024), fullYear(2025, 1.1));
  const m = metrics(fy2025!, fy2024!);

  it('árrés-mutatók: bruttó eredmény saját számítással, ha nincs jelentett', () => {
    expect(v(m('grossProfit'))).toBeCloseTo(1100 - 660, 9);
    expect(m('grossProfit').origin).toBe('calculated');
    expect(v(m('grossMargin'))).toBeCloseTo(0.4, 12);
    expect(v(m('operatingMargin'))).toBeCloseTo(0.2, 12);
    expect(v(m('netMargin'))).toBeCloseTo(150 / 1000, 12);
    expect(m('revenue').origin).toBe('reported');
  });

  it('EPS: jelentett hígított (reported); növekedés az előző FY-hoz', () => {
    expect(v(m('eps'))).toBeCloseTo(1.65, 12);
    expect(m('eps').origin).toBe('reported');
    expect(v(m('revenueGrowth'))).toBeCloseTo(0.1, 12);
    expect(v(m('epsGrowth'))).toBeCloseTo(0.1, 12);
  });

  it('mérleg és cash flow: nettó adósság / készpénz, D/E, FCF, FCF-árrés, -konverzió, EBITDA', () => {
    expect(v(m('netDebt'))).toBe(200);
    expect(v(m('netCash'))).toBe(-200);
    expect(v(m('debtToEquity'))).toBeCloseTo(500 / 800, 12);
    expect(v(m('fcf'))).toBeCloseTo(275 - 55, 9);
    expect(v(m('fcfMargin'))).toBeCloseTo(220 / 1100, 12);
    expect(v(m('fcfConversion'))).toBeCloseTo(220 / 165, 12);
    expect(v(m('ebitda'))).toBeCloseTo(220 + 55, 9);
  });

  it('ROE átlagos saját tőkével; ROIC az effektív adókulccsal', () => {
    expect(v(m('roe'))).toBeCloseTo(165 / 800, 12);
    expect(v(m('effectiveTaxRate'))).toBeCloseTo(44 / 209, 12);
    expect(m('roic').value.status).toBe('OK');
  });
});

describe('computePeriodMetrics – negatív EPS, hiányzó mezők, hiányos történet', () => {
  it('negatív EPS: maga az EPS OK (veszteség), a növekedés negatív bázisról NOT_MEANINGFUL', () => {
    const loss2024: PeriodSpec = {
      ...fullYear(2024),
      income: { ...fullYear(2024).income, netIncome: -50, epsDiluted: -0.5 },
    };
    const [fy2025, fy2024] = columns(loss2024, fullYear(2025));
    const prior = metrics(fy2024!, null);
    expect(v(prior('eps'))).toBe(-0.5);
    expect(prior('netMargin').value.status).toBe('OK');
    expect(prior('fcfConversion').value.status).toBe('NOT_MEANINGFUL'); // NI ≤ 0
    const current = metrics(fy2025!, fy2024!);
    expect(current('epsGrowth').value.status).toBe('NOT_MEANINGFUL');
    expect(current('netIncomeGrowth').value.status).toBe('NOT_MEANINGFUL');
  });

  it('EPS sorrend: hígított hiányában alap (megjegyzéssel), anélkül saját számítás', () => {
    const basicOnly: PeriodSpec = {
      ...fullYear(2025),
      income: { netIncome: 150, epsBasic: 1.52, weightedSharesDiluted: 100, revenue: 1000 },
    };
    const [a] = columns(basicOnly);
    const basic = metrics(a!, null)('eps');
    expect(v(basic)).toBe(1.52);
    expect(basic.notes[0]).toContain('alap (basic)');

    const none: PeriodSpec = {
      ...fullYear(2025),
      income: { netIncome: 150, weightedSharesDiluted: 120 },
    };
    const [b] = columns(none);
    const own = metrics(b!, null)('eps');
    expect(v(own)).toBeCloseTo(1.25, 12);
    expect(own.origin).toBe('calculated');

    const nothing: PeriodSpec = { ...fullYear(2025), income: { revenue: 1 } };
    const [c] = columns(nothing);
    expect(metrics(c!, null)('eps').value.status).toBe('MISSING');
  });

  it('hiányzó mezők: a hiány végigmegy a függő mutatókon, soha nem lesz 0', () => {
    const sparse: PeriodSpec = {
      fy: 2025,
      fp: 'FY',
      start: '2025-01-01',
      end: '2025-12-31',
      income: { revenue: 1000, netIncome: 100 },
      balance: { shareholdersEquity: 800 },
    };
    const [a] = columns(sparse);
    const m = metrics(a!, null);
    for (const id of [
      'grossMargin',
      'operatingMargin',
      'netDebt',
      'fcf',
      'fcfMargin',
      'ebitda',
    ] as const) {
      expect([id, m(id).value.status]).toEqual([id, 'MISSING']);
      expect(m(id).origin).toBe('missing');
    }
    expect(m('netMargin').value.status).toBe('OK');
  });

  it('hiányos történet: nincs előző év → a növekedés MISSING indokkal; ROE csak záró tőkével', () => {
    const [a] = columns(fullYear(2025));
    const m = metrics(a!, null);
    expect(m('revenueGrowth').value).toMatchObject({ status: 'MISSING' });
    expect(m('roe').value.status).toBe('OK');
    expect(m('roe').notes.join(' ')).toMatch(/záró/i);
  });

  it('negatív saját tőke → ROE és D/E NOT_MEANINGFUL (nem negatív szám)', () => {
    const negative: PeriodSpec = {
      ...fullYear(2025),
      balance: { ...fullYear(2025).balance, shareholdersEquity: -100 },
    };
    const [a] = columns(negative);
    const m = metrics(a!, null);
    expect(m('roe').value.status).toBe('NOT_MEANINGFUL');
    expect(m('debtToEquity').value.status).toBe('NOT_MEANINGFUL');
  });
});

describe('computePeriodMetrics – időszak-konvenciók', () => {
  it('negyedéves és TTM oszlopnál a ROE/ROA/ROIC NOT_APPLICABLE (nem évesített)', () => {
    const [a] = columns(fullYear(2025));
    expect(metrics(a!, null, 'quarterly')('roe').value.status).toBe('NOT_APPLICABLE');
    expect(metrics(a!, null, 'ttm')('roa').value.status).toBe('NOT_APPLICABLE');
  });

  it('TTM-oszlopnál a növekedést nem számoljuk (nincs egy évvel korábbi TTM)', () => {
    const [a, b] = columns(fullYear(2024), fullYear(2025));
    const m = metrics(a!, b!, 'ttm');
    expect(m('revenueGrowth').value).toMatchObject({ status: 'MISSING' });
  });

  it('split-gyanú: a részvényszám 4×-esére nő → EPS-növekedés NOT_MEANINGFUL, árbevétel-növekedés OK', () => {
    const split: PeriodSpec = {
      ...fullYear(2025),
      income: { ...fullYear(2025).income, epsDiluted: 0.4, weightedSharesDiluted: 400 },
    };
    const [after, before] = columns(fullYear(2024), split);
    expect(splitBasisCheck(after!, before!)?.status).toBe('NOT_MEANINGFUL');
    const m = metrics(after!, before!);
    expect(m('epsGrowth').value.status).toBe('NOT_MEANINGFUL');
    expect(m('revenueGrowth').value.status).toBe('OK');
  });

  it('elavult készlet → a számított mutató eredete „stale”', () => {
    const set = statementSet({
      frequency: 'annual',
      freshness: 'EXPIRED',
      periods: [fullYear(2025)],
    });
    const [a] = groupByPeriod(set);
    const m = metrics(a!, null);
    expect(m('grossMargin').origin).toBe('stale');
    expect(m('revenue').origin).toBe('stale');
  });
});
