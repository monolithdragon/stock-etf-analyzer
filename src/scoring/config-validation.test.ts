/**
 * PHASE 10 feladat 3. – a súlyok és szabályok automatikus ellenőrzése.
 */
import { evaluateScoring } from './evaluate';
import {
  DEFAULT_ETF_DECISION_CONFIG,
  DEFAULT_ETF_SCORE_CONFIG,
  DEFAULT_STOCK_DECISION_CONFIG,
  DEFAULT_STOCK_SCORE_CONFIG,
  decisionConfigIssues,
  scoreConfigIssues,
  validateConfigs,
  type DecisionConfig,
  type ScoreConfig,
} from './index';
import { stockFeatures, stockInput } from './testing';

const paths = (issues: readonly { path: string }[]) => issues.map((i) => i.path);

describe('kiinduló konfigurációk', () => {
  it.each([
    ['részvény', DEFAULT_STOCK_SCORE_CONFIG, DEFAULT_STOCK_DECISION_CONFIG],
    ['ETF', DEFAULT_ETF_SCORE_CONFIG, DEFAULT_ETF_DECISION_CONFIG],
  ] as const)(
    '%s: érvényes, Σ kategóriasúly = 100, kategórián belül Σ = 1',
    (_n, score, decision) => {
      expect(scoreConfigIssues(score)).toEqual([]);
      expect(decisionConfigIssues(decision, score)).toEqual([]);
      expect(score.categories.reduce((s, c) => s + c.weight, 0)).toBe(100);
      for (const c of score.categories.filter((x) => x.weight > 0)) {
        expect(c.metrics.reduce((s, m) => s + m.weight, 0)).toBeCloseTo(1, 12);
      }
    },
  );

  it('a részvény-score kategóriái a promptban kértek; a MOAT szándékosan 0 súlyú', () => {
    expect(DEFAULT_STOCK_SCORE_CONFIG.categories.map((c) => [c.id, c.weight])).toEqual([
      ['BUSINESS_QUALITY', 10],
      ['GROWTH', 15],
      ['PROFITABILITY', 15],
      ['BALANCE_SHEET', 15],
      ['CASH_FLOW', 15],
      ['MOAT', 0],
      ['MANAGEMENT', 5],
      ['VALUATION', 25],
    ]);
  });

  it('az ETF-score kategóriái nem fedik a részvényéit (nincs keveredés)', () => {
    const stock = new Set(DEFAULT_STOCK_SCORE_CONFIG.categories.map((c) => c.id));
    expect(
      DEFAULT_ETF_SCORE_CONFIG.categories.map((c) => c.id).filter((id) => stock.has(id)),
    ).toEqual([]);
    const stockFeatureIds = new Set(
      DEFAULT_STOCK_SCORE_CONFIG.categories.flatMap((c) => c.metrics.map((m) => m.featureId)),
    );
    const etfFeatureIds = DEFAULT_ETF_SCORE_CONFIG.categories.flatMap((c) =>
      c.metrics.map((m) => m.featureId),
    );
    expect(etfFeatureIds.filter((id) => stockFeatureIds.has(id))).toEqual([]);
  });
});

