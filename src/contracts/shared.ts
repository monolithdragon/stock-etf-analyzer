/**
 * Közös zod sémák a kliens ↔ proxy szerződéshez (D-014, D-039).
 *
 * Munkamegosztás, hogy ne legyen duplikált szabály:
 * - a zod a SZERKEZETET és a típusokat ellenőrzi a bizalmi határon (ismeretlen JSON → típusos adat);
 * - az üzleti invariánsokat (ISIN ellenőrző jegy, pozitív ár…) a domain parserei/konstruktorai
 *   ellenőrzik – a sémák ezeket HÍVJÁK, nem másolják le.
 */
import { z } from 'zod';

import {
  FRESHNESS_VALUES,
  MEASUREMENT_UNITS,
  METRIC_STATUSES,
  PROVENANCE_KINDS,
  UNAVAILABLE_REASONS,
  parseCurrencyCode,
  parseIsoDate,
  parseIsoTimestamp,
  parseListingId,
  type Result,
} from '@/domain';

/** Egy domain `parse…` függvényből zod sémát készít (a hibaüzenet a domainé). */
export function fromDomainParser<T>(parse: (input: string) => Result<T>) {
  return z.string().transform((value, ctx): T => {
    const parsed = parse(value);
    if (parsed.ok) return parsed.value;
    ctx.addIssue({ code: 'custom', message: parsed.error.message });
    return z.NEVER;
  });
}

export const currencyCodeSchema = fromDomainParser(parseCurrencyCode);
export const isoDateSchema = fromDomainParser(parseIsoDate);
export const isoTimestampSchema = fromDomainParser(parseIsoTimestamp);
export const listingIdSchema = fromDomainParser(parseListingId);

/**
 * Provenance a szerződésben. A `period` mezőt a PHASE 04A adja hozzá a kimutatás-végpontokkal.
 * Méretkorlátok: a szolgáltatói szöveg megbízhatatlan adat (ARCHITECTURE 9.).
 */
export const dataProvenanceSchema = z.object({
  sourceId: z.string().min(1).max(64),
  sourceName: z.string().min(1).max(200),
  kind: z.enum(PROVENANCE_KINDS),
  fetchedAt: isoTimestampSchema,
  asOf: z.union([isoDateSchema, isoTimestampSchema]).nullable(),
  freshness: z.enum(FRESHNESS_VALUES),
  currency: currencyCodeSchema.optional(),
  unit: z.enum(MEASUREMENT_UNITS).optional(),
  reference: z.string().max(500).optional(),
  inputs: z.array(z.string().max(100)).max(50).optional(),
});

const NO_VALUE_STATUSES = METRIC_STATUSES.filter(
  (s): s is Exclude<(typeof METRIC_STATUSES)[number], 'OK' | 'UNAVAILABLE'> =>
    s !== 'OK' && s !== 'UNAVAILABLE',
);

/** `Metric<T>` séma tetszőleges értéksémához. Érték csak `OK` státusznál lehet. */
export function metricSchema<S extends z.ZodType>(valueSchema: S) {
  const reason = z.string().min(1).max(500);
  return z.union([
    z.object({ status: z.literal('OK'), value: valueSchema, provenance: dataProvenanceSchema }),
    z.object({
      status: z.literal('UNAVAILABLE'),
      unavailableReason: z.enum(UNAVAILABLE_REASONS),
      reason,
      provenance: dataProvenanceSchema.optional(),
    }),
    z.object({
      status: z.enum(NO_VALUE_STATUSES),
      reason,
      provenance: dataProvenanceSchema.optional(),
    }),
  ]);
}
