/**
 * Részvény-értékelés (PHASE 10): PHASE 06 fundamentális + PHASE 07 értékelés/DCF (+ opcionális
 * PHASE 09 portfólió) → semleges feature-lista → `src/scoring` motor.
 *
 * Csak ténylegesen létező mutatókból dolgozik; minden feature a forrás `Metric`-jét viszi tovább
 * (érték + provenance VAGY a hiány oka). Saját képletet nem számol – az egyetlen származtatott
 * mutató (nettó adósság / EBITDA) a calculations-motor függvényével készül.
 */
import {
  netDebtToEbitda,
  priceAtMarginOfSafety,
  type CalcResult,
  type MarginOfSafetyThresholds,
} from '@/calculations';
import {
  AppErrors,
  err,
  metricMissing,
  metricOk,
  type DataProvenance,
  type FundamentalMetric,
  type MeasurementUnit,
  type Metric,
  type Result,
  type StockFundamentalAnalysis,
  type TrendSeriesId,
} from '@/domain';
import {
  DEFAULT_STOCK_DECISION_CONFIG,
  DEFAULT_STOCK_SCORE_CONFIG,
  evaluateScoring,
  type DecisionResult,
  type InvalidationCondition,
  type ScoringFeature,
  type ScoringInput,
} from '@/scoring';

import { portfolioWeightFeature } from './portfolio-context';
import { EVALUATION_DISCLAIMER, type EvaluationOptions, type InstrumentEvaluation } from './types';
import { engineProvenance } from '../shared/engine-provenance';
import type { DcfScenarioOutput, StockValuationAnalysis } from '../valuation/types';

const numeric = (
  id: string,
  label: string,
  unit: MeasurementUnit,
  value: Metric<number>,
): ScoringFeature => ({ id, label, kind: 'numeric', unit, value, reliability: null });

function annualMetric(a: StockFundamentalAnalysis, id: string): Metric<number> {
  const row = a.periodMetrics.annual.rows.find((r) => r.id === id);
  const cell = row?.cells[0];
  return cell === undefined
    ? metricMissing(`Nincs éves (FY) adat a(z) ${id} mutatóhoz.`)
    : cell.value;
}

function valuationMetric(a: StockFundamentalAnalysis, id: string): Metric<number> {
  const metric: FundamentalMetric | undefined = a.valuation.find((m) => m.id === id);
  return metric === undefined
    ? metricMissing(`A(z) ${id} értékelési mutató nem szerepel az elemzésben.`)
    : metric.value;
}

function cagrMetric(a: StockFundamentalAnalysis, id: TrendSeriesId, years: number): Metric<number> {
  const cagr = a.trends.find((t) => t.id === id)?.cagr.find((c) => c.years === years);
  return cagr === undefined
    ? metricMissing(`Nincs ${years} éves CAGR a(z) ${id} sorozatra.`)
    : cagr.value.value;
}

function leverageMetric(
  a: StockFundamentalAnalysis,
  fetchedAt: DataProvenance['fetchedAt'],
): Metric<number> {
  const debt = annualMetric(a, 'netDebt');
  const earnings = annualMetric(a, 'ebitda');
  const result = netDebtToEbitda({
    netDebt: debt.status === 'OK' ? debt.value : null,
    ebitda: earnings.status === 'OK' ? earnings.value : null,
  });
  if (result.status !== 'OK') {
    const why = [debt, earnings]
      .map((m, i) =>
        m.status === 'OK' ? null : `${i === 0 ? 'netDebt' : 'ebitda'}: ${m.status} – ${m.reason}`,
      )
      .filter((x): x is string => x !== null);
    return { status: result.status, reason: why.length > 0 ? why.join('; ') : result.reason };
  }
  const inputs: [string, DataProvenance][] = [];
  if (debt.status === 'OK') inputs.push(['netDebt', debt.provenance]);
  if (earnings.status === 'OK') inputs.push(['ebitda', earnings.provenance]);
  return metricOk(result.value, engineProvenance({ fetchedAt, inputs, unit: 'multiple' }));
}

function scenario(
  v: StockValuationAnalysis | null,
  id: 'bear' | 'base' | 'bull',
): DcfScenarioOutput | null {
  return v?.dcf.scenarios.find((s) => s.id === id) ?? null;
}

function mosMetric(
  a: StockFundamentalAnalysis,
  v: StockValuationAnalysis | null,
  id: 'bear' | 'base' | 'bull',
): Metric<number> {
  if (v === null) return metricMissing('Nincs értékelési (DCF) elemzés.');
  const s = scenario(v, id);
  if (s === null) return metricMissing(`Nincs ${id} forgatókönyv.`);
  if (s.result.status !== 'OK') return { status: s.result.status, reason: s.result.reason };
  const mos = s.result.value.marginOfSafety;
  if (mos.status !== 'OK') return { status: mos.status, reason: mos.reason };
  const price = a.overview.price.value;
  return metricOk(
    mos.value,
    engineProvenance({
      fetchedAt: v.generatedAt,
      inputs: price.status === 'OK' ? [['marketPrice', price.provenance]] : [],
      kind: 'estimated',
      unit: 'ratio',
    }),
  );
}

