/**
 * CSAK TESZTHEZ (PHASE 11): kézzel írt, kicsi, de teljes `AiInputDto`-k és egy hozzájuk illő,
 * érvényes LLM-válasz. A szerver tesztjei a rétegszabály miatt nem építhetnek DTO-t az
 * application rétegből, ezért közös fixture-t használnak. Nincs az `index.ts`-ben (nem kerül
 * a futó app importgráfjába).
 */
import {
  AI_SCHEMA_VERSION,
  type AiExplanationContent,
  type AiInputDto,
  type AiInputMetric,
} from './ai';

const metric = (
  overrides: Partial<AiInputMetric> & Pick<AiInputMetric, 'ref' | 'label'>,
): AiInputMetric => ({
  value: null,
  display: null,
  unit: null,
  currency: null,
  status: 'OK',
  reason: null,
  categoryRef: null,
  score: null,
  asOf: '2026-09-27',
  freshness: 'FRESH',
  source: {
    sourceId: 'sec-edgar',
    sourceName: 'SEC EDGAR',
    kind: 'calculated',
    fetchedAt: '2026-11-21T22:00:00Z',
  },
  ...overrides,
});

export const STOCK_DTO: AiInputDto = {
  schemaVersion: AI_SCHEMA_VERSION,
  kind: 'stock',
  subject: { id: 'TEST@XNAS', displayName: 'Teszt Rt.' },
  analysisGeneratedAt: '2026-11-21T22:00:00Z',
  metrics: [
    metric({
      ref: 'metric:roe',
      label: 'ROE',
      value: 0.2453,
      display: '24,5%',
      unit: 'ratio',
      categoryRef: 'category:PROFITABILITY',
      score: 100,
    }),
    metric({
      ref: 'metric:pe',
      label: 'P/E',
      value: 31.24,
      display: '31,2x',
      unit: 'multiple',
      categoryRef: 'category:VALUATION',
      score: 12.5,
    }),
    metric({
      ref: 'metric:forwardPe',
      label: 'Forward P/E',
      status: 'MISSING',
      reason: 'A szolgáltató nem ad becslést.',
      categoryRef: 'category:VALUATION',
      asOf: null,
      freshness: null,
      source: null,
    }),
  ],
  evaluation: {
    totalScore: { ref: 'score:total', value: 67.5, status: 'PARTIAL', dataCoverage: 0.9 },
    categories: [
      {
        ref: 'category:PROFITABILITY',
        label: 'Jövedelmezőség',
        status: 'SCORED',
        score: 100,
        weight: 15,
        coverage: 1,
        dataQuality: 'HIGH',
        rationale: ['ROE 24,5% → 100 pont'],
      },
      {
        ref: 'category:VALUATION',
        label: 'Értékelés',
        status: 'PARTIAL',
        score: 12.5,
        weight: 20,
        coverage: 0.5,
        dataQuality: 'HIGH',
        rationale: ['P/E 31,2x → 12,5 pont'],
      },
    ],
    decision: {
      ref: 'decision:label',
      configId: 'stock-default',
      configVersion: '2026-11-22.1',
      labelKey: 'HOLD',
      labelText: 'Hold',
      baseLabelKey: 'WATCH',
      otherLabelTexts: [
        'Strong Buy',
        'Buy',
        'Watch',
        'Reduce',
        'Sell',
        'Strong Sell',
        'Nem értékelhető',
      ],
      matchedRule: { ref: 'rule:stock-watch', description: 'Erős minőség, drága értékelés.' },
      appliedCaps: [
        {
          ref: 'cap:cap-dcf-premium',
          description: 'DCF-prémium plafon.',
          from: 'WATCH',
          to: 'HOLD',
        },
      ],
      drivers: ['A minőség erős, az értékelés drága.'],
      disclaimer: 'Elemzési kategória, nem befektetési tanács.',
    },
    confidence: {
      ref: 'confidence:analysis',
      level: 'MEDIUM',
      score: 72.4,
      reasons: ['Az értékelési kategória részleges.'],
      meaning: 'Az adatok teljessége és minősége, nem a hozam valószínűsége.',
    },
    thesis: {
      stance: 'neutral',
      risks: [
        {
          ref: 'risk:stock-rich-pe',
          kind: 'valuation',
          severity: 'MEDIUM',
          statement: 'A P/E (31,2x) a drága sávban van.',
        },
      ],
      invalidation: [
        {
          ref: 'invalidation:inv-pe',
          statement: 'Ha a P/E 25x alá csökken.',
          currentValue: 31.24,
          threshold: 25,
        },
      ],
      note: 'Tézis a konfigurált szabályokból.',
    },
  },
  dcf: {
    provenanceKind: 'estimated',
    currency: 'USD',
    inputs: [
      metric({
        ref: 'dcfinput:baseFcf',
        label: 'Bázis FCF',
        value: 98.5e9,
        display: '98,50 Mrd USD',
        unit: 'money',
        currency: 'USD',
      }),
    ],
    scenarios: [
      {
        ref: 'dcf:base',
        label: 'Base',
        assumptionSource: 'default',
        explicitYears: 5,
        growthRates: [0.08, 0.08, 0.08, 0.08, 0.08],
        discountRate: 0.09,
        terminalGrowth: 0.025,
        display:
          'Base: növekedés 8,0%, diszkontráta 9,0%, terminális növekedés 2,5%, 5 év; belső érték/részvény 152,30 USD, biztonsági sáv -35%',
        status: 'OK',
        intrinsicValuePerShare: 152.3,
        marginOfSafetyPercent: -35,
        reason: null,
      },
    ],
    notes: [],
  },
  portfolio: null,
  dataGaps: [
    { ref: 'gap:forwardPe', label: 'Forward P/E', reason: 'A szolgáltató nem ad becslést.' },
  ],
  warnings: [],
  disclaimer: 'Elemzési kimenet, nem befektetési tanács.',
};

