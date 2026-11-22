/**
 * Motor-provenance a bemenetek provenance-éből (fajta, legrégebbi `asOf`, legrosszabb
 * frissesség). Közös az ETF- és a portfólióelemzésben (PHASE 08-ban készült, PHASE 09-ben
 * kiemelve az `etf-analysis/etf-metric.ts`-ből).
 */
import { ENGINE_SOURCE_ID, ENGINE_SOURCE_NAME } from '@/calculations';
import {
  toEpochMs,
  type CurrencyCode,
  type DataProvenance,
  type Freshness,
  type IsoDate,
  type IsoTimestamp,
  type MeasurementUnit,
  type ProvenanceKind,
} from '@/domain';

const FRESHNESS_SEVERITY: readonly Freshness[] = ['EXPIRED', 'UNKNOWN', 'STALE', 'FRESH'];

export interface EngineContext {
  readonly fetchedAt: IsoTimestamp;
  /** A számításhoz felhasznált bemenetek provenance-e. */
  readonly inputs: readonly (readonly [string, DataProvenance])[];
  /** `estimated`, ha a számítás feltevést használ (pl. TER-hatás feltételezett hozammal). */
  readonly kind?: 'calculated' | 'estimated';
  readonly currency?: CurrencyCode;
  readonly unit: MeasurementUnit;
}

export function engineProvenance(context: EngineContext): DataProvenance {
  const kinds = new Set(context.inputs.map(([, p]) => p.kind));
  const kind: ProvenanceKind = kinds.has('mock')
    ? 'mock'
    : context.kind === 'estimated' || kinds.has('estimated')
      ? 'estimated'
      : 'calculated';
  let asOf: IsoDate | IsoTimestamp | null = null;
  for (const [, p] of context.inputs) {
    if (p.asOf !== null && (asOf === null || toEpochMs(p.asOf) < toEpochMs(asOf))) asOf = p.asOf;
  }
  const present = new Set(context.inputs.map(([, p]) => p.freshness));
  return {
    sourceId: ENGINE_SOURCE_ID,
    sourceName: ENGINE_SOURCE_NAME,
    kind,
    fetchedAt: context.fetchedAt,
    asOf,
    freshness: FRESHNESS_SEVERITY.find((value) => present.has(value)) ?? 'UNKNOWN',
    unit: context.unit,
    inputs: context.inputs.map(([name]) => name),
    ...(context.currency === undefined ? {} : { currency: context.currency }),
  };
}
