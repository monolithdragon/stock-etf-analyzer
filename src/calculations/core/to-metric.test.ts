import {
  FINANCIAL_METRIC_IDS,
  metricMissing,
  metricNotMeaningful,
  metricOk,
  metricInvalidInput,
  metricUnavailable,
  parseCurrencyCode,
  type CurrencyCode,
  type DataProvenance,
  type FiscalPeriod,
  type IsoTimestamp,
  type Metric,
} from '@/domain';

import { METRIC_DEFINITIONS, toFinancialMetric } from '../definitions';
import { grossMargin, grossProfit, roe } from '../index';
import { calculateMetric, preferReported } from './to-metric';

const NOW = '2026-11-22T10:00:00Z' as IsoTimestamp;
const c = (code: string): CurrencyCode => {
  const parsed = parseCurrencyCode(code);
  if (!parsed.ok) throw new Error(code);
  return parsed.value;
};

function reported(overrides: Partial<DataProvenance> = {}): DataProvenance {
  return {
    sourceId: 'sec-edgar',
    sourceName: 'SEC EDGAR',
    kind: 'reported',
    fetchedAt: '2026-11-21T08:00:00Z' as IsoTimestamp,
    asOf: '2025-12-31' as DataProvenance['asOf'],
    freshness: 'FRESH',
    currency: c('USD'),
    unit: 'money',
    ...overrides,
  };
}

const usd = (value: number, overrides: Partial<DataProvenance> = {}): Metric<number> =>
  metricOk(value, reported(overrides));

const ratioContext = { unit: 'ratio' as const, calculatedAt: NOW };

describe('calculateMetric', () => {
  it('OK bemenetekből calculated provenance: forrás, bemenetek, legrégebbi asOf, legrosszabb frissesség', () => {
    const { metric, notes } = calculateMetric(
      {
        grossProfit: usd(40, { asOf: '2025-12-31' as DataProvenance['asOf'] }),
        revenue: usd(100, { asOf: '2025-09-30' as DataProvenance['asOf'], freshness: 'STALE' }),
      },
      {},
      grossMargin,
      ratioContext,
    );
    expect(notes).toEqual([]);
    expect(metric.status).toBe('OK');
    if (metric.status !== 'OK') return;
    expect(metric.value).toBeCloseTo(0.4, 12);
    expect(metric.provenance).toEqual({
      sourceId: 'engine',
      sourceName: 'Számítási motor',
      kind: 'calculated',
      fetchedAt: NOW,
      asOf: '2025-09-30',
      freshness: 'STALE',
      unit: 'ratio',
      inputs: ['grossProfit', 'revenue'],
    });
  });

  it('pénz jellegű eredménynél a bemenetek közös pénzneme öröklődik; a period a kontextusból jön', () => {
    const period = { fiscalYear: 2025, fiscalPeriod: 'FY' } as unknown as FiscalPeriod;
    const { metric } = calculateMetric(
      { revenue: usd(100), costOfRevenue: usd(60) },
      {},
      grossProfit,
      { unit: 'money', calculatedAt: NOW, period },
    );
    expect(metric.status === 'OK' && metric.provenance.currency).toBe('USD');
    expect(metric.status === 'OK' && metric.provenance.period).toBe(period);
  });

  it('kötelező bemenet nem-OK → a képlet nem fut; az indok megnevezi a bemenetet', () => {
    const formula = jest.fn(grossMargin);
    const { metric } = calculateMetric(
      { grossProfit: metricMissing<number>('nincs tag'), revenue: usd(100) },
      {},
      formula,
      ratioContext,
    );
    expect(formula).not.toHaveBeenCalled();
    expect(metric.status).toBe('MISSING');
    expect(metric.status !== 'OK' && metric.reason).toContain('grossProfit');
  });

  it('több hibás bemenetnél a legsúlyosabb státusz nyer; UNAVAILABLE ok-kódja megmarad', () => {
    const worst = calculateMetric(
      {
        grossProfit: metricNotMeaningful<number>('n/m'),
        revenue: metricInvalidInput<number>('rossz'),
      },
      {},
      grossMargin,
      ratioContext,
    );
    expect(worst.metric.status).toBe('INVALID_INPUT');
    const unavailable = calculateMetric(
      {
        grossProfit: metricMissing<number>('nincs'),
        revenue: metricUnavailable<number>('PLAN_LIMIT', 'nem US'),
      },
      {},
      grossMargin,
      ratioContext,
    );
    expect(unavailable.metric).toMatchObject({
      status: 'UNAVAILABLE',
      unavailableReason: 'PLAN_LIMIT',
    });
  });

  it('opcionális nem-OK bemenet null-ként jut a képlethez (ROE záró értékkel, megjegyzéssel)', () => {
    const { metric, notes } = calculateMetric(
      { netIncome: usd(100), equityEnd: usd(500) },
      { equityStart: metricMissing<number>('nincs előző év') },
      (v) => roe({ netIncome: v.netIncome, equityStart: v.equityStart, equityEnd: v.equityEnd }),
      ratioContext,
    );
    expect(metric.status === 'OK' && metric.value).toBeCloseTo(0.2, 12);
    expect(metric.status === 'OK' && metric.provenance.inputs).toEqual(['netIncome', 'equityEnd']);
    expect(notes[0]).toContain('záró');
  });

  it('az OK opcionális bemenet is bekerül az inputs listába', () => {
    const { metric } = calculateMetric(
      { netIncome: usd(100), equityEnd: usd(600) },
      { equityStart: usd(400) },
      (v) => roe({ netIncome: v.netIncome, equityStart: v.equityStart, equityEnd: v.equityEnd }),
      ratioContext,
    );
    expect(metric.status === 'OK' && metric.provenance.inputs).toEqual([
      'netIncome',
      'equityEnd',
      'equityStart',
    ]);
  });

  it('eltérő pénznemű pénzösszegek → INVALID_INPUT (nincs csendes FX)', () => {
    const { metric } = calculateMetric(
      { grossProfit: usd(40), revenue: usd(100, { currency: c('EUR') }) },
      {},
      grossMargin,
      ratioContext,
    );
    expect(metric.status).toBe('INVALID_INPUT');
    expect(metric.status !== 'OK' && metric.reason).toContain('FX');
  });

  it('nem pénz egységű bemenet pénzneme nem számít az ellenőrzésben', () => {
    const { metric } = calculateMetric(
      { grossProfit: usd(40), revenue: usd(100, { currency: c('EUR'), unit: 'shares' }) },
      {},
      grossMargin,
      ratioContext,
    );
    expect(metric.status).toBe('OK');
  });

  it('a képlet hibája átkerül a Metric-be', () => {
    const { metric } = calculateMetric(
      { grossProfit: usd(40), revenue: usd(0) },
      {},
      grossMargin,
      ratioContext,
    );
    expect(metric.status).toBe('NOT_MEANINGFUL');
  });

  it('provenance-fajta: mock bemenet → mock; becsült bemenet vagy kontextus → estimated', () => {
    const run = (kind: DataProvenance['kind'], contextKind?: 'estimated') =>
      calculateMetric({ grossProfit: usd(40, { kind }), revenue: usd(100) }, {}, grossMargin, {
        ...ratioContext,
        ...(contextKind ? { kind: contextKind } : {}),
      }).metric;
    const kindOf = (metric: Metric<number>) =>
      metric.status === 'OK' ? metric.provenance.kind : null;
    expect(kindOf(run('mock', 'estimated'))).toBe('mock');
    expect(kindOf(run('estimated'))).toBe('estimated');
    expect(kindOf(run('reported', 'estimated'))).toBe('estimated');
    expect(kindOf(run('user_input'))).toBe('calculated');
  });

  it('asOf nélküli bemenetekből asOf: null', () => {
    const { metric } = calculateMetric(
      { grossProfit: usd(40, { asOf: null }), revenue: usd(100, { asOf: null }) },
      {},
      grossMargin,
      ratioContext,
    );
    expect(metric.status === 'OK' && metric.provenance.asOf).toBeNull();
  });
});

