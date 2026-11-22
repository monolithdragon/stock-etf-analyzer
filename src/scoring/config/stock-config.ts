/**
 * Részvény-score és -döntés kiinduló konfigurációja (PHASE 10, D-073, D-075).
 *
 * A horgonyok SZÉLES, iparág-független elemzési konvenciók (mint a D-065 sávjai), NEM objektív
 * igazságok: bank, közmű vagy korai növekedési cég esetén mást jelentenek. Minden érték
 * felülírható. A score-horgonyok szándékosan függetlenek a D-065 LOW/MODERATE/HIGH sávjaitól
 * (az osztályozás, ez folytonos pontozás); mindkettő konfigurálható.
 *
 * Súlyok (Σ = 100): Business Quality 10, Growth 15, Profitability 15, Balance Sheet 15,
 * Cash Flow 15, Moat 0 (nem pontozott), Management 5, Valuation 25.
 */
import type { DecisionConfig, ScoreConfig } from '../types';
import {
  DEFAULT_CONFIDENCE,
  DEFAULT_DECISION_LABELS,
  DEFAULT_QUALITY_POLICY,
} from './shared-defaults';

const linear = (worst: number, best: number) => ({ kind: 'linear', worst, best }) as const;

export const DEFAULT_STOCK_SCORE_CONFIG: ScoreConfig = {
  id: 'stock-default',
  version: '2026-11-22.1',
  subjectKind: 'stock',
  totalWeight: 100,
  minTotalCoverage: 0.6,
  quality: DEFAULT_QUALITY_POLICY,
  categories: [
    {
      id: 'BUSINESS_QUALITY',
      label: 'Üzleti minőség',
      weight: 10,
      minCoverage: 0.5,
      description: 'Tőkehatékonyság és árazási erő számszerű közelítése (ROIC, bruttó árrés).',
      metrics: [
        {
          featureId: 'roic',
          weight: 0.6,
          rule: linear(0.05, 0.2),
          rationale:
            '5% körül a tőkeköltség alatt/közelében, 20% felett kiemelkedő tőkehatékonyság.',
        },
        {
          featureId: 'grossMargin',
          weight: 0.4,
          rule: linear(0.2, 0.6),
          rationale: 'Magas bruttó árrés = árazási erő közelítése (iparágfüggő!).',
        },
      ],
    },
    {
      id: 'GROWTH',
      label: 'Növekedés',
      weight: 15,
      minCoverage: 0.5,
      description: 'Többéves CAGR és a legutóbbi év növekedése.',
      metrics: [
        {
          featureId: 'revenueCagr3y',
          weight: 0.3,
          rule: linear(0, 0.12),
          rationale: '0% stagnálás, 12%/év erős növekedés.',
        },
        {
          featureId: 'revenueCagr5y',
          weight: 0.2,
          rule: linear(0, 0.12),
          rationale: 'Hosszabb távú megerősítés.',
        },
        {
          featureId: 'epsCagr3y',
          weight: 0.2,
          rule: linear(0, 0.15),
          rationale: 'Egy részvényre jutó eredmény növekedése.',
        },
        {
          featureId: 'fcfCagr3y',
          weight: 0.15,
          rule: linear(0, 0.15),
          rationale: 'Szabad cash flow növekedése.',
        },
        {
          featureId: 'revenueGrowth',
          weight: 0.15,
          rule: linear(-0.05, 0.12),
          rationale: 'Legutóbbi FY YoY; enyhe csökkenés 0 pont.',
        },
      ],
    },
    {
      id: 'PROFITABILITY',
      label: 'Jövedelmezőség',
      weight: 15,
      minCoverage: 0.5,
      description: 'Árrések és saját tőke arányos megtérülés a legutóbbi FY-ban.',
      metrics: [
        {
          featureId: 'operatingMargin',
          weight: 0.4,
          rule: linear(0.05, 0.3),
          rationale: '5% vékony, 30% kiemelkedő üzemi árrés.',
        },
        {
          featureId: 'netMargin',
          weight: 0.3,
          rule: linear(0.02, 0.2),
          rationale: '2% vékony, 20% kiemelkedő nettó árrés.',
        },
        {
          featureId: 'roe',
          weight: 0.3,
          rule: linear(0.05, 0.25),
          rationale: 'A ROE-t a tőkeáttétel torzíthatja; ezért csak 30% súly.',
        },
      ],
    },
    {
      id: 'BALANCE_SHEET',
      label: 'Mérleg',
      weight: 15,
      minCoverage: 0.5,
      description: 'Eladósodottság a saját tőkéhez és a működési eredményhez mérve.',
      metrics: [
        {
          featureId: 'debtToEquity',
          weight: 0.5,
          rule: linear(2.5, 0.3),
          rationale: '0,3 alatt konzervatív, 2,5 felett magas áttétel.',
        },
        {
          featureId: 'netDebtToEbitda',
          weight: 0.5,
          rule: linear(4, 0),
          rationale: 'Nettó készpénz (≤ 0) 100 pont, 4× felett 0 pont.',
        },
      ],
    },
    {
      id: 'CASH_FLOW',
      label: 'Cash flow',
      weight: 15,
      minCoverage: 0.5,
      description: 'Szabad cash flow termelés és az eredmény pénzzé válása.',
      metrics: [
        {
          featureId: 'fcfMargin',
          weight: 0.5,
          rule: linear(0, 0.2),
          rationale: 'Negatív FCF 0 pont, 20% FCF-árrés 100 pont.',
        },
        {
          featureId: 'fcfConversion',
          weight: 0.5,
          rule: linear(0.5, 1.2),
          rationale: 'FCF / nettó eredmény: 50% gyenge, 120% erős.',
        },
      ],
    },
    {
      id: 'MOAT',
      label: 'Versenyelőny (moat)',
      weight: 0,
      minCoverage: 1,
      description: 'Tartós versenyelőny.',
      metrics: [],
      notScoredReason:
        'Nem pontozott: a versenyelőny csak forrásolt kvalitatív lelettel értékelhető (D-063), és a lelet nem hordoz gépileg pontozható irányt. A rendszer szövegből nem pontoz. A ROIC és a bruttó árrés az Üzleti minőségben szerepel.',
    },
    {
      id: 'MANAGEMENT',
      label: 'Menedzsment / tőkeallokáció',
      weight: 5,
      minCoverage: 1,
      description:
        'Közelítés: a részvényszám 3 éves változása (hígítás vs. visszavásárlás). Csak tény-alapú proxy, nem a vezetés minősítése.',
      metrics: [
        {
          featureId: 'sharesCagr3y',
          weight: 1,
          rule: linear(0.03, -0.02),
          rationale: 'Évi 3% hígítás 0 pont, évi 2% nettó visszavásárlás 100 pont.',
        },
      ],
    },
    {
      id: 'VALUATION',
      label: 'Értékelés',
      weight: 25,
      minCoverage: 0.5,
      description:
        'Szorzók az aktuális árral és a legutóbbi FY-jal (D-062); alacsonyabb szorzó = több pont.',
      metrics: [
        {
          featureId: 'pe',
          weight: 0.25,
          rule: linear(35, 12),
          rationale: 'P/E 12 alatt olcsó, 35 felett drága (széles piaci konvenció).',
        },
        {
          featureId: 'pfcf',
          weight: 0.25,
          rule: linear(35, 12),
          rationale: 'P/FCF ugyanazzal a horgonnyal.',
        },
        {
          featureId: 'evToEbitda',
          weight: 0.2,
          rule: linear(22, 8),
          rationale: 'EV/EBITDA 8 alatt olcsó, 22 felett drága.',
        },
        {
          featureId: 'fcfYield',
          weight: 0.2,
          rule: linear(0.01, 0.07),
          rationale: 'FCF-hozam 1% alatt drága, 7% felett olcsó.',
        },
        {
          featureId: 'ps',
          weight: 0.1,
          rule: linear(10, 1.5),
          rationale: 'P/S csak kiegészítő (árrésfüggő).',
        },
      ],
    },
  ],
};

