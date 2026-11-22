import {
  AppErrors,
  createDividendEvent,
  createDividendHistory,
  createInstrumentProfile,
  createPriceSeries,
  createQuote,
  err,
  metricOk,
  parseListingId,
  type AppError,
  type CurrencyCode,
  type DataProvenance,
  type DividendHistory,
  type FundamentalMetric,
  type InstrumentProfile,
  type ListingId,
  type PriceSeries,
  type Quote,
  type Result,
} from '@/domain';

import { groupByPeriod, type PeriodStatements } from './statement-periods';
import { TEST_FETCHED_AT, fullYear, statementSet, type PeriodSpec } from './testing';
import { FORWARD_EPS_MISSING_REASON, computeValuation, type ValuationInput } from './valuation';

const LISTING: ListingId = (() => {
  const id = parseListingId('TEST@XNYS');
  if (!id.ok) throw new Error('setup');
  return id.value;
})();

const prov = (extra: Partial<DataProvenance> = {}): DataProvenance => ({
  sourceId: 'fmp',
  sourceName: 'Teszt FMP',
  kind: 'reported',
  fetchedAt: TEST_FETCHED_AT,
  asOf: null,
  freshness: 'FRESH',
  ...extra,
});

function unwrap<T>(r: Result<T>): T {
  if (!r.ok) throw new Error(r.error.message);
  return r.value;
}

const quote = (price: number, currency = 'USD'): Result<Quote, AppError> => ({
  ok: true,
  value: unwrap(
    createQuote({
      listingId: LISTING,
      price,
      currency: currency as CurrencyCode,
      asOf: '2026-11-21T10:00:00Z',
      delayMinutes: null,
      provenance: prov(),
    }),
  ),
});

const profile = (beta: number | null): Result<InstrumentProfile, AppError> => ({
  ok: true,
  value: unwrap(
    createInstrumentProfile({
      listingId: LISTING,
      name: 'Teszt',
      kindHint: 'stock',
      isin: null,
      cik: null,
      country: 'US',
      sector: null,
      industry: null,
      exchangeName: null,
      tradingCurrency: 'USD',
      website: null,
      description: null,
      beta,
      provenance: prov(),
    }),
  ),
});

function prices(days: number): Result<PriceSeries, AppError> {
  const end = Date.parse('2026-11-20T00:00:00Z');
  const points = Array.from({ length: days }, (_, i) => ({
    date: new Date(end - (days - 1 - i) * 86_400_000).toISOString().slice(0, 10),
    close: 10 + (i % 7),
  }));
  return {
    ok: true,
    value: unwrap(
      createPriceSeries({
        listingId: LISTING,
        currency: 'USD' as CurrencyCode,
        adjustment: 'SPLIT_DIVIDEND',
        points,
        provenance: prov({ freshness: 'FRESH' }),
      }),
    ),
  };
}

function dividends(amounts: [string, number][]): Result<DividendHistory, AppError> {
  const events = amounts.map(([exDate, amount]) =>
    unwrap(
      createDividendEvent({
        exDate,
        paymentDate: null,
        recordDate: null,
        declarationDate: null,
        amount,
        currency: 'USD' as CurrencyCode,
        splitAdjustedAmount: amount,
        frequency: 'Quarterly',
      }),
    ),
  );
  return {
    ok: true,
    value: unwrap(createDividendHistory({ listingId: LISTING, events, provenance: prov() })),
  };
}

function annual(...periods: PeriodSpec[]): PeriodStatements[] {
  return groupByPeriod(statementSet({ frequency: 'annual', periods }));
}

function run(overrides: Partial<ValuationInput> = {}) {
  const [fy2025, fy2024] = annual(fullYear(2024), fullYear(2025, 1.1));
  const out = computeValuation({
    quote: quote(33),
    profile: profile(1.2),
    prices: prices(365),
    dividends: dividends([
      ['2026-02-10', 0.1],
      ['2026-05-10', 0.1],
      ['2026-08-10', 0.1],
      ['2026-11-10', 0.1],
    ]),
    latestFy: fy2025!,
    previousFy: fy2024!,
    latestBalance: fy2025!,
    calculatedAt: TEST_FETCHED_AT,
    ...overrides,
  });
  const get = (id: string): FundamentalMetric => {
    const m = out.valuation.find((x) => x.id === id);
    if (m === undefined) throw new Error(id);
    return m;
  };
  return { out, get };
}
const v = (m: FundamentalMetric) => (m.value.status === 'OK' ? m.value.value : m.value.status);

