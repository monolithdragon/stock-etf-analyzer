/**
 * Összehasonlítás (PHASE 14, D-086). Csak ÖSSZEHASONLÍTHATÓ mutatókat ad vissza:
 *
 * 1. Típus: a mutatónak minden kiválasztott instrumentum típusára értelmezettnek kell lennie
 *    (P/E csak részvény, TER csak ETF). Vegyes (részvény–ETF) halmaznál csak a közös
 *    piaci adatok maradnak + a „részvény súlya az ETF-ben” (ha a holdings ismert).
 * 2. Pénznem: pénzösszeg (ár, AUM, piaci kapitalizáció) csak azonos pénznemben.
 * 3. Hozam-alap: ETF-hozam csak mindkét oldalon total return alapon (D-069), az időszakos
 *    hozam csak azonos (±7 nap) ablakon.
 * 4. Score: csak azonos score-rendszer (konfiguráció-azonosító) pontja.
 * 5. Lefedettség: a sor csak akkor jelenik meg, ha legalább két instrumentumnál van értéke;
 *    a hiányzó cella N/A az okkal (soha nem 0).
 *
 * A kizárt mutatók indokkal együtt visszajönnek (`excluded`), hogy a UI meg tudja mutatni,
 * MIÉRT nincs ott egy sor. A „kedvezőbb” jelölés csak az irány szerinti ceteris paribus jelzés,
 * nem ajánlás.
 */
import {
  AppErrors,
  err,
  metricMissing,
  metricOk,
  ok,
  toEpochMs,
  type AppError,
  type MeasurementUnit,
  type Metric,
  type Result,
} from '@/domain';

import { analyzeEtfOverlap, stockWeightInEtf, type EtfOverlapAnalysis } from './etf-overlap';
import { snapshotMetric, type InstrumentSnapshot, type SnapshotKind } from './instrument-snapshot';

export const MIN_COMPARE = 2;
export const MAX_COMPARE = 4;
/** Időszakos hozamnál ennyi nap eltérés megengedett az ablak kezdetén és végén. */
export const WINDOW_TOLERANCE_DAYS = 7;

export type ComparisonRequirement =
  'same_currency' | 'total_return_basis' | 'same_window' | 'same_score_system';

export type ComparisonDirection = 'higher_is_better' | 'lower_is_better' | 'none';

export interface ComparisonMetricDef {
  readonly id: string;
  readonly label: string;
  readonly unit: MeasurementUnit;
  readonly group: string;
  readonly appliesTo: readonly SnapshotKind[];
  readonly direction: ComparisonDirection;
  readonly requires: readonly ComparisonRequirement[];
}

const BOTH: readonly SnapshotKind[] = ['stock', 'etf'];
const STOCK: readonly SnapshotKind[] = ['stock'];
const ETF: readonly SnapshotKind[] = ['etf'];

const def = (
  id: string,
  label: string,
  unit: MeasurementUnit,
  group: string,
  appliesTo: readonly SnapshotKind[],
  direction: ComparisonDirection,
  requires: readonly ComparisonRequirement[] = [],
): ComparisonMetricDef => ({ id, label, unit, group, appliesTo, direction, requires });

