/**
 * Instrumentum-pillanatkép (PHASE 14, D-085): a compare, a watchlist, a screener és a riasztás
 * KÖZÖS, lapos bemenete. Nem számol új mutatót – a meglévő use case-ek (PHASE 06–10) kimenetéből
 * gyűjti össze a mutatókat, változatlan `Metric`-kel (érték + provenance VAGY a hiány oka).
 *
 * Így a négy funkció ugyanazokat a számokat látja, mint az elemzőképernyő (nincs duplikált
 * üzleti logika), és minden találat / cella / riasztás visszavezethető a forrásadatra.
 */
import { simpleReturn } from '@/calculations';
import type { ModelValueCategory } from '@/calculations';
import {
  metricMissing,
  metricOk,
  type CurrencyCode,
  type DataProvenance,
  type EtfHoldingsSnapshot,
  type IsoDate,
  type IsoTimestamp,
  type MeasurementUnit,
  type Metric,
  type PriceSeries,
  type Quote,
} from '@/domain';

import type { EtfAnalysis, EtfMetric, ReturnComparisonBasis } from '../etf-analysis/types';
import type { InstrumentEvaluation } from '../scoring/types';
import { engineProvenance } from '../shared/engine-provenance';
import type { EtfEvaluationResult, StockEvaluationResult } from '../use-cases/evaluate-instrument';

export type SnapshotKind = 'stock' | 'etf';

export interface SnapshotMetric {
  readonly id: string;
  readonly label: string;
  readonly unit: MeasurementUnit;
  readonly value: Metric<number>;
  /** Hozam-/kockázati mutató ablaka (ETF), egyébként `null`. */
  readonly window: { readonly start: IsoDate; readonly end: IsoDate } | null;
}

export interface SnapshotScore {
  readonly totalScore: number | null;
  /** A score-rendszer (részvény ≠ ETF) – csak azonos rendszer pontja hasonlítható. */
  readonly configId: string;
  readonly configVersion: string;
  readonly decisionLabel: string;
  readonly decisionText: string;
  readonly confidenceLevel: string;
}

/** Részvény: a Base DCF MOS-kategóriája (PHASE 07 küszöbök); ETF-nél `NOT_APPLICABLE`. */
export type ValuationStatus =
  | { readonly status: 'OK'; readonly category: ModelValueCategory; readonly mos: number }
  | { readonly status: 'NOT_APPLICABLE' | 'MISSING'; readonly reason: string };

export interface InstrumentSnapshot {
  readonly listingId: string;
  readonly kind: SnapshotKind;
  readonly name: string | null;
  /** Az értékpapír ISIN-je, ha a forrás közölte (ETF-átfedés, részvény–ETF kitettség). */
  readonly isin: string | null;
  readonly tradingCurrency: CurrencyCode | null;
  /** Legutóbbi ár (a `getListingQuote` use case-ből, frissességgel). */
  readonly price: Metric<number>;
  /** Napi változás = utolsó záró / előző záró − 1 (számított); hiányozhat. */
  readonly dayChange: Metric<number>;
  readonly metrics: Readonly<Record<string, SnapshotMetric>>;
  readonly score: SnapshotScore | null;
  readonly valuation: ValuationStatus;
  /** ETF holdings-pillanatkép (részvénynél `NOT_APPLICABLE`). */
  readonly holdings: Metric<EtfHoldingsSnapshot>;
  /** ETF-hozam összehasonlítási alapja (D-069); részvénynél `null`. */
  readonly returnBasis: ReturnComparisonBasis | null;
  /** Az elemzés időbélyege. */
  readonly generatedAt: IsoTimestamp;
}

export interface SnapshotMarketInputs {
  readonly quote: Quote | null;
  /** A quote hiányának oka (ha `quote === null`). */
  readonly quoteError?: string;
  readonly recentPrices?: PriceSeries | null;
  readonly isin?: string | null;
}

// ---------------------------------------------------------------------------------------------

export function priceMetric(inputs: SnapshotMarketInputs): Metric<number> {
  const quote = inputs.quote;
  if (quote === null) {
    return metricMissing(inputs.quoteError ?? 'Nincs elérhető árfolyam.');
  }
  return metricOk(quote.price.amount, { ...quote.provenance, currency: quote.price.currency });
}

/**
 * Napi változás az utolsó két záróárból. A quote végpont nem ad előző záróárat, ezért ez
 * SZÁMÍTOTT érték az ártörténetből (`calculated` provenance, bemenet: a két záróár).
 */
export function dayChangeMetric(series: PriceSeries | null | undefined): Metric<number> {
  if (series === null || series === undefined) {
    return metricMissing('Nincs friss ártörténet a napi változáshoz.');
  }
  const points = series.points;
  if (points.length < 2) {
    return metricMissing('A napi változáshoz legalább két záróár kell.');
  }
  const last = points[points.length - 1]!;
  const previous = points[points.length - 2]!;
  const result = simpleReturn({ startValue: previous.close, endValue: last.close });
  if (result.status !== 'OK') return { status: result.status, reason: result.reason };
  const provenance: DataProvenance = {
    ...engineProvenance({
      fetchedAt: series.provenance.fetchedAt,
      inputs: [
        [`close@${previous.date}`, { ...series.provenance, asOf: previous.date }],
        [`close@${last.date}`, { ...series.provenance, asOf: last.date }],
      ],
      unit: 'ratio',
    }),
    asOf: last.date,
  };
  return metricOk(result.value, provenance);
}

