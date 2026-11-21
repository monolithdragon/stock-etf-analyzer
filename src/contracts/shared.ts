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
  FISCAL_PERIOD_TYPES,
  FRESHNESS_VALUES,
  MEASUREMENT_UNITS,
  METRIC_STATUSES,
  PROVENANCE_KINDS,
  UNAVAILABLE_REASONS,
  createFiscalPeriod,
  parseCik,
  parseCurrencyCode,
  parseIsin,
  parseIsoDate,
  parseIsoTimestamp,
  parseListingId,
  parseSecurityId,
  type AppError,
  type Result,
} from '@/domain';

/** A domain hibájából zod-hibaüzenet(ek), mezőútvonallal. */
function domainIssueMessages(error: AppError): readonly string[] {
  if (error.kind !== 'VALIDATION' || error.issues.length === 0) return [error.message];
  return error.issues.map((i) => (i.path === '' ? i.message : `${i.path}: ${i.message}`));
}

/**
 * Egy szerkezeti sémát a domain konstruktorával/parserével zár le: a zod csak az alakot nézi,
 * az üzleti szabályt a domain ellenőrzi (D-039). A kimenet típusa a domain típusa.
 */
export function withDomain<S extends z.ZodType, T>(
  schema: S,
  create: (value: z.output<S>) => Result<T>,
) {
  return schema.transform((value, ctx): T => {
    const created = create(value);
    if (created.ok) return created.value;
    for (const message of domainIssueMessages(created.error)) {
      ctx.addIssue({ code: 'custom', message });
    }
    return z.NEVER;
  });
}

/** Egy domain `parse…` függvényből zod sémát készít (a hibaüzenet a domainé). */
export function fromDomainParser<T>(parse: (input: string) => Result<T>) {
  return withDomain(z.string(), parse);
}

export const currencyCodeSchema = fromDomainParser(parseCurrencyCode);
export const isoDateSchema = fromDomainParser(parseIsoDate);
export const isoTimestampSchema = fromDomainParser(parseIsoTimestamp);
export const listingIdSchema = fromDomainParser(parseListingId);
export const isinSchema = fromDomainParser(parseIsin);
export const securityIdSchema = fromDomainParser(parseSecurityId);
export const cikSchema = fromDomainParser(parseCik);

/** Pénzügyi időszak; a `durationDays`-t a domain újraszámolja, nem a hálózatnak hisz. */
export const fiscalPeriodSchema = withDomain(
  z.object({
    fiscalYear: z.number(),
    fiscalPeriod: z.enum(FISCAL_PERIOD_TYPES),
    start: z.string(),
    end: z.string(),
    durationDays: z.number().optional(),
  }),
  createFiscalPeriod,
);

/**
 * Provenance a szerződésben.
 * Méretkorlátok: a szolgáltatói szöveg megbízhatatlan adat (ARCHITECTURE 9.).
 */
export const dataProvenanceSchema = z.object({
  sourceId: z.string().min(1).max(64),
  sourceName: z.string().min(1).max(200),
  kind: z.enum(PROVENANCE_KINDS),
  fetchedAt: isoTimestampSchema,
  asOf: z.union([isoDateSchema, isoTimestampSchema]).nullable(),
  freshness: z.enum(FRESHNESS_VALUES),
  period: fiscalPeriodSchema.optional(),
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
