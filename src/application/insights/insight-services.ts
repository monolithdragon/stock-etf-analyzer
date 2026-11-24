/**
 * PHASE 14 use case-ek: figyelőlista-áttekintés, összehasonlítás, screener, riasztások.
 * Mind a közös pillanatkép-betöltőre épül (`load-snapshot.ts`) – üzleti logika nincs duplikálva.
 */
import { AppErrors, err, ok, toIsoTimestamp, type AppError, type Result } from '@/domain';

import type {
  AlertRuleRepository,
  Clock,
  IdGenerator,
  PortfolioRepository,
  WatchlistRepository,
} from '../ports';
import {
  ALERT_METRIC_INFO,
  MAX_ALERT_RULES,
  applyEvaluation,
  evaluateAlertRule,
  validateNewAlertRule,
  type AlertEvaluation,
  type AlertRule,
  type AlertSubject,
  type NewAlertRule,
} from './alerts';
import { compareInstruments, type ComparisonResult } from './compare';
import type {
  LoadInstrumentSnapshot,
  LoadInstrumentSnapshots,
  LoadMarketSummary,
  MarketSummary,
  SnapshotLoadOutcome,
  SnapshotOptions,
  SnapshotTarget,
} from './load-snapshot';
import {
  runScreener,
  validateScreenerQuery,
  type ScreenerQuery,
  type ScreenerResult,
} from './screener';
import type { GetInstrumentProfile } from '../use-cases/get-market-data';
import type { WatchlistInstrumentKind, WatchlistItem } from '../watchlist/types';

// ---------------------------------------------------------------------------------------------
// Összehasonlítás
// ---------------------------------------------------------------------------------------------

export interface CompareOutcome {
  readonly comparison: ComparisonResult;
  /** A betöltés eredménye elemenként (hibás elem kimarad, okkal). */
  readonly loads: readonly SnapshotLoadOutcome[];
}

export type CompareListings = (
  targets: readonly SnapshotTarget[],
  options?: SnapshotOptions,
) => Promise<Result<CompareOutcome, AppError>>;

export function createCompareListings(deps: {
  readonly loadSnapshots: LoadInstrumentSnapshots;
}): CompareListings {
  return async (targets, options) => {
    const loads = await deps.loadSnapshots(targets, options);
    const snapshots = loads.flatMap((l) => (l.snapshot === null ? [] : [l.snapshot]));
    const failed = loads.filter((l) => l.error !== null);
    const compared = compareInstruments(snapshots);
    if (!compared.ok) {
      const why = failed.map((l) => `${l.target.listingId}: ${l.error?.message ?? ''}`).join('; ');
      return err(
        AppErrors.validation(
          failed.length > 0
            ? `${compared.error.message} Nem betölthető: ${why}`
            : compared.error.message,
        ),
      );
    }
    return ok({ comparison: compared.value, loads });
  };
}

// ---------------------------------------------------------------------------------------------
// Lokális univerzum (screener): figyelőlista + portfólió
// ---------------------------------------------------------------------------------------------

export type ListLocalUniverse = () => Promise<Result<readonly SnapshotTarget[], AppError>>;

export function createListLocalUniverse(deps: {
  readonly watchlistRepository: WatchlistRepository;
  readonly portfolioRepository: PortfolioRepository;
  readonly getInstrumentProfile: GetInstrumentProfile;
}): ListLocalUniverse {
  return async () => {
    const watchlist = await deps.watchlistRepository.list();
    if (!watchlist.ok) return watchlist;
    const targets: SnapshotTarget[] = watchlist.value.map((i) => ({
      listingId: i.listingId,
      kind: i.kind,
    }));
    const known = new Set(targets.map((t) => t.listingId));
    const portfolios = await deps.portfolioRepository.listPortfolios();
    if (!portfolios.ok) return portfolios;
    for (const portfolio of portfolios.value) {
      const transactions = await deps.portfolioRepository.listTransactions(portfolio.id);
      if (!transactions.ok) return transactions;
      for (const t of transactions.value) {
        if (known.has(t.listingId)) continue;
        known.add(t.listingId);
        // A tranzakció nem tárol típust → a (cache-elt) profil típusjelzése; hiányában ismeretlen.
        const profile = await deps.getInstrumentProfile(t.listingId);
        const hint = profile.ok ? profile.value.kindHint : null;
        const kind: WatchlistInstrumentKind = hint === 'stock' || hint === 'etf' ? hint : 'unknown';
        targets.push({ listingId: t.listingId, kind });
      }
    }
    return ok(targets);
  };
}

export type RunScreen = (
  query: ScreenerQuery,
  options?: SnapshotOptions,
) => Promise<Result<ScreenerResult, AppError>>;

export function createRunScreen(deps: {
  readonly listUniverse: ListLocalUniverse;
  readonly loadSnapshots: LoadInstrumentSnapshots;
}): RunScreen {
  return async (query, options) => {
    const issues = validateScreenerQuery(query);
    if (issues.length > 0) {
      return err(AppErrors.validation(issues.map((i) => i.message).join(' ')));
    }
    const universe = await deps.listUniverse();
    if (!universe.ok) return universe;
    // Csak a szűrt típus töltődik be (kvótakímélés); a többi okkal kimarad.
    const skipped: { listingId: string; reason: string }[] = [];
    const targets = universe.value.filter((t) => {
      if (t.kind === query.universe) return true;
      skipped.push({
        listingId: t.listingId,
        reason:
          t.kind === 'unknown'
            ? 'Ismeretlen típus – nem szűrhető.'
            : t.kind === 'stock'
              ? 'Részvény (ETF-szűrő fut).'
              : 'ETF (részvényszűrő fut).',
      });
      return false;
    });
    const loads = await deps.loadSnapshots(targets, options);
    for (const load of loads) {
      if (load.error !== null) {
        skipped.push({
          listingId: load.target.listingId,
          reason: `Nem betölthető: ${load.error.message}`,
        });
      }
    }
    const snapshots = loads.flatMap((l) => (l.snapshot === null ? [] : [l.snapshot]));
    return ok(runScreener(query, snapshots, skipped));
  };
}

