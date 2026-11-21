import {
  AppErrors,
  addMoney,
  andThen,
  assessFreshness,
  createFiscalPeriod,
  createMoney,
  err,
  inclusiveDaysBetween,
  isMetricOk,
  isRetryable,
  mapMetric,
  mapResult,
  metricMissing,
  metricOk,
  metricUnavailable,
  ok,
  parseCurrencyCode,
  parseIsoDate,
  parseIsoTimestamp,
  parseIsin,
  parseListingId,
  parseSecurityId,
  splitListingId,
  toLocalIsoDate,
  validateFields,
  type AppError,
  type CurrencyCode,
  type DataProvenance,
  type IsoDate,
  type IsoTimestamp,
} from '@/domain';

const USD = 'USD' as CurrencyCode;
const EUR = 'EUR' as CurrencyCode;
const PROVENANCE: DataProvenance = {
  sourceId: 'test',
  sourceName: 'Teszt',
  kind: 'mock',
  fetchedAt: '2026-11-21T12:00:00Z' as IsoTimestamp,
  asOf: null,
  freshness: 'UNKNOWN',
};

describe('Result', () => {
  it('mapResult és andThen csak siker esetén fut, a hibát változatlanul továbbadja', () => {
    expect(mapResult(ok(2), (n) => n * 3)).toEqual(ok(6));
    const failure = err(AppErrors.network('nincs hálózat'));
    expect(mapResult(failure, (n: number) => n * 3)).toBe(failure);
    expect(andThen(ok(2), (n) => (n > 1 ? ok(n) : err(AppErrors.calculationInvalid('x'))))).toEqual(
      ok(2),
    );
  });
});

describe('AppError', () => {
  it('megkülönbözteti az újrapróbálható (átmeneti) hibákat', () => {
    const retryable: AppError[] = [
      AppErrors.network('x'),
      AppErrors.timeout('x', 5000),
      AppErrors.rateLimited('x', 60),
      AppErrors.upstream('HTTP_ERROR', 'x'),
    ];
    const permanent: AppError[] = [
      AppErrors.validation('x'),
      AppErrors.notFound('portfólió', 'p1'),
      AppErrors.missingData(['revenue']),
      AppErrors.calculationInvalid('r ≤ g'),
      AppErrors.storage('x'),
      AppErrors.upstream('CONTRACT_MISMATCH', 'x'),
      AppErrors.upstream('NOT_IMPLEMENTED', 'x'),
    ];
    expect(retryable.map(isRetryable)).toEqual(retryable.map(() => true));
    expect(permanent.map(isRetryable)).toEqual(permanent.map(() => false));
  });

  it('a rate limit megőrzi az újrapróbálási időt, a hiányzó adat a mezőket', () => {
    expect(AppErrors.rateLimited('limit', 30)).toMatchObject({
      kind: 'RATE_LIMITED',
      retryAfterSec: 30,
    });
    expect(AppErrors.missingData(['revenue', 'netIncome'])).toMatchObject({
      kind: 'MISSING_DATA',
      missing: ['revenue', 'netIncome'],
    });
  });
});

