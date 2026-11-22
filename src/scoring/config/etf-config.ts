/**
 * ETF-score és -döntés kiinduló konfigurációja (PHASE 10, D-073, D-075).
 *
 * Az ETF-score az alap SZERKEZETÉT értékeli (költség, diverzifikáció, követés, méret, likviditás,
 * replikáció, kockázat, koncentráció, deviza) – NEM a mögöttes vállalatok minőségét (az a
 * részvény-score dolga; a kettő nem keveredik). Bemenet: a PHASE 08 `EtfAnalysis.features`.
 *
 * Súlyok (Σ = 100): Diversification 15, Cost 20, Tracking 15, Liquidity 5, Size 10,
 * Structure 10, Risk 10, Concentration 10, Currency Risk 5.
 *
 * Kontextus-mutatók (nem pontozott, mert preferencia vagy eszközosztály-függő): volatilitás
 * (PHASE 08 `context` irány), legnagyobb ország súlya (regionális ETF-nél 100% a cél),
 * osztalékkezelés, UCITS, domicil, devizafedezés ténye.
 */
import type { DecisionConfig, ScoreConfig } from '../types';
import {
  DEFAULT_CONFIDENCE,
  DEFAULT_DECISION_LABELS,
  DEFAULT_QUALITY_POLICY,
} from './shared-defaults';

const linear = (worst: number, best: number) => ({ kind: 'linear', worst, best }) as const;

export const DEFAULT_ETF_SCORE_CONFIG: ScoreConfig = {
  id: 'etf-default',
  version: '2026-11-22.1',
  subjectKind: 'etf',
  totalWeight: 100,
  minTotalCoverage: 0.6,
  quality: DEFAULT_QUALITY_POLICY,
  categories: [
    {
      id: 'DIVERSIFICATION',
      label: 'Diverzifikáció',
      weight: 15,
      minCoverage: 0.4,
      description: 'Tételszám és effektív tételszám (1 / HHI).',
      metrics: [
        {
          featureId: 'holdingsCount',
          weight: 0.4,
          rule: linear(20, 500),
          rationale: '20 tétel szűk, 500+ széles.',
        },
        {
          featureId: 'effectiveHoldings',
          weight: 0.6,
          rule: linear(10, 150),
          rationale: 'A súlyozott koncentrációt is figyelembe veszi.',
        },
      ],
    },
    {
      id: 'COST',
      label: 'Költség',
      weight: 20,
      minCoverage: 1,
      description: 'Teljes költséghányad (TER).',
      metrics: [
        {
          featureId: 'ter',
          weight: 1,
          rule: linear(0.0075, 0.0007),
          rationale: '0,07% nagyon olcsó, 0,75% drága (széles indexalapoknál).',
        },
      ],
    },
    {
      id: 'TRACKING',
      label: 'Követés',
      weight: 15,
      minCoverage: 0.6,
      description: 'Évesített tracking difference és tracking error total return indexhez (D-069).',
      metrics: [
        {
          featureId: 'annualizedTrackingDifference',
          weight: 0.6,
          rule: linear(-0.01, 0),
          rationale: '0 vagy jobb: 100 pont; −1%/év: 0 pont.',
        },
        {
          featureId: 'trackingError',
          weight: 0.4,
          rule: linear(0.01, 0.001),
          rationale: '0,1% szoros, 1% laza követés.',
        },
      ],
    },
    {
      id: 'LIQUIDITY',
      label: 'Likviditás',
      weight: 5,
      minCoverage: 1,
      description: 'Átlagos napi forgalom (kézi bevitel, KI-67).',
      metrics: [
        {
          featureId: 'averageDailyTradedValue',
          weight: 1,
          rule: {
            kind: 'linear_money',
            byCurrency: {
              EUR: { worst: 100_000, best: 5_000_000 },
              USD: { worst: 100_000, best: 5_000_000 },
              GBP: { worst: 100_000, best: 5_000_000 },
            },
          },
          rationale:
            'Napi 100 ezer alatt szűk, 5 millió felett bőséges forgalom. Más pénznemben nem pontozott.',
        },
      ],
    },
    {
      id: 'SIZE',
      label: 'Méret és kor',
      weight: 10,
      minCoverage: 0.6,
      description: 'Alapméret (megszűnési kockázat közelítése) és az alap kora.',
      metrics: [
        {
          featureId: 'aum',
          weight: 0.7,
          rule: {
            kind: 'linear_money',
            byCurrency: {
              EUR: { worst: 50_000_000, best: 1_000_000_000 },
              USD: { worst: 50_000_000, best: 1_000_000_000 },
              GBP: { worst: 50_000_000, best: 1_000_000_000 },
            },
          },
          rationale: '50 millió alatt megszűnési kockázat, 1 milliárd felett stabil méret.',
        },
        {
          featureId: 'fundAgeYears',
          weight: 0.3,
          rule: linear(1, 5),
          rationale: '1 év alatt rövid múlt, 5 év felett bejáratott.',
        },
      ],
    },
    {
      id: 'STRUCTURE',
      label: 'Szerkezet',
      weight: 10,
      minCoverage: 1,
      description: 'Replikációs módszer (partnerkockázat, átláthatóság).',
      metrics: [
        {
          featureId: 'replication',
          weight: 1,
          rule: {
            kind: 'categorical',
            scores: { physical_full: 100, physical_sampling: 85, synthetic: 60 },
          },
          rationale:
            'Fizikai teljes replikáció a legátláthatóbb; a szintetikus swap-partnerkockázatot hordoz.',
        },
      ],
    },
    {
      id: 'RISK',
      label: 'Kockázat',
      weight: 10,
      minCoverage: 1,
      description: 'Legnagyobb visszaesés az elemzési ablakban (D-066, D-070).',
      metrics: [
        {
          featureId: 'maxDrawdown',
          weight: 1,
          rule: linear(-0.5, -0.1),
          rationale: '−10% enyhe, −50% súlyos visszaesés.',
        },
      ],
    },
    {
      id: 'CONCENTRATION',
      label: 'Koncentráció',
      weight: 10,
      minCoverage: 0.6,
      description: 'Top 10, legnagyobb tétel és legnagyobb szektor súlya.',
      metrics: [
        {
          featureId: 'top10Weight',
          weight: 0.4,
          rule: linear(0.6, 0.15),
          rationale: 'Top 10 ≤ 15% széles, ≥ 60% koncentrált.',
        },
        {
          featureId: 'largestHoldingWeight',
          weight: 0.3,
          rule: linear(0.2, 0.03),
          rationale: 'Egy tétel ≤ 3% vs. ≥ 20%.',
        },
        {
          featureId: 'largestSectorWeight',
          weight: 0.3,
          rule: linear(0.5, 0.2),
          rationale: 'Legnagyobb szektor ≤ 20% vs. ≥ 50%.',
        },
      ],
    },
    {
      id: 'CURRENCY_RISK',
      label: 'Devizakockázat',
      weight: 5,
      minCoverage: 1,
      description: 'Fedezetlen idegen devizás kitettség a kijelzési devizához képest.',
      metrics: [
        {
          featureId: 'unhedgedForeignShare',
          weight: 1,
          rule: linear(1, 0),
          rationale: '0% fedezetlen idegen deviza 100 pont, 100% 0 pont.',
        },
      ],
    },
  ],
};