describe('preferReported', () => {
  const compute = () =>
    calculateMetric({ revenue: usd(100), costOfRevenue: usd(60) }, {}, grossProfit, {
      unit: 'money',
      calculatedAt: NOW,
    });

  it('a jelentett OK érték változatlanul megy tovább', () => {
    const value = usd(41);
    expect(preferReported(value, compute).metric).toBe(value);
  });
  it('jelentett hiányában a saját számítás', () => {
    const { metric } = preferReported(metricMissing('nincs GrossProfit tag'), compute);
    expect(metric.status === 'OK' && metric.value).toBe(40);
  });
  it('ha a saját számítás is MISSING, a jelentett informatívabb státusza nyer', () => {
    const invalid = metricInvalidInput<number>('negatív bruttó eredmény a forrásban');
    const missingCompute = () =>
      calculateMetric(
        { revenue: metricMissing<number>('x') },
        {},
        () => grossProfit({ revenue: 1, costOfRevenue: 1 }),
        {
          unit: 'money',
          calculatedAt: NOW,
        },
      );
    expect(preferReported(invalid, missingCompute).metric).toBe(invalid);
  });
});

describe('METRIC_DEFINITIONS és toFinancialMetric', () => {
  it('minden FinancialMetricId-hez van képlet és egység', () => {
    expect(Object.keys(METRIC_DEFINITIONS).sort()).toEqual([...FINANCIAL_METRIC_IDS].sort());
    for (const definition of Object.values(METRIC_DEFINITIONS)) {
      expect(definition.formula.length).toBeGreaterThan(0);
    }
  });

  it('FinancialMetric: képlet és egység a táblából, bemenetek a provenance-ből', () => {
    const calculation = calculateMetric(
      { grossProfit: usd(40), revenue: usd(100) },
      {},
      grossMargin,
      ratioContext,
    );
    const built = toFinancialMetric('grossMargin', calculation, null);
    expect(built.ok && built.value).toMatchObject({
      id: 'grossMargin',
      unit: 'ratio',
      formula: 'grossProfit / revenue',
      inputs: ['grossProfit', 'revenue'],
      period: null,
    });
  });

  it('nem-OK számításnál üres bemenetlista', () => {
    const built = toFinancialMetric(
      'pe',
      { metric: metricNotMeaningful('negatív EPS'), notes: [] },
      null,
    );
    expect(built.ok && built.value.inputs).toEqual([]);
    expect(built.ok && built.value.value.status).toBe('NOT_MEANINGFUL');
  });
});
