/**
 * PHASE 10 – score engine: határérték-, hiányzóadat- és szélsőérték-tesztek, visszakövethetőség.
 */
import { metricOk } from '@/domain';

import { assessConfidence } from './confidence';
import {
  DEFAULT_QUALITY_POLICY,
  DEFAULT_STOCK_SCORE_CONFIG,
  type CategoryConfig,
  type ScoreConfig,
  type ScoringFeature,
} from './index';
import { buildScoreCard, scoreCategory, scoreMetric } from './score-engine';
import { compare, linearScore, roundScore, weightedAverage } from './score-math';
import { cat, missing, notMeaningful, num, prov } from './testing';

const policy = DEFAULT_QUALITY_POLICY;

describe('linearScore – horgonyok és határok', () => {
  const higher = { worst: 0.05, best: 0.2 };
  const lower = { worst: 35, best: 12 };

  it.each([
    [0.05, 0],
    [0.2, 100],
    [0.125, 50],
    [0.0499, 0],
    [0.2001, 100],
    [-5, 0], // szélsőérték: levágás
    [1e12, 100],
  ])('magasabb a jobb: %p → %p pont', (value, expected) => {
    expect(linearScore(value, higher)).toBe(expected);
  });

  it.each([
    [35, 0],
    [12, 100],
    [23.5, 50],
    [500, 0],
    [0.5, 100],
  ])('alacsonyabb a jobb: %p → %p pont', (value, expected) => {
    expect(linearScore(value, lower)).toBe(expected);
  });

  it('egy tizedesre kerekít, −0 nincs', () => {
    expect(linearScore(0.1, higher)).toBe(33.3);
    expect(roundScore(-0.04)).toBe(0);
    expect(Object.is(roundScore(-0.04), 0)).toBe(true);
  });

  it('súlyozott átlag újranormalizál; üres → null', () => {
    expect(weightedAverage([{ value: 80, weight: 0.3 }])).toBe(80);
    expect(weightedAverage([])).toBeNull();
    expect(
      weightedAverage([
        { value: 100, weight: 0.5 },
        { value: 0, weight: 0.5 },
      ]),
    ).toBe(50);
  });
});

describe('scoreMetric – hiány és szabály-ütközés nem 0 pont', () => {
  const rule = {
    featureId: 'x',
    weight: 1,
    rule: { kind: 'linear', worst: 0, best: 1 },
    rationale: 'r',
  } as const;

  it('hiányzó mutató: score null, ok a bemenetből', () => {
    const m = scoreMetric(missing('x', 'nincs FY'), rule, policy);
    expect(m.score).toBeNull();
    expect(m.inputStatus).toBe('MISSING');
    expect(m.reason).toContain('nincs FY');
  });

  it('N/M (pl. negatív saját tőke): score null, nem 0', () => {
    const m = scoreMetric(notMeaningful('x'), rule, policy);
    expect(m.score).toBeNull();
    expect(m.inputStatus).toBe('NOT_MEANINGFUL');
  });

  it('a leképező nem adta át: NO_FEATURE', () => {
    expect(scoreMetric(undefined, rule, policy)).toMatchObject({
      score: null,
      inputStatus: 'NO_FEATURE',
      origin: 'missing',
    });
  });

  it('AI-értelmezés forrású érték nem pontozható', () => {
    const f = num('x', 0.5, { provenance: { kind: 'ai_interpretation' } });
    expect(scoreMetric(f, rule, policy)).toMatchObject({ score: null, qualityFactor: null });
  });

  it('kategória-szabály: ismert érték pontot kap, ismeretlen nem (és nem 0)', () => {
    const categorical = {
      featureId: 'replication',
      weight: 1,
      rule: { kind: 'categorical', scores: { physical_full: 100, synthetic: 60 } },
      rationale: 'r',
    } as const;
    expect(scoreMetric(cat('replication', 'synthetic'), categorical, policy).score).toBe(60);
    const unknown = scoreMetric(cat('replication', 'other'), categorical, policy);
    expect(unknown.score).toBeNull();
    expect(unknown.reason).toContain('„other”');
  });

  it('pénzösszeg: csak a konfigurált pénznemben pontozható', () => {
    const money = {
      featureId: 'aum',
      weight: 1,
      rule: { kind: 'linear_money', byCurrency: { EUR: { worst: 0, best: 100 } } },
      rationale: 'r',
    } as const;
    const eur = num('aum', 50, { unit: 'money', provenance: { currency: 'EUR' as never } });
    const huf = num('aum', 50, { unit: 'money', provenance: { currency: 'HUF' as never } });
    expect(scoreMetric(eur, money, policy).score).toBe(50);
    expect(scoreMetric(huf, money, policy)).toMatchObject({ score: null, currency: 'HUF' });
  });

  it('adatminőségi szorzó: fajta × frissesség × ablakhossz', () => {
    const q = (f: ScoringFeature) => scoreMetric(f, rule, policy).qualityFactor;
    expect(q(num('x', 0.5))).toBe(1);
    expect(q(num('x', 0.5, { provenance: { kind: 'estimated' } }))).toBe(0.7);
    expect(q(num('x', 0.5, { provenance: { kind: 'user_input', freshness: 'STALE' } }))).toBe(0.6);
    expect(q(num('x', 0.5, { reliability: 'short_window' }))).toBe(0.8);
    expect(q(num('x', 0.5, { provenance: { kind: 'mock' } }))).toBe(0.3);
  });

  it('NaN soha nem jut be OK-ként (metricOk őr) → nem pontozott', () => {
    const f = num('x', metricOk(Number.NaN, prov()));
    expect(scoreMetric(f, rule, policy)).toMatchObject({
      score: null,
      inputStatus: 'INVALID_INPUT',
    });
  });
});

