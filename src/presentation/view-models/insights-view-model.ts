/**
 * PHASE 14 view-modellek: figyelőlista-sor, összehasonlító tábla (mobilbarát, mutatónként
 * függőleges cellákkal), ETF-átfedés, screener-találat bizonyítékokkal, riasztás-sor.
 * Tiszta függvények (React nélkül tesztelhetők); szám csak a formázókon át jelenik meg.
 */
import type {
  AlertEvaluation,
  AlertRule,
  ComparisonResult,
  EtfOverlapAnalysis,
  InstrumentSnapshot,
  MarketSummary,
  ScreenerResult,
  ScreenerRow,
  ScreenerUnit,
  ValuationStatus,
  WatchlistItem,
} from '@/application';
import { ALERT_METRIC_INFO } from '@/application';
import type { MeasurementUnit, Metric } from '@/domain';
import type { StatusTone } from '@/presentation/components';
import {
  formatDateTime,
  formatMetric,
  formatNumber,
  formatPercent,
  formatUnitValue,
  FRESHNESS_LABEL,
  parseDecimalInput,
} from '@/presentation/format';

import { buildMetricRow, type MetricRowModel } from './metric-row';

export const KIND_LABEL = { stock: 'Részvény', etf: 'ETF', unknown: 'Ismeretlen típus' } as const;

export interface BadgeModel {
  readonly label: string;
  readonly tone: StatusTone;
}

// --- Figyelőlista ------------------------------------------------------------------------------

export const VALUATION_LABEL = {
  DISCOUNT_TO_MODEL: 'Diszkont a modellértékhez',
  NEAR_MODEL: 'Modellérték közelében',
  PREMIUM_TO_MODEL: 'Prémium a modellértékhez',
} as const;

export function valuationText(valuation: ValuationStatus): string {
  if (valuation.status === 'OK') {
    return `${VALUATION_LABEL[valuation.category]} (Base DCF MOS ${formatPercent(valuation.mos, { signed: true })})`;
  }
  return valuation.status === 'NOT_APPLICABLE'
    ? 'Nem alkalmazható (ETF)'
    : `N/A – ${valuation.reason}`;
}

/** Frissesség-jelzés egy érték provenance-éből (offline tartalék külön kiemelve). */
export function freshnessBadge(metric: Metric<number>): BadgeModel | null {
  if (metric.status !== 'OK') return null;
  const p = metric.provenance;
  if (p.cache?.mode === 'offline_fallback') {
    return { label: 'Offline adat – elavult lehet', tone: 'warning' };
  }
  if (p.kind === 'mock') return { label: 'Demóadat', tone: 'info' };
  const tone: StatusTone =
    p.freshness === 'FRESH' ? 'positive' : p.freshness === 'UNKNOWN' ? 'neutral' : 'warning';
  return { label: `Frissesség: ${FRESHNESS_LABEL[p.freshness]}`, tone };
}

export interface WatchlistRowModel {
  readonly key: string;
  readonly title: string;
  readonly subtitle: string;
  readonly rows: readonly MetricRowModel[];
  readonly badges: readonly BadgeModel[];
  /** „Frissítve: …” – a legutóbbi lekérés ideje (a cache sem írja felül). */
  readonly updatedText: string | null;
  readonly scoreText: string | null;
  readonly valuationText: string | null;
  readonly errorText: string | null;
}

export function buildWatchlistRow(
  item: WatchlistItem,
  market: MarketSummary | null,
  snapshot: InstrumentSnapshot | null = null,
  snapshotError: string | null = null,
): WatchlistRowModel {
  const rows: MetricRowModel[] = [];
  const badges: BadgeModel[] = [];
  let updatedText: string | null = null;
  if (market !== null) {
    rows.push(
      buildMetricRow({
        key: 'price',
        label: 'Árfolyam',
        value: market.price,
        unit: 'money_per_share',
      }),
    );
    const change = market.dayChange;
    rows.push(
      buildMetricRow({
        key: 'dayChange',
        label: 'Napi változás',
        value: change,
        unit: 'ratio',
        formula: 'utolsó záróár / előző záróár − 1 (split-korrigált ártörténetből)',
        ...(change.status === 'OK'
          ? {
              formatted: {
                text: formatPercent(change.value, { signed: true, decimals: 2 }),
                status: 'OK' as const,
                reason: null,
                accessibilityText: formatPercent(change.value, { signed: true, decimals: 2 }),
              },
            }
          : {}),
      }),
    );
    const badge = freshnessBadge(market.price);
    if (badge !== null) badges.push(badge);
    if (market.price.status === 'OK') {
      const p = market.price.provenance;
      updatedText = `Frissítve: ${formatDateTime(p.fetchedAt)} · adatnap: ${p.asOf === null ? 'nem közölt' : formatDateTime(p.asOf)}`;
    }
  }
  const score = snapshot?.score ?? null;
  return {
    key: item.listingId,
    title: item.name ?? item.listingId,
    subtitle: `${item.listingId} · ${KIND_LABEL[item.kind]}`,
    rows,
    badges,
    updatedText,
    scoreText:
      score === null
        ? null
        : `Score: ${score.totalScore === null ? 'N/A' : `${formatNumber(score.totalScore, 1)} / 100`} · ${score.decisionText}`,
    valuationText: snapshot === null ? null : `Értékelés: ${valuationText(snapshot.valuation)}`,
    errorText: snapshotError,
  };
}

