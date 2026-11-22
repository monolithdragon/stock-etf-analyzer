/**
 * ETF-elemzés összerakása – tiszta függvény (hálózat nélkül tesztelhető). PHASE 08, D-069.
 *
 * Az ETF-et NEM részvényként kezeli: vállalati P/E, Forward P/E, DCF és minőségi modell
 * `notApplicable` indokkal; ezeket a modulokat nem is importálja (őrteszt kikényszeríti).
 */
import { deriveRegion } from '@/calculations';
import {
  classifyMetricOrigin,
  ETF_PROFILE_FIELDS,
  metricMissing,
  metricOk,
  ok,
  toIsoTimestamp,
  type AppError,
  type CurrencyCode,
  type DividendHistory,
  type EtfClassificationKey,
  type EtfProfile,
  type EtfRegion,
  type FxConversion,
  type InstrumentProfile,
  type ListingId,
  type Metric,
  type PriceSeries,
  type Quote,
  type Result,
} from '@/domain';

import { analyzeCosts } from './etf-costs';
import { buildFeatureModel } from './etf-features';
import { analyzeCurrency, analyzeHoldings } from './etf-holdings-analysis';
import { engineProvenance } from './etf-metric';
import { buildEtfProfile, NO_METADATA_REASON } from './etf-profile-builder';
import { analyzeReturns } from './etf-returns';
import { analyzeRisk, analyzeTracking, DEFAULT_MIN_RISK_OBSERVATIONS } from './etf-risk';
import type {
  EtfAnalysis,
  EtfAnalysisOptions,
  EtfCoverage,
  EtfCoverageItem,
  EtfHoldingsAnalysis,
  NotApplicableAnalysis,
} from './types';

export const ETF_ANALYSIS_DISCLAIMER =
  'Elemzési kimenet múltbeli és forrásolt adatokból – nem befektetési tanács, nem személyre szabott ajánlás és nem hozamígéret. A múltbeli hozam és kockázat nem garantálja a jövőbelit.';

export const ETF_NOT_APPLICABLE: readonly NotApplicableAnalysis[] = [
  {
    id: 'pe',
    label: 'P/E (vállalati)',
    reason:
      'Az ETF nem vállalat: nincs saját eredménye. Az alap súlyozott P/E-je csak holdings-szintű fundamentumokból volna számolható, ilyen forrás nincs.',
  },
  {
    id: 'forwardPe',
    label: 'Forward P/E',
    reason: 'Az ETF-re nincs saját EPS-becslés; holdings-szintű konszenzus-forrás nincs.',
  },
  {
    id: 'dcf',
    label: 'DCF belső érték',
    reason:
      'Az ETF értéke a nettó eszközértékből (NAV) adódik, nem saját jövőbeli cash flow-ból; a vállalati DCF nem értelmezett.',
  },
  {
    id: 'fundamentalQuality',
    label: 'Vállalati minőségi modell',
    reason:
      'A minőségi modell (versenyelőny, menedzsment, mérleg) vállalatra szól; ETF-nél a struktúra és a költség a releváns.',
  },
];

export interface EtfAnalysisInputs {
  readonly listingId: ListingId;
  readonly now: Date;
  readonly options: EtfAnalysisOptions;
  readonly quote: Result<Quote, AppError>;
  readonly instrumentProfile: Result<InstrumentProfile, AppError>;
  /** Split- és osztalék-korrigált ártörténet (total return jellegű). */
  readonly totalSeries: Result<PriceSeries, AppError>;
  /** Árfolyamsor (split-korrigált, ha a forrás adja; különben nyers). */
  readonly priceSeries: Result<PriceSeries, AppError>;
  readonly dividends: Result<DividendHistory, AppError>;
  /** Az AUM átváltása a kijelzési pénznemre (a use case végzi); `null`, ha nem kellett. */
  readonly aumConversion: Result<FxConversion, AppError> | null;
}

function tradingCurrencyOf(inputs: EtfAnalysisInputs): Metric<CurrencyCode> {
  if (inputs.quote.ok) {
    return metricOk(inputs.quote.value.price.currency, inputs.quote.value.provenance);
  }
  for (const series of [inputs.totalSeries, inputs.priceSeries]) {
    if (series.ok) return metricOk(series.value.currency, series.value.provenance);
  }
  if (inputs.instrumentProfile.ok && inputs.instrumentProfile.value.tradingCurrency !== null) {
    return metricOk(
      inputs.instrumentProfile.value.tradingCurrency,
      inputs.instrumentProfile.value.provenance,
    );
  }
  return metricMissing('A jegyzés pénznemét egyik forrás sem adta (árfolyam, ártörténet, profil).');
}

