/**
 * ETF-elemzés → képernyőmodell (PHASE 12). KÜLÖN logika a részvénytől (más szakaszok,
 * más mutatók; P/E, DCF ETF-nél nem alkalmazható – ezt a `notApplicable` lista mondja ki).
 *
 * A `coverage.limitations` és a `returns.comparisonBasis` mindig látható (ROADMAP PHASE 08 →
 * PHASE 12 kapcsolódási pont).
 */
import type { EtfAnalysis, EtfEvaluationResult, EtfMetric } from '@/application';
import type { Metric } from '@/domain';
import type { DataNotice } from '@/presentation/components/states';
import type { WeightItem } from '@/presentation/components/weight-bars';
import { formatDate, formatLargeMoney, formatPercent } from '@/presentation/format';

import { buildEvaluationViewModel, type EvaluationViewModel } from './evaluation-view-model';
import { buildMetricRow, buildTextRow, type MetricRowModel } from './metric-row';

export function etfMetricRow(metric: EtfMetric): MetricRowModel {
  const window =
    metric.window !== null
      ? `${formatDate(metric.window.start)} – ${formatDate(metric.window.end)} (${metric.window.observations} megfigyelés)`
      : null;
  const reliability =
    metric.reliability === 'short_window' ? 'rövid ablak – óvatosan értelmezendő' : null;
  return buildMetricRow({
    key: metric.id,
    label: metric.label,
    value: metric.value,
    unit: metric.unit,
    origin: metric.origin,
    formula: metric.formula,
    notes: metric.notes,
    hint: [reliability, window].filter((x): x is string => x !== null).join(' · ') || null,
  });
}

const CLASSIFICATION_LABEL = {
  region: 'Régió',
  assetClass: 'Eszközosztály',
  sizeSegment: 'Méretszegmens',
  style: 'Stílus / faktor',
  dividendFocus: 'Osztalékfókusz',
  weighting: 'Súlyozás',
} as const;

const COMPARISON_BASIS_TEXT = {
  total_return:
    'Összehasonlítási alap: teljes hozam (osztalékkal) – más ETF-fel azonos alapon vethető össze.',
  price_return_only:
    'Összehasonlítási alap: CSAK árfolyamhozam – disztribúciós ETF-nél félrevezető lehet, más ETF teljes hozamával nem vethető össze.',
  none: 'Nincs összehasonlítható hozamadat.',
} as const;

export interface EtfSection {
  readonly id:
    | 'basics'
    | 'costs'
    | 'benchmark'
    | 'holdings'
    | 'style'
    | 'dividend'
    | 'tracking'
    | 'risk'
    | 'performance';
  readonly title: string;
  readonly rows: readonly MetricRowModel[];
  readonly notes: readonly string[];
  readonly summary: string;
}

export interface WeightBreakdown {
  readonly available: boolean;
  readonly items: readonly WeightItem[];
  /** Hiány oka (nem-OK státusznál). */
  readonly reason: string | null;
}

export interface EtfViewModel {
  readonly header: {
    readonly title: string;
    readonly subtitle: string;
    readonly coverageText: string;
  };
  readonly notices: readonly DataNotice[];
  readonly evaluation: EvaluationViewModel;
  readonly sections: readonly EtfSection[];
  readonly countries: WeightBreakdown;
  readonly sectors: WeightBreakdown;
  readonly limitations: readonly string[];
  readonly comparisonBasisText: string;
  readonly notApplicable: readonly string[];
  readonly disclaimers: readonly string[];
}

function section(
  id: EtfSection['id'],
  title: string,
  rows: readonly MetricRowModel[],
  notes: readonly string[] = [],
): EtfSection {
  const ok = rows.filter((r) => r.status === 'OK').length;
  return { id, title, rows, notes, summary: `${ok}/${rows.length} adat elérhető` };
}

function breakdown(
  metric: Metric<readonly { readonly key: string; readonly weight: number }[]>,
): WeightBreakdown {
  if (metric.status !== 'OK') return { available: false, items: [], reason: metric.reason };
  const items = [...metric.value]
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 10)
    .map((g) => ({ key: g.key, label: g.key, weight: g.weight }));
  return { available: true, items, reason: null };
}

function aumRow(analysis: EtfAnalysis): MetricRowModel {
  const aum = analysis.profile.aum;
  if (aum.status === 'OK') {
    return buildMetricRow({
      key: 'aum',
      label: 'Kezelt vagyon (AUM)',
      value: { status: 'OK', value: aum.value.amount, provenance: aum.provenance },
      unit: 'money',
      currency: aum.value.currency,
      formatted: {
        text: formatLargeMoney(aum.value.amount, aum.value.currency),
        status: 'OK',
        reason: null,
        accessibilityText: formatLargeMoney(aum.value.amount, aum.value.currency),
      },
    });
  }
  return buildMetricRow({ key: 'aum', label: 'Kezelt vagyon (AUM)', value: aum, unit: null });
}

