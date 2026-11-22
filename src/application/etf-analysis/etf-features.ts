/**
 * ETF-score feature-modell (PHASE 08 feladat 9.) – SÚLYOZÁS ÉS PONTSZÁM NÉLKÜL.
 *
 * A PHASE 10 döntési engine ezekből a feature-ökből dolgozik majd. Itt csak az érték (vagy a
 * hiány oka), az eredet és a „kedvező irány” szerepel; küszöböt, súlyt, pontot NEM adunk.
 */
import {
  classifyMetricOrigin,
  metricMissing,
  metricOk,
  parseCurrencyCode,
  parseIsoDate,
  toEpochMs,
  type EtfProfile,
  type IsoTimestamp,
  type Metric,
} from '@/domain';

import { etfMetric, fromCalc, propagateFailure } from './etf-metric';
import type {
  EtfAnalysisOptions,
  EtfCostAnalysis,
  EtfCurrencyAnalysis,
  EtfFeature,
  EtfFeatureGroup,
  EtfFeatureModel,
  EtfHoldingsAnalysis,
  EtfMetric,
  EtfRiskAnalysis,
  EtfTrackingAnalysis,
  FeatureDirection,
} from './types';
import { ETF_FEATURE_GROUPS } from './types';

export const ETF_FEATURE_NOTE =
  'Feature-modell súlyozás és pontszám nélkül; a végleges ETF-score a PHASE 10 döntési engine feladata. Az „irány” csak azt jelzi, melyik érték kedvezőbb ceteris paribus.';

export interface FeatureInputs {
  readonly profile: EtfProfile;
  readonly holdings: EtfHoldingsAnalysis;
  readonly costs: EtfCostAnalysis;
  readonly tracking: EtfTrackingAnalysis;
  readonly risk: EtfRiskAnalysis;
  readonly currency: EtfCurrencyAnalysis;
  readonly liquidity: EtfAnalysisOptions['liquidity'];
  readonly now: Date;
  readonly fetchedAt: IsoTimestamp;
}

function numeric(
  group: EtfFeatureGroup,
  direction: FeatureDirection,
  metric: EtfMetric,
): EtfFeature {
  return { id: metric.id, group, kind: 'numeric', direction, metric };
}

function categorical<T>(
  id: string,
  group: EtfFeatureGroup,
  label: string,
  value: Metric<T>,
  toText: (value: T) => string = String,
): EtfFeature {
  const text: Metric<string> =
    value.status === 'OK' ? metricOk(toText(value.value), value.provenance) : value;
  return { id, group, kind: 'categorical', label, value: text, origin: classifyMetricOrigin(text) };
}

const YEAR_MS = 365.25 * 86_400_000;

function fundAge(profile: EtfProfile, now: Date, fetchedAt: IsoTimestamp): EtfMetric {
  const spec = {
    id: 'fundAgeYears',
    label: 'Az alap kora (év)',
    unit: 'count',
    formula: '(ma − indulás dátuma) / 365,25 nap',
  } as const;
  const inception = profile.inceptionDate;
  if (inception.status !== 'OK')
    return etfMetric(spec, propagateFailure('indulás dátuma', inception));
  const years = (now.getTime() - toEpochMs(inception.value)) / YEAR_MS;
  return years < 0
    ? etfMetric(spec, {
        status: 'INVALID_INPUT',
        reason: `Jövőbeli indulási dátum (${inception.value}).`,
      })
    : fromCalc(
        spec,
        { status: 'OK', value: years, notes: [] },
        {
          fetchedAt,
          inputs: [['inceptionDate', inception.provenance]],
        },
      );
}

function aumFeature(inputs: FeatureInputs): EtfMetric {
  const spec = {
    id: 'aum',
    label: 'Alapméret (AUM)',
    unit: 'money',
    formula: 'a kibocsátó által közölt kezelt vagyon; ha kért, a kijelzési pénznemben',
  } as const;
  const display = inputs.currency.aumInDisplayCurrency;
  const source = display.status === 'OK' ? display : inputs.profile.aum;
  if (source.status !== 'OK') return etfMetric(spec, propagateFailure('AUM', source));
  return etfMetric(
    spec,
    metricOk(source.value.amount, {
      ...source.provenance,
      currency: source.value.currency,
      unit: 'money',
    }),
  );
}