/** Régió: a megadott (forrás/kézi) érték az elsődleges; hiányában holdings-országsúlyból. */
function withDerivedRegion(
  profile: EtfProfile,
  holdings: EtfHoldingsAnalysis,
  fetchedAt: ReturnType<typeof toIsoTimestamp>,
  warnings: string[],
): EtfProfile {
  if (holdings.countryWeights.status !== 'OK') return profile;
  const derived = deriveRegion(holdings.countryWeights.value);
  if (derived.status !== 'OK') return profile;
  const given = profile.classification.region;
  if (given.status === 'OK') {
    if (given.value !== derived.value.region) {
      warnings.push(
        `A megadott régió (${given.value}) eltér a holdings-országsúlyból levezetettől (${derived.value.region}).`,
      );
    }
    return profile;
  }
  const region: Metric<EtfRegion> = metricOk(
    derived.value.region,
    engineProvenance({
      fetchedAt,
      inputs: [['countryWeights', holdings.countryWeights.provenance]],
      unit: 'ratio',
    }),
  );
  return { ...profile, classification: { ...profile.classification, region } };
}

function coverageOf(profile: EtfProfile, inputs: EtfAnalysisInputs): EtfCoverage {
  const item = (field: EtfCoverageItem['field'], metric: Metric<unknown>): EtfCoverageItem => ({
    field,
    status: metric.status,
    origin: classifyMetricOrigin(metric),
    reason: metric.status === 'OK' ? null : metric.reason,
  });
  const classificationKeys = Object.keys(profile.classification) as EtfClassificationKey[];
  const items: EtfCoverageItem[] = [
    ...ETF_PROFILE_FIELDS.map((field) => item(field, profile[field])),
    ...classificationKeys.map((key) => item(`classification.${key}`, profile.classification[key])),
  ];
  const relevant = items.filter((i) => i.status !== 'NOT_APPLICABLE');
  const limitations: string[] = [];
  if (inputs.options.metadata === undefined) limitations.push(NO_METADATA_REASON);
  if (profile.holdings.status !== 'OK') {
    limitations.push(
      'Holdings-adat nincs: a top N súly, a koncentráció, az ország-/szektorsúly és a mögöttes devizakitettség nem számolható. (Free csomag: nincs; SEC N-PORT csak US-regisztrált alapokra, negyedévente, késleltetve – adapter még nincs.)',
    );
  }
  if (inputs.options.benchmark === undefined) {
    limitations.push(
      'Indexsor nincs: a tracking difference, a tracking error és a béta nem számolható.',
    );
  }
  if (inputs.options.liquidity === undefined) {
    limitations.push('Forgalmi adat nincs (a normalizált ártörténetben nincs volumen).');
  }
  for (const series of [inputs.totalSeries, inputs.priceSeries]) {
    if (series.ok) limitations.push(...series.value.notes);
  }
  return {
    items,
    available: relevant.filter((i) => i.status === 'OK').length,
    total: relevant.length,
    limitations: [...new Set(limitations)],
  };
}

export function buildEtfAnalysis(inputs: EtfAnalysisInputs): Result<EtfAnalysis, AppError> {
  const { options, now } = inputs;
  const fetchedAt = toIsoTimestamp(now);
  const built = buildEtfProfile({
    listingId: inputs.listingId,
    now,
    fetchedAt,
    metadata: options.metadata,
    instrumentProfile: inputs.instrumentProfile.ok ? inputs.instrumentProfile.value : null,
    tradingCurrency: tradingCurrencyOf(inputs),
  });
  if (!built.ok) return built;
  const warnings = [...built.value.warnings];

  const holdings = analyzeHoldings(built.value.profile.holdings, fetchedAt);
  const profile = withDerivedRegion(built.value.profile, holdings, fetchedAt, warnings);

  const returns = analyzeReturns({
    totalSeries: inputs.totalSeries,
    priceSeries: inputs.priceSeries,
    dividends: inputs.dividends,
    distribution: profile.distribution,
    fetchedAt,
  });
  const riskInputs = {
    totalSeries: inputs.totalSeries,
    priceSeries: inputs.priceSeries,
    distribution: profile.distribution,
    benchmark: options.benchmark,
    riskFreeRate: options.riskFreeRate,
    minObservations: options.minRiskObservations ?? DEFAULT_MIN_RISK_OBSERVATIONS,
    fetchedAt,
  };
  const risk = analyzeRisk(riskInputs);
  const tracking = analyzeTracking(riskInputs);
  const costs = analyzeCosts(profile, options.terImpact, fetchedAt);
  const currency = analyzeCurrency({
    profile,
    displayCurrency: options.displayCurrency ?? null,
    aumConversion: inputs.aumConversion,
    fetchedAt,
  });
  const features = buildFeatureModel({
    profile,
    holdings,
    costs,
    tracking,
    risk,
    currency,
    liquidity: options.liquidity,
    now,
    fetchedAt,
  });
  if (returns.comparisonBasis === 'price_return_only') {
    warnings.push(
      'Csak árfolyamhozam: más ETF-fel csak azonos (total return) alapon hasonlítsd össze.',
    );
  }

  return ok({
    listingId: inputs.listingId,
    generatedAt: fetchedAt,
    profile,
    coverage: coverageOf(profile, inputs),
    currency,
    returns,
    risk,
    costs,
    tracking,
    holdings,
    features,
    notApplicable: ETF_NOT_APPLICABLE,
    warnings,
    disclaimer: ETF_ANALYSIS_DISCLAIMER,
  });
}