export function buildEtfViewModel(result: EtfEvaluationResult): EtfViewModel {
  const a = result.analysis;
  const p = a.profile;
  const name = p.name.status === 'OK' ? p.name.value : p.ticker;

  const basics = [
    buildTextRow({ key: 'isin', label: 'ISIN', value: p.isin }),
    buildTextRow({ key: 'issuer', label: 'Kibocsátó', value: p.issuer }),
    buildTextRow({ key: 'domicile', label: 'Domicilium', value: p.domicile }),
    buildTextRow({
      key: 'tradingCurrency',
      label: 'Kereskedési pénznem',
      value: p.tradingCurrency,
    }),
    buildTextRow({ key: 'fundBaseCurrency', label: 'Alap pénzneme', value: p.fundBaseCurrency }),
    buildTextRow({
      key: 'inceptionDate',
      label: 'Indulás',
      value: p.inceptionDate,
      display: (v) => formatDate(String(v)),
    }),
    buildTextRow({ key: 'replication', label: 'Replikáció', value: p.replication }),
    buildTextRow({ key: 'ucits', label: 'UCITS', value: p.ucits }),
    buildTextRow({ key: 'currencyHedged', label: 'Devizafedezett', value: p.currencyHedged }),
  ];

  const style = (Object.keys(CLASSIFICATION_LABEL) as (keyof typeof CLASSIFICATION_LABEL)[]).map(
    (key) =>
      buildTextRow({
        key: `class-${key}`,
        label: CLASSIFICATION_LABEL[key],
        value: p.classification[key],
      }),
  );

  const h = a.holdings;
  const sections: EtfSection[] = [
    section('basics', 'Alapadatok', basics),
    section(
      'costs',
      'Költség (TER) és méret (AUM)',
      [
        etfMetricRow(a.costs.ter),
        aumRow(a),
        etfMetricRow(a.costs.annualCostPer10k),
        etfMetricRow(a.costs.longTermCostShare),
      ],
      [
        `TER-hatás feltevése: ${a.costs.assumptions.years} év, ${formatPercent(a.costs.assumptions.assumedGrossReturn)} bruttó hozam (${a.costs.assumptions.source === 'user' ? 'saját' : 'alapértelmezett'} – becslés).`,
      ],
    ),
    section('benchmark', 'Benchmark', [
      buildTextRow({ key: 'benchmark', label: 'Követett index', value: p.benchmark }),
    ]),
    section(
      'holdings',
      'Holdings és koncentráció',
      [
        h.holdingsCount,
        h.coveredWeight,
        h.top10Weight,
        h.largestHoldingWeight,
        h.effectiveHoldings,
        h.largestCountryWeight,
        h.largestSectorWeight,
      ].map(etfMetricRow),
      [
        h.asOf !== null ? `Holdings dátuma: ${formatDate(h.asOf)}` : 'Holdings dátuma: nincs adat',
        ...(h.completeness === 'partial'
          ? ['Részleges holdings-lista: a mutatók alsó becslések.']
          : []),
        ...h.notes,
      ],
    ),
    section('style', 'Súlyozás és stílus', style),
    section('dividend', 'Osztalék', [
      buildTextRow({ key: 'distribution', label: 'Kifizetési mód', value: p.distribution }),
      etfMetricRow(a.returns.distributionYieldTtm),
    ]),
    section(
      'tracking',
      'Követés (tracking)',
      [
        a.tracking.trackingDifference,
        a.tracking.annualizedTrackingDifference,
        a.tracking.trackingError,
      ].map(etfMetricRow),
      a.tracking.definitions,
    ),
    section(
      'risk',
      'Kockázat',
      [
        a.risk.volatility,
        a.risk.maxDrawdown,
        a.risk.downsideDeviation,
        a.risk.sharpe,
        a.risk.sortino,
        a.risk.beta,
      ].map(etfMetricRow),
      a.risk.conventions,
    ),
    section(
      'performance',
      'Hozam (múltbeli)',
      [a.returns.priceReturn, a.returns.totalReturn, a.returns.annualizedTotalReturn].map(
        etfMetricRow,
      ),
      [COMPARISON_BASIS_TEXT[a.returns.comparisonBasis], ...a.returns.notes],
    ),
  ];

  const notices: DataNotice[] = [];
  const mock =
    (p.tradingCurrency.status === 'OK' && p.tradingCurrency.provenance.kind === 'mock') ||
    (p.name.status === 'OK' && p.name.provenance.kind === 'mock');
  if (mock) {
    notices.push({
      id: 'mock',
      tone: 'info',
      title: 'Demóadat',
      message: 'Kitalált, nem valós adatok – csak a működés bemutatására.',
    });
  }
  const stale = [p.tradingCurrency, p.name].some(
    (m) =>
      m.status === 'OK' &&
      (m.provenance.freshness === 'STALE' || m.provenance.freshness === 'EXPIRED'),
  );
  if (stale) {
    notices.push({
      id: 'stale',
      tone: 'warning',
      title: 'Elavult adat',
      message: 'Az adatok egy része nem friss.',
    });
  }
  if (a.coverage.available < a.coverage.total) {
    notices.push({
      id: 'partial',
      tone: 'warning',
      title: 'Részleges adat',
      message: `${a.coverage.available}/${a.coverage.total} ETF-adatmező érhető el. A hiány nem nulla – N/A jelöléssel, okkal látszik.`,
    });
  }

  return {
    header: {
      title: name,
      subtitle: `${p.ticker} · ${p.exchange} · ETF`,
      coverageText: `Adatlefedettség: ${a.coverage.available}/${a.coverage.total} mező`,
    },
    notices,
    evaluation: buildEvaluationViewModel(result.evaluation),
    sections,
    countries: breakdown(h.countryWeights),
    sectors: breakdown(h.sectorWeights),
    limitations: a.coverage.limitations,
    comparisonBasisText: COMPARISON_BASIS_TEXT[a.returns.comparisonBasis],
    notApplicable: a.notApplicable.map((n) => `${n.label}: ${n.reason}`),
    disclaimers: [a.disclaimer],
  };
}