/** A mutatókatalógus – a sorrend a megjelenítés sorrendje. */
export const COMPARISON_METRICS: readonly ComparisonMetricDef[] = [
  def('price', 'Árfolyam', 'money_per_share', 'Piac', BOTH, 'none', ['same_currency']),
  def('dayChange', 'Napi változás', 'ratio', 'Piac', BOTH, 'none'),
  def('totalScore', 'Összpontszám', 'count', 'Score', BOTH, 'higher_is_better', [
    'same_score_system',
  ]),
  // Részvény – értékelés
  def('pe', 'P/E', 'multiple', 'Értékelés', STOCK, 'lower_is_better'),
  def('pfcf', 'P/FCF', 'multiple', 'Értékelés', STOCK, 'lower_is_better'),
  def('evToEbitda', 'EV/EBITDA', 'multiple', 'Értékelés', STOCK, 'lower_is_better'),
  def('ps', 'P/S', 'multiple', 'Értékelés', STOCK, 'lower_is_better'),
  def('fcfYield', 'FCF-hozam', 'ratio', 'Értékelés', STOCK, 'higher_is_better'),
  def('mosBase', 'Biztonsági sáv (Base DCF)', 'ratio', 'Értékelés', STOCK, 'higher_is_better'),
  def('dividendYield', 'Osztalékhozam (TTM)', 'ratio', 'Osztalék', STOCK, 'none'),
  def('marketCap', 'Piaci kapitalizáció', 'money', 'Méret', STOCK, 'none', ['same_currency']),
  // Részvény – növekedés
  def('revenueCagr3y', 'Árbevétel CAGR 3 év', 'ratio', 'Növekedés', STOCK, 'higher_is_better'),
  def('revenueCagr5y', 'Árbevétel CAGR 5 év', 'ratio', 'Növekedés', STOCK, 'higher_is_better'),
  def('epsCagr3y', 'EPS CAGR 3 év', 'ratio', 'Növekedés', STOCK, 'higher_is_better'),
  def('fcfCagr3y', 'FCF CAGR 3 év', 'ratio', 'Növekedés', STOCK, 'higher_is_better'),
  def(
    'revenueGrowth',
    'Árbevétel-növekedés (YoY)',
    'ratio',
    'Növekedés',
    STOCK,
    'higher_is_better',
  ),
  // Részvény – minőség, mérleg
  def('roic', 'ROIC', 'ratio', 'Minőség', STOCK, 'higher_is_better'),
  def('roe', 'ROE', 'ratio', 'Minőség', STOCK, 'higher_is_better'),
  def('grossMargin', 'Bruttó árrés', 'ratio', 'Minőség', STOCK, 'higher_is_better'),
  def('operatingMargin', 'Üzemi árrés', 'ratio', 'Minőség', STOCK, 'higher_is_better'),
  def('netMargin', 'Nettó árrés', 'ratio', 'Minőség', STOCK, 'higher_is_better'),
  def('fcfMargin', 'FCF-árrés', 'ratio', 'Minőség', STOCK, 'higher_is_better'),
  def('debtToEquity', 'Adósság / saját tőke', 'multiple', 'Mérleg', STOCK, 'lower_is_better'),
  def('netDebtToEbitda', 'Nettó adósság / EBITDA', 'multiple', 'Mérleg', STOCK, 'lower_is_better'),
  def('beta', 'Béta (szolgáltatói)', 'multiple', 'Kockázat', STOCK, 'none'),
  // ETF – költség, méret
  def('ter', 'TER', 'ratio', 'Költség', ETF, 'lower_is_better'),
  def('aum', 'Alapméret (AUM)', 'money', 'Méret', ETF, 'higher_is_better', ['same_currency']),
  def('fundAgeYears', 'Az alap kora (év)', 'count', 'Méret', ETF, 'higher_is_better'),
  // ETF – hozam, kockázat
  def('totalReturn', 'Total return (időszak)', 'ratio', 'Hozam', ETF, 'higher_is_better', [
    'total_return_basis',
    'same_window',
  ]),
  def(
    'annualizedTotalReturn',
    'Évesített total return',
    'ratio',
    'Hozam',
    ETF,
    'higher_is_better',
    ['total_return_basis'],
  ),
  def('distributionYieldTtm', 'Kifizetési hozam (TTM)', 'ratio', 'Osztalék', ETF, 'none'),
  def('volatility', 'Volatilitás (évesített)', 'ratio', 'Kockázat', ETF, 'lower_is_better', [
    'same_window',
  ]),
  def('maxDrawdown', 'Max. visszaesés', 'ratio', 'Kockázat', ETF, 'higher_is_better', [
    'same_window',
  ]),
  // ETF – követés
  def('trackingError', 'Tracking error', 'ratio', 'Követés', ETF, 'lower_is_better'),
  def(
    'annualizedTrackingDifference',
    'Évesített tracking difference',
    'ratio',
    'Követés',
    ETF,
    'higher_is_better',
  ),
  // ETF – diverzifikáció, koncentráció
  def('holdingsCount', 'Pozíciók száma', 'count', 'Diverzifikáció', ETF, 'higher_is_better'),
  def(
    'effectiveHoldings',
    'Effektív pozíciószám',
    'count',
    'Diverzifikáció',
    ETF,
    'higher_is_better',
  ),
  def('top10Weight', 'Top 10 súlya', 'ratio', 'Koncentráció', ETF, 'lower_is_better'),
  def(
    'largestHoldingWeight',
    'Legnagyobb pozíció',
    'ratio',
    'Koncentráció',
    ETF,
    'lower_is_better',
  ),
  def('largestCountryWeight', 'Legnagyobb ország', 'ratio', 'Koncentráció', ETF, 'lower_is_better'),
  def('largestSectorWeight', 'Legnagyobb szektor', 'ratio', 'Koncentráció', ETF, 'lower_is_better'),
  def('unhedgedForeignShare', 'Fedezetlen devizakitettség', 'ratio', 'Deviza', ETF, 'none'),
];

export interface ComparisonCell {
  readonly listingId: string;
  readonly value: Metric<number>;
}

