/**
 * Piaci adatok szerződése (PHASE 04B): ártörténet, osztalék, profil.
 * A hálózati alak = a domain alakja; az üzleti szabályokat a domain konstruktorai ellenőrzik.
 */
import { z } from 'zod';

import {
  INSTRUMENT_KINDS,
  PRICE_ADJUSTMENTS,
  createDividendEvent,
  createDividendHistory,
  createInstrumentProfile,
  createPriceSeries,
} from '@/domain';

import { currencyCodeSchema, dataProvenanceSchema, listingIdSchema, withDomain } from './shared';

const notesSchema = z.array(z.string().max(500)).max(20);

/** Legfeljebb ~40 év napi adata (a free források ennél jóval kevesebbet adnak). */
export const MAX_PRICE_POINTS = 10_000;

/** `GET /api/v1/instruments/{id}/prices?from&to&adjustment` válaszának `data` része. */
export const priceSeriesDtoSchema = withDomain(
  z.object({
    listingId: listingIdSchema,
    currency: currencyCodeSchema,
    adjustment: z.enum(PRICE_ADJUSTMENTS),
    points: z.array(z.object({ date: z.string(), close: z.number() })).max(MAX_PRICE_POINTS),
    notes: notesSchema,
    provenance: dataProvenanceSchema,
  }),
  createPriceSeries,
);
export type PriceSeriesDto = z.input<typeof priceSeriesDtoSchema>;

const dividendEventDtoSchema = withDomain(
  z.object({
    exDate: z.string(),
    paymentDate: z.string().nullable(),
    recordDate: z.string().nullable(),
    declarationDate: z.string().nullable(),
    amount: z.object({ amount: z.number(), currency: currencyCodeSchema }),
    splitAdjustedAmount: z.number().nullable(),
    frequency: z.string().max(50).nullable(),
  }),
  ({ amount, ...rest }) =>
    createDividendEvent({ ...rest, amount: amount.amount, currency: amount.currency }),
);

/** `GET /api/v1/instruments/{id}/dividends?from&to` válaszának `data` része. */
export const dividendHistoryDtoSchema = withDomain(
  z.object({
    listingId: listingIdSchema,
    events: z.array(dividendEventDtoSchema).max(1000),
    notes: notesSchema,
    provenance: dataProvenanceSchema,
  }),
  createDividendHistory,
);
export type DividendHistoryDto = z.input<typeof dividendHistoryDtoSchema>;

/** `GET /api/v1/instruments/{id}/profile` válaszának `data` része. */
export const instrumentProfileDtoSchema = withDomain(
  z.object({
    listingId: listingIdSchema,
    name: z.string(),
    kindHint: z.enum(INSTRUMENT_KINDS).nullable(),
    isin: z.string().nullable(),
    cik: z.string().nullable(),
    country: z.string().nullable(),
    sector: z.string().nullable(),
    industry: z.string().nullable(),
    exchangeName: z.string().nullable(),
    tradingCurrency: z.string().nullable(),
    website: z.string().nullable(),
    description: z.string().max(5000).nullable(),
    /** PHASE 06: opcionális (régebbi proxy nem küldi) → `null`. */
    beta: z.number().nullable().optional(),
    provenance: dataProvenanceSchema,
  }),
  createInstrumentProfile,
);
export type InstrumentProfileDto = z.input<typeof instrumentProfileDtoSchema>;
