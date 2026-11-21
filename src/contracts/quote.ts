import { z } from 'zod';

import { createQuote, type Quote, type Result } from '@/domain';

import { currencyCodeSchema, dataProvenanceSchema, listingIdSchema } from './shared';

/** `GET /api/v1/instruments/{id}/quote` válaszának `data` része (contract v1 váz, PHASE 04A véglegesíti). */
export const quoteDtoSchema = z.object({
  listingId: listingIdSchema,
  price: z.number(),
  currency: currencyCodeSchema,
  asOf: z.string(),
  delayMinutes: z.number().int().nullable(),
  provenance: dataProvenanceSchema,
});

/** A hálózaton utazó alak (validálás előtt). */
export type QuoteDto = z.input<typeof quoteDtoSchema>;

/** Contract → domain mapper: az üzleti szabályokat (pozitív ár, időbélyeg) a domain ellenőrzi. */
export function quoteFromDto(dto: z.output<typeof quoteDtoSchema>): Result<Quote> {
  return createQuote(dto);
}