const category: CategoryConfig = {
  id: 'C',
  label: 'Kat',
  weight: 100,
  minCoverage: 0.5,
  description: '',
  metrics: [
    { featureId: 'a', weight: 0.6, rule: { kind: 'linear', worst: 0, best: 1 }, rationale: '' },
    { featureId: 'b', weight: 0.4, rule: { kind: 'linear', worst: 0, best: 1 }, rationale: '' },
  ],
};
const byId = (features: ScoringFeature[]) => new Map(features.map((f) => [f.id, f]));

describe('scoreCategory – hiányzó adat kezelése (D-074)', () => {
  it('minden mutató megvan → SCORED, súlyozott átlag', () => {
    const c = scoreCategory(category, byId([num('a', 1), num('b', 0.5)]), policy);
    expect(c).toMatchObject({ status: 'SCORED', score: 80, coverage: 1 });
  });

  it('hiányzó mutató NEM 0: újranormalizálás a meglévőre (nem 60 × 1 = 60, hanem 100)', () => {
    const c = scoreCategory(category, byId([num('a', 1), missing('b')]), policy);
    expect(c.status).toBe('PARTIAL');
    expect(c.score).toBe(100);
    expect(c.coverage).toBe(0.6);
    expect(c.missing).toEqual([
      { featureId: 'b', status: 'MISSING', reason: 'MISSING: nincs adat' },
    ]);
  });

  it('lefedettség a minimum alatt → INSUFFICIENT_DATA, score null', () => {
    const c = scoreCategory(category, byId([missing('a'), num('b', 1)]), policy);
    expect(c).toMatchObject({ status: 'INSUFFICIENT_DATA', score: null, coverage: 0.4 });
    expect(c.rationale.join(' ')).toContain('40% < 50%');
  });

  it('lefedettség pontosan a minimumon → PARTIAL (≥ határ)', () => {
    const half = { ...category, minCoverage: 0.6 };
    expect(scoreCategory(half, byId([num('a', 0.5), missing('b')]), policy).status).toBe('PARTIAL');
  });

  it('adatminőség és frissesség: legrosszabb frissesség, legrégebbi asOf, problémák listája', () => {
    const c = scoreCategory(
      category,
      byId([
        num('a', 1, { provenance: { freshness: 'STALE', asOf: '2025-12-31' as never } }),
        num('b', 1, { provenance: { kind: 'estimated' } }),
      ]),
      policy,
    );
    expect(c.freshness).toEqual({ worst: 'STALE', oldestAsOf: '2025-12-31' });
    expect(c.dataQuality.factor).toBe(0.73); // 0,6 × 0,75 + 0,4 × 0,7
    expect(c.dataQuality.level).toBe('MEDIUM');
    expect(c.dataQuality.issues).toEqual(['a: frissesség STALE', 'b: estimated']);
  });

  it('0 súlyú kategória: NOT_SCORED indoklással', () => {
    const moat = DEFAULT_STOCK_SCORE_CONFIG.categories.find((c) => c.id === 'MOAT');
    if (moat === undefined) throw new Error('MOAT');
    const c = scoreCategory(moat, new Map(), policy);
    expect(c).toMatchObject({ status: 'NOT_SCORED', score: null, weight: 0 });
    expect(c.rationale[0]).toContain('forrásolt');
  });
});