// --- Összehasonlítás ---------------------------------------------------------------------------

export interface ComparisonCellModel {
  readonly listingId: string;
  readonly row: MetricRowModel;
  readonly favorable: boolean;
}

export interface ComparisonRowModel {
  readonly key: string;
  readonly label: string;
  readonly cells: readonly ComparisonCellModel[];
  readonly notes: readonly string[];
}

export interface ComparisonGroupModel {
  readonly title: string;
  readonly rows: readonly ComparisonRowModel[];
}

export interface OverlapLineModel {
  readonly label: string;
  readonly value: string;
}

export interface OverlapViewModel {
  readonly key: string;
  readonly title: string;
  readonly statusText: string;
  readonly ok: boolean;
  readonly lines: readonly OverlapLineModel[];
  readonly topCommon: readonly OverlapLineModel[];
  readonly notes: readonly string[];
}

export interface ComparisonViewModel {
  readonly modeText: string;
  readonly columns: readonly { readonly listingId: string; readonly title: string }[];
  readonly groups: readonly ComparisonGroupModel[];
  readonly excluded: readonly { readonly label: string; readonly reason: string }[];
  readonly overlaps: readonly OverlapViewModel[];
  readonly exposures: readonly MetricRowModel[];
  readonly notes: readonly string[];
}

const MODE_TEXT = {
  stock: 'Részvény–részvény összehasonlítás',
  etf: 'ETF–ETF összehasonlítás',
  mixed: 'Részvény–ETF összehasonlítás (csak a közös mutatók)',
} as const;

const pct = (v: number | null) => (v === null ? 'N/A' : formatPercent(v, { decimals: 2 }));

export function buildOverlapViewModel(
  overlap: EtfOverlapAnalysis,
  title: (id: string) => string,
): OverlapViewModel {
  const dateOf = (asOf: string | null, completeness: string | null) =>
    asOf === null
      ? 'nincs holdings-adat'
      : `${asOf}${completeness === 'partial' ? ' (részleges lista)' : completeness === 'complete' ? ' (teljes lista)' : ''}`;
  const lines: OverlapLineModel[] = [
    {
      label: `${title(overlap.a.listingId)} holdings-dátuma`,
      value: dateOf(overlap.a.asOf, overlap.a.completeness),
    },
    {
      label: `${title(overlap.b.listingId)} holdings-dátuma`,
      value: dateOf(overlap.b.asOf, overlap.b.completeness),
    },
  ];
  if (overlap.dateGapDays !== null) {
    lines.push({
      label: 'Dátumeltérés',
      value: `${overlap.dateGapDays} nap (kompatibilis: ≤ ${overlap.maxGapDays} nap)`,
    });
  }
  if (overlap.status === 'OK' && overlap.overlap !== null) {
    lines.push(
      {
        label: overlap.isLowerBound ? 'Átfedés (Σ min) – alsó becslés' : 'Átfedés (Σ min)',
        value: pct(overlap.overlap.overlapWeight),
      },
      { label: 'Közös pozíciók száma', value: String(overlap.overlap.commonCount) },
      {
        label: `Közös súly ${title(overlap.a.listingId)}-ban`,
        value: pct(overlap.commonWeightInA),
      },
      {
        label: `Közös súly ${title(overlap.b.listingId)}-ban`,
        value: pct(overlap.commonWeightInB),
      },
      {
        label: '50/50 keverék közös kitettsége (cégenként egyszer)',
        value: pct(overlap.equalMixCommonExposure),
      },
    );
  }
  return {
    key: `${overlap.a.listingId}|${overlap.b.listingId}`,
    title: `${title(overlap.a.listingId)} ↔ ${title(overlap.b.listingId)}`,
    statusText:
      overlap.status === 'OK'
        ? overlap.sameDate
          ? 'Azonos napi pillanatképek'
          : 'Kompatibilis pillanatképek'
        : `Nem számolható – ${overlap.reason ?? ''}`,
    ok: overlap.status === 'OK',
    lines,
    topCommon: (overlap.overlap?.common ?? []).slice(0, 5).map((c) => ({
      label: c.key,
      value: `${pct(c.weightA)} / ${pct(c.weightB)} → átfedés ${pct(c.overlap)}`,
    })),
    notes: overlap.notes,
  };
}