// ---------------------------------------------------------------------------------------------
// Figyelőlista-áttekintés
// ---------------------------------------------------------------------------------------------

export interface WatchlistOverviewRow {
  readonly item: WatchlistItem;
  readonly market: MarketSummary;
}

export type GetWatchlistOverview = (
  items: readonly WatchlistItem[],
) => Promise<readonly WatchlistOverviewRow[]>;

/** Ár + napi változás tételenként (sorban). A score/értékelés külön, kérésre töltődik. */
export function createGetWatchlistOverview(deps: {
  readonly loadMarketSummary: LoadMarketSummary;
}): GetWatchlistOverview {
  return async (items) => {
    const rows: WatchlistOverviewRow[] = [];
    for (const item of items) {
      rows.push({ item, market: await deps.loadMarketSummary(item.listingId) });
    }
    return rows;
  };
}

// ---------------------------------------------------------------------------------------------
// Riasztások
// ---------------------------------------------------------------------------------------------

export interface AlertCheckReport {
  readonly evaluatedAt: string;
  readonly results: readonly AlertEvaluation[];
  readonly newlyTriggered: readonly AlertEvaluation[];
  /** Hány jegyzésnél kellett teljes elemzés (kvóta-átláthatóság). */
  readonly analysesLoaded: number;
}

export interface AlertService {
  list(): Promise<Result<readonly AlertRule[], AppError>>;
  add(input: NewAlertRule): Promise<Result<AlertRule, AppError>>;
  remove(id: string): Promise<Result<void, AppError>>;
  setEnabled(id: string, enabled: boolean): Promise<Result<void, AppError>>;
  /** Az engedélyezett szabályok kiértékelése MOST (alkalmazáson belül). */
  checkNow(options?: SnapshotOptions): Promise<Result<AlertCheckReport, AppError>>;
}

export function createAlertService(deps: {
  readonly repository: AlertRuleRepository;
  readonly loadSnapshot: LoadInstrumentSnapshot;
  readonly loadMarketSummary: LoadMarketSummary;
  readonly clock: Clock;
  readonly ids: IdGenerator;
}): AlertService {
  const find = async (id: string): Promise<Result<AlertRule, AppError>> => {
    const rules = await deps.repository.list();
    if (!rules.ok) return rules;
    const rule = rules.value.find((r) => r.id === id);
    return rule === undefined ? err(AppErrors.notFound('riasztás', id)) : ok(rule);
  };
  return {
    list: () => deps.repository.list(),
    async add(input) {
      const issues = validateNewAlertRule(input);
      if (issues.length > 0) return err(AppErrors.validation(issues.join(' ')));
      const existing = await deps.repository.list();
      if (!existing.ok) return existing;
      if (existing.value.length >= MAX_ALERT_RULES) {
        return err(AppErrors.validation(`Legfeljebb ${MAX_ALERT_RULES} riasztás tárolható.`));
      }
      const rule: AlertRule = {
        id: deps.ids.next('alert'),
        listingId: input.listingId,
        kind: input.kind === 'etf' ? 'etf' : 'stock',
        metric: input.metric,
        comparator: input.comparator,
        threshold: input.threshold,
        currency: input.metric === 'price' ? (input.currency ?? '').toUpperCase() : null,
        enabled: true,
        createdAt: toIsoTimestamp(deps.clock.now()),
        lastState: null,
        lastEvaluatedAt: null,
        lastTriggeredAt: null,
      };
      const saved = await deps.repository.save(rule);
      return saved.ok ? ok(rule) : saved;
    },
    remove: (id) => deps.repository.remove(id),
    async setEnabled(id, enabled) {
      const rule = await find(id);
      if (!rule.ok) return rule;
      return deps.repository.save({ ...rule.value, enabled });
    },
    async checkNow(options) {
      const rules = await deps.repository.list();
      if (!rules.ok) return rules;
      const evaluatedAt = toIsoTimestamp(deps.clock.now());
      const active = rules.value.filter((r) => r.enabled);
      const byListing = new Map<string, AlertRule[]>();
      for (const rule of active) {
        byListing.set(rule.listingId, [...(byListing.get(rule.listingId) ?? []), rule]);
      }
      const results: AlertEvaluation[] = [];
      let analysesLoaded = 0;
      for (const [listingId, listingRules] of byListing) {
        const needsAnalysis = listingRules.some((r) => ALERT_METRIC_INFO[r.metric].needsAnalysis);
        let subject: AlertSubject;
        if (needsAnalysis) {
          analysesLoaded += 1;
          const loaded = await deps.loadSnapshot(
            { listingId, kind: listingRules[0]!.kind },
            options,
          );
          subject = loaded.ok
            ? { kind: 'snapshot', snapshot: loaded.value }
            : { kind: 'error', reason: loaded.error.message };
        } else {
          subject = { kind: 'price', price: (await deps.loadMarketSummary(listingId)).price };
        }
        for (const rule of listingRules) {
          const evaluation = evaluateAlertRule(rule, subject, evaluatedAt);
          results.push(evaluation);
          const saved = await deps.repository.save(applyEvaluation(rule, evaluation));
          if (!saved.ok) return saved;
        }
      }
      return ok({
        evaluatedAt,
        results,
        newlyTriggered: results.filter((r) => r.newlyTriggered),
        analysesLoaded,
      });
    },
  };
}
