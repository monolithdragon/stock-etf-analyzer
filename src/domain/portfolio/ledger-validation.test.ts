import {
  createPortfolioAssetMetadata,
  orderTransactions,
  validateTransactionLedger,
  type CurrencyCode,
  type FxRate,
  type IsoDate,
  type IsoTimestamp,
  type ListingId,
  type Portfolio,
  type PortfolioId,
  type Transaction,
  type TransactionId,
} from '@/domain';

const EUR = 'EUR' as CurrencyCode;
const USD = 'USD' as CurrencyCode;
const A = 'AAPL@XNAS' as ListingId;
const B = 'VWCE@XETR' as ListingId;
const PORTFOLIO: Portfolio = {
  id: 'p1' as PortfolioId,
  name: 'P',
  baseCurrency: EUR,
  createdAt: '2026-01-01T00:00:00Z' as IsoTimestamp,
};
const base = (id: string, listingId: ListingId, tradeDate: string) => ({
  id: id as TransactionId,
  portfolioId: 'p1' as PortfolioId,
  listingId,
  tradeDate: tradeDate as IsoDate,
  note: null,
  fxRateToBase: null as FxRate | null,
});
const buy = (
  id: string,
  date: string,
  quantity: number,
  price = 10,
  currency = USD,
  listingId = A,
): Transaction => ({
  ...base(id, listingId, date),
  type: 'BUY',
  quantity,
  price: { amount: price, currency },
  fees: { amount: 0, currency },
});
const sell = (id: string, date: string, quantity: number, listingId = A): Transaction => ({
  ...base(id, listingId, date),
  type: 'SELL',
  quantity,
  price: { amount: 12, currency: USD },
  fees: { amount: 0, currency: USD },
});
const codes = (
  transactions: readonly Transaction[],
  currencies?: ReadonlyMap<ListingId, CurrencyCode>,
) =>
  validateTransactionLedger(PORTFOLIO, transactions, { listingCurrencies: currencies }).issues.map(
    (i) => `${i.code}:${i.transactionId}`,
  );

