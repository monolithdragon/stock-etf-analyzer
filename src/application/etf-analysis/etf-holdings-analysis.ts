/**
 * Holdings-alapú mutatók és devizakitettség (PHASE 08 feladat 4. és 5., D-067, D-068).
 * Holdings nélkül minden mutató a hiány okát hordozza (free csomag: `UNAVAILABLE / PLAN_LIMIT`).
 */
import {
  currencyRisk,
  exposureBreakdown,
  holdingsConcentration,
  topNWeight,
  type CalcResult,
  type CurrencyRisk,
  type ExposureBreakdown,
} from '@/calculations';
import {
  metricMissing,
  metricNotApplicable,
  metricOk,
  toMajor,
  type CurrencyCode,
  type DisplayCurrency,
  type EtfHoldingsSnapshot,
  type EtfProfile,
  type FxConversion,
  type IsoTimestamp,
  type Metric,
  type Money,
  type AppError,
  type Result,
} from '@/domain';

import {
  engineProvenance,
  etfMetric,
  fromCalc,
  propagateFailure,
  type MetricSpec,
} from './etf-metric';
import type {
  EtfCurrencyAnalysis,
  EtfExposureGroup,
  EtfHoldingsAnalysis,
  EtfMetric,
} from './types';
import { appErrorToMetric } from '../shared/app-error-metric';

const ratio = (id: string, label: string, formula: string): MetricSpec => ({
  id,
  label,
  unit: 'ratio',
  formula,
});

export const HOLDINGS_SPECS = {
  holdingsCount: {
    id: 'holdingsCount',
    label: 'Pozíciók száma',
    unit: 'count',
    formula: 'a forrás által jelentett pozíciószám; teljes listánál a tételek száma',
  },
  coveredWeight: ratio(
    'coveredWeight',
    'A lista által lefedett súly',
    'Σ súly a felsorolt tételekre',
  ),
  top5Weight: ratio('top5Weight', 'Top 5 súly', 'a legnagyobb 5 pozitív súly összege'),
  top10Weight: ratio('top10Weight', 'Top 10 súly', 'a legnagyobb 10 pozitív súly összege'),
  top20Weight: ratio('top20Weight', 'Top 20 súly', 'a legnagyobb 20 pozitív súly összege'),
  herfindahl: ratio(
    'herfindahl',
    'Koncentráció (HHI)',
    'Σ wᵢ² a pozitív, 1-re normalizált súlyokra; teljes lista kell',
  ),
  effectiveHoldings: {
    id: 'effectiveHoldings',
    label: 'Effektív pozíciószám',
    unit: 'count',
    formula: '1 / HHI',
  },
  largestHoldingWeight: ratio('largestHoldingWeight', 'Legnagyobb pozíció súlya', 'max wᵢ'),
  largestCountryWeight: ratio('largestCountryWeight', 'Legnagyobb országsúly', 'max_ország Σ wᵢ'),
  largestSectorWeight: ratio('largestSectorWeight', 'Legnagyobb szektorsúly', 'max_szektor Σ wᵢ'),
  unhedgedForeignShare: ratio(
    'unhedgedForeignShare',
    'Fedezetlen idegen devizakitettség',
    'a kijelzési devizától eltérő, fedezés utáni mögöttes kitettség aránya (holdings-deviza szerint)',
  ),
} as const satisfies Record<string, MetricSpec>;

function breakdownMetric(
  calc: CalcResult<ExposureBreakdown>,
  snapshot: EtfHoldingsSnapshot,
  fetchedAt: IsoTimestamp,
): Metric<readonly EtfExposureGroup[]> {
  if (calc.status !== 'OK') return { status: calc.status, reason: calc.reason };
  return metricOk(
    calc.value.groups,
    engineProvenance({ fetchedAt, inputs: [['holdings', snapshot.provenance]], unit: 'ratio' }),
  );
}

function largestGroup(
  spec: MetricSpec,
  breakdown: Metric<readonly EtfExposureGroup[]>,
  calc: CalcResult<ExposureBreakdown>,
): EtfMetric {
  if (breakdown.status !== 'OK')
    return etfMetric(spec, propagateFailure('csoportosítás', breakdown));
  const top = breakdown.value[0];
  if (top === undefined) {
    return etfMetric(spec, metricMissing('Egyetlen tételnél sincs megadva a besorolás.'));
  }
  const notes = calc.status === 'OK' ? [`${top.key}`, ...calc.notes] : [];
  return etfMetric(spec, metricOk(top.weight, breakdown.provenance), null, notes);
}

