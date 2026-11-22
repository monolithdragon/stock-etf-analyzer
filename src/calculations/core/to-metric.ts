/**
 * Híd a domain `Metric<number>` értékei és a szám-szintű képletek között (D-055).
 *
 * `calculateMetric` lépései:
 * 1. Ha egy KÖTELEZŐ bemenet nem `OK`, a képlet nem fut: az eredmény a legsúlyosabb bemeneti
 *    státuszt kapja (az indok megnevezi a bemenetet; `UNAVAILABLE` ok-kódja megmarad).
 *    Az OPCIONÁLIS bemenet nem-OK státusza `null`-ként (hiányzó) jut a képlethez.
 * 2. Pénznem-őr: a pénz jellegű (`money`, `money_per_share`) bemenetek pénzneme egyezzen;
 *    eltérés → `INVALID_INPUT` (nincs csendes FX, D-017).
 * 3. A képlet `CalcResult`-ja `Metric`-ké alakul `calculated` provenance-szel
 *    (`mock` bemenet → `mock`; `estimated` bemenet vagy kontextus → `estimated`).
 */
import {
  metricOk,
  metricUnavailable,
  type CurrencyCode,
  type DataProvenance,
  type FiscalPeriod,
  type Freshness,
  type IsoDate,
  type IsoTimestamp,
  type MeasurementUnit,
  type Metric,
  type MetricStatus,
  type ProvenanceKind,
  toEpochMs,
} from '@/domain';

import type { CalcResult } from './calc-result';

export const ENGINE_SOURCE_ID = 'engine';
export const ENGINE_SOURCE_NAME = 'Számítási motor';

export interface CalculationContext {
  /** Az eredmény egysége. */
  readonly unit: MeasurementUnit;
  /** A számítás időpontja (injektált óra – determinisztikus tesztekhez). */
  readonly calculatedAt: IsoTimestamp;
  /** Pénz jellegű eredmény pénzneme; ha nincs megadva, a bemenetek közös pénzneme. */
  readonly currency?: CurrencyCode;
  readonly period?: FiscalPeriod;
  /** `estimated`, ha a számítás feltevést használ (pl. tartalék adókulcs, elvárthozam-modell). */
  readonly kind?: 'calculated' | 'estimated';
}

export interface MetricCalculation {
  readonly metric: Metric<number>;
  /** A képlet megjegyzései (pl. „csak záró érték”) – a UI/magyarázat felé továbbítandó. */
  readonly notes: readonly string[];
}

/** Nem-OK bemenetek súlyossági sorrendje: a legelső előforduló határozza meg az eredményt. */
const STATUS_SEVERITY: readonly Exclude<MetricStatus, 'OK'>[] = [
  'ERROR',
  'INVALID_INPUT',
  'UNAVAILABLE',
  'MISSING',
  'INSUFFICIENT_DATA',
  'NOT_APPLICABLE',
  'NOT_MEANINGFUL',
];

const FRESHNESS_SEVERITY: readonly Freshness[] = ['EXPIRED', 'UNKNOWN', 'STALE', 'FRESH'];

const MONEY_UNITS: ReadonlySet<MeasurementUnit | undefined> = new Set(['money', 'money_per_share']);

type OkProvenances = readonly (readonly [string, DataProvenance])[];

function deriveKind(provenances: OkProvenances, context: CalculationContext): ProvenanceKind {
  const kinds = new Set(provenances.map(([, p]) => p.kind));
  if (kinds.has('mock')) return 'mock';
  if (context.kind === 'estimated' || kinds.has('estimated')) return 'estimated';
  return 'calculated';
}

function oldestAsOf(provenances: OkProvenances): IsoDate | IsoTimestamp | null {
  let oldest: IsoDate | IsoTimestamp | null = null;
  for (const [, p] of provenances) {
    if (p.asOf !== null && (oldest === null || toEpochMs(p.asOf) < toEpochMs(oldest))) {
      oldest = p.asOf;
    }
  }
  return oldest;
}

function worstFreshness(provenances: OkProvenances): Freshness {
  const present = new Set(provenances.map(([, p]) => p.freshness));
  return FRESHNESS_SEVERITY.find((value) => present.has(value)) ?? 'UNKNOWN';
}