describe('hibás score-konfiguráció → VALIDATION, mezőútvonallal', () => {
  const withCategories = (fn: (c: ScoreConfig['categories']) => ScoreConfig['categories']) => ({
    ...DEFAULT_STOCK_SCORE_CONFIG,
    categories: fn(DEFAULT_STOCK_SCORE_CONFIG.categories),
  });

  it('kategóriasúly-összeg ≠ 100', () => {
    const bad = withCategories((cs) =>
      cs.map((c) => (c.id === 'GROWTH' ? { ...c, weight: 14 } : c)),
    );
    const issues = scoreConfigIssues(bad);
    expect(paths(issues)).toEqual(['categories']);
    expect(issues[0]?.message).toContain('most: 99');
  });

  it('lebegőpontos tűrés: 0,1 + 0,2 + 0,7 mutatósúly elfogadott', () => {
    const ok = withCategories((cs) =>
      cs.map((c) =>
        c.id === 'BUSINESS_QUALITY'
          ? {
              ...c,
              metrics: [
                { ...c.metrics[0]!, weight: 0.1 },
                { ...c.metrics[1]!, weight: 0.2 },
                { ...c.metrics[1]!, featureId: 'other', weight: 0.7 },
              ],
            }
          : c,
      ),
    );
    expect(scoreConfigIssues(ok)).toEqual([]);
  });

  it('mutatósúly-összeg ≠ 1, negatív súly, egyforma horgonyok, duplikált mutató', () => {
    const bad = withCategories((cs) =>
      cs.map((c) =>
        c.id === 'BUSINESS_QUALITY'
          ? {
              ...c,
              metrics: [
                { ...c.metrics[0]!, weight: -0.5, rule: { kind: 'linear', worst: 1, best: 1 } },
                { ...c.metrics[0]!, weight: 0.5 },
              ],
            }
          : c,
      ),
    );
    expect(paths(scoreConfigIssues(bad))).toEqual([
      'categories[0].metrics[0].weight',
      'categories[0].metrics[0].rule',
      'categories[0].metrics[1]',
      'categories[0].metrics',
    ]);
  });

  it('0 súlyú kategória mutatóval / indok nélkül', () => {
    const bad = withCategories((cs) =>
      cs.map((c) => (c.id === 'MOAT' ? { ...c, notScoredReason: undefined } : c)),
    );
    expect(paths(scoreConfigIssues(bad))).toEqual(['categories[5]']);
  });

  it('kategória-pont 0–100 között; pénznem nélküli pénzszabály', () => {
    const bad: ScoreConfig = {
      ...DEFAULT_ETF_SCORE_CONFIG,
      categories: DEFAULT_ETF_SCORE_CONFIG.categories.map((c) =>
        c.id === 'STRUCTURE'
          ? {
              ...c,
              metrics: [{ ...c.metrics[0]!, rule: { kind: 'categorical', scores: { x: 120 } } }],
            }
          : c.id === 'LIQUIDITY'
            ? {
                ...c,
                metrics: [{ ...c.metrics[0]!, rule: { kind: 'linear_money', byCurrency: {} } }],
              }
            : c,
      ),
    };
    expect(paths(scoreConfigIssues(bad))).toEqual([
      'categories[3].metrics[0].rule',
      'categories[5].metrics[0].rule.scores.x',
    ]);
  });

  it('hibás minőségi szorzó és confidence-szintek', () => {
    const bad: ScoreConfig = {
      ...DEFAULT_STOCK_SCORE_CONFIG,
      quality: {
        ...DEFAULT_STOCK_SCORE_CONFIG.quality,
        shortWindow: 1.5,
        levels: { high: 0.5, medium: 0.7 },
      },
    };
    expect(paths(scoreConfigIssues(bad))).toEqual(['quality.shortWindow', 'quality.levels']);
  });
});

describe('hibás döntési konfiguráció', () => {
  const issuesOf = (decision: DecisionConfig) =>
    paths(decisionConfigIssues(decision, DEFAULT_STOCK_SCORE_CONFIG));

  it('nincs fallback-szabály a végén', () => {
    const bad = {
      ...DEFAULT_STOCK_DECISION_CONFIG,
      rules: DEFAULT_STOCK_DECISION_CONFIG.rules.slice(0, -1),
    };
    expect(issuesOf(bad)).toEqual(['rules[5]']);
  });

  it('ismeretlen dimenzió, jelzés és kategória', () => {
    const bad: DecisionConfig = {
      ...DEFAULT_STOCK_DECISION_CONFIG,
      dimensions: [
        ...DEFAULT_STOCK_DECISION_CONFIG.dimensions,
        { id: 'x', label: 'x', categories: [{ categoryId: 'NOPE', weight: 1 }] },
      ],
      rules: [
        {
          id: 'r',
          label: 'BUY',
          description: '',
          all: [
            { kind: 'dimension', dimension: 'ghost', min: 50 },
            { kind: 'flag', flag: 'ghostFlag', equals: true },
          ],
        },
        ...DEFAULT_STOCK_DECISION_CONFIG.rules,
      ],
    };
    expect(issuesOf(bad)).toEqual([
      'dimensions[6].categories[0]',
      'rules[0].all[0]',
      'rules[0].all[1]',
    ]);
  });

  it('üres címkeszöveg és fordított confidence-szintek', () => {
    const bad: DecisionConfig = {
      ...DEFAULT_STOCK_DECISION_CONFIG,
      labels: { ...DEFAULT_STOCK_DECISION_CONFIG.labels, HOLD: { text: ' ', description: '' } },
      confidence: { high: 40, medium: 60 },
    };
    expect(issuesOf(bad)).toEqual(['labels.HOLD', 'confidence']);
  });
});

describe('a részvény- és az ETF-rendszer nem keverhető', () => {
  it('részvény-bemenet ETF-konfigurációval → VALIDATION, pontozás nélkül', () => {
    const result = evaluateScoring(
      stockInput(stockFeatures(0.8)),
      DEFAULT_ETF_SCORE_CONFIG,
      DEFAULT_ETF_DECISION_CONFIG,
    );
    expect(result.ok).toBe(false);
    if (!result.ok && result.error.kind === 'VALIDATION') {
      expect(paths(result.error.issues)).toContain('scoreConfig.subjectKind');
    }
  });

  it('eltérő eszközfajtájú score- és döntési konfiguráció', () => {
    const result = validateConfigs(
      DEFAULT_STOCK_SCORE_CONFIG,
      DEFAULT_ETF_DECISION_CONFIG,
      'stock',
    );
    expect(result.ok).toBe(false);
    if (!result.ok && result.error.kind === 'VALIDATION') {
      expect(paths(result.error.issues)).toContain('decisionConfig.subjectKind');
    }
  });
});