function scoreOf(evaluation: InstrumentEvaluation): SnapshotScore {
  return {
    totalScore: evaluation.score.totalScore,
    configId: evaluation.score.configId,
    configVersion: evaluation.score.configVersion,
    decisionLabel: evaluation.decision.label,
    decisionText: evaluation.decision.labelText,
    confidenceLevel: evaluation.confidence.level,
  };
}

function featureMetrics(evaluation: InstrumentEvaluation): Record<string, SnapshotMetric> {
  const metrics: Record<string, SnapshotMetric> = {};
  for (const feature of evaluation.features) {
    if (feature.kind !== 'numeric') continue;
    metrics[feature.id] = {
      id: feature.id,
      label: feature.label,
      unit: feature.unit,
      value: feature.value,
      window: null,
    };
  }
  return metrics;
}

function etfMetric(metric: EtfMetric): SnapshotMetric {
  return {
    id: metric.id,
    label: metric.label,
    unit: metric.unit,
    value: metric.value,
    window: metric.window === null ? null : { start: metric.window.start, end: metric.window.end },
  };
}

// ---------------------------------------------------------------------------------------------

export function buildStockSnapshot(
  result: StockEvaluationResult,
  market: SnapshotMarketInputs,
): InstrumentSnapshot {
  const { fundamentals, valuation, evaluation } = result;
  const metrics = featureMetrics(evaluation);
  for (const id of ['dividendYield', 'marketCap'] as const) {
    const metric = fundamentals.valuation.find((m) => m.id === id);
    if (metric !== undefined) {
      metrics[id] = {
        id,
        label: id === 'dividendYield' ? 'Osztalékhozam (TTM)' : 'Piaci kapitalizáció',
        unit: metric.unit,
        value: metric.value,
        window: null,
      };
    }
  }
  const base = valuation.dcf.scenarios.find((s) => s.id === 'base');
  const valuationStatus: ValuationStatus =
    base === undefined
      ? { status: 'MISSING', reason: 'Nincs Base DCF forgatókönyv.' }
      : base.category.status === 'OK'
        ? {
            status: 'OK',
            category: base.category.value.category,
            mos: base.category.value.marginOfSafety,
          }
        : { status: 'MISSING', reason: base.category.reason };
  return {
    listingId: fundamentals.overview.listingId,
    kind: 'stock',
    name: fundamentals.overview.name,
    isin: market.isin ?? null,
    tradingCurrency: fundamentals.overview.tradingCurrency,
    price: priceMetric(market),
    dayChange: dayChangeMetric(market.recentPrices),
    metrics,
    score: scoreOf(evaluation),
    valuation: valuationStatus,
    holdings: {
      status: 'NOT_APPLICABLE',
      reason: 'Részvénynek nincs holdings-összetétele.',
    },
    returnBasis: null,
    generatedAt: evaluation.evaluatedAt,
  };
}

export function buildEtfSnapshot(
  result: EtfEvaluationResult,
  market: SnapshotMarketInputs,
): InstrumentSnapshot {
  const { analysis, evaluation } = result;
  const metrics = featureMetrics(evaluation);
  const extra: readonly EtfMetric[] = [
    analysis.returns.priceReturn,
    analysis.returns.totalReturn,
    analysis.returns.annualizedTotalReturn,
    analysis.returns.distributionYieldTtm,
    analysis.risk.volatility,
    analysis.risk.maxDrawdown,
    analysis.tracking.trackingDifference,
    analysis.tracking.annualizedTrackingDifference,
    analysis.tracking.trackingError,
  ];
  for (const metric of extra) metrics[metric.id] = etfMetric(metric);
  const profile: EtfAnalysis['profile'] = analysis.profile;
  return {
    listingId: analysis.listingId,
    kind: 'etf',
    name: profile.name.status === 'OK' ? profile.name.value : null,
    isin: profile.isin.status === 'OK' ? profile.isin.value : (market.isin ?? null),
    tradingCurrency: profile.tradingCurrency.status === 'OK' ? profile.tradingCurrency.value : null,
    price: priceMetric(market),
    dayChange: dayChangeMetric(market.recentPrices),
    metrics,
    score: scoreOf(evaluation),
    valuation: {
      status: 'NOT_APPLICABLE',
      reason: 'ETF-re vállalati DCF/MOS nem értelmezett (D-069).',
    },
    holdings: profile.holdings,
    returnBasis: analysis.returns.comparisonBasis,
    generatedAt: analysis.generatedAt,
  };
}

/** Egy mutató a pillanatképből; hiányzó azonosítónál `MISSING` (soha nem 0). */
export function snapshotMetric(snapshot: InstrumentSnapshot, id: string): Metric<number> {
  if (id === 'price') return snapshot.price;
  if (id === 'dayChange') return snapshot.dayChange;
  return (
    snapshot.metrics[id]?.value ??
    metricMissing(`A(z) ${id} mutató nem szerepel a(z) ${snapshot.listingId} elemzésében.`)
  );
}