function liquidityFeature(inputs: FeatureInputs): EtfMetric {
  const spec = {
    id: 'averageDailyTradedValue',
    label: 'Átlagos napi forgalom',
    unit: 'money',
    formula: 'átlagos napi kereskedett érték (forrásból vagy kézi bevitelből)',
  } as const;
  const liquidity = inputs.liquidity;
  if (liquidity === undefined) {
    return etfMetric(
      spec,
      metricMissing(
        'Nincs forgalmi adat: a normalizált ártörténet nem tartalmaz volument (KI-67); kézzel megadható.',
      ),
    );
  }
  const currency = parseCurrencyCode(liquidity.currency);
  const asOf = parseIsoDate(liquidity.asOf);
  if (
    !Number.isFinite(liquidity.averageDailyTradedValue) ||
    liquidity.averageDailyTradedValue < 0 ||
    !currency.ok ||
    !asOf.ok
  ) {
    return etfMetric(spec, {
      status: 'INVALID_INPUT',
      reason: 'A napi forgalom nemnegatív véges szám, ISO pénznemmel és ÉÉÉÉ-HH-NN dátummal.',
    });
  }
  return etfMetric(
    spec,
    metricOk(liquidity.averageDailyTradedValue, {
      sourceId: 'user',
      sourceName: liquidity.sourceName,
      kind: 'user_input',
      fetchedAt: inputs.fetchedAt,
      asOf: asOf.value,
      freshness: 'UNKNOWN',
      unit: 'money',
      currency: currency.value,
    }),
  );
}

function syntheticFlag(profile: EtfProfile): Metric<string> {
  const replication = profile.replication;
  return replication.status === 'OK'
    ? metricOk(replication.value === 'synthetic' ? 'igen' : 'nem', replication.provenance)
    : replication;
}

export function buildFeatureModel(inputs: FeatureInputs): EtfFeatureModel {
  const { profile, holdings, costs, tracking, risk, currency } = inputs;
  const features: EtfFeature[] = [
    numeric('diversification', 'higher_is_better', holdings.holdingsCount),
    numeric('diversification', 'higher_is_better', holdings.effectiveHoldings),
    numeric('concentration', 'lower_is_better', holdings.top10Weight),
    numeric('concentration', 'lower_is_better', holdings.largestHoldingWeight),
    numeric('concentration', 'lower_is_better', holdings.largestCountryWeight),
    numeric('concentration', 'lower_is_better', holdings.largestSectorWeight),
    numeric('cost', 'lower_is_better', costs.ter),
    numeric('tracking', 'higher_is_better', tracking.annualizedTrackingDifference),
    numeric('tracking', 'lower_is_better', tracking.trackingError),
    numeric('liquidity', 'higher_is_better', liquidityFeature(inputs)),
    numeric('size', 'higher_is_better', aumFeature(inputs)),
    numeric('size', 'higher_is_better', fundAge(profile, inputs.now, inputs.fetchedAt)),
    categorical('replication', 'structure', 'Replikáció', profile.replication),
    categorical('synthetic', 'structure', 'Szintetikus (swap-alapú)', syntheticFlag(profile)),
    categorical('distribution', 'structure', 'Osztalékkezelés', profile.distribution),
    categorical('ucits', 'structure', 'UCITS', profile.ucits, (v) => (v ? 'igen' : 'nem')),
    categorical('domicile', 'structure', 'Domicil', profile.domicile),
    numeric('risk', 'context', risk.volatility),
    numeric('risk', 'higher_is_better', risk.maxDrawdown),
    numeric('currency', 'lower_is_better', currency.unhedgedForeignShare),
    categorical('hedged', 'currency', 'Devizafedezett', currency.hedged, (v) =>
      v ? 'igen' : 'nem',
    ),
  ];
  const groupCoverage = Object.fromEntries(
    ETF_FEATURE_GROUPS.map((group) => {
      const inGroup = features.filter((feature) => feature.group === group);
      const available = inGroup.filter((feature) =>
        feature.kind === 'numeric'
          ? feature.metric.value.status === 'OK'
          : feature.value.status === 'OK',
      ).length;
      return [group, { available, total: inGroup.length }];
    }),
  ) as EtfFeatureModel['groupCoverage'];
  return { features, groupCoverage, note: ETF_FEATURE_NOTE };
}
