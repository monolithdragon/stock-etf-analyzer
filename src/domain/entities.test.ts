import {
  createAnalysisResult,
  createEtf,
  createFinancialMetric,
  createFinancialStatement,
  createFiscalPeriod,
  createFxRate,
  createListing,
  createPortfolio,
  createPriceSeries,
  createQuote,
  createStock,
  createTransaction,
  metricMissing,
  metricNotApplicable,
  metricOk,
  type CurrencyCode,
  type DataProvenance,
  type FinancialMetric,
  type FiscalPeriod,
  type IsoDate,
  type IsoTimestamp,
  type ListingId,
  type SecurityId,
  type TransactionInput,
} from '@/domain';

const USD = 'USD' as CurrencyCode;
const EUR = 'EUR' as CurrencyCode;
const LISTING = 'DEMO@XNAS' as ListingId;
const SECURITY = 'US0378331005' as SecurityId;

const provenance = (overrides: Partial<DataProvenance> = {}): DataProvenance => ({
  sourceId: 'mock',
  sourceName: 'Demóadat',
  kind: 'mock',
  fetchedAt: '2026-11-21T12:00:00Z' as IsoTimestamp,
  asOf: null,
  freshness: 'UNKNOWN',
  ...overrides,
});

function fy2025(): FiscalPeriod {
  const period = createFiscalPeriod({
    fiscalYear: 2025,
    fiscalPeriod: 'FY',
    start: '2025-01-01',
    end: '2025-12-31',
  });
  if (!period.ok) throw new Error('setup');
  return period.value;
}

describe('Instrument (Stock | Etf) és Listing', () => {
  const stockInput = {
    securityId: 'US0378331005',
    isin: 'US0378331005',
    name: ' Demo Corp ',
    country: 'us',
    figi: null,
    cik: '0000320193',
    reportingCurrency: 'USD',
    sector: '',
    industry: null,
    provenance: provenance(),
  };

  it('érvényes részvényt normalizálva hoz létre; üres szöveg → null', () => {
    const stock = createStock(stockInput);
    expect(stock).toMatchObject({
      ok: true,
      value: { kind: 'stock', name: 'Demo Corp', country: 'US', sector: null, cik: '0000320193' },
    });
  });

  it('ISIN esetén a securityId-nak egyeznie kell (D-025)', () => {
    expect(createStock({ ...stockInput, securityId: 'sec-edgar:0000320193' }).ok).toBe(false);
  });

  it('az összes hibás mezőt egyszerre jelzi', () => {
    const result = createStock({
      ...stockInput,
      name: '  ',
      cik: '320193',
      reportingCurrency: 'dollar',
    });
    expect(result.ok).toBe(false);
    if (result.ok || result.error.kind !== 'VALIDATION') return;
    expect(result.error.issues.map((i) => i.path).sort()).toEqual([
      'cik',
      'name',
      'reportingCurrency',
    ]);
  });

  const etfInput = {
    securityId: 'IE00BK5BQT80',
    isin: 'IE00BK5BQT80',
    name: 'Demo ETF',
    country: 'IE',
    figi: null,
    provenance: provenance(),
    issuer: metricMissing<string>('nincs adat'),
    ter: metricOk(0.0022, provenance({ kind: 'user_input' })),
    aum: metricMissing<{ amount: number; currency: CurrencyCode }>('nincs adat'),
    benchmark: metricMissing<string>('nincs adat'),
    replication: metricMissing<'physical_full'>('nincs adat'),
    distribution: metricOk('accumulating' as const, provenance()),
    ucits: metricOk(true, provenance()),
    currencyHedged: metricMissing<boolean>('nincs adat'),
    inceptionDate: metricMissing<IsoDate>('nincs adat'),
  };

  it('ETF: a hiányzó metaadat Metric státusszal él, nem 0/üres', () => {
    const etf = createEtf(etfInput);
    expect(etf.ok).toBe(true);
    if (etf.ok) expect(etf.value.issuer.status).toBe('MISSING');
  });

  it('ETF: a százalékként (tört helyett) megadott TER-t elutasítja', () => {
    const result = createEtf({ ...etfInput, ter: metricOk(0.22, provenance()) });
    expect(result).toMatchObject({ ok: false, error: { kind: 'VALIDATION' } });
  });

  it('Listing: a listingId a symbol@MIC-ből képződik', () => {
    const listing = createListing({
      securityId: 'IE00BK5BQT80',
      symbol: 'vwce',
      mic: 'xetr',
      exchangeName: 'Xetra',
      tradingCurrency: 'eur',
      isPrimary: null,
      figi: null,
    });
    expect(listing).toMatchObject({
      ok: true,
      value: { listingId: 'VWCE@XETR', tradingCurrency: 'EUR', isPrimary: null },
    });
  });
});