export const DEFAULT_STOCK_DECISION_CONFIG: DecisionConfig = {
  id: 'stock-decision-default',
  version: '2026-11-22.1',
  subjectKind: 'stock',
  dimensions: [
    { id: 'valuation', label: 'Értékelés', categories: [{ categoryId: 'VALUATION', weight: 1 }] },
    {
      id: 'quality',
      label: 'Minőség',
      categories: [
        { categoryId: 'BUSINESS_QUALITY', weight: 0.4 },
        { categoryId: 'PROFITABILITY', weight: 0.4 },
        { categoryId: 'MANAGEMENT', weight: 0.2 },
      ],
    },
    { id: 'growth', label: 'Növekedés', categories: [{ categoryId: 'GROWTH', weight: 1 }] },
    {
      id: 'balanceSheet',
      label: 'Mérleg',
      categories: [{ categoryId: 'BALANCE_SHEET', weight: 1 }],
    },
    { id: 'cashFlow', label: 'Cash flow', categories: [{ categoryId: 'CASH_FLOW', weight: 1 }] },
    {
      id: 'risk',
      label: 'Piaci kockázat (béta)',
      categories: [],
      feature: {
        featureId: 'beta',
        weight: 1,
        rule: linear(2, 0.8),
        rationale: 'Szolgáltatói béta: 0,8 alatt 100 pont, 2,0 felett 0 pont.',
      },
    },
  ],
  flagRules: [
    {
      id: 'portfolioOverweight',
      featureId: 'portfolioWeight',
      comparator: 'gt',
      threshold: 0.1,
      description: 'A pozíció súlya a portfólióban > 10%',
    },
  ],
  externalFlags: {
    mosDiscount: 'Base DCF: az ár érdemben a modellérték alatt (DISCOUNT_TO_MODEL, D-065 küszöb)',
    mosPremium: 'Base DCF: az ár érdemben a modellérték felett (PREMIUM_TO_MODEL, D-065 küszöb)',
    bearMosNegative: 'Bear DCF: az ár a modellérték felett (MOS < 0)',
  },
  rules: [
    {
      id: 'stock-strong-buy',
      label: 'STRONG_BUY',
      description:
        'Erős összkép, erős minőség és értékelés, stabil mérleg és cash flow, DCF-diszkont.',
      all: [
        { kind: 'total', min: 75 },
        { kind: 'dimension', dimension: 'quality', min: 70 },
        { kind: 'dimension', dimension: 'valuation', min: 65 },
        { kind: 'dimension', dimension: 'balanceSheet', min: 50 },
        { kind: 'dimension', dimension: 'cashFlow', min: 50 },
        { kind: 'flag', flag: 'mosDiscount', equals: true },
      ],
    },
    {
      id: 'stock-buy',
      label: 'BUY',
      description: 'Jó összkép, jó minőség, legalább közepes értékelés, mérleg és cash flow.',
      all: [
        { kind: 'total', min: 65 },
        { kind: 'dimension', dimension: 'quality', min: 60 },
        { kind: 'dimension', dimension: 'valuation', min: 50 },
        { kind: 'dimension', dimension: 'balanceSheet', min: 40 },
        { kind: 'dimension', dimension: 'cashFlow', min: 40 },
      ],
    },
    {
      id: 'stock-watch',
      label: 'WATCH',
      description: 'Jó minőség, de drága értékelés.',
      all: [
        { kind: 'dimension', dimension: 'quality', min: 60 },
        { kind: 'dimension', dimension: 'valuation', max: 50 },
      ],
    },
    {
      id: 'stock-hold',
      label: 'HOLD',
      description: 'Közepes összkép.',
      all: [{ kind: 'total', min: 45 }],
    },
    {
      id: 'stock-strong-sell',
      label: 'STRONG_SELL',
      description: 'Nagyon gyenge összkép gyenge mérleggel és cash flow-val.',
      all: [
        { kind: 'total', max: 25 },
        { kind: 'dimension', dimension: 'balanceSheet', max: 30 },
        { kind: 'dimension', dimension: 'cashFlow', max: 30 },
      ],
    },
    {
      id: 'stock-sell',
      label: 'SELL',
      description: 'Gyenge összkép.',
      all: [{ kind: 'total', max: 35 }],
    },
    {
      id: 'stock-reduce',
      label: 'REDUCE',
      description: 'Alapértelmezett: gyengébb összkép (összpontszám 35–45 között).',
      all: [],
    },
  ],
  caps: [
    {
      id: 'cap-low-confidence',
      description: 'Alacsony adatteljesség/-minőség mellett nincs Buy/Strong Buy.',
      when: [{ kind: 'confidence', levels: ['LOW'] }],
      maxLabel: 'WATCH',
    },
    {
      id: 'cap-dcf-premium',
      description:
        'Ha a Base DCF szerint az ár érdemben a modellérték felett van, legfeljebb Hold.',
      when: [{ kind: 'flag', flag: 'mosPremium', equals: true }],
      maxLabel: 'HOLD',
    },
    {
      id: 'cap-high-beta',
      description: 'Nagyon magas piaci kockázat (béta-pont < 25) mellett legfeljebb Watch.',
      when: [{ kind: 'dimension', dimension: 'risk', max: 25 }],
      maxLabel: 'WATCH',
    },
    {
      id: 'cap-portfolio-overweight',
      description:
        'Ha a pozíció már túlsúlyos a portfólióban, legfeljebb Hold (koncentrációs kockázat).',
      when: [{ kind: 'flag', flag: 'portfolioOverweight', equals: true }],
      maxLabel: 'HOLD',
    },
  ],
  labels: DEFAULT_DECISION_LABELS,
  confidence: DEFAULT_CONFIDENCE,
  thesis: {
    dataGapCategoryWeight: 10,
    riskRules: [
      {
        id: 'stock-net-loss',
        kind: 'fundamental',
        severity: 'HIGH',
        dimension: 'quality',
        featureId: 'netMargin',
        comparator: 'lt',
        threshold: 0,
        statement: 'Veszteséges a legutóbbi pénzügyi évben (nettó árrés < 0).',
        invalidatesPositive: 'Ha a nettó árrés negatívba fordul (veszteség).',
        invalidatesNegative: 'Ha a nettó árrés tartósan pozitívba fordul.',
      },
      {
        id: 'stock-negative-fcf',
        kind: 'fundamental',
        severity: 'HIGH',
        dimension: 'cashFlow',
        featureId: 'fcfMargin',
        comparator: 'lt',
        threshold: 0,
        statement: 'Negatív szabad cash flow a legutóbbi pénzügyi évben.',
        invalidatesPositive: 'Ha a szabad cash flow negatívvá válik.',
        invalidatesNegative: 'Ha a szabad cash flow pozitívvá válik.',
      },
      {
        id: 'stock-high-leverage',
        kind: 'fundamental',
        severity: 'MEDIUM',
        dimension: 'balanceSheet',
        featureId: 'netDebtToEbitda',
        comparator: 'gt',
        threshold: 3,
        statement: 'Magas eladósodottság: nettó adósság / EBITDA > 3.',
        invalidatesPositive: 'Ha a nettó adósság / EBITDA 3 fölé emelkedik.',
        invalidatesNegative: 'Ha a nettó adósság / EBITDA 3 alá csökken.',
      },
      {
        id: 'stock-revenue-decline',
        kind: 'fundamental',
        severity: 'MEDIUM',
        dimension: 'growth',
        featureId: 'revenueGrowth',
        comparator: 'lt',
        threshold: 0,
        statement: 'Csökkenő árbevétel a legutóbbi pénzügyi évben.',
        invalidatesPositive: 'Ha az éves árbevétel csökkenni kezd.',
        invalidatesNegative: 'Ha az éves árbevétel ismét nő.',
      },
      {
        id: 'stock-dilution',
        kind: 'fundamental',
        severity: 'MEDIUM',
        dimension: 'quality',
        featureId: 'sharesCagr3y',
        comparator: 'gt',
        threshold: 0.02,
        statement: 'Érdemi hígítás: a részvényszám 3 év alatt évi 2%-nál gyorsabban nőtt.',
        invalidatesPositive: 'Ha a részvényszám évi 2%-nál gyorsabban nő (hígítás).',
        invalidatesNegative: 'Ha a hígítás megáll.',
      },
      {
        id: 'stock-rich-pe',
        kind: 'valuation',
        severity: 'MEDIUM',
        dimension: 'valuation',
        featureId: 'pe',
        comparator: 'gt',
        threshold: 35,
        statement: 'Magas P/E (> 35): az ár sok jövőbeli növekedést áraz be.',
        invalidatesPositive: 'Ha a P/E 35 fölé emelkedik.',
        invalidatesNegative: 'Ha a P/E 35 alá csökken.',
      },
      {
        id: 'stock-dcf-premium',
        kind: 'valuation',
        severity: 'HIGH',
        dimension: 'valuation',
        flag: 'mosPremium',
        statement:
          'A Base DCF szerint az ár érdemben a modellérték felett van (feltevésfüggő becslés).',
        invalidatesPositive: 'Ha a Base DCF szerint az ár érdemben a modellérték fölé kerül.',
        invalidatesNegative: 'Ha a Base DCF szerint az ár már nincs érdemben a modellérték felett.',
      },
      {
        id: 'stock-bear-case',
        kind: 'valuation',
        severity: 'LOW',
        dimension: 'valuation',
        flag: 'bearMosNegative',
        statement: 'Óvatos (Bear) forgatókönyvben az ár a modellérték felett van.',
        invalidatesPositive: 'Ha a Bear forgatókönyvben is az ár a modellérték fölé kerül.',
        invalidatesNegative: 'Ha a Bear forgatókönyvben is az ár a modellérték alá kerül.',
      },
      {
        id: 'stock-high-beta',
        kind: 'risk',
        severity: 'MEDIUM',
        dimension: 'risk',
        featureId: 'beta',
        comparator: 'gt',
        threshold: 1.5,
        statement: 'Magas piaci érzékenység (béta > 1,5).',
        invalidatesPositive: 'Ha a béta 1,5 fölé emelkedik.',
        invalidatesNegative: 'Ha a béta 1,5 alá csökken.',
      },
      {
        id: 'stock-portfolio-overweight',
        kind: 'portfolio',
        severity: 'MEDIUM',
        dimension: null,
        flag: 'portfolioOverweight',
        statement: 'A pozíció súlya a portfólióban 10% felett: koncentrációs kockázat.',
        invalidatesPositive: 'Ha a pozíció súlya a portfólióban 10% fölé nő.',
        invalidatesNegative: 'Ha a pozíció súlya 10% alá csökken.',
      },
    ],
  },
};