export interface ComparisonRow {
  readonly metric: ComparisonMetricDef;
  readonly cells: readonly ComparisonCell[];
  /** Az irány szerint kedvezőbb érték jegyzése (holtversenynél és irány nélkül `null`). */
  readonly favorable: string | null;
  readonly notes: readonly string[];
}

export interface ExcludedMetric {
  readonly id: string;
  readonly label: string;
  readonly reason: string;
}

export interface StockEtfExposure {
  readonly stockListingId: string;
  readonly etfListingId: string;
  readonly weight: Metric<number>;
}

export interface ComparisonResult {
  readonly listingIds: readonly string[];
  readonly names: Readonly<Record<string, string | null>>;
  readonly mode: 'stock' | 'etf' | 'mixed';
  readonly rows: readonly ComparisonRow[];
  readonly excluded: readonly ExcludedMetric[];
  /** Csak ETF-párokra (minden pár). */
  readonly overlaps: readonly EtfOverlapAnalysis[];
  /** Csak vegyes halmaznál: részvény súlya az ETF-ekben. */
  readonly exposures: readonly StockEtfExposure[];
  readonly notes: readonly string[];
}

const DAY_MS = 86_400_000;

function scoreMetric(snapshot: InstrumentSnapshot): Metric<number> {
  const score = snapshot.score;
  if (score === null) return metricMissing('Nincs score.');
  if (score.totalScore === null) return metricMissing('A score nem számolható (kevés adat).');
  return metricOk(score.totalScore, {
    sourceId: 'engine',
    sourceName: `Score-motor (${score.configId} ${score.configVersion})`,
    kind: 'calculated',
    fetchedAt: snapshot.generatedAt,
    asOf: null,
    freshness: 'UNKNOWN',
    unit: 'count',
  });
}

function cellValue(snapshot: InstrumentSnapshot, id: string): Metric<number> {
  return id === 'totalScore' ? scoreMetric(snapshot) : snapshotMetric(snapshot, id);
}

function currencyOf(metric: Metric<number>): string | null {
  return metric.status === 'OK' ? (metric.provenance.currency ?? null) : null;
}

function checkRequirement(
  requirement: ComparisonRequirement,
  metric: ComparisonMetricDef,
  snapshots: readonly InstrumentSnapshot[],
  cells: readonly ComparisonCell[],
): string | null {
  const okCells = cells.filter((c) => c.value.status === 'OK');
  switch (requirement) {
    case 'same_currency': {
      const currencies = new Set(okCells.map((c) => currencyOf(c.value) ?? '?'));
      if (currencies.has('?')) return 'A pénznem nem ismert minden értéknél – nem hasonlítható.';
      return currencies.size > 1
        ? `Eltérő pénznem (${[...currencies].join(', ')}) – átváltás nélkül nem hasonlítható.`
        : null;
    }
    case 'total_return_basis': {
      const bad = snapshots.filter((s) => s.returnBasis !== 'total_return');
      return bad.length > 0
        ? `A hozam-alap nem azonos: ${bad.map((s) => `${s.listingId} (${s.returnBasis ?? 'nincs'})`).join(', ')} – csak total return alapon hasonlítható (D-069).`
        : null;
    }
    case 'same_window': {
      const windows = snapshots
        .map((s) => s.metrics[metric.id]?.window ?? null)
        .filter((w): w is NonNullable<typeof w> => w !== null);
      if (windows.length < 2) return null;
      const first = windows[0]!;
      const differs = windows.some(
        (w) =>
          Math.abs(toEpochMs(w.start) - toEpochMs(first.start)) > WINDOW_TOLERANCE_DAYS * DAY_MS ||
          Math.abs(toEpochMs(w.end) - toEpochMs(first.end)) > WINDOW_TOLERANCE_DAYS * DAY_MS,
      );
      return differs
        ? `Eltérő mérési ablak (${windows.map((w) => `${w.start}–${w.end}`).join(' vs ')}) – nem hasonlítható.`
        : null;
    }
    case 'same_score_system': {
      const systems = new Set(
        snapshots.map((s) =>
          s.score === null ? '?' : `${s.score.configId}@${s.score.configVersion}`,
        ),
      );
      return systems.size > 1
        ? `Eltérő score-rendszer (${[...systems].join(', ')}) – a részvény- és ETF-pont nem összemérhető.`
        : null;
    }
  }
}

function periodNote(cells: readonly ComparisonCell[]): string | null {
  const years = new Set(
    cells
      .map((c) => (c.value.status === 'OK' ? c.value.provenance.period : undefined))
      .filter((p): p is NonNullable<typeof p> => p !== undefined)
      .map((p) => `${p.fiscalPeriod}${p.fiscalYear}`),
  );
  return years.size > 1
    ? `Eltérő jelentési időszak (${[...years].join(', ')}) – az összevetés óvatosan értelmezendő.`
    : null;
}