describe('további validációs ágak (táblázatos)', () => {
  const S = DEFAULT_STOCK_SCORE_CONFIG;
  const D = DEFAULT_STOCK_DECISION_CONFIG;
  const scoreCases: [string, ScoreConfig, string][] = [
    ['totalWeight ≤ 0', { ...S, totalWeight: 0 }, 'totalWeight'],
    ['minTotalCoverage > 1', { ...S, minTotalCoverage: 1.5 }, 'minTotalCoverage'],
    [
      'duplikált kategória',
      { ...S, categories: [...S.categories, { ...S.categories[5]! }] },
      'categories[8].id',
    ],
    [
      'minCoverage < 0',
      { ...S, categories: S.categories.map((c, i) => (i === 0 ? { ...c, minCoverage: -1 } : c)) },
      'categories[0].minCoverage',
    ],
    [
      'pozitív súly mutató nélkül',
      { ...S, categories: S.categories.map((c, i) => (i === 0 ? { ...c, metrics: [] } : c)) },
      'categories[0].metrics',
    ],
    [
      'negatív kategóriasúly',
      { ...S, categories: S.categories.map((c, i) => (i === 0 ? { ...c, weight: -10 } : c)) },
      'categories[0].weight',
    ],
    [
      'hibás frissesség-szorzó',
      { ...S, quality: { ...S.quality, freshness: { ...S.quality.freshness, STALE: 2 } } },
      'quality.STALE',
    ],
  ];
  it.each(scoreCases)('score: %s', (_name, config, path) => {
    expect(paths(scoreConfigIssues(config))).toContain(path);
  });

  const decisionCases: [string, DecisionConfig, string][] = [
    [
      'dimenzió forrás nélkül',
      { ...D, dimensions: [...D.dimensions, { id: 'empty', label: 'e', categories: [] }] },
      'dimensions[6]',
    ],
    [
      'dimenzió-súlyok összege ≠ 1, nem pozitív súly',
      {
        ...D,
        dimensions: [
          ...D.dimensions,
          { id: 'w', label: 'w', categories: [{ categoryId: 'GROWTH', weight: 0 }] },
        ],
      },
      'dimensions[6].categories[0].weight',
    ],
    [
      'duplikált dimenzió',
      { ...D, dimensions: [...D.dimensions, { ...D.dimensions[0]! }] },
      'dimensions[6]',
    ],
    [
      'hibás dimenzió-mutató szabály',
      {
        ...D,
        dimensions: D.dimensions.map((d) =>
          d.feature === undefined
            ? d
            : { ...d, feature: { ...d.feature, rule: { kind: 'linear', worst: 1, best: 1 } } },
        ),
      },
      'dimensions[5].feature.rule',
    ],
    [
      'nem véges jelzés-küszöb',
      { ...D, flagRules: [{ ...D.flagRules[0]!, threshold: Number.NaN }] },
      'flagRules[0].threshold',
    ],
    ['nincs szabály', { ...D, rules: [] }, 'rules'],
    ['plafon feltétel nélkül', { ...D, caps: [{ ...D.caps[0]!, when: [] }] }, 'caps[0].when'],
    [
      'tartomány-feltétel min/max nélkül és 0–100-on kívül',
      {
        ...D,
        caps: [
          { ...D.caps[0]!, when: [{ kind: 'total' }] },
          { ...D.caps[0]!, when: [{ kind: 'total', min: -1, max: 120 }] },
          { ...D.caps[0]!, when: [{ kind: 'confidence', levels: [] }] },
        ],
      },
      'caps[0].when[0]',
    ],
    [
      'thesis-szabály mutató ÉS jelzés egyszerre',
      {
        ...D,
        thesis: {
          ...D.thesis,
          riskRules: [{ ...D.thesis.riskRules[0]!, flag: 'mosPremium' }],
        },
      },
      'thesis.riskRules[0]',
    ],
    [
      'thesis-szabály ismeretlen jelzéssel',
      {
        ...D,
        thesis: {
          ...D.thesis,
          riskRules: [
            {
              id: 'x',
              kind: 'data',
              severity: 'LOW',
              dimension: null,
              flag: 'nope',
              statement: '',
              invalidatesPositive: '',
              invalidatesNegative: '',
            },
          ],
        },
      },
      'thesis.riskRules[0]',
    ],
  ];
  it.each(decisionCases)('döntés: %s', (_name, config, path) => {
    expect(paths(decisionConfigIssues(config, S))).toContain(path);
  });

  it('a tartomány-feltétel minden hibája külön útvonalon jelenik meg', () => {
    const config: DecisionConfig = {
      ...D,
      caps: [{ ...D.caps[0]!, when: [{ kind: 'total', min: -1, max: 120 }] }],
    };
    expect(paths(decisionConfigIssues(config, S))).toEqual([
      'caps[0].when[0].min',
      'caps[0].when[0].max',
    ]);
  });
});
