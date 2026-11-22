import {
  AppErrors,
  createDividendEvent,
  createDividendHistory,
  createInstrumentProfile,
  createInstrumentSearchHit,
  isRetryable,
  parseCurrencyCode,
  parseListingId,
  parseSearchQuery,
  type DataProvenance,
  type IsoTimestamp,
  type ListingId,
} from '@/domain';

const provenance: DataProvenance = {
  sourceId: 'fmp',
  sourceName: 'FMP',
  kind: 'reported',
  fetchedAt: '2026-11-21T12:00:00.000Z' as IsoTimestamp,
  asOf: null,
  freshness: 'UNKNOWN',
};
const listing = (() => {
  const parsed = parseListingId('AAPL@XNAS');
  if (!parsed.ok) throw new Error('setup');
  return parsed.value as ListingId;
})();
const usd = (() => {
  const parsed = parseCurrencyCode('USD');
  if (!parsed.ok) throw new Error('setup');
  return parsed.value;
})();

describe('DividendEvent / DividendHistory', () => {
  const base = {
    exDate: '2026-11-12',
    paymentDate: null,
    recordDate: null,
    declarationDate: null,
    amount: 0.27,
    currency: usd,
    splitAdjustedAmount: null,
    frequency: '  ',
  };

  it('érvényes esemény; az üres frekvencia null', () => {
    expect(createDividendEvent(base)).toMatchObject({
      ok: true,
      value: { amount: { amount: 0.27, currency: 'USD' }, frequency: null },
    });
  });

  it('0 vagy negatív összeg NEM osztalék (nem tároljuk 0-ként)', () => {
    expect(createDividendEvent({ ...base, amount: 0 }).ok).toBe(false);
    expect(createDividendEvent({ ...base, amount: -1 }).ok).toBe(false);
  });

  it('a történet ex-dátum szerint növekvő; azonos nap megengedett (rendkívüli osztalék)', () => {
    const a = createDividendEvent({ ...base, exDate: '2026-05-01' });
    const b = createDividendEvent(base);
    if (!a.ok || !b.ok) throw new Error('setup');
    expect(
      createDividendHistory({ listingId: listing, events: [a.value, b.value], provenance }).ok,
    ).toBe(true);
    expect(
      createDividendHistory({ listingId: listing, events: [b.value, b.value], provenance }).ok,
    ).toBe(true);
    expect(
      createDividendHistory({ listingId: listing, events: [b.value, a.value], provenance }).ok,
    ).toBe(false);
  });
});

describe('InstrumentProfile', () => {
  it('a forrás üres szövegei null-lá válnak (nem üres string, nem kitalált érték)', () => {
    const profile = createInstrumentProfile({
      listingId: listing,
      name: 'Apple Inc.',
      kindHint: 'stock',
      isin: '',
      cik: ' ',
      country: '',
      sector: '',
      industry: null,
      exchangeName: 'NASDAQ',
      tradingCurrency: '',
      website: '',
      description: 'x'.repeat(5000),
      provenance,
    });
    expect(profile).toMatchObject({
      ok: true,
      value: { isin: null, cik: null, country: null, sector: null, tradingCurrency: null },
    });
    expect(profile.ok && profile.value.description?.length).toBe(4000);
  });
});

describe('keresés és hibamodell', () => {
  it('a találat listingId-ja symbol@MIC; GBp → GBX', () => {
    expect(
      createInstrumentSearchHit({
        symbol: 'isf',
        mic: 'XLON',
        name: 'iShares',
        kindHint: 'etf',
        isin: null,
        tradingCurrency: 'GBp',
        exchangeName: null,
      }),
    ).toMatchObject({ ok: true, value: { listingId: 'ISF@XLON', tradingCurrency: 'GBX' } });
  });

  it('keresőkifejezés: 1–64 karakter, a szóközök összevonva', () => {
    expect(parseSearchQuery('  vanguard   all world ')).toEqual({
      ok: true,
      value: 'vanguard all world',
    });
    expect(parseSearchQuery('   ').ok).toBe(false);
    expect(parseSearchQuery('x'.repeat(65)).ok).toBe(false);
  });

  it('UNAVAILABLE nem újrapróbálható (csomag/kvóta nem javul azonnali újrapróbával)', () => {
    expect(isRetryable(AppErrors.unavailable('QUOTA_EXHAUSTED', 'x'))).toBe(false);
    expect(isRetryable(AppErrors.unavailable('PLAN_LIMIT', 'x'))).toBe(false);
  });
});