export function analyzeHoldings(
  holdings: Metric<EtfHoldingsSnapshot>,
  fetchedAt: IsoTimestamp,
): EtfHoldingsAnalysis {
  if (holdings.status !== 'OK') {
    const failed = propagateFailure('holdings', holdings);
    const metric = (spec: MetricSpec) => etfMetric(spec, failed);
    return {
      asOf: null,
      completeness: null,
      holdingsCount: metric(HOLDINGS_SPECS.holdingsCount),
      coveredWeight: metric(HOLDINGS_SPECS.coveredWeight),
      top5Weight: metric(HOLDINGS_SPECS.top5Weight),
      top10Weight: metric(HOLDINGS_SPECS.top10Weight),
      top20Weight: metric(HOLDINGS_SPECS.top20Weight),
      herfindahl: metric(HOLDINGS_SPECS.herfindahl),
      effectiveHoldings: metric(HOLDINGS_SPECS.effectiveHoldings),
      largestHoldingWeight: metric(HOLDINGS_SPECS.largestHoldingWeight),
      countryWeights: failed as Metric<never>,
      sectorWeights: failed as Metric<never>,
      largestCountryWeight: metric(HOLDINGS_SPECS.largestCountryWeight),
      largestSectorWeight: metric(HOLDINGS_SPECS.largestSectorWeight),
      notes: [],
    };
  }
  const snapshot = holdings.value;
  const isComplete = snapshot.completeness === 'complete';
  const weights = snapshot.holdings.map((h) => h.weight);
  const context = { fetchedAt, inputs: [['holdings', snapshot.provenance]] as const };

  const count: Metric<number> =
    snapshot.reportedHoldingsCount !== null
      ? metricOk(snapshot.reportedHoldingsCount, { ...snapshot.provenance, unit: 'count' })
      : isComplete
        ? metricOk(snapshot.holdings.length, engineProvenance({ ...context, unit: 'count' }))
        : {
            status: 'INSUFFICIENT_DATA',
            reason: `Részleges lista (${snapshot.holdings.length} tétel); az alap teljes pozíciószámát a forrás nem közli.`,
          };

  const concentration = holdingsConcentration({ weights, isComplete });
  const top = (spec: MetricSpec, n: number) =>
    fromCalc(spec, topNWeight({ weights, n, isComplete }), context);

  const countryCalc = exposureBreakdown(
    snapshot.holdings.map((h) => ({ key: h.country, weight: h.weight })),
  );
  const sectorCalc = exposureBreakdown(
    snapshot.holdings.map((h) => ({ key: h.sector, weight: h.weight })),
  );
  const countryWeights = breakdownMetric(countryCalc, snapshot, fetchedAt);
  const sectorWeights = snapshot.holdings.every((h) => h.sector === null)
    ? metricMissing<readonly EtfExposureGroup[]>(
        'A forrás nem ad szektor-besorolást (pl. a SEC N-PORT sem tartalmaz szektort).',
      )
    : breakdownMetric(sectorCalc, snapshot, fetchedAt);

  return {
    asOf: snapshot.asOf,
    completeness: snapshot.completeness,
    holdingsCount: etfMetric(HOLDINGS_SPECS.holdingsCount, count),
    coveredWeight: fromCalc(
      HOLDINGS_SPECS.coveredWeight,
      { status: 'OK', value: snapshot.listedWeight, notes: [] },
      context,
    ),
    top5Weight: top(HOLDINGS_SPECS.top5Weight, 5),
    top10Weight: top(HOLDINGS_SPECS.top10Weight, 10),
    top20Weight: top(HOLDINGS_SPECS.top20Weight, 20),
    herfindahl: fromCalc(
      HOLDINGS_SPECS.herfindahl,
      concentration.status === 'OK'
        ? { ...concentration, value: concentration.value.herfindahl }
        : concentration,
      context,
    ),
    effectiveHoldings: fromCalc(
      HOLDINGS_SPECS.effectiveHoldings,
      concentration.status === 'OK'
        ? { ...concentration, value: concentration.value.effectiveHoldings }
        : concentration,
      context,
    ),
    largestHoldingWeight: top(HOLDINGS_SPECS.largestHoldingWeight, 1),
    countryWeights,
    sectorWeights,
    largestCountryWeight: largestGroup(
      HOLDINGS_SPECS.largestCountryWeight,
      countryWeights,
      countryCalc,
    ),
    largestSectorWeight: largestGroup(
      HOLDINGS_SPECS.largestSectorWeight,
      sectorWeights,
      sectorCalc,
    ),
    notes: [
      ...snapshot.notes,
      ...(holdings.provenance.freshness === 'STALE' || holdings.provenance.freshness === 'EXPIRED'
        ? [`A holdings-pillanatkép régi (${snapshot.asOf}).`]
        : []),
    ],
  };
}

function shareOf(calc: CalcResult<CurrencyRisk>): CalcResult<number> {
  return calc.status === 'OK' ? { ...calc, value: calc.value.unhedgedForeignShare } : calc;
}

export interface CurrencyInputs {
  readonly profile: EtfProfile;
  readonly displayCurrency: DisplayCurrency | null;
  readonly aumConversion: Result<FxConversion, AppError> | null;
  readonly fetchedAt: IsoTimestamp;
}