export function buildComparisonViewModel(result: ComparisonResult): ComparisonViewModel {
  const title = (id: string) => result.names[id] ?? id;
  const groups: ComparisonGroupModel[] = [];
  for (const row of result.rows) {
    const model: ComparisonRowModel = {
      key: row.metric.id,
      label: row.metric.label,
      notes: row.notes,
      cells: row.cells.map((cell) => {
        const favorable = row.favorable === cell.listingId;
        return {
          listingId: cell.listingId,
          favorable,
          row: buildMetricRow({
            key: `${row.metric.id}-${cell.listingId}`,
            label: title(cell.listingId),
            value: cell.value,
            unit: row.metric.unit,
            hint: favorable ? '★ kedvezőbb (a mutató iránya szerint)' : null,
          }),
        };
      }),
    };
    const group = groups.find((g) => g.title === row.metric.group);
    if (group === undefined) groups.push({ title: row.metric.group, rows: [model] });
    else (group.rows as ComparisonRowModel[]).push(model);
  }
  return {
    modeText: MODE_TEXT[result.mode],
    columns: result.listingIds.map((id) => ({ listingId: id, title: title(id) })),
    groups,
    excluded: result.excluded.map((e) => ({ label: e.label, reason: e.reason })),
    overlaps: result.overlaps.map((o) => buildOverlapViewModel(o, title)),
    exposures: result.exposures.map((e) =>
      buildMetricRow({
        key: `exp-${e.stockListingId}-${e.etfListingId}`,
        label: `${title(e.stockListingId)} súlya: ${title(e.etfListingId)}`,
        value: e.weight,
        unit: 'ratio',
        formula: 'a részvény ISIN-jének súlya az ETF holdings-listájában',
      }),
    ),
    notes: result.notes,
  };
}

// --- Küszöb-bevitel (screener, riasztás) -------------------------------------------------------

/**
 * Felhasználói küszöb → belső érték. Százalékos mezőknél a felhasználó SZÁZALÉKOT ír
 * („0,25” = 0,25%), a motor tizedes törtet kap (0.0025). Hibás bevitel → `NaN` (a validáció
 * okkal utasítja el).
 */
export function parseThresholdInput(raw: string, unit: ScreenerUnit | MeasurementUnit): number {
  const value = parseDecimalInput(raw);
  return unit === 'ratio' ? value / 100 : value;
}

export function formatThreshold(
  value: number,
  unit: ScreenerUnit | MeasurementUnit,
  currency?: string | null,
): string {
  return formatUnitValue(value, unit, currency ?? null);
}

export function inputUnitHint(unit: ScreenerUnit | MeasurementUnit): string {
  switch (unit) {
    case 'ratio':
      return '%-ban (pl. 0,25 = 0,25%)';
    case 'multiple':
      return 'szorzó (pl. 15)';
    case 'money':
      return 'összeg (pl. 1000000000) + pénznem';
    case 'money_per_share':
      return 'ár a jegyzés pénznemében';
    default:
      return 'szám';
  }
}

// --- Screener ----------------------------------------------------------------------------------

export const CRITERION_STATUS_LABEL = {
  PASS: '✓ megfelel',
  FAIL: '✗ nem felel meg',
  NOT_EVALUABLE: '? nem értékelhető (hiányzó adat)',
} as const;

const OPERATOR_TEXT = { gte: '≥', lte: '≤' } as const;

export interface ScreenerRowModel {
  readonly key: string;
  readonly title: string;
  readonly subtitle: string;
  readonly evidence: readonly MetricRowModel[];
  readonly staleNote: string | null;
}

