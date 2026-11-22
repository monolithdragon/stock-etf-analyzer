import {
  createFinancialStatement,
  createFinancialStatementSet,
  createFiscalPeriod,
  createListingCandidate,
  parseCurrencyCode,
  parseSecurityId,
  type DataProvenance,
  type IsoTimestamp,
} from '@/domain';

const provenance: DataProvenance = {
  sourceId: 'sec-edgar',
  sourceName: 'SEC',
  kind: 'reported',
  fetchedAt: '2026-11-21T12:00:00Z' as IsoTimestamp,
  asOf: null,
  freshness: 'UNKNOWN',
};

describe('createListingCandidate', () => {
  const valid = {
    isin: 'IE00BK5BQT80',
    symbol: 'VWCE',
    mic: 'XETR',
    exchangeName: 'Xetra',
    tradingCurrency: null,
    figi: 'BBG00PQQJ3N6',
    compositeFigi: 'BBG00PQQJ374',
    kindHint: 'etf' as const,
    sourceName: 'VANG FTSE AW USDA',
  };

  it('listing-azonosítót és ISIN alapú security-azonosítót képez; a pénznem lehet null', () => {
    expect(createListingCandidate(valid)).toMatchObject({
      ok: true,
      value: { listingId: 'VWCE@XETR', securityId: 'IE00BK5BQT80', tradingCurrency: null },
    });
  });

  it('az összes hibás mezőt egyszerre jelzi', () => {
    const r = createListingCandidate({
      ...valid,
      isin: 'IE00BK5BQT81',
      mic: 'XX',
      symbol: 'BAD/X',
    });
    expect(r.ok).toBe(false);
    if (!r.ok && r.error.kind === 'VALIDATION') {
      expect(r.error.issues.map((i) => i.path).sort()).toEqual(['isin', 'mic', 'symbol']);
    }
  });
});

describe('createFinancialStatementSet', () => {
  const sid = parseSecurityId('sec-edgar:0000320193');
  const usd = parseCurrencyCode('USD');
  const fy = createFiscalPeriod({
    fiscalYear: 2025,
    fiscalPeriod: 'FY',
    start: '2024-09-29',
    end: '2025-09-27',
  });
  const q1 = createFiscalPeriod({
    fiscalYear: 2026,
    fiscalPeriod: 'Q1',
    start: '2025-09-28',
    end: '2025-12-27',
  });
  if (!sid.ok || !usd.ok || !fy.ok || !q1.ok) throw new Error('setup');

  const statement = (period: typeof fy.value, source = provenance) => {
    const s = createFinancialStatement({
      statementType: 'income',
      securityId: sid.value,
      period,
      currency: usd.value,
      provenance: source,
      lineItems: {},
    });
    if (!s.ok) throw new Error(s.error.message);
    return s.value;
  };
  const base = {
    securityId: sid.value,
    cik: null,
    entityName: 'Apple Inc.',
    notes: [],
    provenance,
  };

  it('éves készletbe negyedéves kimutatás nem kerülhet', () => {
    expect(
      createFinancialStatementSet({
        ...base,
        frequency: 'annual',
        statements: [statement(q1.value)],
      }).ok,
    ).toBe(false);
    expect(
      createFinancialStatementSet({
        ...base,
        frequency: 'annual',
        statements: [statement(fy.value)],
      }).ok,
    ).toBe(true);
  });

  it('egy készlet csak egy forrásból állhat (nincs csendes keverés)', () => {
    const other = statement(fy.value, { ...provenance, sourceId: 'fmp' });
    expect(
      createFinancialStatementSet({ ...base, frequency: 'annual', statements: [other] }).ok,
    ).toBe(false);
  });
});