export const DEFAULT_ETF_DECISION_CONFIG: DecisionConfig = {
  id: 'etf-decision-default',
  version: '2026-11-22.1',
  subjectKind: 'etf',
  dimensions: [
    { id: 'cost', label: 'Költség', categories: [{ categoryId: 'COST', weight: 1 }] },
    {
      id: 'diversification',
      label: 'Diverzifikáció és koncentráció',
      categories: [
        { categoryId: 'DIVERSIFICATION', weight: 0.5 },
        { categoryId: 'CONCENTRATION', weight: 0.5 },
      ],
    },
    { id: 'tracking', label: 'Követés', categories: [{ categoryId: 'TRACKING', weight: 1 }] },
    {
      id: 'structure',
      label: 'Szerkezet, méret, likviditás',
      categories: [
        { categoryId: 'STRUCTURE', weight: 0.5 },
        { categoryId: 'SIZE', weight: 0.3 },
        { categoryId: 'LIQUIDITY', weight: 0.2 },
      ],
    },
    {
      id: 'risk',
      label: 'Kockázat és deviza',
      categories: [
        { categoryId: 'RISK', weight: 0.7 },
        { categoryId: 'CURRENCY_RISK', weight: 0.3 },
      ],
    },
  ],
  flagRules: [
    {
      id: 'portfolioOverweight',
      featureId: 'portfolioWeight',
      comparator: 'gt',
      threshold: 0.4,
      description: 'Az ETF súlya a portfólióban > 40%',
    },
  ],
  externalFlags: {},
  rules: [
    {
      id: 'etf-buy',
      label: 'BUY',
      description: 'Erős szerkezeti összkép: alacsony költség, jó diverzifikáció és szerkezet.',
      all: [
        { kind: 'total', min: 70 },
        { kind: 'dimension', dimension: 'cost', min: 60 },
        { kind: 'dimension', dimension: 'diversification', min: 50 },
        { kind: 'dimension', dimension: 'structure', min: 50 },
      ],
    },
    {
      id: 'etf-hold',
      label: 'HOLD',
      description: 'Elfogadható szerkezet.',
      all: [{ kind: 'total', min: 50 }],
    },
    {
      id: 'etf-reduce',
      label: 'REDUCE',
      description: 'Gyengébb szerkezet.',
      all: [{ kind: 'total', min: 35 }],
    },
    {
      id: 'etf-sell',
      label: 'SELL',
      description: 'Alapértelmezett: gyenge szerkezeti összkép.',
      all: [],
    },
  ],
  caps: [
    {
      id: 'cap-low-confidence',
      description: 'Alacsony adatteljesség/-minőség mellett nincs Buy.',
      when: [{ kind: 'confidence', levels: ['LOW'] }],
      maxLabel: 'WATCH',
    },
    {
      id: 'cap-portfolio-overweight',
      description: 'Ha az ETF már túlsúlyos a portfólióban, legfeljebb Hold.',
      when: [{ kind: 'flag', flag: 'portfolioOverweight', equals: true }],
      maxLabel: 'HOLD',
    },
  ],
  labels: {
    ...DEFAULT_DECISION_LABELS,
    BUY: {
      text: 'Buy',
      description:
        'Az alap szerkezete (költség, diverzifikáció, replikáció) erős a konfigurált küszöbök szerint. Nem a piac vagy az index jövőbeli hozamáról szól.',
    },
  },
  confidence: DEFAULT_CONFIDENCE,
  thesis: {
    dataGapCategoryWeight: 10,
    riskRules: [
      {
        id: 'etf-high-ter',
        kind: 'fundamental',
        severity: 'MEDIUM',
        dimension: 'cost',
        featureId: 'ter',
        comparator: 'gt',
        threshold: 0.005,
        statement: 'Magas költség: TER > 0,5%.',
        invalidatesPositive: 'Ha a TER 0,5% fölé emelkedik.',
        invalidatesNegative: 'Ha a TER 0,5% alá csökken.',
      },
      {
        id: 'etf-poor-tracking',
        kind: 'fundamental',
        severity: 'MEDIUM',
        dimension: 'tracking',
        featureId: 'annualizedTrackingDifference',
        comparator: 'lt',
        threshold: -0.005,
        statement: 'Gyenge követés: évesített tracking difference < −0,5%.',
        invalidatesPositive: 'Ha az évesített tracking difference −0,5% alá romlik.',
        invalidatesNegative: 'Ha az évesített tracking difference −0,5% fölé javul.',
      },
      {
        id: 'etf-young-fund',
        kind: 'fundamental',
        severity: 'LOW',
        dimension: 'structure',
        featureId: 'fundAgeYears',
        comparator: 'lt',
        threshold: 3,
        statement: 'Fiatal alap (< 3 év): rövid követési múlt.',
        invalidatesPositive: 'Nem alkalmazható (az alap kora csak nő).',
        invalidatesNegative: 'Ha az alap eléri a 3 éves kort.',
      },
      {
        id: 'etf-concentrated',
        kind: 'risk',
        severity: 'MEDIUM',
        dimension: 'diversification',
        featureId: 'top10Weight',
        comparator: 'gt',
        threshold: 0.5,
        statement: 'Koncentrált portfólió: a top 10 tétel súlya > 50%.',
        invalidatesPositive: 'Ha a top 10 tétel súlya 50% fölé nő.',
        invalidatesNegative: 'Ha a top 10 tétel súlya 50% alá csökken.',
      },
      {
        id: 'etf-synthetic',
        kind: 'risk',
        severity: 'LOW',
        dimension: 'structure',
        featureId: 'replication',
        comparator: 'eq',
        threshold: 'synthetic',
        statement: 'Szintetikus replikáció: swap-partnerkockázat.',
        invalidatesPositive: 'Ha az alap szintetikus replikációra vált.',
        invalidatesNegative: 'Ha az alap fizikai replikációra vált.',
      },
      {
        id: 'etf-currency',
        kind: 'risk',
        severity: 'LOW',
        dimension: 'risk',
        featureId: 'unhedgedForeignShare',
        comparator: 'gt',
        threshold: 0.5,
        statement: 'A kitettség több mint fele fedezetlen idegen devizában van.',
        invalidatesPositive: 'Ha a fedezetlen idegen devizás kitettség 50% fölé nő.',
        invalidatesNegative: 'Ha a fedezetlen idegen devizás kitettség 50% alá csökken.',
      },
      {
        id: 'etf-portfolio-overweight',
        kind: 'portfolio',
        severity: 'MEDIUM',
        dimension: null,
        flag: 'portfolioOverweight',
        statement: 'Az ETF súlya a portfólióban 40% felett.',
        invalidatesPositive: 'Ha az ETF súlya a portfólióban 40% fölé nő.',
        invalidatesNegative: 'Ha az ETF súlya 40% alá csökken.',
      },
    ],
  },
};
