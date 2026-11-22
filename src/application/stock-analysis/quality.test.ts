import {
  createFundamentalMetric,
  metricMissing,
  metricNotApplicable,
  metricOk,
  type FundamentalMetric,
  type FundamentalMetricId,
  type QualitativeFinding,
  type StockOverview,
} from '@/domain';

import { buildQualityAnalysis } from './quality';

const okMetric = (id: FundamentalMetricId, value = 1): FundamentalMetric =>
  createFundamentalMetric({
    id,
    unit: 'ratio',
    formula: 'f',
    period: null,
    value: metricOk(value, {
      sourceId: 'engine',
      sourceName: 'E',
      kind: 'calculated',
      fetchedAt: '2026-11-21T00:00:00Z' as never,
      asOf: null,
      freshness: 'FRESH',
    }),
  });
const missingMetric = (id: FundamentalMetricId): FundamentalMetric =>
  createFundamentalMetric({
    id,
    unit: 'ratio',
    formula: 'f',
    period: null,
    value: metricMissing('nincs'),
  });

const overview = (patch: Partial<StockOverview> = {}): StockOverview =>
  ({
    name: 'Teszt',
    sector: 'Technology',
    industry: 'Software',
    country: 'US',
    ...patch,
  }) as StockOverview;

const finding: QualitativeFinding = {
  theme: 'MOAT',
  statement: 'Hálózati hatás: 2 milliárd aktív eszköz (10-K Item 1).',
  sourceKind: 'filing',
  sourceReference: '10-K 2026 Item 1',
  verifiableBy: '10-K Item 1',
  asOf: '2026-11-03' as never,
  provenanceKind: 'reported',
};

const allProfitability = ['grossMargin', 'operatingMargin', 'netMargin', 'roe', 'roic'] as const;

describe('buildQualityAnalysis (feladat 7–8.)', () => {
  it('nincs pontszám; minden téma szerepel', () => {
    const q = buildQualityAnalysis({
      overview: overview(),
      latestAnnual: [],
      valuation: [],
      trends: [],
      findings: [],
    });
    expect(q.scoring).toBe('NOT_SCORED');
    expect(q.themes.map((t) => t.theme)).toEqual([
      'BUSINESS',
      'GROWTH',
      'PROFITABILITY',
      'BALANCE_SHEET',
      'CASH_FLOW',
      'MOAT',
      'MANAGEMENT',
      'VALUATION',
    ]);
  });

  it('kvantitatív téma: teljes → EVIDENCE_AVAILABLE; részleges → PARTIAL (a hiány felsorolva); semmi → INSUFFICIENT', () => {
    const full = buildQualityAnalysis({
      overview: overview(),
      latestAnnual: allProfitability.map((id) => okMetric(id)),
      valuation: [],
      trends: [],
      findings: [],
    });
    expect(full.themes.find((t) => t.theme === 'PROFITABILITY')?.status).toBe('EVIDENCE_AVAILABLE');

    const partial = buildQualityAnalysis({
      overview: overview(),
      latestAnnual: [okMetric('grossMargin'), missingMetric('roic')],
      valuation: [],
      trends: [],
      findings: [],
    });
    const p = partial.themes.find((t) => t.theme === 'PROFITABILITY')!;
    expect(p.status).toBe('PARTIAL_EVIDENCE');
    expect(p.missing[0]).toContain('roic: MISSING');

    expect(partial.themes.find((t) => t.theme === 'CASH_FLOW')?.status).toBe('INSUFFICIENT_DATA');
  });

  it('NOT_APPLICABLE mutató nem számít hiánynak', () => {
    const q = buildQualityAnalysis({
      overview: overview(),
      latestAnnual: [
        okMetric('grossMargin'),
        createFundamentalMetric({
          id: 'roe',
          unit: 'ratio',
          formula: 'f',
          period: null,
          value: metricNotApplicable('negyedéves'),
        }),
      ],
      valuation: [],
      trends: [],
      findings: [],
    });
    const p = q.themes.find((t) => t.theme === 'PROFITABILITY')!;
    expect(p.status).toBe('EVIDENCE_AVAILABLE');
    expect(p.missing).toEqual([]);
  });

  it('MOAT: jó numerikus kontextus mellett is INSUFFICIENT_DATA forrásolt lelet nélkül', () => {
    const q = buildQualityAnalysis({
      overview: overview(),
      latestAnnual: [okMetric('grossMargin', 0.7), okMetric('roic', 0.5)],
      valuation: [],
      trends: [],
      findings: [],
    });
    const moat = q.themes.find((t) => t.theme === 'MOAT')!;
    expect(moat.status).toBe('INSUFFICIENT_DATA');
    expect(moat.evidence.map((e) => e.id)).toEqual(['grossMargin', 'roic']);
    expect(moat.missing[0]).toContain('forrásolt');
  });

  it('MOAT forrásolt lelettel → EVIDENCE_AVAILABLE; a lelet a témánál jelenik meg, máshol nem', () => {
    const q = buildQualityAnalysis({
      overview: overview(),
      latestAnnual: [],
      valuation: [],
      trends: [],
      findings: [finding],
    });
    expect(q.themes.find((t) => t.theme === 'MOAT')).toMatchObject({
      status: 'EVIDENCE_AVAILABLE',
      findings: [finding],
    });
    expect(q.themes.find((t) => t.theme === 'MANAGEMENT')?.status).toBe('INSUFFICIENT_DATA');
  });

  it('BUSINESS: metaadat nélkül és árbevétel nélkül INSUFFICIENT_DATA; részleges metaadatnál PARTIAL', () => {
    const none = buildQualityAnalysis({
      overview: overview({ name: null, sector: null, industry: null, country: null }),
      latestAnnual: [],
      valuation: [],
      trends: [],
      findings: [],
    });
    expect(none.themes[0]?.status).toBe('INSUFFICIENT_DATA');
    const partial = buildQualityAnalysis({
      overview: overview({ sector: null }),
      latestAnnual: [okMetric('revenue', 100)],
      valuation: [],
      trends: [],
      findings: [],
    });
    expect(partial.themes[0]).toMatchObject({ status: 'PARTIAL_EVIDENCE' });
    expect(partial.themes[0]?.missing).toContain('szektor: nincs forrásadat');
  });
});
