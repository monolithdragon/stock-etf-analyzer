/**
 * Portfólióelemzés összerakása (PHASE 09) – TISZTA függvény: minden adat (árfolyam, FX,
 * metaadat, holdings, ártörténet) bemenet; nincs hálózat, nincs óra (a `now` paraméter).
 */
import {
  orderTransactions,
  toIsoTimestamp,
  validateTransactionLedger,
  type AppError,
  type CurrencyCode,
  type EtfHoldingsSnapshot,
  type IsoDate,
  type ListingId,
  type Portfolio,
  type PortfolioAssetMetadata,
  type PriceSeries,
  type Quote,
  type Result,
  type Transaction,
} from '@/domain';

import type { FxLookup } from './fx-lookup';
import { buildConcentration, buildEtfOverlap, buildExposures } from './portfolio-exposure';
import { buildHistory, type FxDailyPoint } from './portfolio-history';
import { buildPosition } from './portfolio-positions';
import { assignWeights, buildTotals } from './portfolio-totals';
import type { PortfolioAnalysis, UsedFxRate } from './types';

export const PORTFOLIO_ANALYSIS_DISCLAIMER =
  'Elemzési kimenet a rögzített tranzakciók és a jelölt forrású adatok alapján. Nem befektetési tanács, nem hozamígéret. Az átlagár-módszer nem alkalmas adóbevallásra.';

export const ACCOUNTING_METHOD = {
  id: 'average_cost',
  description:
    'Átlagár-módszer (D-012): a vételek díjjal növelt költsége átlagolódik; eladáskor a bekerülés az átlagáron csökken, a realizált P/L = nettó eladási bevétel − átlagár × darab. Split: a darabszám nő, a bekerülés változatlan.',
  taxWarning:
    'Adózási célra nem alkalmas: a magyar szabályok szerinti árfolyamnyereség-számítás (pl. FIFO, MNB-árfolyam) eltérhet. FIFO: későbbi bővítés.',
} as const;

export interface PortfolioAnalysisInput {
  readonly portfolio: Portfolio;
  readonly transactions: readonly Transaction[];
  readonly now: Date;
  readonly quotes: ReadonlyMap<ListingId, Result<Quote, AppError>>;
  readonly fx: FxLookup;
  readonly metadata: ReadonlyMap<ListingId, PortfolioAssetMetadata>;
  readonly holdings: ReadonlyMap<ListingId, EtfHoldingsSnapshot>;
  readonly history: {
    readonly enabled: boolean;
    readonly from: IsoDate | null;
    readonly priceSeries: ReadonlyMap<ListingId, Result<PriceSeries, AppError>>;
    readonly fxSeries: ReadonlyMap<CurrencyCode, readonly FxDailyPoint[]>;
  };
  readonly riskFreeRate: number | null;
  readonly minRiskObservations: number;
}