function screenerRow(row: ScreenerRow): ScreenerRowModel {
  return {
    key: row.listingId,
    title: row.name ?? row.listingId,
    subtitle: row.listingId,
    evidence: row.evidence.map((e, i) =>
      buildMetricRow({
        key: `${row.listingId}-${i}`,
        label: `${e.field.label} ${OPERATOR_TEXT[e.criterion.operator]} ${formatThreshold(e.criterion.value, e.field.unit, e.criterion.currency)}`,
        value: e.value,
        unit: e.field.unit,
        hint: CRITERION_STATUS_LABEL[e.status],
        ...(e.reason !== null && e.value.status === 'OK' ? { notes: [e.reason] } : {}),
      }),
    ),
    staleNote: row.usesStaleData
      ? 'Elavult vagy offline tartalékból jött adatot is használ.'
      : null,
  };
}

export interface ScreenerViewModel {
  readonly summary: string;
  readonly matches: readonly ScreenerRowModel[];
  readonly notEvaluable: readonly ScreenerRowModel[];
  readonly failed: readonly ScreenerRowModel[];
  readonly skipped: readonly { readonly title: string; readonly reason: string }[];
  readonly disclaimer: string;
}

export function buildScreenerViewModel(result: ScreenerResult): ScreenerViewModel {
  return {
    summary: `${result.matches.length} találat · ${result.notEvaluable.length} nem értékelhető · ${result.failed.length} nem felel meg · ${result.skipped.length} kimaradt`,
    matches: result.matches.map(screenerRow),
    notEvaluable: result.notEvaluable.map(screenerRow),
    failed: result.failed.map(screenerRow),
    skipped: result.skipped.map((s) => ({ title: s.listingId, reason: s.reason })),
    disclaimer: result.disclaimer,
  };
}

// --- Riasztás ----------------------------------------------------------------------------------

const COMPARATOR_TEXT = { above: 'felett', below: 'alatt' } as const;

export const ALERT_STATE_BADGE: Readonly<Record<AlertEvaluation['status'], BadgeModel>> = {
  TRIGGERED: { label: 'Teljesült', tone: 'warning' },
  NOT_TRIGGERED: { label: 'Nem teljesült', tone: 'neutral' },
  NOT_EVALUABLE: { label: 'Nem értékelhető', tone: 'info' },
};

export function alertRuleText(rule: AlertRule): string {
  const info = ALERT_METRIC_INFO[rule.metric];
  return `${info.label} ${COMPARATOR_TEXT[rule.comparator]}: ${formatThreshold(rule.threshold, info.unit, rule.currency)}`;
}

export interface AlertRowModel {
  readonly key: string;
  readonly title: string;
  readonly subtitle: string;
  readonly enabled: boolean;
  readonly badge: BadgeModel | null;
  readonly observed: MetricRowModel | null;
  readonly lines: readonly string[];
}

export function buildAlertRow(rule: AlertRule, evaluation: AlertEvaluation | null): AlertRowModel {
  const info = ALERT_METRIC_INFO[rule.metric];
  const state = evaluation?.status ?? rule.lastState;
  const lines: string[] = [];
  if (!rule.enabled) lines.push('Kikapcsolva – nem értékelődik ki.');
  if (evaluation?.newlyTriggered === true) lines.push('Újonnan teljesült ennél az ellenőrzésnél.');
  if (evaluation?.reason) lines.push(evaluation.reason);
  if (rule.lastEvaluatedAt !== null)
    lines.push(`Utolsó ellenőrzés: ${formatDateTime(rule.lastEvaluatedAt)}`);
  if (rule.lastTriggeredAt !== null)
    lines.push(`Utoljára teljesült: ${formatDateTime(rule.lastTriggeredAt)}`);
  return {
    key: rule.id,
    title: alertRuleText(rule),
    subtitle: `${rule.listingId} · ${KIND_LABEL[rule.kind]}`,
    enabled: rule.enabled,
    badge: state === null ? null : ALERT_STATE_BADGE[state],
    observed:
      evaluation === null
        ? null
        : buildMetricRow({
            key: `obs-${rule.id}`,
            label: 'Megfigyelt érték',
            value: evaluation.observed,
            unit: info.unit,
          }),
    lines,
  };
}

/** Egy `Metric` rövid szövege (pl. a figyelőlista-összegzéshez). */
export function metricText(metric: Metric<number>, unit: MeasurementUnit): string {
  return formatMetric(metric, unit).text;
}