export const PORTFOLIO_DTO: AiInputDto = {
  schemaVersion: AI_SCHEMA_VERSION,
  kind: 'portfolio',
  subject: { id: 'portfolio', displayName: null },
  analysisGeneratedAt: '2026-11-22T12:00:00Z',
  metrics: [
    metric({
      ref: 'metric:concentration.top5Weight',
      label: 'Top 5 súly',
      value: 1,
      display: '100,0%',
      unit: 'ratio',
    }),
  ],
  evaluation: null,
  dcf: null,
  portfolio: {
    baseCurrency: 'EUR',
    openPositionCount: 2,
    positions: [
      {
        ref: 'position:AAPL@XNAS',
        listingId: 'AAPL@XNAS',
        instrumentKind: 'stock',
        status: 'open',
        weight: 0.6,
        weightDisplay: '60,0%',
      },
      {
        ref: 'position:VWCE@XETR',
        listingId: 'VWCE@XETR',
        instrumentKind: 'etf',
        status: 'open',
        weight: 0.4,
        weightDisplay: '40,0%',
      },
    ],
  },
  dataGaps: [],
  warnings: [],
  disclaimer: 'Portfólió-elemzés, nem befektetési tanács.',
};

/** Egy „jó” LLM-válasz a `STOCK_DTO`-hoz: minden szám és hivatkozás a bemenetből. */
export function validStockContent(): AiExplanationContent {
  return {
    schemaVersion: AI_SCHEMA_VERSION,
    kind: 'stock',
    summary: {
      text: 'A Teszt Rt. címkéje Hold, összpontszáma 67,5 pont; az elemzés teljessége közepes.',
      basedOn: ['decision:label', 'score:total', 'confidence:analysis'],
      support: 'data',
    },
    positives: [
      {
        text: 'Kiemelkedő jövedelmezőség: a ROE 24,5%.',
        basedOn: ['metric:roe', 'category:PROFITABILITY'],
        support: 'data',
      },
    ],
    negatives: [{ text: 'Drága értékelés: a P/E 31,2x.', basedOn: ['metric:pe'], support: 'data' }],
    keyRisks: [
      { text: 'A P/E a drága sávban van.', basedOn: ['risk:stock-rich-pe'], support: 'data' },
    ],
    valuationExplanation: [
      {
        text: 'Az alapszabály szerint a minőség erős, de a DCF-prémium plafon korlátozza a címkét.',
        basedOn: ['rule:stock-watch', 'cap:cap-dcf-premium'],
        support: 'data',
      },
    ],
    dcfAssumptions: [
      {
        text: 'Az alapesetben 8,0% növekedés, 9,0% diszkontráta és 2,5% terminális növekedés szerepel; a becslés érzékeny ezekre.',
        basedOn: ['dcf:base'],
        support: 'data',
      },
    ],
    dataGaps: [
      {
        text: 'A Forward P/E nem áll rendelkezésre.',
        basedOn: ['gap:forwardPe'],
        support: 'insufficient_data',
      },
    ],
    reviewTriggers: [
      {
        text: 'Új éves beszámoló után érdemes újraértékelni.',
        basedOn: ['metric:roe'],
        support: 'data',
      },
    ],
    thesisInvalidators: [
      {
        text: 'Ha a P/E 25x alá csökken, a tézis módosul.',
        basedOn: ['invalidation:inv-pe'],
        support: 'data',
      },
    ],
    confidence: {
      level: 'MEDIUM',
      explanation: 'Az adatok teljességét jelzi, nem hozam-előrejelzés.',
    },
  };
}