function favorable(
  direction: ComparisonDirection,
  cells: readonly ComparisonCell[],
): string | null {
  if (direction === 'none') return null;
  const values = cells
    .filter((c) => c.value.status === 'OK')
    .map((c) => ({ id: c.listingId, v: (c.value as { value: number }).value }));
  if (values.length < 2) return null;
  const sorted = [...values].sort((x, y) =>
    direction === 'higher_is_better' ? y.v - x.v : x.v - y.v,
  );
  return sorted[0]!.v === sorted[1]!.v ? null : sorted[0]!.id;
}

function kindLabel(kinds: readonly SnapshotKind[]): string {
  return kinds.length === 1 && kinds[0] === 'stock' ? 'részvényre' : 'ETF-re';
}

export function compareInstruments(
  snapshots: readonly InstrumentSnapshot[],
): Result<ComparisonResult, AppError> {
  const ids = snapshots.map((s) => s.listingId);
  if (new Set(ids).size !== ids.length) {
    return err(AppErrors.validation('Ugyanaz az instrumentum kétszer szerepel.'));
  }
  if (snapshots.length < MIN_COMPARE || snapshots.length > MAX_COMPARE) {
    return err(
      AppErrors.validation(
        `Az összehasonlításhoz ${MIN_COMPARE}–${MAX_COMPARE} instrumentum kell (most: ${snapshots.length}).`,
      ),
    );
  }
  const kinds = new Set(snapshots.map((s) => s.kind));
  const mode: ComparisonResult['mode'] = kinds.size > 1 ? 'mixed' : [...kinds][0]!;
  const rows: ComparisonRow[] = [];
  const excluded: ExcludedMetric[] = [];

  for (const metric of COMPARISON_METRICS) {
    const notApplicable = snapshots.find((s) => !metric.appliesTo.includes(s.kind));
    if (notApplicable !== undefined) {
      excluded.push({
        id: metric.id,
        label: metric.label,
        reason: `Csak ${kindLabel(metric.appliesTo)} értelmezett mutató – vegyes összehasonlításban nem jelenik meg.`,
      });
      continue;
    }
    const cells = snapshots.map((s) => ({
      listingId: s.listingId,
      value: cellValue(s, metric.id),
    }));
    const available = cells.filter((c) => c.value.status === 'OK').length;
    if (available < MIN_COMPARE) {
      excluded.push({
        id: metric.id,
        label: metric.label,
        reason: `Csak ${available} instrumentumnál elérhető – legalább ${MIN_COMPARE} kell az összevetéshez.`,
      });
      continue;
    }
    const failed = metric.requires
      .map((r) => checkRequirement(r, metric, snapshots, cells))
      .find((reason): reason is string => reason !== null);
    if (failed !== undefined) {
      excluded.push({ id: metric.id, label: metric.label, reason: failed });
      continue;
    }
    const notes: string[] = [];
    const period = periodNote(cells);
    if (period !== null) notes.push(period);
    if (available < cells.length) {
      notes.push('Nem minden instrumentumnál elérhető – a hiányzó érték N/A, nem 0.');
    }
    rows.push({ metric, cells, favorable: favorable(metric.direction, cells), notes });
  }

  const etfs = snapshots.filter((s) => s.kind === 'etf');
  const stocks = snapshots.filter((s) => s.kind === 'stock');
  const overlaps: EtfOverlapAnalysis[] = [];
  for (let i = 0; i < etfs.length; i += 1) {
    for (let j = i + 1; j < etfs.length; j += 1)
      overlaps.push(analyzeEtfOverlap(etfs[i]!, etfs[j]!));
  }
  const exposures: StockEtfExposure[] =
    mode === 'mixed'
      ? stocks.flatMap((stock) =>
          etfs.map((etf) => ({
            stockListingId: stock.listingId,
            etfListingId: etf.listingId,
            weight: stockWeightInEtf(stock, etf),
          })),
        )
      : [];
  const notes = [
    'A „kedvezőbb” jelölés csak a mutató iránya szerinti, ceteris paribus jelzés – nem ajánlás.',
  ];
  if (mode === 'mixed') {
    notes.push(
      'Részvény és ETF között vállalati mutató (P/E, DCF) és alapmutató (TER, tracking) nem hasonlítható; csak a közös piaci adatok és a részvény ETF-beli súlya látszik.',
    );
  }
  return ok({
    listingIds: ids,
    names: Object.fromEntries(snapshots.map((s) => [s.listingId, s.name])),
    mode,
    rows,
    excluded,
    overlaps,
    exposures,
    notes,
  });
}
