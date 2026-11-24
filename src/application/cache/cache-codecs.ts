/**
 * Cache-payload kódolás/dekódolás (PHASE 13, D-082).
 *
 * A tárolt alak a proxy-szerződés (contracts) DTO-ja, a visszaolvasás UGYANAZZAL a zod-sémával
 * validál, mint a hálózati válasz. Így a sérült, kézzel módosított vagy régi sémájú rekord nem
 * jut el a számításokig: a dekódolás hibát ad, a cache törli a rekordot és újra lekér.
 */
import type { z } from 'zod';

import {
  dividendHistoryDtoSchema,
  financialStatementSetDtoSchema,
  fxRateSetDtoSchema,
  instrumentProfileDtoSchema,
  instrumentSearchResultDtoSchema,
  priceSeriesDtoSchema,
  quoteDtoSchema,
  quoteFromDto,
  quoteToDto,
  securityListingsDtoSchema,
} from '@/contracts';
import type {
  DataProvenance,
  DividendHistory,
  FinancialStatementSet,
  FxRateSet,
  InstrumentProfile,
  InstrumentSearchResult,
  PriceSeries,
  Quote,
  SecurityListings,
} from '@/domain';

export interface CacheCodec<T> {
  encode(value: T): unknown;
  /** `null` = érvénytelen payload (a hívó törli a rekordot). */
  decode(raw: unknown): T | null;
}

/** A cache-jelzést (`provenance.cache`) nem tároljuk: az a kiszolgálás módja, nem az adaté. */
function stripCacheInfo(provenance: DataProvenance): DataProvenance {
  if (provenance.cache === undefined) return provenance;
  const { cache: _cache, ...rest } = provenance;
  return rest;
}

function withProvenance<T extends { readonly provenance: DataProvenance }>(value: T): T {
  return { ...value, provenance: stripCacheInfo(value.provenance) };
}

function schemaCodec<T extends { readonly provenance: DataProvenance }>(
  schema: z.ZodType<T, unknown>,
): CacheCodec<T> {
  return {
    encode: (value) => withProvenance(value),
    decode: (raw) => {
      const parsed = schema.safeParse(raw);
      return parsed.success ? parsed.data : null;
    },
  };
}

export const quoteCodec: CacheCodec<Quote> = {
  encode: (quote) => quoteToDto(withProvenance(quote)),
  decode: (raw) => {
    const dto = quoteDtoSchema.safeParse(raw);
    if (!dto.success) return null;
    const quote = quoteFromDto(dto.data);
    return quote.ok ? quote.value : null;
  },
};

export const priceSeriesCodec = schemaCodec<PriceSeries>(priceSeriesDtoSchema);
export const dividendHistoryCodec = schemaCodec<DividendHistory>(dividendHistoryDtoSchema);
export const financialStatementsCodec = schemaCodec<FinancialStatementSet>(
  financialStatementSetDtoSchema,
);
export const instrumentProfileCodec = schemaCodec<InstrumentProfile>(instrumentProfileDtoSchema);
export const securityListingsCodec = schemaCodec<SecurityListings>(securityListingsDtoSchema);
export const searchResultCodec = schemaCodec<InstrumentSearchResult>(
  instrumentSearchResultDtoSchema,
);

export const fxRateSetCodec: CacheCodec<FxRateSet> = {
  encode: (set) => ({
    ...set,
    rates: set.rates.map((rate) => ({ ...rate, provenance: stripCacheInfo(rate.provenance) })),
  }),
  decode: (raw) => {
    const parsed = fxRateSetDtoSchema.safeParse(raw);
    return parsed.success ? parsed.data : null;
  },
};