export function buildStockFeatures(
  a: StockFundamentalAnalysis,
  v: StockValuationAnalysis | null,
  options: Pick<EvaluationOptions, 'portfolio'> = {},
): ScoringFeature[] {
  const features: ScoringFeature[] = [
    numeric('roic', 'ROIC', 'ratio', annualMetric(a, 'roic')),
    numeric('grossMargin', 'Bruttó árrés', 'ratio', annualMetric(a, 'grossMargin')),
    numeric('revenueCagr3y', 'Árbevétel CAGR 3 év', 'ratio', cagrMetric(a, 'revenue', 3)),
    numeric('revenueCagr5y', 'Árbevétel CAGR 5 év', 'ratio', cagrMetric(a, 'revenue', 5)),
    numeric('epsCagr3y', 'EPS CAGR 3 év', 'ratio', cagrMetric(a, 'eps', 3)),
    numeric('fcfCagr3y', 'FCF CAGR 3 év', 'ratio', cagrMetric(a, 'fcf', 3)),
    numeric(
      'revenueGrowth',
      'Árbevétel-növekedés (YoY)',
      'ratio',
      annualMetric(a, 'revenueGrowth'),
    ),
    numeric('operatingMargin', 'Üzemi árrés', 'ratio', annualMetric(a, 'operatingMargin')),
    numeric('netMargin', 'Nettó árrés', 'ratio', annualMetric(a, 'netMargin')),
    numeric('roe', 'ROE', 'ratio', annualMetric(a, 'roe')),
    numeric('debtToEquity', 'Adósság / saját tőke', 'multiple', annualMetric(a, 'debtToEquity')),
    numeric(
      'netDebtToEbitda',
      'Nettó adósság / EBITDA',
      'multiple',
      leverageMetric(a, a.generatedAt),
    ),
    numeric('fcfMargin', 'FCF-árrés', 'ratio', annualMetric(a, 'fcfMargin')),
    numeric('fcfConversion', 'FCF-konverzió', 'ratio', annualMetric(a, 'fcfConversion')),
    numeric(
      'sharesCagr3y',
      'Részvényszám CAGR 3 év',
      'ratio',
      cagrMetric(a, 'sharesOutstanding', 3),
    ),
    numeric('pe', 'P/E', 'multiple', valuationMetric(a, 'pe')),
    numeric('pfcf', 'P/FCF', 'multiple', valuationMetric(a, 'pfcf')),
    numeric('evToEbitda', 'EV/EBITDA', 'multiple', valuationMetric(a, 'evToEbitda')),
    numeric('fcfYield', 'FCF-hozam', 'ratio', valuationMetric(a, 'fcfYield')),
    numeric('ps', 'P/S', 'multiple', valuationMetric(a, 'ps')),
    numeric('beta', 'Béta (szolgáltatói)', 'multiple', a.overview.beta.value),
    numeric('mosBase', 'Biztonsági sáv – Base DCF', 'ratio', mosMetric(a, v, 'base')),
    numeric('mosBear', 'Biztonsági sáv – Bear DCF', 'ratio', mosMetric(a, v, 'bear')),
    numeric('mosBull', 'Biztonsági sáv – Bull DCF', 'ratio', mosMetric(a, v, 'bull')),
  ];
  if (options.portfolio !== undefined) {
    features.push(portfolioWeightFeature(options.portfolio, a.overview.listingId));
  }
  return features;
}

/** Külső jelzések a PHASE 07 MOS-kategóriájából (a felhasználó által állított küszöbökkel). */
export function buildStockFlags(v: StockValuationAnalysis | null): ScoringInput['flags'] {
  const base = scenario(v, 'base');
  const category = base?.category.status === 'OK' ? base.category.value.category : null;
  const bear = scenario(v, 'bear');
  const bearMos =
    bear?.result.status === 'OK' && bear.result.value.marginOfSafety.status === 'OK'
      ? bear.result.value.marginOfSafety.value
      : null;
  return {
    mosDiscount: category === null ? null : category === 'DISCOUNT_TO_MODEL',
    mosPremium: category === null ? null : category === 'PREMIUM_TO_MODEL',
    bearMosNegative: bearMos === null ? null : bearMos < 0,
  };
}

