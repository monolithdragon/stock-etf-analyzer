import { z } from 'zod';

import { createFxRate, createFxRateSet } from '@/domain';

import { currencyCodeSchema, dataProvenanceSchema, withDomain } from './shared';

/** Egy ráta: 1 `base` = `rate` `quote`, a domain ellenőrzi (pozitív, valós nap, base ≠ quote). */
export const fxRateDtoSchema = withDomain(
  z.object({
    base: currencyCodeSchema,
    quote: currencyCodeSchema,
    rate: z.number(),
    asOf: z.string(),
    provenance: dataProvenanceSchema,
  }),
  createFxRate,
);

/** `GET /api/v1/fx?base=EUR&quotes=USD,HUF&date=YYYY-MM-DD` válaszának `data` része. */
export const fxRateSetDtoSchema = withDomain(
  z.object({
    base: currencyCodeSchema,
    rates: z.array(fxRateDtoSchema).max(100),
    missing: z.array(currencyCodeSchema).max(100),
  }),
  createFxRateSet,
);

export type FxRateSetDto = z.input<typeof fxRateSetDtoSchema>;
