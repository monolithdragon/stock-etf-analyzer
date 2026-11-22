import { z } from 'zod';

import { INSTRUMENT_KINDS, MAX_SEARCH_HITS, createInstrumentSearchHit } from '@/domain';

import { dataProvenanceSchema, withDomain } from './shared';

const instrumentSearchHitDtoSchema = withDomain(
  z.object({
    listingId: z.string(),
    symbol: z.string(),
    mic: z.string(),
    name: z.string(),
    kindHint: z.enum(INSTRUMENT_KINDS).nullable(),
    isin: z.string().nullable(),
    tradingCurrency: z.string().nullable(),
    exchangeName: z.string().nullable(),
  }),
  // A `listingId`-t a domain a symbol + MIC párból ÚJRASZÁMOLJA (nem hisz a hálózatnak).
  ({ listingId: _ignored, ...rest }) => createInstrumentSearchHit(rest),
);

const omittedCount = z.number().int().nonnegative();

/** `GET /api/v1/search?q=` válaszának `data` része (PHASE 04B). */
export const instrumentSearchResultDtoSchema = z.object({
  query: z.string().min(1).max(64),
  hits: z.array(instrumentSearchHitDtoSchema).max(MAX_SEARCH_HITS),
  omitted: z.object({
    unmappedVenue: omittedCount,
    invalidSymbol: omittedCount,
    unsupportedType: omittedCount,
    truncated: omittedCount,
  }),
  provenance: dataProvenanceSchema,
});
export type InstrumentSearchResultDto = z.input<typeof instrumentSearchResultDtoSchema>;