function priceTrigger(
  id: string,
  statement: (price: string) => string,
  comparator: 'gt' | 'lt',
  intrinsicValue: number,
  mos: number,
  currency: string | null,
  currentPrice: number | null,
): InvalidationCondition[] {
  const result: CalcResult<number> = priceAtMarginOfSafety({ intrinsicValue, marginOfSafety: mos });
  if (result.status !== 'OK') return [];
  const rounded = Number(result.value.toPrecision(3));
  return [
    {
      id,
      kind: 'price',
      statement: statement(`${rounded}${currency === null ? '' : ` ${currency}`}`),
      target: 'marketPrice',
      comparator,
      threshold: rounded,
      currentValue: currentPrice,
      ruleId: 'dcf-price-trigger',
    },
  ];
}

/** Árszint-alapú érvénytelenítés a Base DCF belső értékéből és a PHASE 07 MOS-küszöbeiből. */
export function stockPriceInvalidation(
  v: StockValuationAnalysis | null,
  decision: DecisionResult,
): InvalidationCondition[] {
  const base = scenario(v, 'base');
  if (v === null || base === null || base.result.status !== 'OK') return [];
  const iv = base.result.value.intrinsicValuePerShare;
  const thresholds: MarginOfSafetyThresholds = v.thresholds.marginOfSafety;
  const currency = v.dcf.inputs.currency;
  const price = v.dcf.inputs.fields.marketPrice.value;
  const positive = ['STRONG_BUY', 'BUY', 'WATCH'].includes(decision.label);
  const negative = ['REDUCE', 'SELL', 'STRONG_SELL'].includes(decision.label);
  if (positive) {
    return [
      ...(decision.label === 'STRONG_BUY'
        ? priceTrigger(
            'price-loses-dcf-discount',
            (p) =>
              `Ha az ár ${p} fölé emelkedik, megszűnik az érdemi Base DCF-diszkont (a Strong Buy feltétele).`,
            'gt',
            iv,
            thresholds.discountAtLeast,
            currency,
            price,
          )
        : []),
      ...priceTrigger(
        'price-dcf-premium',
        (p) =>
          `Ha az ár ${p} fölé emelkedik, a Base DCF szerint érdemben a modellérték felett lesz (plafon: legfeljebb Hold).`,
        'gt',
        iv,
        thresholds.premiumBelow,
        currency,
        price,
      ),
    ];
  }
  if (decision.appliedCaps.some((cap) => cap.capId === 'cap-dcf-premium')) {
    return priceTrigger(
      'price-lifts-dcf-premium-cap',
      (p) =>
        `Ha az ár ${p} alá csökken, a Base DCF szerint már nincs érdemben a modellérték felett (a DCF-prémium plafon megszűnik).`,
      'lt',
      iv,
      thresholds.premiumBelow,
      currency,
      price,
    );
  }
  if (negative) {
    return priceTrigger(
      'price-dcf-discount',
      (p) => `Ha az ár ${p} alá csökken, a Base DCF érdemi diszkontot mutat.`,
      'lt',
      iv,
      thresholds.discountAtLeast,
      currency,
      price,
    );
  }
  return [];
}

export function buildStockEvaluation(
  fundamentals: StockFundamentalAnalysis,
  valuation: StockValuationAnalysis | null,
  options: EvaluationOptions = {},
): Result<InstrumentEvaluation> {
  if (valuation !== null && valuation.listingId !== fundamentals.overview.listingId) {
    return err(
      AppErrors.validation(
        `A DCF-elemzés (${valuation.listingId}) másik jegyzéshez tartozik, mint a fundamentális elemzés (${fundamentals.overview.listingId}).`,
      ),
    );
  }
  const scoreConfig = options.scoreConfig ?? DEFAULT_STOCK_SCORE_CONFIG;
  const decisionConfig = options.decisionConfig ?? DEFAULT_STOCK_DECISION_CONFIG;
  const features = buildStockFeatures(fundamentals, valuation, options);
  const input: ScoringInput = { subjectKind: 'stock', features, flags: buildStockFlags(valuation) };
  const outcome = evaluateScoring(input, scoreConfig, decisionConfig, (decision) =>
    stockPriceInvalidation(valuation, decision),
  );
  if (!outcome.ok) return outcome;
  const warnings: string[] = [];
  if (valuation === null) {
    warnings.push('Értékelés (DCF) nélkül futott: a DCF/MOS jelzések ismeretlenek.');
  }
  return {
    ok: true,
    value: {
      subjectKind: 'stock',
      listingId: fundamentals.overview.listingId,
      evaluatedAt: valuation?.generatedAt ?? fundamentals.generatedAt,
      configs: {
        score: { id: scoreConfig.id, version: scoreConfig.version },
        decision: { id: decisionConfig.id, version: decisionConfig.version },
      },
      features,
      ...outcome.value,
      aiInvolvement: 'none',
      warnings,
      disclaimer: EVALUATION_DISCLAIMER,
    },
  };
}