describe('computeValuation – definíciók (aktuális ár + legutóbbi FY, D-062)', () => {
  it('piaci érték, EV, P/E, P/S, P/B, P/FCF, FCF-hozam, EV/EBITDA, PEG', () => {
    const { get } = run();
    expect(v(get('marketCap'))).toBe(3300); // 33 × 100
    expect(v(get('enterpriseValue'))).toBe(3300 + 500 - 300);
    expect(v(get('pe'))).toBeCloseTo(33 / 1.65, 12);
    expect(v(get('ps'))).toBeCloseTo(3300 / 1100, 12);
    expect(v(get('pb'))).toBeCloseTo(3300 / 800, 12);
    expect(v(get('pfcf'))).toBeCloseTo(3300 / 220, 9);
    expect(v(get('fcfYield'))).toBeCloseTo(220 / 3300, 12);
    expect(v(get('evToEbitda'))).toBeCloseTo(3500 / 275, 9);
    expect(v(get('peg'))).toBeCloseTo(33 / 1.65 / 10, 9); // EPS-növekedés 10%
    expect(get('pe').notes.join(' ')).toContain('FY2025');
  });

  it('osztalék: TTM 4 × 0,10 = 0,40; hozam = 0,40 / 33', () => {
    const { get } = run();
    expect(v(get('dividendPerShareTtm'))).toBeCloseTo(0.4, 12);
    expect(v(get('dividendYield'))).toBeCloseTo(0.4 / 33, 12);
  });

  it('osztalékesemény nélkül, ismeretlen lefedettséggel → MISSING (a hiány nem 0% hozam)', () => {
    const { get } = run({ dividends: dividends([]) });
    expect(get('dividendPerShareTtm').value.status).toBe('MISSING');
    expect(get('dividendYield').value.status).toBe('MISSING');
  });

  it('negatív EPS → P/E és PEG NOT_MEANINGFUL; a többi szorzó ettől számolható', () => {
    const loss: PeriodSpec = {
      ...fullYear(2025),
      income: { ...fullYear(2025).income, netIncome: -50, epsDiluted: -0.5 },
    };
    const [fy2025, fy2024] = annual(fullYear(2024), loss);
    const { get } = run({ latestFy: fy2025!, previousFy: fy2024!, latestBalance: fy2025! });
    expect(get('pe').value.status).toBe('NOT_MEANINGFUL');
    expect(get('peg').value.status).not.toBe('OK');
    expect(get('ps').value.status).toBe('OK');
  });

  it('eltérő jegyzési és beszámolói pénznem → az ár-alapú szorzók MISSING + figyelmeztetés (KI-50)', () => {
    const { get, out } = run({ quote: quote(33, 'EUR') });
    for (const id of ['pe', 'ps', 'pb', 'pfcf', 'fcfYield', 'evToEbitda', 'peg']) {
      expect([id, get(id).value.status]).toEqual([id, 'MISSING']);
    }
    expect(out.warnings[0]).toContain('FX');
  });

  it('nincs FY (pl. új jogalany) → az eredményalapú szorzók MISSING, a P/B mérlegből számolható', () => {
    const [fy2025] = annual(fullYear(2025));
    const { get } = run({ latestFy: null, previousFy: null, latestBalance: fy2025! });
    expect(get('pe').value.status).toBe('MISSING');
    expect(get('pb').value.status).toBe('OK');
  });
});

describe('computeValuation – áttekintő piaci mutatók', () => {
  it('ár (reported), béta (szolgáltatói, megjegyzéssel), 52 hetes záróár-tartomány (calculated)', () => {
    const { out } = run();
    expect(out.overview.price.origin).toBe('reported');
    expect(v(out.overview.beta)).toBe(1.2);
    expect(out.overview.beta.notes[0]).toContain('PHASE 08');
    expect(v(out.overview.week52High)).toBe(16);
    expect(v(out.overview.week52Low)).toBe(10);
    expect(out.overview.week52Low.origin).toBe('calculated');
    expect(v(out.overview.sharesOutstanding)).toBe(100);
  });

  it('béta nélküli profil → MISSING; profilhiba (csomagkorlát) → UNAVAILABLE', () => {
    expect(run({ profile: profile(null) }).out.overview.beta.value.status).toBe('MISSING');
    const blocked = run({ profile: err(AppErrors.unavailable('PLAN_LIMIT', 'free csomag')) });
    expect(blocked.out.overview.beta.origin).toBe('unavailable');
  });

  it('rövid ártörténet → 52 hetes tartomány INSUFFICIENT_DATA; hálózati hiba → ERROR', () => {
    expect(run({ prices: prices(60) }).out.overview.week52High.value.status).toBe(
      'INSUFFICIENT_DATA',
    );
    const offline = run({ prices: err(AppErrors.network('nincs net')) });
    expect(offline.out.overview.week52Low.value.status).toBe('ERROR');
  });

  it('ár nélkül (kvóta) minden ár-alapú mutató UNAVAILABLE, ok-kóddal', () => {
    const { get, out } = run({
      quote: err(AppErrors.unavailable('QUOTA_EXHAUSTED', 'napi keret')),
    });
    expect(out.overview.price.value).toMatchObject({
      status: 'UNAVAILABLE',
      unavailableReason: 'QUOTA_EXHAUSTED',
    });
    expect(get('marketCap').origin).toBe('unavailable');
    expect(get('dividendYield').value.status).not.toBe('OK');
  });
});

describe('computeValuation – Forward P/E (PHASE 07, D-065)', () => {
  it('forrásolt EPS-előrejelzés nélkül MISSING indokkal – nincs saját becslés', () => {
    const { get } = run();
    const fpe = get('forwardPe');
    expect(fpe.value.status).toBe('MISSING');
    expect(fpe.value.status !== 'OK' && fpe.value.reason).toContain(FORWARD_EPS_MISSING_REASON);
  });

  it('ha a forward EPS ténylegesen elérhető (forrásolt), P/E = ár / forward EPS', () => {
    const forwardEps = metricOk(2.2, {
      ...prov({ sourceId: 'estimates-test', sourceName: 'Teszt konszenzus' }),
      unit: 'money_per_share',
      currency: 'USD' as CurrencyCode,
    });
    const { get } = run({ forwardEps });
    expect(v(get('forwardPe'))).toBeCloseTo(33 / 2.2, 12);
    expect(get('forwardPe').formula).toContain('forwardEps');
  });

  it('negatív forward EPS → NOT_MEANINGFUL', () => {
    const forwardEps = metricOk(-1, {
      ...prov(),
      unit: 'money_per_share',
      currency: 'USD' as CurrencyCode,
    });
    expect(run({ forwardEps }).get('forwardPe').value.status).toBe('NOT_MEANINGFUL');
  });
});
