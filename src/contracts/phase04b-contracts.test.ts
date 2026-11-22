import {
  apiErrorToAppError,
  dividendHistoryDtoSchema,
  instrumentProfileDtoSchema,
  instrumentSearchResultDtoSchema,
  parseApiResponse,
  priceSeriesDtoSchema,
} from '@/contracts';

const provenance = {
  sourceId: 'eodhd',
  sourceName: 'EODHD',
  kind: 'reported',
  fetchedAt: '2026-11-21T12:00:00.000Z',
  asOf: '2026-11-20',
  freshness: 'UNKNOWN',
};

describe('PHASE 04B contract-sémák (a domain szabályait hívják)', () => {
  it('priceSeries: érvényes; a nem növekvő dátum és a 0-s ár elutasítva', () => {
    const base = {
      listingId: 'ISF@XLON',
      currency: 'GBX',
      adjustment: 'NONE',
      notes: [],
      provenance,
    };
    expect(
      priceSeriesDtoSchema.safeParse({ ...base, points: [{ date: '2026-11-20', close: 1010.8 }] })
        .success,
    ).toBe(true);
    expect(
      priceSeriesDtoSchema.safeParse({ ...base, points: [{ date: '2026-11-20', close: 0 }] })
        .success,
    ).toBe(false);
    expect(
      priceSeriesDtoSchema.safeParse({
        ...base,
        points: [
          { date: '2026-11-20', close: 1 },
          { date: '2026-11-19', close: 1 },
        ],
      }).success,
    ).toBe(false);
    expect(
      priceSeriesDtoSchema.safeParse({ ...base, adjustment: 'ADJUSTED', points: [] }).success,
    ).toBe(false);
  });

  it('dividendHistory: a pénznem eseményenként megmarad (GBP egy GBX-jegyzésen)', () => {
    const parsed = dividendHistoryDtoSchema.safeParse({
      listingId: 'ISF@XLON',
      events: [
        {
          exDate: '2025-03-13',
          paymentDate: '2025-03-26',
          recordDate: null,
          declarationDate: '2025-03-06',
          amount: { amount: 0.0475, currency: 'GBP' },
          splitAdjustedAmount: 0.0475,
          frequency: 'Quarterly',
        },
      ],
      notes: [],
      provenance,
    });
    expect(parsed.success && parsed.data.events[0]?.amount).toEqual({
      amount: 0.0475,
      currency: 'GBP',
    });
  });

  it('profile: hibás ISIN elutasítva (a domain ellenőrző jegye)', () => {
    const base = {
      listingId: 'AAPL@XNAS',
      name: 'Apple Inc.',
      kindHint: 'stock',
      cik: '0000320193',
      country: 'US',
      sector: null,
      industry: null,
      exchangeName: null,
      tradingCurrency: 'USD',
      website: null,
      description: null,
      provenance,
    };
    expect(instrumentProfileDtoSchema.safeParse({ ...base, isin: 'US0378331005' }).success).toBe(
      true,
    );
    expect(instrumentProfileDtoSchema.safeParse({ ...base, isin: 'US0378331006' }).success).toBe(
      false,
    );
  });

  it('search: a listingId-t a domain újraszámolja (a hálózati érték nem számít)', () => {
    const parsed = instrumentSearchResultDtoSchema.safeParse({
      query: 'ISF',
      hits: [
        {
          listingId: 'HAMIS@XXXX',
          symbol: 'ISF',
          mic: 'XLON',
          name: 'iShares Core FTSE 100',
          kindHint: 'etf',
          isin: 'IE0005042456',
          tradingCurrency: 'GBX',
          exchangeName: 'London Stock Exchange',
        },
      ],
      omitted: { unmappedVenue: 0, invalidSymbol: 0, unsupportedType: 0, truncated: 0 },
      provenance,
    });
    expect(parsed.success && parsed.data.hits[0]?.listingId).toBe('ISF@XLON');
  });
});

describe('CAPABILITY_UNAVAILABLE + unavailableReason (visszafelé kompatibilis)', () => {
  it('okkal → UNAVAILABLE a kliensen; ok nélkül (04A-alak) → MISSING_DATA / source', () => {
    expect(
      apiErrorToAppError({
        code: 'CAPABILITY_UNAVAILABLE',
        message: 'x',
        unavailableReason: 'QUOTA_EXHAUSTED',
      }),
    ).toEqual({ kind: 'UNAVAILABLE', message: 'x', reason: 'QUOTA_EXHAUSTED' });
    expect(apiErrorToAppError({ code: 'CAPABILITY_UNAVAILABLE', message: 'x' })).toMatchObject({
      kind: 'MISSING_DATA',
      missing: ['source'],
    });
  });

  it('ismeretlen ok-kód → CONTRACT_MISMATCH (nem találgatunk)', () => {
    const result = parseApiResponse(
      {
        apiVersion: '1',
        error: { code: 'CAPABILITY_UNAVAILABLE', message: 'x', unavailableReason: 'BUDGET' },
      },
      priceSeriesDtoSchema,
    );
    expect(result).toMatchObject({ ok: false, error: { failure: 'CONTRACT_MISMATCH' } });
  });
});
