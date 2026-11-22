import {
  AppErrors,
  err,
  ok,
  type AppError,
  type FinancialStatementSet,
  type Result,
  type StatementFrequency,
} from '@/domain';

import {
  createAnalyzeStockFundamentals,
  type AnalyzeStockFundamentalsDeps,
} from './analyze-stock-fundamentals';
import { fullYear, statementSet } from '../stock-analysis/testing';

const clock = { now: () => new Date('2026-11-21T12:00:00Z') };
const unavailable = () =>
  Promise.resolve(
    err(AppErrors.unavailable('PLAN_LIMIT', 'free csomag')) as Result<never, AppError>,
  );

function deps(
  statements: (frequency: StatementFrequency) => Promise<Result<FinancialStatementSet, AppError>>,
): AnalyzeStockFundamentalsDeps & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    clock,
    getFinancialStatements: (id, frequency) => {
      calls.push(`statements:${id}:${frequency}`);
      return statements(frequency);
    },
    getListingQuote: (id) => {
      calls.push(`quote:${id}`);
      return unavailable();
    },
    getInstrumentProfile: unavailable,
    getPriceHistory: (id, options) => {
      calls.push(`prices:${options?.adjustment}`);
      return unavailable();
    },
    getDividendHistory: (id, options) => {
      calls.push(`dividends:${options?.from}..${options?.to}`);
      return unavailable();
    },
  };
}

const annualOnly = (freshness: 'FRESH' | 'STALE' = 'FRESH') =>
  deps((frequency) =>
    Promise.resolve(
      frequency === 'annual'
        ? ok(statementSet({ frequency, freshness, periods: [fullYear(2024), fullYear(2025, 1.1)] }))
        : ok(statementSet({ frequency, periods: [] })),
    ),
  );

describe('analyzeStockFundamentals – use case', () => {
  it('érvénytelen listing-azonosító → VALIDATION, lekérés nélkül', async () => {
    const d = annualOnly();
    const result = await createAnalyzeStockFundamentals(d)('nem jó');
    expect(result).toMatchObject({ ok: false, error: { kind: 'VALIDATION' } });
    expect(d.calls).toEqual([]);
  });

  it('forrás nélküli kvalitatív lelet → VALIDATION a mező útvonalával', async () => {
    const result = await createAnalyzeStockFundamentals(annualOnly())('AAPL@XNAS', {
      qualitativeFindings: [
        {
          theme: 'MOAT',
          statement: 'Erős márka',
          sourceKind: 'user',
          sourceReference: '',
          verifiableBy: 'saját vélemény',
          asOf: '2026-11-21',
        },
      ],
    });
    expect(result).toMatchObject({
      ok: false,
      error: { kind: 'VALIDATION', issues: [{ path: 'qualitativeFindings.0' }] },
    });
  });

  it('minden lekérés egyszer, párhuzamosan; osztalék 2 évre, ártörténet osztalékkorrigált', async () => {
    const d = annualOnly();
    await createAnalyzeStockFundamentals(d)('AAPL@XNAS');
    expect(d.calls).toEqual([
      'statements:AAPL@XNAS:annual',
      'statements:AAPL@XNAS:quarterly',
      'quote:AAPL@XNAS',
      'prices:SPLIT_DIVIDEND',
      'dividends:2024-11-21..2026-11-21',
    ]);
  });

  it('piaci adatok nélkül is elkészül: fundamentumok OK, ár-alapú UNAVAILABLE, PARTIAL teljesség', async () => {
    const result = await createAnalyzeStockFundamentals(annualOnly())('AAPL@XNAS');
    if (!result.ok) throw new Error(result.error.message);
    const a = result.value;
    expect(a.periodMetrics.annual.columns.map((c) => c.label)).toEqual(['FY2025', 'FY2024']);
    expect(a.overview.name).toBe('Teszt Rt.'); // profil hiányában a kimutatás-készlet neve
    expect(a.overview.sector).toBeNull();
    expect(a.dataQuality.completeness).toBe('PARTIAL');
    expect(a.dataQuality.gaps.some((g) => g.status === 'UNAVAILABLE')).toBe(true);
    expect(a.periodMetrics.ttm.columns).toHaveLength(0);
  });

  it('elavult kimutatás-készlet → figyelmeztetés és „stale” eredetű mutatók', async () => {
    const result = await createAnalyzeStockFundamentals(annualOnly('STALE'))('AAPL@XNAS');
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value.dataQuality.warnings.join(' ')).toContain(
      'Elavult adat (STALE): annualStatements',
    );
    const margin = result.value.periodMetrics.annual.rows.find((r) => r.id === 'grossMargin')!;
    expect(margin.cells[0]?.origin).toBe('stale');
  });

  it('teljes kiesés (hálózat) → mégis eredmény, INSUFFICIENT teljesség, a hibák a forráslistában', async () => {
    const d = deps(() => Promise.resolve(err(AppErrors.network('nincs kapcsolat'))));
    const result = await createAnalyzeStockFundamentals(d)('AAPL@XNAS');
    if (!result.ok) throw new Error(result.error.message);
    const a = result.value;
    expect(a.dataQuality.completeness).toBe('INSUFFICIENT');
    expect(a.dataQuality.gaps[0]).toMatchObject({ status: 'ERROR' });
    expect(a.dataQuality.sources[0]).toMatchObject({
      resource: 'annualStatements',
      error: { kind: 'NETWORK' },
    });
    expect(a.statements.annual.every((t) => t.periods.length === 0)).toBe(true);
    expect(a.quality.themes.find((t) => t.theme === 'GROWTH')?.status).toBe('INSUFFICIENT_DATA');
  });

  it('forrásolt lelet a minőségi modellbe kerül (MOAT), pontszám nélkül', async () => {
    const result = await createAnalyzeStockFundamentals(annualOnly())('AAPL@XNAS', {
      qualitativeFindings: [
        {
          theme: 'MOAT',
          statement: 'Szabadalmi portfólió: 1 200 aktív szabadalom.',
          sourceKind: 'filing',
          sourceReference: '10-K 2026 Item 1',
          verifiableBy: '10-K Item 1, „Intellectual Property”',
          asOf: '2026-11-03',
        },
      ],
    });
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value.quality.themes.find((t) => t.theme === 'MOAT')?.status).toBe(
      'EVIDENCE_AVAILABLE',
    );
    expect(result.value.quality.scoring).toBe('NOT_SCORED');
    expect(result.value.disclaimer).toContain('Nem befektetési tanács');
  });
});