describe('buildScoreCard – összpontszám és visszakövethetőség', () => {
  const config: ScoreConfig = {
    id: 't',
    version: '1',
    subjectKind: 'stock',
    totalWeight: 100,
    minTotalCoverage: 0.6,
    quality: policy,
    categories: [
      { ...category, id: 'A', weight: 60 },
      {
        ...category,
        id: 'B',
        weight: 40,
        metrics: [
          { featureId: 'c', weight: 1, rule: { kind: 'linear', worst: 0, best: 1 }, rationale: '' },
        ],
      },
    ],
  };

  it('minden kategória → SCORED; az effektív súlyok összege 1', () => {
    const card = buildScoreCard(config, [num('a', 1), num('b', 0.5), num('c', 0.25)]);
    expect(card.totalScore).toBe(58); // 0,6 × 80 + 0,4 × 25
    expect(card.totalStatus).toBe('SCORED');
    expect(card.categories.reduce((s, c) => s + (c.effectiveWeight ?? 0), 0)).toBeCloseTo(1, 10);
  });

  it('kategória kimarad → újranormalizált összpontszám, PARTIAL, lefedettség jelölve', () => {
    const card = buildScoreCard(config, [num('a', 1), num('b', 0.5), missing('c')]);
    expect(card.totalScore).toBe(80);
    expect(card.totalStatus).toBe('PARTIAL');
    expect(card.scoredWeightShare).toBe(0.6);
    expect(card.dataCoverage).toBe(0.6);
    expect(card.categories.find((c) => c.id === 'B')?.effectiveWeight).toBeNull();
  });

  it('a pontozott súly a minimum alatt → nincs összpontszám (nem 0)', () => {
    const card = buildScoreCard(config, [missing('a'), missing('b'), num('c', 1)]);
    expect(card.totalScore).toBeNull();
    expect(card.totalStatus).toBe('INSUFFICIENT_DATA');
  });

  it('semmi adat → null, nem 0', () => {
    const card = buildScoreCard(config, []);
    expect(card.totalScore).toBeNull();
    expect(card.categories.every((c) => c.score === null)).toBe(true);
  });

  it('visszakövethető: a kategória a kiírt mutatópontokból, az összpont a kategóriákból számolható', () => {
    const card = buildScoreCard(config, [num('a', 0.37), num('b', 0.91), num('c', 0.123)]);
    for (const c of card.categories) {
      const scored = c.metrics.filter((m) => m.score !== null);
      const w = scored.reduce((s, m) => s + m.weight, 0);
      expect(c.score).toBe(
        roundScore(scored.reduce((s, m) => s + (m.score ?? 0) * m.weight, 0) / w),
      );
    }
    const total = card.categories.reduce((s, c) => s + (c.score ?? 0) * c.weight, 0) / 100;
    expect(card.totalScore).toBe(roundScore(total));
  });

  it('duplikált azonosító a kártya szintjén: az első számít (az evaluateScoring előtte elutasítja)', () => {
    const card = buildScoreCard(config, [num('c', 1), num('c', 0), num('a', 1), num('b', 1)]);
    expect(card.categories.find((c) => c.id === 'B')?.score).toBe(100);
  });
});

describe('összehasonlítás és confidence-ágak', () => {
  it('compare: minden operátor; eltérő típus → false', () => {
    expect([
      compare(1, 'lt', 2),
      compare(2, 'lte', 2),
      compare(3, 'gt', 2),
      compare(2, 'gte', 2),
    ]).toEqual([true, true, true, true]);
    expect(compare('a', 'eq', 'a')).toBe(true);
    expect(compare('a', 'lt', 1)).toBe(false);
  });

  it('demóadat egyetlen mutatóban: magas lefedettség mellett is legfeljebb LOW', () => {
    const config: ScoreConfig = {
      ...DEFAULT_STOCK_SCORE_CONFIG,
      categories: [{ ...category, id: 'A', weight: 100 }],
    };
    const card = buildScoreCard(config, [
      num('a', 1),
      num('b', 1, { provenance: { kind: 'mock' } }),
    ]);
    const confidence = assessConfidence(card, { high: 80, medium: 45 });
    expect(confidence.score).toBe(72); // 100 × 1 × (0,6 × 1 + 0,4 × 0,3)
    expect(confidence.level).toBe('LOW');
    expect(confidence.reasons.join(' ')).toContain('mock');
  });
});