describe('Quote és PriceSeries', () => {
  const base = {
    listingId: LISTING,
    currency: USD,
    asOf: '2026-11-21T11:55:00Z',
    delayMinutes: 15,
    provenance: provenance(),
  };

  it('pozitív árral létrejön; 0 vagy negatív ár érvénytelen (nem „hiányzó”)', () => {
    expect(createQuote({ ...base, price: 101.5 })).toMatchObject({
      ok: true,
      value: { price: { amount: 101.5, currency: 'USD' } },
    });
    expect(createQuote({ ...base, price: 0 }).ok).toBe(false);
    expect(createQuote({ ...base, price: -1 }).ok).toBe(false);
    expect(createQuote({ ...base, price: 1, delayMinutes: -5 }).ok).toBe(false);
  });

  it('ártörténet: csak szigorúan növekvő dátumok', () => {
    const series = {
      listingId: LISTING,
      currency: USD,
      adjustment: 'SPLIT' as const,
      provenance: provenance(),
    };
    expect(
      createPriceSeries({
        ...series,
        points: [
          { date: '2026-11-19', close: 10 },
          { date: '2026-11-20', close: 11 },
        ],
      }).ok,
    ).toBe(true);
    expect(
      createPriceSeries({
        ...series,
        points: [
          { date: '2026-11-20', close: 10 },
          { date: '2026-11-20', close: 11 },
        ],
      }).ok,
    ).toBe(false);
  });
});

describe('FinancialStatement', () => {
  it('a forrás által meg nem adott tétel MISSING lesz, a jelentett 0 megmarad 0-nak', () => {
    const statement = createFinancialStatement({
      statementType: 'cashflow',
      securityId: SECURITY,
      period: fy2025(),
      currency: USD,
      provenance: provenance({ sourceName: 'SEC EDGAR' }),
      lineItems: {
        operatingCashFlow: metricOk(1000, provenance({ currency: USD })),
        dividendsPaid: metricOk(0, provenance({ currency: USD })),
      },
    });
    expect(statement.ok).toBe(true);
    if (!statement.ok) return;
    expect(statement.value.statementType).toBe('cashflow');
    expect(statement.value.lineItems.dividendsPaid).toMatchObject({ status: 'OK', value: 0 });
    expect(statement.value.lineItems.capitalExpenditure).toMatchObject({
      status: 'MISSING',
      reason: expect.stringContaining('SEC EDGAR'),
    });
  });

  it('a kimutatás pénznemétől eltérő pénzösszegű tételt elutasítja', () => {
    const statement = createFinancialStatement({
      statementType: 'income',
      securityId: SECURITY,
      period: fy2025(),
      currency: USD,
      provenance: provenance(),
      lineItems: { revenue: metricOk(1000, provenance({ currency: EUR })) },
    });
    expect(statement).toMatchObject({ ok: false, error: { kind: 'VALIDATION' } });
  });

  it('ismeretlen tételt (pl. elírás) nem fogad el', () => {
    const statement = createFinancialStatement({
      statementType: 'balance',
      securityId: SECURITY,
      period: fy2025(),
      currency: USD,
      provenance: provenance(),
      lineItems: { revenue: metricOk(1, provenance()) } as never,
    });
    expect(statement.ok).toBe(false);
  });
});

