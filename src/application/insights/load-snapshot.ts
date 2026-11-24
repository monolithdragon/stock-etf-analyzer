/**
 * Use case-ek: pillanatkép betöltése (PHASE 14, D-085).
 *
 * - `loadMarketSummary(listingId)`: ár + napi változás (2 könnyű lekérés, a cache-en át) –
 *   a figyelőlista alapnézete. Elemzést NEM indít (kvótakímélés: free EODHD 20 hívás/nap).
 * - `loadInstrumentSnapshot(item)`: teljes pillanatkép a meglévő `evaluateStock` /
 *   `evaluateEtf` use case-ből + piaci összefoglaló. Csak kifejezett felhasználói kérésre fut
 *   (compare, screener, riasztás-ellenőrzés, „Score betöltése”).
 *
 * Ismeretlen típusú jegyzésnél nem találgatunk (részvény vagy ETF?) – `VALIDATION` hibát adunk.
 * A lista-változatok SORBAN dolgoznak (nem párhuzamosan), hogy a szolgáltatói limitet ne
 * terheljék csúcsszerűen; egy elem hibája nem buktatja a többit.
 */
import {
  AppErrors,
  err,
  ok,
  toUtcIsoDate,
  type AppError,
  type DisplayCurrency,
  type Metric,
  type Result,
} from '@/domain';

import type { Clock } from '../ports';
import {
  buildEtfSnapshot,
  buildStockSnapshot,
  dayChangeMetric,
  priceMetric,
  type InstrumentSnapshot,
  type SnapshotMarketInputs,
} from './instrument-snapshot';
import type { EvaluateEtf, EvaluateStock } from '../use-cases/evaluate-instrument';
import type { GetListingQuote } from '../use-cases/get-listing-quote';
import type { GetInstrumentProfile, GetPriceHistory } from '../use-cases/get-market-data';
import type { WatchlistInstrumentKind } from '../watchlist/types';

/** A napi változáshoz lekért ablak (hétvége + ünnep mellett is legyen két záróár). */
export const DAY_CHANGE_LOOKBACK_DAYS = 10;

export interface SnapshotTarget {
  readonly listingId: string;
  readonly kind: WatchlistInstrumentKind;
}

export interface MarketSummary {
  readonly listingId: string;
  readonly price: Metric<number>;
  readonly dayChange: Metric<number>;
}

export interface SnapshotLoadOutcome {
  readonly target: SnapshotTarget;
  readonly snapshot: InstrumentSnapshot | null;
  /** Hiba esetén az ok (pl. nem elérhető adat, ismeretlen típus). */
  readonly error: AppError | null;
}

export interface SnapshotOptions {
  readonly displayCurrency?: DisplayCurrency;
}

export type LoadMarketSummary = (listingId: string) => Promise<MarketSummary>;
export type LoadInstrumentSnapshot = (
  target: SnapshotTarget,
  options?: SnapshotOptions,
) => Promise<Result<InstrumentSnapshot, AppError>>;
export type LoadInstrumentSnapshots = (
  targets: readonly SnapshotTarget[],
  options?: SnapshotOptions,
) => Promise<readonly SnapshotLoadOutcome[]>;

export interface SnapshotDeps {
  readonly getListingQuote: GetListingQuote;
  readonly getPriceHistory: GetPriceHistory;
  readonly getInstrumentProfile: GetInstrumentProfile;
  readonly evaluateStock: EvaluateStock;
  readonly evaluateEtf: EvaluateEtf;
  readonly clock: Clock;
}

async function marketInputs(
  deps: Pick<SnapshotDeps, 'getListingQuote' | 'getPriceHistory' | 'clock'>,
  listingId: string,
): Promise<SnapshotMarketInputs> {
  const now = deps.clock.now();
  const from = toUtcIsoDate(new Date(now.getTime() - DAY_CHANGE_LOOKBACK_DAYS * 86_400_000));
  const [quote, history] = await Promise.all([
    deps.getListingQuote(listingId),
    // Split-korrigált sor: egy split napján ne látsszon hamis −50%-os „napi változás”.
    deps.getPriceHistory(listingId, { from, to: toUtcIsoDate(now), adjustment: 'SPLIT' }),
  ]);
  return {
    quote: quote.ok ? quote.value : null,
    ...(quote.ok ? {} : { quoteError: `Ár nem elérhető: ${quote.error.message}` }),
    recentPrices: history.ok ? history.value : null,
  };
}

export function createLoadMarketSummary(
  deps: Pick<SnapshotDeps, 'getListingQuote' | 'getPriceHistory' | 'clock'>,
): LoadMarketSummary {
  return async (listingId) => {
    const inputs = await marketInputs(deps, listingId);
    return {
      listingId,
      price: priceMetric(inputs),
      dayChange: dayChangeMetric(inputs.recentPrices),
    };
  };
}

export function createLoadInstrumentSnapshot(deps: SnapshotDeps): LoadInstrumentSnapshot {
  return async (target, options = {}) => {
    if (target.kind === 'unknown') {
      return err(
        AppErrors.validation(
          `A(z) ${target.listingId} típusa ismeretlen (részvény vagy ETF?) – nem találgatunk; nyisd meg az elemzést, vagy vedd fel újra a keresésből.`,
        ),
      );
    }
    const market = await marketInputs(deps, target.listingId);
    if (target.kind === 'stock') {
      const [evaluated, profile] = await Promise.all([
        deps.evaluateStock(target.listingId),
        deps.getInstrumentProfile(target.listingId),
      ]);
      if (!evaluated.ok) return evaluated;
      return ok(
        buildStockSnapshot(evaluated.value, {
          ...market,
          isin: profile.ok ? profile.value.isin : null,
        }),
      );
    }
    const evaluated = await deps.evaluateEtf(
      target.listingId,
      options.displayCurrency === undefined
        ? {}
        : { analysis: { displayCurrency: options.displayCurrency } },
    );
    if (!evaluated.ok) return evaluated;
    return ok(buildEtfSnapshot(evaluated.value, market));
  };
}

export function createLoadInstrumentSnapshots(
  loadOne: LoadInstrumentSnapshot,
): LoadInstrumentSnapshots {
  return async (targets, options) => {
    const outcomes: SnapshotLoadOutcome[] = [];
    const seen = new Set<string>();
    for (const target of targets) {
      if (seen.has(target.listingId)) continue;
      seen.add(target.listingId);
      const result = await loadOne(target, options);
      outcomes.push(
        result.ok
          ? { target, snapshot: result.value, error: null }
          : { target, snapshot: null, error: result.error },
      );
    }
    return outcomes;
  };
}