describe('validateTransactionLedger (feladat 9.)', () => {
  it('érvényes napló: nincs hiba', () => {
    const result = validateTransactionLedger(PORTFOLIO, [
      buy('t1', '2026-01-02', 5),
      sell('t2', '2026-02-02', 5),
    ]);
    expect(result.issues).toEqual([]);
    expect(result.blocking).toBe(false);
    expect(result.invalidListings.size).toBe(0);
  });

  it('túladás → OVERSELL hiba; a jegyzés érvénytelen, a másik nem', () => {
    const result = validateTransactionLedger(PORTFOLIO, [
      buy('t1', '2026-01-02', 5),
      sell('t2', '2026-02-02', 6),
      buy('t3', '2026-01-02', 1, 10, EUR, B),
    ]);
    expect(result.issues.map((i) => i.code)).toEqual(['OVERSELL']);
    expect([...result.invalidListings]).toEqual([A]);
  });

  it('időrend számít: a vétel előtti napra dátumozott eladás túladás (a rögzítési sorrendtől függetlenül)', () => {
    expect(codes([buy('t1', '2026-03-01', 5), sell('t2', '2026-02-01', 5)])).toEqual([
      'OVERSELL:t2',
    ]);
  });

  it('azonos napon a rögzítési sorrend érvényes (stabil rendezés)', () => {
    const ordered = orderTransactions([sell('t2', '2026-01-02', 1), buy('t1', '2026-01-02', 1)]);
    expect(ordered.map((t) => t.id)).toEqual(['t2', 't1']);
    expect(codes([buy('t1', '2026-01-02', 1), sell('t2', '2026-01-02', 1)])).toEqual([]);
  });

  it('ismétlődő azonosító → DUPLICATE_ID és blocking; azonos tartalom → csak figyelmeztetés', () => {
    const dup = validateTransactionLedger(PORTFOLIO, [
      buy('t1', '2026-01-02', 1),
      buy('t1', '2026-01-03', 1),
    ]);
    expect(dup.blocking).toBe(true);
    const twin = validateTransactionLedger(PORTFOLIO, [
      buy('t1', '2026-01-02', 1),
      buy('t2', '2026-01-02', 1),
    ]);
    expect(twin.issues).toMatchObject([
      { code: 'POSSIBLE_DUPLICATE', severity: 'warning', transactionId: 't2' },
    ]);
    expect(twin.invalidListings.size).toBe(0);
  });

  it('a tárolóból érkező hibás adat futásidőben is kiszűrve: nem pozitív mennyiség, hibás ár, hiányzó pénznem', () => {
    const zeroQty = { ...buy('t1', '2026-01-02', 1), quantity: 0 } as Transaction;
    const badPrice = {
      ...buy('t2', '2026-01-02', 1),
      price: { amount: Number.NaN, currency: USD },
    } as Transaction;
    const noCurrency = {
      ...buy('t3', '2026-01-02', 1),
      price: { amount: 10, currency: undefined as unknown as CurrencyCode },
    } as Transaction;
    const badCurrency = {
      ...buy('t4', '2026-01-02', 1),
      fees: { amount: 0, currency: 'usd' as CurrencyCode },
    } as Transaction;
    expect(codes([zeroQty, badPrice, noCurrency, badCurrency])).toEqual([
      'INVALID_VALUE:t1',
      'INVALID_VALUE:t2',
      'MISSING_CURRENCY:t3',
      'MISSING_CURRENCY:t4',
    ]);
  });

  it('ellentmondó deviza: egy jegyzés két fő pénznemben, vagy eltér az ismert jegyzési pénznemtől', () => {
    expect(
      codes([buy('t1', '2026-01-02', 1, 10, USD), buy('t2', '2026-01-03', 1, 10, EUR)]),
    ).toEqual(['CURRENCY_CONFLICT:t2']);
    expect(codes([buy('t1', '2026-01-02', 1, 10, EUR)], new Map([[A, USD]]))).toEqual([
      'CURRENCY_CONFLICT:t1',
    ]);
    // GBX és GBP ugyanaz a fő pénznem → nem ellentmondás
    const gbx = 'GBX' as CurrencyCode;
    const gbp = 'GBP' as CurrencyCode;
    expect(
      codes([buy('t1', '2026-01-02', 1, 800, gbx, B), buy('t2', '2026-01-03', 1, 8, gbp, B)]),
    ).toEqual([]);
  });

  it('rossz irányú rögzített FX-ráta → FX_RATE_MISMATCH', () => {
    const wrong: FxRate = {
      base: EUR,
      quote: USD,
      rate: 1.1,
      asOf: '2026-01-02' as IsoDate,
      provenance: {
        sourceId: 'x',
        sourceName: 'x',
        kind: 'user_input',
        fetchedAt: '2026-01-02T00:00:00Z' as IsoTimestamp,
        asOf: null,
        freshness: 'FRESH',
      },
    };
    expect(codes([{ ...buy('t1', '2026-01-02', 1), fxRateToBase: wrong } as Transaction])).toEqual([
      'FX_RATE_MISMATCH:t1',
    ]);
  });

  it('pozíció nélküli split és osztalék: figyelmeztetés; idegen portfólió: blocking', () => {
    const split: Transaction = {
      ...base('t1', A, '2026-01-02'),
      type: 'SPLIT',
      ratioFrom: 1,
      ratioTo: 2,
    };
    const dividend: Transaction = {
      ...base('t2', A, '2026-01-03'),
      type: 'DIVIDEND',
      amount: { amount: 1, currency: USD },
    };
    const result = validateTransactionLedger(PORTFOLIO, [split, dividend]);
    expect(result.issues.map((i) => [i.code, i.severity])).toEqual([
      ['SPLIT_WITHOUT_POSITION', 'warning'],
      ['DIVIDEND_WITHOUT_POSITION', 'warning'],
    ]);
    const foreign = {
      ...buy('t9', '2026-01-02', 1),
      portfolioId: 'p2' as PortfolioId,
    } as Transaction;
    expect(validateTransactionLedger(PORTFOLIO, [foreign]).blocking).toBe(true);
  });

  it('split után a mennyiség nő: a split utáni eladás az új darabszámig érvényes', () => {
    const split: Transaction = {
      ...base('t2', A, '2026-02-01'),
      type: 'SPLIT',
      ratioFrom: 1,
      ratioTo: 4,
    };
    expect(codes([buy('t1', '2026-01-02', 5), split, sell('t3', '2026-03-01', 20)])).toEqual([]);
    expect(codes([buy('t1', '2026-01-02', 5), split, sell('t3', '2026-03-01', 21)])).toEqual([
      'OVERSELL:t3',
    ]);
  });
});

describe('createPortfolioAssetMetadata', () => {
  const source = { kind: 'user_input' as const, sourceName: 'Kézi' };
  it('részvény eszközosztálya automatikusan equity; ETF-nél nincs alapérték', () => {
    const stock = createPortfolioAssetMetadata({
      listingId: A,
      kind: 'stock',
      country: 'us',
      source,
    });
    expect(stock).toMatchObject({
      ok: true,
      value: { assetClass: 'equity', country: 'US', sector: null },
    });
    const etf = createPortfolioAssetMetadata({ listingId: B, kind: 'etf', source });
    expect(etf).toMatchObject({ ok: true, value: { assetClass: null } });
  });
  it('hibás ISIN, ismeretlen fajta, részvény nem-equity osztállyal → VALIDATION', () => {
    expect(createPortfolioAssetMetadata({ listingId: A, isin: 'US0378331006', source }).ok).toBe(
      false,
    );
    expect(createPortfolioAssetMetadata({ listingId: A, kind: 'bond', source }).ok).toBe(false);
    expect(
      createPortfolioAssetMetadata({ listingId: A, kind: 'stock', assetClass: 'bond', source }).ok,
    ).toBe(false);
  });
});
