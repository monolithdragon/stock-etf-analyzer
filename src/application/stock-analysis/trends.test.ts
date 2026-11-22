import type { IsoDate, TrendSeries } from '@/domain';

import { groupByPeriod } from './statement-periods';
import { TEST_FETCHED_AT, fullYear, statementSet, type PeriodSpec } from './testing';
import { buildTrends, fiscalYearEndShiftDays } from './trends';

function trends(...periods: PeriodSpec[]): TrendSeries[] {
  return buildTrends(
    groupByPeriod(statementSet({ frequency: 'annual', periods })),
    TEST_FETCHED_AT,
  );
}
const cagrOf = (list: TrendSeries[], id: string, years: number) =>
  list.find((t) => t.id === id)!.cagr.find((c) => c.years === years)!.value;

describe('buildTrends – CAGR csak összehasonlítható adattal', () => {
  it('3 éves CAGR a végpontokból; 1 éves = éves növekedés; pontos képlet-címke', () => {
    const list = trends(
      fullYear(2022),
      fullYear(2023, 1.1),
      fullYear(2024, 1.21),
      fullYear(2025, 1.331),
    );
    const three = cagrOf(list, 'revenue', 3);
    expect(three.value.status === 'OK' && three.value.value).toBeCloseTo(0.1, 12);
    expect(three.id).toBe('revenueCagr');
    expect(three.formula).toBe('(revenue_end / revenue_start)^(1/3) − 1');
    expect(three.notes.join(' ')).toContain('FY2022 → FY2025');
    const one = cagrOf(list, 'revenue', 1);
    expect(one.value.status === 'OK' && one.value.value).toBeCloseTo(0.1, 12);
  });

  it('hiányos történet: 5 és 10 éves CAGR INSUFFICIENT_DATA, az elérhető tartomány megnevezve', () => {
    const list = trends(fullYear(2022), fullYear(2025));
    expect(cagrOf(list, 'revenue', 5).value.status).toBe('INSUFFICIENT_DATA');
    expect(cagrOf(list, 'revenue', 10).value).toMatchObject({
      status: 'INSUFFICIENT_DATA',
      reason: expect.stringContaining('FY2022–FY2025'),
    });
    // Hézag a közbenső években nem akadály (a CAGR csak a végpontokat használja).
    expect(cagrOf(list, 'revenue', 3).value.status).toBe('OK');
    expect(trends().find((t) => t.id === 'revenue')!.cagr[0]!.value.value.status).toBe(
      'INSUFFICIENT_DATA',
    );
  });

  it('negatív végpont (pl. veszteséges év) → NOT_MEANINGFUL', () => {
    const loss: PeriodSpec = {
      ...fullYear(2022),
      income: { ...fullYear(2022).income, netIncome: -10 },
    };
    expect(cagrOf(trends(loss, fullYear(2025)), 'netIncome', 3).value.status).toBe(
      'NOT_MEANINGFUL',
    );
  });

  it('eltérő pénzügyi év vége (szeptemberről decemberre váltott) → NOT_MEANINGFUL', () => {
    const september: PeriodSpec = { ...fullYear(2022), start: '2021-10-01', end: '2022-09-30' };
    expect(cagrOf(trends(september, fullYear(2025)), 'revenue', 3).value).toMatchObject({
      status: 'NOT_MEANINGFUL',
      reason: expect.stringContaining('pénzügyi év vége megváltozott'),
    });
  });

  it('52/53 hetes év (záródátum ±7 napon belül csúszik) → összehasonlítható', () => {
    const a: PeriodSpec = { ...fullYear(2022), start: '2021-09-26', end: '2022-09-24' };
    const b: PeriodSpec = { ...fullYear(2025), start: '2024-09-29', end: '2025-09-27' };
    expect(cagrOf(trends(a, b), 'revenue', 3).value.status).toBe('OK');
    expect(fiscalYearEndShiftDays('2022-09-24' as IsoDate, '2025-09-27' as IsoDate)).toBe(3);
    expect(fiscalYearEndShiftDays('2024-12-29' as IsoDate, '2026-01-03' as IsoDate)).toBeLessThan(
      7,
    );
  });

  it('eltérő beszámolási pénznem a végpontokon → NOT_MEANINGFUL', () => {
    const eur: PeriodSpec = { ...fullYear(2025), currency: 'EUR' as never };
    expect(cagrOf(trends(fullYear(2022), eur), 'revenue', 3).value.status).toBe('NOT_MEANINGFUL');
  });

  it('részvényfelosztás az ablakban → EPS- és részvényszám-CAGR NOT_MEANINGFUL; árbevétel OK', () => {
    const split = (fy: number): PeriodSpec => ({
      ...fullYear(fy),
      income: { ...fullYear(fy).income, epsDiluted: 0.375, weightedSharesDiluted: 400 },
      balance: { ...fullYear(fy).balance, sharesOutstanding: 400 },
    });
    const list = trends(fullYear(2022), fullYear(2023), split(2024), split(2025));
    expect(cagrOf(list, 'eps', 3).value.status).toBe('NOT_MEANINGFUL');
    expect(cagrOf(list, 'sharesOutstanding', 3).value.status).toBe('NOT_MEANINGFUL');
    expect(cagrOf(list, 'eps', 1).value.status).toBe('OK'); // split után azonos bázis
    expect(cagrOf(list, 'revenue', 3).value.status).toBe('OK');
  });

  it('a split-bázis nem ellenőrizhető (hiányzó év) → számol, de megjegyzéssel jelzi', () => {
    const list = trends(fullYear(2022), fullYear(2025));
    expect(cagrOf(list, 'eps', 3).notes.join(' ')).toContain('nem ellenőrizhető');
  });
});