export function buildPortfolioAnalysis(input: PortfolioAnalysisInput): PortfolioAnalysis {
  const { portfolio, fx } = input;
  const fetchedAt = toIsoTimestamp(input.now);
  const listingCurrencies = new Map<ListingId, CurrencyCode>();
  for (const [listingId, quote] of input.quotes) {
    if (quote.ok) listingCurrencies.set(listingId, quote.value.price.currency);
  }
  const validation = validateTransactionLedger(portfolio, input.transactions, {
    listingCurrencies,
  });
  const ordered = orderTransactions(input.transactions);
  const listings = [...new Set(ordered.map((t) => t.listingId))];

  const rawPositions = listings.map((listingId) =>
    buildPosition({
      listingId,
      transactions: ordered.filter((t) => t.listingId === listingId),
      issues: validation.issues.filter((issue) => issue.listingId === listingId),
      invalid: validation.blocking || validation.invalidListings.has(listingId),
      quote: input.quotes.get(listingId) ?? null,
      metadata: input.metadata.get(listingId) ?? null,
      fx,
      fetchedAt,
    }),
  );
  const weighting = assignWeights(rawPositions, fetchedAt);
  const positions = weighting.positions;
  const totals = buildTotals(positions, portfolio.baseCurrency, fetchedAt);
  const weightById = new Map(weighting.weights.map((w) => [w.listingId, w.weight]));
  const weighted = positions
    .filter((p) => weightById.has(p.listingId))
    .map((position) => ({ position, weight: weightById.get(position.listingId) as number }));
  const exposureInput = {
    weighted,
    unpriced: weighting.unpriced,
    holdings: input.holdings,
    provenance: weighting.provenance,
  };
  const exposures = buildExposures(exposureInput);

  const history = buildHistory({
    enabled: input.history.enabled,
    from: input.history.from,
    base: portfolio.baseCurrency,
    transactions: ordered,
    invalidListings: validation.blocking ? new Set(listings) : validation.invalidListings,
    priceSeries: input.history.priceSeries,
    fxSeries: input.history.fxSeries,
    openListingsByWeight: [...weighted]
      .sort((a, b) => b.weight - a.weight)
      .map((w) => w.position.listingId),
    riskFreeRate: input.riskFreeRate,
    minObservations: input.minRiskObservations,
    fetchedAt,
  });

  return {
    portfolioId: portfolio.id,
    portfolioName: portfolio.name,
    baseCurrency: portfolio.baseCurrency,
    generatedAt: fetchedAt,
    accountingMethod: ACCOUNTING_METHOD,
    validation: { issues: validation.issues },
    positions,
    totals,
    exposures,
    concentration: buildConcentration(exposureInput, exposures),
    etfOverlap: buildEtfOverlap(exposureInput, positions),
    history,
    fxRatesUsed: collectUsedRates(positions),
    warnings: buildWarnings(input, validation.issues, weighting.unpriced, positions),
    disclaimer: PORTFOLIO_ANALYSIS_DISCLAIMER,
  };
}

function collectUsedRates(positions: PortfolioAnalysis['positions']): readonly UsedFxRate[] {
  const seen = new Map<string, UsedFxRate>();
  for (const position of positions) {
    const rates = [position.currentFx, ...position.ledger.map((row) => row.fxRate)];
    for (const rate of rates) {
      if (rate === null) continue;
      seen.set(`${rate.currency}|${rate.asOf}|${rate.source}|${rate.rate}`, rate);
    }
  }
  return [...seen.values()].sort(
    (a, b) => a.currency.localeCompare(b.currency) || a.asOf.localeCompare(b.asOf),
  );
}

function buildWarnings(
  input: PortfolioAnalysisInput,
  issues: PortfolioAnalysis['validation']['issues'],
  unpriced: readonly ListingId[],
  positions: PortfolioAnalysis['positions'],
): readonly string[] {
  const warnings: string[] = [];
  const errors = issues.filter((i) => i.severity === 'error');
  if (errors.length > 0) {
    warnings.push(
      `${errors.length} hibás tranzakció: az érintett pozíciók nem számolhatók (lásd validation).`,
    );
  }
  const soft = issues.filter((i) => i.severity === 'warning');
  if (soft.length > 0)
    warnings.push(`${soft.length} ellenőrizendő tranzakció (pl. lehetséges duplikátum).`);
  if (unpriced.length > 0) {
    warnings.push(
      `Piaci érték nélküli pozíció (ár vagy FX hiányzik): ${unpriced.join(', ')} – az összesítés nem teljes.`,
    );
  }
  for (const [listingId, quote] of input.quotes) {
    if (!quote.ok) continue;
    const freshness = quote.value.provenance.freshness;
    if (freshness === 'STALE' || freshness === 'EXPIRED') {
      warnings.push(`${listingId}: az árfolyam nem friss (${freshness}, ${quote.value.asOf}).`);
    }
    if (quote.value.provenance.kind === 'mock') {
      warnings.push(`${listingId}: DEMO árfolyam (mock adat).`);
    }
  }
  if (positions.some((p) => p.status === 'open' && p.metadata === null)) {
    warnings.push(
      'Egyes pozícióknak nincs metaadata (fajta, ország, szektor): a kitettség-bontásban besorolatlanok.',
    );
  }
  return warnings;
}
