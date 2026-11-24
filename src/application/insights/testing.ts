/**
 * CSAK TESZTEKHEZ: pillanatkép- és holdings-építők a PHASE 14 logika teszteléséhez.
 */
import type {
  CurrencyCode,
  DataProvenance,
  EtfHoldingsSnapshot,
  Freshness,
  IsoDate,
  IsoTimestamp,
  MeasurementUnit,
  Metric,
} from '@/domain';

import type { InstrumentSnapshot, SnapshotKind, SnapshotMetric } from './instrument-snapshot';

export const T0 = '2026-11-24T10:00:00.000Z' as IsoTimestamp;

export function prov(extra: Partial<DataProvenance> = {}): DataProvenance {
  return {
    sourceId: 'test',
    sourceName: 'Teszt forrás',
    kind: 'reported',
    fetchedAt: T0,
    asOf: '2026-11-23' as IsoDate,
    freshness: 'FRESH',
    ...extra,
  };
}

export function okValue(value: number, extra: Partial<DataProvenance> = {}): Metric<number> {
  return { status: 'OK', value, provenance: prov(extra) };
}

export const missing = (reason = 'nincs adat'): Metric<number> => ({ status: 'MISSING', reason });

export function metric(
  id: string,
  value: Metric<number>,
  unit: MeasurementUnit = 'ratio',
  window: SnapshotMetric['window'] = null,
): SnapshotMetric {
  return { id, label: id, unit, value, window };
}

export function holdings(
  asOf: string,
  items: readonly { readonly isin: string | null; readonly weight: number }[],
  completeness: 'complete' | 'partial' = 'complete',
): Metric<EtfHoldingsSnapshot> {
  return {
    status: 'OK',
    value: {
      asOf: asOf as IsoDate,
      holdings: items.map((h, i) => ({
        name: `H${i}`,
        isin: h.isin as EtfHoldingsSnapshot['holdings'][number]['isin'],
        weight: h.weight,
        country: null,
        sector: null,
        currency: null,
      })),
      declaredComplete: completeness === 'complete',
      reportedHoldingsCount: null,
      listedWeight: items.reduce((s, h) => s + h.weight, 0),
      completeness,
      notes: [],
      provenance: prov({ kind: 'user_input', asOf: asOf as IsoDate }),
    },
    provenance: prov({ kind: 'user_input', asOf: asOf as IsoDate }),
  };
}

export function snapshot(
  listingId: string,
  kind: SnapshotKind,
  options: {
    readonly metrics?: readonly SnapshotMetric[];
    readonly price?: Metric<number>;
    readonly currency?: string;
    readonly score?: number | null;
    readonly isin?: string | null;
    readonly holdings?: Metric<EtfHoldingsSnapshot>;
    readonly returnBasis?: InstrumentSnapshot['returnBasis'];
    readonly freshness?: Freshness;
  } = {},
): InstrumentSnapshot {
  const currency = (options.currency ?? 'USD') as CurrencyCode;
  return {
    listingId,
    kind,
    name: `${listingId} név`,
    isin: options.isin ?? null,
    tradingCurrency: currency,
    price: options.price ?? okValue(100, { currency, freshness: options.freshness ?? 'FRESH' }),
    dayChange: okValue(0.01, { kind: 'calculated' }),
    metrics: Object.fromEntries((options.metrics ?? []).map((m) => [m.id, m])),
    score:
      options.score === undefined && kind === 'stock'
        ? stockScore(60)
        : options.score === undefined
          ? etfScore(70)
          : options.score === null
            ? null
            : kind === 'stock'
              ? stockScore(options.score)
              : etfScore(options.score),
    valuation:
      kind === 'stock'
        ? { status: 'OK', category: 'NEAR_MODEL', mos: 0.05 }
        : { status: 'NOT_APPLICABLE', reason: 'ETF' },
    holdings:
      options.holdings ??
      (kind === 'etf'
        ? { status: 'MISSING', reason: 'nincs holdings' }
        : { status: 'NOT_APPLICABLE', reason: 'részvény' }),
    returnBasis: options.returnBasis ?? (kind === 'etf' ? 'total_return' : null),
    generatedAt: T0,
  };
}

function stockScore(total: number) {
  return {
    totalScore: total,
    configId: 'stock-default',
    configVersion: '1',
    decisionLabel: 'HOLD',
    decisionText: 'Tartás',
    confidenceLevel: 'MEDIUM',
  };
}

function etfScore(total: number) {
  return { ...stockScore(total), configId: 'etf-default' };
}