function failedInputMetric(
  failures: readonly (readonly [string, Exclude<Metric<number>, { status: 'OK' }>])[],
): Metric<number> {
  const worst = STATUS_SEVERITY.find((status) => failures.some(([, m]) => m.status === status));
  const [name, metric] = failures.find(([, m]) => m.status === worst) ?? failures[0]!;
  const reason = `A(z) „${name}” bemenet nem használható (${metric.status}): ${metric.reason}`;
  if (metric.status === 'UNAVAILABLE') {
    return metricUnavailable(metric.unavailableReason, reason);
  }
  return { status: metric.status, reason };
}

/**
 * Képlet futtatása `Metric` bemenetekkel.
 *
 * @example
 * calculateMetric({ grossProfit, revenue }, {}, (v) => grossMargin(v), { unit: 'ratio', calculatedAt })
 */
export function calculateMetric<K extends string, O extends string = never>(
  required: Readonly<Record<K, Metric<number>>>,
  optional: Readonly<Record<O, Metric<number> | null | undefined>>,
  // `NoInfer`: a kulcsokat a bemeneti objektumok határozzák meg, nem a képlet paramétertípusa.
  formula: (
    values: Readonly<Record<NoInfer<K>, number> & Record<NoInfer<O>, number | null>>,
  ) => CalcResult<number>,
  context: CalculationContext,
): MetricCalculation {
  const requiredEntries = Object.entries(required) as [K, Metric<number>][];
  const failures = requiredEntries.filter(
    (entry): entry is [K, Exclude<Metric<number>, { status: 'OK' }>] => entry[1].status !== 'OK',
  );
  if (failures.length > 0) return { metric: failedInputMetric(failures), notes: [] };

  const okProvenances: [string, DataProvenance][] = [];
  const values: Record<string, number | null> = {};
  for (const [name, metric] of requiredEntries) {
    if (metric.status === 'OK') {
      values[name] = metric.value;
      okProvenances.push([name, metric.provenance]);
    }
  }
  for (const [name, metric] of Object.entries(optional) as [O, Metric<number> | null][]) {
    if (metric !== null && metric !== undefined && metric.status === 'OK') {
      values[name] = metric.value;
      okProvenances.push([name, metric.provenance]);
    } else {
      values[name] = null;
    }
  }

  const currencies = new Set(
    okProvenances
      .filter(([, p]) => MONEY_UNITS.has(p.unit) && p.currency !== undefined)
      .map(([, p]) => p.currency as CurrencyCode),
  );
  if (currencies.size > 1) {
    return {
      metric: {
        status: 'INVALID_INPUT',
        reason: `Eltérő pénznemű bemenetek (${[...currencies].join(', ')}) – előbb FX-átváltás szükséges.`,
      },
      notes: [],
    };
  }

  const result = formula(values as Record<K, number> & Record<O, number | null>);
  if (result.status !== 'OK') {
    return { metric: { status: result.status, reason: result.reason }, notes: [] };
  }

  const currency =
    context.currency ??
    (MONEY_UNITS.has(context.unit) && currencies.size === 1 ? [...currencies][0] : undefined);
  const provenance: DataProvenance = {
    sourceId: ENGINE_SOURCE_ID,
    sourceName: ENGINE_SOURCE_NAME,
    kind: deriveKind(okProvenances, context),
    fetchedAt: context.calculatedAt,
    asOf: oldestAsOf(okProvenances),
    freshness: worstFreshness(okProvenances),
    unit: context.unit,
    inputs: okProvenances.map(([name]) => name),
    ...(currency === undefined ? {} : { currency }),
    ...(context.period === undefined ? {} : { period: context.period }),
  };
  return { metric: metricOk(result.value, provenance), notes: result.notes };
}

/**
 * Jelentett érték elsőbbsége (pl. `grossProfit`, `operatingIncome`): ha a jelentett `OK`,
 * azt adja vissza változatlanul; különben a saját számítást. Ha a saját számítás is csak
 * `MISSING`, de a jelentett érték informatívabb státuszú (pl. `INVALID_INPUT`), azt adja.
 */
export function preferReported(
  reported: Metric<number>,
  compute: () => MetricCalculation,
): MetricCalculation {
  if (reported.status === 'OK') return { metric: reported, notes: [] };
  const computed = compute();
  if (computed.metric.status === 'MISSING' && reported.status !== 'MISSING') {
    return { metric: reported, notes: [] };
  }
  return computed;
}