describe('validateFields', () => {
  it('az összes hibás mezőt egyszerre, útvonallal adja vissza', () => {
    const result = validateFields({
      isin: parseIsin('XX123'),
      currency: parseCurrencyCode('dollar'),
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe('VALIDATION');
    if (result.error.kind !== 'VALIDATION') return;
    expect(result.error.issues.map((i) => i.path)).toEqual(['isin', 'currency']);
  });

  it('siker esetén a parse-olt (normalizált) értékeket adja', () => {
    expect(validateFields({ ccy: parseCurrencyCode(' usd ') })).toEqual(ok({ ccy: 'USD' }));
  });
});

describe('azonosítók', () => {
  it.each(['US0378331005', 'AU0000XVGZA3', 'us0378331005'])('érvényes ISIN: %s', (isin) => {
    expect(parseIsin(isin).ok).toBe(true);
  });

  it.each(['US0378331006', 'US037833100', '120378331005', ''])('érvénytelen ISIN: "%s"', (isin) => {
    expect(parseIsin(isin).ok).toBe(false);
  });

  it('listing-azonosító: TICKER@MIC, normalizálva és szétbontható', () => {
    const result = parseListingId(' vwce@xetr ');
    expect(result).toEqual(ok('VWCE@XETR'));
    if (result.ok) expect(splitListingId(result.value)).toEqual({ symbol: 'VWCE', mic: 'XETR' });
    expect(parseListingId('AAPL').ok).toBe(false);
    expect(parseListingId('AAPL@XNAS@X').ok).toBe(false);
    expect(parseListingId('AAPL@XN').ok).toBe(false);
  });

  it('security-azonosító: ISIN vagy forrás:kód', () => {
    expect(parseSecurityId('US0378331005').ok).toBe(true);
    expect(parseSecurityId('sec-edgar:0000320193').ok).toBe(true);
    expect(parseSecurityId('AAPL').ok).toBe(false);
  });
});

describe('dátumok', () => {
  it('csak létező naptári napot fogad el', () => {
    expect(parseIsoDate('2024-02-29').ok).toBe(true);
    expect(parseIsoDate('2026-02-29').ok).toBe(false);
    expect(parseIsoDate('2026-13-01').ok).toBe(false);
    expect(parseIsoDate('21.11.2026').ok).toBe(false);
  });

  it('az időbélyegnek UTC (Z) alakúnak kell lennie', () => {
    expect(parseIsoTimestamp('2026-11-21T15:04:05Z').ok).toBe(true);
    expect(parseIsoTimestamp('2026-11-21T15:04:05.123Z').ok).toBe(true);
    expect(parseIsoTimestamp('2026-11-21T15:04:05+01:00').ok).toBe(false);
    expect(parseIsoTimestamp('2026-11-21').ok).toBe(false);
  });

  it('a helyi „ma” a készülék naptári napja (időzónától függetlenül tesztelve)', () => {
    expect(toLocalIsoDate(new Date(2026, 10, 21, 0, 30))).toBe('2026-11-21');
  });

  it('a napok számába mindkét végpont beletartozik', () => {
    expect(inclusiveDaysBetween('2026-01-01' as IsoDate, '2026-12-31' as IsoDate)).toBe(365);
    expect(inclusiveDaysBetween('2026-01-01' as IsoDate, '2026-01-01' as IsoDate)).toBe(1);
  });
});

describe('Money', () => {
  it('eltérő pénznemet nem ad össze (nincs csendes konverzió)', () => {
    const a = createMoney(10, USD);
    const b = createMoney(5, EUR);
    if (!a.ok || !b.ok) throw new Error('setup');
    expect(addMoney(a.value, a.value)).toEqual(ok({ amount: 20, currency: USD }));
    expect(addMoney(a.value, b.value)).toMatchObject({
      ok: false,
      error: { kind: 'CALCULATION_INVALID' },
    });
  });

  it('NaN/Infinity összeg nem hozható létre', () => {
    expect(createMoney(Number.NaN, USD).ok).toBe(false);
    expect(createMoney(Number.POSITIVE_INFINITY, USD).ok).toBe(false);
  });
});

describe('FiscalPeriod', () => {
  it('éves és negyedéves időszakot a hossz alapján ellenőriz', () => {
    expect(
      createFiscalPeriod({
        fiscalYear: 2025,
        fiscalPeriod: 'FY',
        start: '2025-01-01',
        end: '2025-12-31',
      }),
    ).toMatchObject({ ok: true, value: { durationDays: 365 } });
    expect(
      createFiscalPeriod({
        fiscalYear: 2025,
        fiscalPeriod: 'Q1',
        start: '2025-01-01',
        end: '2025-12-31',
      }).ok,
    ).toBe(false);
  });

  it('elfogadja a 14 hetes (98 napos) negyedévet (53 hetes üzleti év, D-037)', () => {
    expect(
      createFiscalPeriod({
        fiscalYear: 2023,
        fiscalPeriod: 'Q1',
        start: '2022-09-25',
        end: '2022-12-31',
      }),
    ).toMatchObject({ ok: true, value: { durationDays: 98 } });
  });

  it('fordított dátumokat elutasít', () => {
    expect(
      createFiscalPeriod({
        fiscalYear: 2025,
        fiscalPeriod: 'FY',
        start: '2025-12-31',
        end: '2025-01-01',
      }).ok,
    ).toBe(false);
  });
});

describe('Freshness', () => {
  const policy = { freshForMs: 15 * 60_000, expiresAfterMs: 24 * 3_600_000 };
  const now = new Date('2026-11-21T12:00:00Z');

  it.each([
    ['2026-11-21T11:50:00Z', 'FRESH'],
    ['2026-11-21T10:00:00Z', 'STALE'],
    ['2026-11-19T12:00:00Z', 'EXPIRED'],
    ['2026-11-21T12:30:00Z', 'UNKNOWN'], // jövőbeli időpont gyanús
  ] as const)('%s → %s', (asOf, expected) => {
    expect(assessFreshness(asOf as IsoTimestamp, now, policy)).toBe(expected);
  });

  it('időpont nélkül UNKNOWN', () => {
    expect(assessFreshness(null, now, policy)).toBe('UNKNOWN');
  });
});

describe('Metric', () => {
  it('a hiányzó érték nem 0: nincs value mező, van indok', () => {
    const missing = metricMissing<number>('A forrás nem adta meg.');
    expect(missing).toEqual({ status: 'MISSING', reason: 'A forrás nem adta meg.' });
    expect('value' in missing).toBe(false);
    expect(isMetricOk(missing)).toBe(false);
  });

  it('a 0 csak OK státusszal létezik, és érvényes érték', () => {
    const zero = metricOk(0, PROVENANCE);
    expect(zero).toEqual({ status: 'OK', value: 0, provenance: PROVENANCE });
  });

  it('NaN és Infinity soha nem lehet OK → INVALID_INPUT', () => {
    expect(metricOk(Number.NaN, PROVENANCE).status).toBe('INVALID_INPUT');
    expect(metricOk(Number.NEGATIVE_INFINITY, PROVENANCE).status).toBe('INVALID_INPUT');
  });

  it('mapMetric csak OK-nál alakít, a nem-OK indokot megtartja', () => {
    expect(mapMetric(metricOk(0.15, PROVENANCE), (v) => v * 100)).toMatchObject({ value: 15 });
    const unavailable = metricUnavailable<number>('PLAN_LIMIT', 'Csak fizetős csomagban.');
    expect(mapMetric(unavailable, (v) => v * 100)).toBe(unavailable);
  });
});
