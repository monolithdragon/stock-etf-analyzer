/**
 * Súlyok és portfólió-összesítések (D-072/2): minden összeg a pozíciók összege, a komponensek
 * listájával; ha bármelyik pozíció értéke hiányzik, az összeg NEM `OK` (a részösszeg külön).
 */
import { portfolioWeights } from '@/calculations';
import {
  metricInsufficientData,
  metricMissing,
  metricNotApplicable,
  metricOk,
  type CurrencyCode,
  type DataProvenance,
  type IsoTimestamp,
  type ListingId,
  type Metric,
  type Money,
} from '@/domain';

import { metricFromCalc } from './portfolio-metric';
import type { PositionWithoutWeight } from './portfolio-positions';
import type { PortfolioTotal, PortfolioTotals, PositionAnalysis } from './types';
import { engineProvenance } from '../shared/engine-provenance';

export interface WeightingResult {
  readonly positions: readonly PositionAnalysis[];
  /** Az árazott pozíciók súlyai (Σ = 1). */
  readonly weights: readonly { readonly listingId: ListingId; readonly weight: number }[];
  /** Nyitott (vagy hibás) pozíciók piaci érték nélkül – a súlyozásból kimaradtak. */
  readonly unpriced: readonly ListingId[];
  readonly provenance: DataProvenance;
}

export function assignWeights(
  positions: readonly PositionWithoutWeight[],
  fetchedAt: IsoTimestamp,
): WeightingResult {
  const candidates = positions.filter((p) => p.status !== 'closed');
  const inputs = candidates.flatMap((p) =>
    p.marketValueBase.status === 'OK'
      ? [[`marketValue:${p.listingId}`, p.marketValueBase.provenance] as const]
      : [],
  );
  const provenance = engineProvenance({ fetchedAt, inputs, unit: 'ratio' });
  const calc =
    candidates.length === 0
      ? null
      : portfolioWeights(
          candidates.map((p) => ({
            id: p.listingId,
            value: p.marketValueBase.status === 'OK' ? p.marketValueBase.value : null,
          })),
        );
  const weightById = new Map<string, number>();
  if (calc !== null && calc.status === 'OK') {
    for (const { id, weight } of calc.value.weights) weightById.set(id, weight);
  }
  const unpriced = candidates.filter((p) => !weightById.has(p.listingId)).map((p) => p.listingId);

  const withWeights = positions.map((p): PositionAnalysis => {
    let weight: Metric<number>;
    if (p.status === 'closed') weight = metricNotApplicable('Zárt pozíció: nincs súlya.');
    else {
      const w = weightById.get(p.listingId);
      weight =
        w !== undefined
          ? metricOk(w, provenance)
          : calc !== null && calc.status !== 'OK' && calc.status !== 'MISSING'
            ? { status: calc.status, reason: calc.reason }
            : metricMissing(
                `A piaci érték bázisdevizában hiányzik (${p.marketValueBase.status === 'OK' ? '–' : p.marketValueBase.reason}); a pozíció kimaradt a súlyozásból (nem 0 súllyal).`,
              );
    }
    return { ...p, weight };
  });
  return {
    positions: withWeights,
    weights: [...weightById.entries()].map(([listingId, weight]) => ({
      listingId: listingId as ListingId,
      weight,
    })),
    unpriced,
    provenance,
  };
}

function total(
  id: string,
  label: string,
  positions: readonly PositionAnalysis[],
  pick: (position: PositionAnalysis) => Metric<Money>,
  currency: CurrencyCode,
  fetchedAt: IsoTimestamp,
): PortfolioTotal {
  const components: { listingId: ListingId; amount: number }[] = [];
  const missing: ListingId[] = [];
  const reasons: string[] = [];
  const inputs: (readonly [string, DataProvenance])[] = [];
  for (const position of positions) {
    const metric = pick(position);
    if (metric.status === 'OK') {
      components.push({ listingId: position.listingId, amount: metric.value.amount });
      inputs.push([`${id}:${position.listingId}`, metric.provenance]);
    } else {
      missing.push(position.listingId);
      reasons.push(`${position.listingId}: ${metric.reason}`);
    }
  }
  const sum = components.reduce((acc, item) => acc + item.amount, 0);
  const value: Metric<Money> =
    positions.length === 0
      ? metricInsufficientData('A portfólióban nincs tranzakció.')
      : missing.length > 0
        ? metricMissing(
            `${missing.length} pozíció értéke hiányzik, ezért a(z) „${label}” összeg nem teljes. ${reasons.join(' | ')}`,
          )
        : metricOk(
            { amount: sum, currency },
            engineProvenance({ fetchedAt, inputs, unit: 'money', currency }),
          );
  return { id, label, value, availableSum: { amount: sum, currency }, components, missing };
}

export function buildTotals(
  positions: readonly PositionAnalysis[],
  currency: CurrencyCode,
  fetchedAt: IsoTimestamp,
): PortfolioTotals {
  const t = (id: string, label: string, pick: (p: PositionAnalysis) => Metric<Money>) =>
    total(id, label, positions, pick, currency, fetchedAt);
  const totalReturn = t('totalReturn', 'Összhozam', (p) => p.totalReturnBase);
  const grossInvested = t('grossInvested', 'Bruttó befektetés', (p) => p.grossInvestedBase);
  const pct =
    totalReturn.value.status !== 'OK'
      ? ({ status: 'MISSING', reason: totalReturn.value.reason } as const)
      : grossInvested.value.status !== 'OK'
        ? ({ status: 'MISSING', reason: grossInvested.value.reason } as const)
        : grossInvested.value.value.amount <= 0
          ? ({ status: 'NOT_APPLICABLE', reason: 'Nincs vétel.' } as const)
          : ({
              status: 'OK',
              value: totalReturn.value.value.amount / grossInvested.value.value.amount,
              notes: [],
            } as const);
  return {
    currency,
    marketValue: t('marketValue', 'Piaci érték', (p) => p.marketValueBase),
    costBasis: t('costBasis', 'Bekerülési érték (nyitott)', (p) => p.costBasisBase),
    unrealizedPL: t('unrealizedPL', 'Nem realizált P/L', (p) => p.unrealizedPLBase),
    priceEffect: t('priceEffect', 'Árhatás', (p) => p.priceEffectBase),
    fxEffect: t('fxEffect', 'FX-hatás', (p) => p.fxEffectBase),
    realizedPL: t('realizedPL', 'Realizált P/L', (p) => p.realizedPLBase),
    dividends: t('dividends', 'Osztalék', (p) => p.dividendsBase),
    otherFees: t('otherFees', 'Külön díjak', (p) => p.otherFeesBase),
    grossInvested,
    totalReturn,
    totalReturnPct: metricFromCalc(
      {
        id: 'totalReturnPct',
        label: 'Összhozam %',
        unit: 'ratio',
        formula:
          '(nem realizált + realizált + osztalék − külön díjak) / bruttó befektetés; egyszerű, NEM idő- vagy pénzsúlyozott',
      },
      pct,
      engineProvenance({ fetchedAt, inputs: [], unit: 'ratio' }),
    ),
    openPositions: positions.filter((p) => p.status === 'open').length,
    closedPositions: positions.filter((p) => p.status === 'closed').length,
    invalidPositions: positions.filter((p) => p.status === 'invalid').length,
  };
}