describe('FinancialMetric és AnalysisResult', () => {
  const metric = (id: FinancialMetric['id'], value: FinancialMetric['value']): FinancialMetric => ({
    id,
    unit: 'ratio',
    value,
    formula: 'netIncome / revenue',
    period: null,
    inputs: ['netIncome', 'revenue'],
  });

  it('AI-értelmezés nem lehet számszerű mutató forrása', () => {
    const fromAi = metric('netMargin', metricOk(0.2, provenance({ kind: 'ai_interpretation' })));
    expect(createFinancialMetric(fromAi)).toMatchObject({
      ok: false,
      error: { kind: 'VALIDATION' },
    });
    const calculated = metric('netMargin', metricOk(0.2, provenance({ kind: 'calculated' })));
    expect(createFinancialMetric(calculated).ok).toBe(true);
  });

  it('adatteljesség: N/A nem hiány, MISSING igen', () => {
    const result = createAnalysisResult({
      subject: { kind: 'etf', securityId: SECURITY, listingId: LISTING },
      generatedAt: '2026-11-21T12:00:00Z' as IsoTimestamp,
      metrics: [
        metric('netMargin', metricOk(0.2, provenance({ kind: 'calculated' }))),
        metric('pe', metricNotApplicable('ETF-re nem értelmezett')),
        metric('fcf', metricMissing('Nincs CapEx')),
      ],
    });
    expect(result.completeness).toBe('PARTIAL');
    expect(result.dataGaps).toEqual([
      { metricId: 'fcf', status: 'MISSING', reason: 'Nincs CapEx' },
    ]);
  });

  it('ha egyetlen releváns mutató sem OK → INSUFFICIENT; ha mind OK → COMPLETE', () => {
    const subject = { kind: 'portfolio' as const, portfolioId: 'p1' as never };
    const at = '2026-11-21T12:00:00Z' as IsoTimestamp;
    expect(
      createAnalysisResult({
        subject,
        generatedAt: at,
        metrics: [metric('fcf', metricMissing('x'))],
      }).completeness,
    ).toBe('INSUFFICIENT');
    expect(
      createAnalysisResult({
        subject,
        generatedAt: at,
        metrics: [metric('fcf', metricOk(1, provenance({ kind: 'calculated' })))],
      }).completeness,
    ).toBe('COMPLETE');
  });
});

describe('FxRate', () => {
  it('pozitív ráta, eltérő pénznemek', () => {
    const input = {
      base: EUR,
      quote: USD,
      rate: 1.08,
      asOf: '2026-11-20',
      provenance: provenance(),
    };
    expect(createFxRate(input).ok).toBe(true);
    expect(createFxRate({ ...input, rate: 0 }).ok).toBe(false);
    expect(createFxRate({ ...input, quote: EUR }).ok).toBe(false);
  });
});

describe('Portfolio és Transaction', () => {
  const today = '2026-11-21' as IsoDate;
  const buy: TransactionInput = {
    id: 'tx_1',
    portfolioId: 'p1',
    listingId: LISTING,
    type: 'BUY',
    tradeDate: '2026-11-20',
    quantity: 2.5,
    price: 100,
    priceCurrency: USD,
    fees: 0,
    feesCurrency: EUR,
  };

  it('portfólió: név kötelező, max. 80 karakter', () => {
    const input = { id: 'p1', name: 'Fő', baseCurrency: EUR, createdAt: '2026-11-21T12:00:00Z' };
    expect(createPortfolio(input).ok).toBe(true);
    expect(createPortfolio({ ...input, name: 'x'.repeat(81) }).ok).toBe(false);
  });

  it('vétel: tört darab és 0 díj megengedett; a díj pénzneme eltérhet', () => {
    expect(createTransaction(buy, { today })).toMatchObject({
      ok: true,
      value: { type: 'BUY', quantity: 2.5, fees: { amount: 0, currency: 'EUR' }, note: null },
    });
  });

  it('érvénytelen mennyiség, ár és jövőbeli dátum elutasítva, mezőnként', () => {
    const result = createTransaction({ ...buy, quantity: 0, price: -1 }, { today });
    expect(result.ok).toBe(false);
    if (!result.ok && result.error.kind === 'VALIDATION') {
      expect(result.error.issues.map((i) => i.path)).toEqual(['quantity', 'price']);
    }
    expect(createTransaction({ ...buy, tradeDate: '2026-11-22' }, { today })).toMatchObject({
      ok: false,
      error: { issues: [{ path: 'tradeDate' }] },
    });
  });

  it('osztalék, díj és felosztás saját mezőkkel', () => {
    const base = { id: 'tx_2', portfolioId: 'p1', listingId: LISTING, tradeDate: '2026-11-01' };
    expect(
      createTransaction({ ...base, type: 'DIVIDEND', amount: 3.2, currency: USD }, { today }).ok,
    ).toBe(true);
    expect(
      createTransaction({ ...base, type: 'FEE', amount: 0, currency: EUR }, { today }).ok,
    ).toBe(false);
    expect(
      createTransaction({ ...base, type: 'SPLIT', ratioFrom: 1, ratioTo: 4 }, { today }).ok,
    ).toBe(true);
    expect(
      createTransaction({ ...base, type: 'SPLIT', ratioFrom: 2, ratioTo: 2 }, { today }).ok,
    ).toBe(false);
  });
});