export function analyzeCurrency(inputs: CurrencyInputs): EtfCurrencyAnalysis {
  const { profile, displayCurrency, fetchedAt } = inputs;
  const notes: string[] = [];
  const holdings = profile.holdings;

  // Mögöttes kitettség a holdings devizája szerint (GBX → GBP).
  let underlying: EtfCurrencyAnalysis['underlyingExposure'];
  let groups: readonly EtfExposureGroup[] = [];
  if (holdings.status !== 'OK') {
    underlying = propagateFailure('holdings', holdings) as Metric<never>;
  } else if (holdings.value.holdings.every((h) => h.currency === null)) {
    underlying = metricMissing('A holdings-tételeknél a forrás nem adott devizát.');
  } else {
    const calc = exposureBreakdown(
      holdings.value.holdings.map((h) => ({
        key: h.currency === null ? null : toMajor(h.currency).major,
        weight: h.weight,
      })),
    );
    if (calc.status === 'OK') {
      groups = calc.value.groups;
      underlying = metricOk(
        groups.map((g) => ({ currency: g.key, weight: g.weight })),
        engineProvenance({ fetchedAt, inputs: [['holdings', holdings.provenance]], unit: 'ratio' }),
      );
    } else {
      underlying = { status: calc.status, reason: calc.reason };
    }
  }

  // Fedezetlen idegen kitettség a kijelzési devizához képest.
  let unhedged: EtfMetric;
  const spec = HOLDINGS_SPECS.unhedgedForeignShare;
  const hedged = profile.currencyHedged;
  if (displayCurrency === null) {
    unhedged = etfMetric(spec, metricMissing('Nincs kijelzési (befektetői) deviza megadva.'));
  } else if (hedged.status !== 'OK') {
    unhedged = etfMetric(spec, propagateFailure('devizafedezés (hedged)', hedged));
  } else if (hedged.value) {
    const target = profile.hedgeCurrency;
    unhedged =
      target.status === 'OK'
        ? fromCalc(
            spec,
            shareOf(
              currencyRisk({
                exposures: groups,
                investorCurrency: displayCurrency,
                hedgedTo: target.value,
              }),
            ),
            {
              fetchedAt,
              inputs: [
                ['currencyHedged', hedged.provenance],
                ['hedgeCurrency', target.provenance],
              ],
            },
          )
        : etfMetric(spec, propagateFailure('fedezési deviza', target));
  } else if (underlying.status !== 'OK') {
    unhedged = etfMetric(spec, propagateFailure('mögöttes devizakitettség', underlying));
  } else {
    unhedged = fromCalc(
      spec,
      shareOf(
        currencyRisk({ exposures: groups, investorCurrency: displayCurrency, hedgedTo: null }),
      ),
      {
        fetchedAt,
        inputs: [
          ['holdings', underlying.provenance],
          ['currencyHedged', hedged.provenance],
        ],
      },
    );
  }

  const trading = profile.tradingCurrency;
  if (
    trading.status === 'OK' &&
    groups.length > 0 &&
    groups[0]?.key !== toMajor(trading.value).major
  ) {
    notes.push(
      `A jegyzési deviza (${trading.value}) nem azonos a fő mögöttes kitettséggel (${groups[0]?.key}): a devizakockázatot a mögöttes eszközök adják, nem a jegyzés.`,
    );
  }
  if (
    displayCurrency !== null &&
    trading.status === 'OK' &&
    toMajor(trading.value).major !== displayCurrency
  ) {
    notes.push(
      `A kijelzési deviza (${displayCurrency}) eltér a jegyzésitől (${trading.value}): az átváltás csak megjelenítés, a kitettséget nem változtatja.`,
    );
  }

  return {
    tradingCurrency: trading,
    fundBaseCurrency: profile.fundBaseCurrency,
    hedged,
    hedgeCurrency: profile.hedgeCurrency,
    underlyingExposure: underlying,
    unhedgedForeignShare: unhedged,
    displayCurrency,
    aumInDisplayCurrency: aumInDisplay(inputs),
    notes,
  };
}

function aumInDisplay(inputs: CurrencyInputs): Metric<Money> {
  const { profile, displayCurrency, aumConversion } = inputs;
  if (displayCurrency === null) return metricNotApplicable('Nincs kijelzési deviza megadva.');
  if (profile.aum.status !== 'OK') return propagateFailure('AUM', profile.aum) as Metric<never>;
  if (aumConversion === null) return metricMissing('Az AUM átváltása nem történt meg.');
  if (!aumConversion.ok) return appErrorToMetric(aumConversion.error, 'AUM átváltása');
  const { converted, rate } = aumConversion.value;
  return metricOk(converted, {
    ...profile.aum.provenance,
    kind: profile.aum.provenance.kind === 'mock' ? 'mock' : 'calculated',
    currency: converted.currency as CurrencyCode,
    inputs: ['aum', ...(rate === null ? [] : [`fx:${rate.base}/${rate.quote}@${rate.asOf}`])],
  });
}
