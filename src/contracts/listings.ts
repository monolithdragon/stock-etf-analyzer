import { z } from 'zod';

import {
  INSTRUMENT_KINDS,
  createListingCandidate,
  invalid,
  ok,
  securityIdFromIsin,
  type Result,
  type SecurityListings,
} from '@/domain';

import { dataProvenanceSchema, isinSchema, withDomain } from './shared';

/** A hálózati alak = a domain alakja (a `securityId` itt mindig ISIN, a domain ellenőrzi). */
export const listingCandidateDtoSchema = withDomain(
  z.object({
    securityId: z.string(),
    symbol: z.string(),
    mic: z.string(),
    exchangeName: z.string(),
    tradingCurrency: z.string().nullable(),
    figi: z.string().nullable(),
    compositeFigi: z.string().nullable(),
    kindHint: z.enum(INSTRUMENT_KINDS).nullable(),
    sourceName: z.string().nullable(),
  }),
  ({ securityId, ...rest }) => createListingCandidate({ ...rest, isin: securityId }),
);

const omittedCount = z.number().int().nonnegative();

/** `GET /api/v1/securities/{isin}/listings` válaszának `data` része (D-025). */
export const securityListingsDtoSchema = withDomain(
  z.object({
    isin: isinSchema,
    listings: z.array(listingCandidateDtoSchema).max(500),
    omitted: z.object({
      unmappedVenue: omittedCount,
      composite: omittedCount,
      invalidSymbol: omittedCount,
    }),
    provenance: dataProvenanceSchema,
  }),
  (dto): Result<SecurityListings> => {
    const securityId = securityIdFromIsin(dto.isin);
    const foreign = dto.listings.find((l) => l.securityId !== securityId);
    return foreign === undefined
      ? ok({ ...dto, securityId })
      : invalid(`Idegen jegyzés a listában: ${foreign.listingId} (${foreign.securityId}).`);
  },
);

export type SecurityListingsDto = z.input<typeof securityListingsDtoSchema>;
