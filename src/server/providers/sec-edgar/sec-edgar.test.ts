/**
 * SEC EDGAR adapter és normalizáló – 12 VALÓS (megvágott) companyfacts fixture-ön (R-05).
 * Rögzítés: `node scripts/record-sec-fixtures.mjs` (2026-11-21).
 */
import { financialStatementSetDtoSchema } from '@/contracts';
import {
  parseCik,
  parseListingId,
  parseSecurityId,
  type FinancialStatement,
  type FinancialStatementSet,
  type IsoTimestamp,
  type ListingId,
  type Metric,
  type StatementFrequency,
} from '@/domain';

import { secCompanyFactsShellSchema } from './sec-dto';
import { createSecEdgarProvider, toSecTicker } from './sec-edgar-provider';
import { normalizeSecCompanyFacts } from './sec-normalizer';
import { createRequestScheduler } from '../../http/request-scheduler';
import { fakeFetch, fixedNow, jsonResponse, loadFixture } from '../../testing/test-helpers';

const TICKERS = [
  'AAPL',
  'MSFT',
  'NVDA',
  'AMZN',
  'GOOGL',
  'JPM',
  'KO',
  'XOM',
  'JNJ',
  'WMT',
  'BRK-B',
  'TSM',
];

function normalize(ticker: string, frequency: StatementFrequency): FinancialStatementSet {
  const shell = secCompanyFactsShellSchema.parse(
    loadFixture('sec-edgar', `companyfacts-${ticker}.json`),
  );
  const cik = parseCik(String(shell.cik).padStart(10, '0'));
  const securityId = parseSecurityId(`sec-edgar:${String(shell.cik).padStart(10, '0')}`);
  if (!cik.ok || !securityId.ok) throw new Error('setup');
  const result = normalizeSecCompanyFacts(shell, {
    frequency,
    cik: cik.value,
    securityId: securityId.value,
    fetchedAt: '2026-11-21T12:00:00Z' as IsoTimestamp,
    sourceUrl: 'https://data.sec.gov/…',
  });
  if (!result.ok) throw new Error(`${ticker}: ${result.error.message}`);
  return result.value;
}

const find = (
  set: FinancialStatementSet,
  type: FinancialStatement['statementType'],
  fiscalYear: number,
  fp = 'FY',
) =>
  set.statements.find(
    (s) =>
      s.statementType === type &&
      s.period.fiscalYear === fiscalYear &&
      s.period.fiscalPeriod === fp,
  );

function item(statement: FinancialStatement | undefined, key: string): Metric<number> | undefined {
  return (statement?.lineItems as Readonly<Record<string, Metric<number>>> | undefined)?.[key];
}
const value = (statement: FinancialStatement | undefined, key: string) => {
  const m = item(statement, key);
  return m?.status === 'OK' ? m.value : m?.status;
};

describe('normalizeSecCompanyFacts – invariánsok mind a 12 cégen', () => {
  it.each(
    TICKERS.flatMap(
      (t) =>
        [
          [t, 'annual'],
          [t, 'quarterly'],
        ] as const,
    ),
  )(
    '%s %s: szerződésnek megfelel, egy forrás, hiány ≠ 0, időszak a dátumokból',
    (ticker, frequency) => {
      const set = normalize(ticker, frequency);

      // 1) A kliens contract-sémája elfogadja (szerver ↔ kliens egyezés).
      expect(
        financialStatementSetDtoSchema.safeParse(JSON.parse(JSON.stringify(set))).success,
      ).toBe(true);

      for (const s of set.statements) {
        // 2) Egy forrás, jelentett adat.
        expect(s.provenance).toMatchObject({ sourceId: 'sec-edgar', kind: 'reported' });
        // 3) Időszak-hossz a D-037 sávban, és a gyakoriságnak megfelelő típus.
        const isAnnual = s.period.fiscalPeriod === 'FY';
        expect(isAnnual).toBe(frequency === 'annual');
        expect(s.period.durationDays).toBeGreaterThanOrEqual(isAnnual ? 350 : 80);
        expect(s.period.durationDays).toBeLessThanOrEqual(isAnnual ? 380 : 100);
        for (const metric of Object.values(
          s.lineItems as Readonly<Record<string, Metric<number>>>,
        )) {
          if (metric.status === 'OK') {
            // 4) Minden érték nyomon követhető: tag + accession.
            expect(metric.provenance.reference).toMatch(/^(us-gaap|ifrs-full|dei):\w+ accn=/);
            // 5) Pénzösszeg csak a kimutatás pénznemében.
            if (metric.provenance.unit === 'money')
              expect(metric.provenance.currency).toBe(s.currency);
          } else {
            // 6) Nem-OK érték mindig indokolt, és nincs mellette szám.
            expect(metric.reason.length).toBeGreaterThan(10);
            expect('value' in metric).toBe(false);
          }
        }
        // 7) Az összetett totalDebt szándékosan MISSING, indoklással (nem 0, nem összeadott).
        if (s.statementType === 'balance') expect(item(s, 'totalDebt')?.status).toBe('MISSING');
      }
    },
  );
});

describe('normalizeSecCompanyFacts – golden értékek (valós SEC-adat)', () => {
  it('AAPL FY2025: szeptemberi év vége, a filing saját fy-ja alapján címkézve', () => {
    const income = find(normalize('AAPL', 'annual'), 'income', 2025);
    expect(income?.period).toMatchObject({
      start: '2024-09-29',
      end: '2025-09-27',
      durationDays: 364,
    });
    expect(value(income, 'revenue')).toBe(416_161_000_000);
    expect(value(income, 'epsDiluted')).toBeCloseTo(7.46, 2);
    // Restatement-szabály: a legkésőbb beadott filing értéke (2026-os 10-K).
    expect(item(income, 'revenue')).toMatchObject({
      provenance: { reference: expect.stringContaining('accn=0000320193-26-000026') },
    });
  });

  it('MSFT: júniusi év vége; a 2026. júl–szept. negyedév FY2027 Q1', () => {
    expect(value(find(normalize('MSFT', 'annual'), 'income', 2026), 'revenue')).toBeCloseTo(
      331.84e9,
      -7,
    );
    const q = find(normalize('MSFT', 'quarterly'), 'income', 2027, 'Q1');
    expect(q?.period).toMatchObject({ start: '2026-07-01', end: '2026-09-30' });
  });

  it('NVDA és WMT: januári év vége → a záró év a pénzügyi év', () => {
    expect(find(normalize('NVDA', 'annual'), 'income', 2026)?.period.end).toBe('2026-01-25');
    expect(find(normalize('WMT', 'annual'), 'income', 2026)?.period.end).toBe('2026-01-31');
  });

  it('WMT / BRK-B: a teljes „Revenues” a prioritás, nem a RevenueFromContract… részösszeg', () => {
    const wmt = find(normalize('WMT', 'annual'), 'income', 2026);
    expect(item(wmt, 'revenue')).toMatchObject({
      provenance: { reference: expect.stringMatching(/^us-gaap:Revenues /) },
    });
    expect(value(wmt, 'revenue')).toBeCloseTo(713.16e9, -7);
  });

  it('TSM (20-F, IFRS): a pénznem TWD (domináns egység), nem a kényelmi USD', () => {
    const income = find(normalize('TSM', 'annual'), 'income', 2024);
    expect(income?.currency).toBe('TWD');
    expect(value(income, 'revenue')).toBe(2_894_307_700_000);
    expect(item(income, 'revenue')).toMatchObject({
      provenance: { reference: expect.stringMatching(/^ifrs-full:Revenue /) },
    });
  });

  it('TSM negyedéves: nincs 10-Q → üres készlet, magyarázattal', () => {
    const set = normalize('TSM', 'quarterly');
    expect(set.statements).toHaveLength(0);
    expect(set.notes.join(' ')).toContain('20-F');
  });

  it('XOM (új CIK, még nincs 10-K): éves készlet üres és megmagyarázott; negyedéves van', () => {
    const annual = normalize('XOM', 'annual');
    expect(annual.statements).toHaveLength(0);
    expect(annual.notes.join(' ')).toContain('Nincs éves');
    expect(
      normalize('XOM', 'quarterly').statements.filter((s) => s.statementType === 'income'),
    ).toHaveLength(2);
  });

  it('hiány ≠ 0: a BRK-B EPS és a JPM negyedéves árbevétele MISSING, nem 0', () => {
    expect(item(find(normalize('BRK-B', 'annual'), 'income', 2025), 'epsDiluted')?.status).toBe(
      'MISSING',
    );
    const jpm = normalize('JPM', 'quarterly').statements.find((s) => s.statementType === 'income');
    expect(item(jpm, 'revenue')).toMatchObject({
      status: 'MISSING',
      reason: expect.stringContaining('Revenues'),
    });
  });

  it('JNJ: a részvényszám a SAJÁT 10-K címlapjáról jön, nem egy későbbi 10-Q-ról (R-16)', () => {
    const balance = find(normalize('JNJ', 'annual'), 'balance', 2025);
    expect(item(balance, 'sharesOutstanding')).toMatchObject({
      status: 'OK',
      provenance: {
        asOf: '2026-02-06',
        reference: expect.stringContaining(
          'dei:EntityCommonStockSharesOutstanding accn=0000200406-26-000016',
        ),
      },
    });
  });

  it('negyedéves: a 6/9 hónapos (YTD) időszakok kiszűrve, a Q2/Q3 CF hiánya megmagyarázva', () => {
    const set = normalize('AAPL', 'quarterly');
    expect(set.statements.every((s) => s.period.durationDays <= 100)).toBe(true);
    expect(set.notes.join(' ')).toContain('YTD');
  });
});

describe('createSecEdgarProvider', () => {
  const tickers = loadFixture('sec-edgar', 'company-tickers.json');
  const aapl = loadFixture('sec-edgar', 'companyfacts-AAPL.json');
  const listing = (id: string): ListingId => {
    const parsed = parseListingId(id);
    if (!parsed.ok) throw new Error(id);
    return parsed.value;
  };

  function provider(
    route: Parameters<typeof fakeFetch>[0],
    userAgent: string | null = 'StockEtfAnalyzer dev@example.com',
  ) {
    const fetchImpl = fakeFetch(route);
    const p = createSecEdgarProvider({
      fetchImpl,
      now: fixedNow,
      userAgent,
      timeoutMs: 50,
      scheduler: createRequestScheduler(0),
    });
    if (p.getFinancialStatements === undefined) throw new Error('nincs képesség');
    return { get: p.getFinancialStatements.bind(p), fetchImpl, info: p.info };
  }

  const router = (url: string) =>
    url.endsWith('company_tickers.json')
      ? jsonResponse(tickers)
      : url.endsWith('CIK0000320193.json')
        ? jsonResponse(aapl)
        : jsonResponse({}, 404);

  it('ticker → CIK → companyfacts, User-Agent fejléccel; a ticker-lista memóban marad', async () => {
    const { get, fetchImpl } = provider(router);
    const first = await get(listing('AAPL@XNAS'), 'annual');
    await get(listing('AAPL@XNAS'), 'quarterly');

    expect(first).toMatchObject({
      ok: true,
      value: { cik: '0000320193', entityName: 'Apple Inc.', frequency: 'annual' },
    });
    expect(fetchImpl.calls.map((c) => c.url)).toEqual([
      'https://www.sec.gov/files/company_tickers.json',
      'https://data.sec.gov/api/xbrl/companyfacts/CIK0000320193.json',
      'https://data.sec.gov/api/xbrl/companyfacts/CIK0000320193.json',
    ]);
    expect((fetchImpl.calls[0]?.init?.headers as Record<string, string>)['User-Agent']).toBe(
      'StockEtfAnalyzer dev@example.com',
    );
  });

  it('BRK.B → a SEC-formátum BRK-B', () => {
    expect(toSecTicker('BRK.B')).toBe('BRK-B');
  });

  it('nem US tőzsde → MISSING_DATA(market), hálózati hívás nélkül', async () => {
    const { get, fetchImpl } = provider(router);
    expect(await get(listing('SAP@XETR'), 'annual')).toMatchObject({
      ok: false,
      error: { kind: 'MISSING_DATA', missing: ['market'] },
    });
    expect(fetchImpl.calls).toHaveLength(0);
  });

  it('ismeretlen ticker → NOT_FOUND', async () => {
    expect(await provider(router).get(listing('NINCSILYEN@XNYS'), 'annual')).toMatchObject({
      ok: false,
      error: { kind: 'NOT_FOUND' },
    });
  });

  it('User-Agent nélkül: „nincs konfigurálva”, hálózati hívás nélkül', async () => {
    const { get, fetchImpl, info } = provider(router, null);
    expect(info.configured).toBe(false);
    expect(await get(listing('AAPL@XNAS'), 'annual')).toMatchObject({
      ok: false,
      error: { kind: 'UPSTREAM', failure: 'NOT_IMPLEMENTED' },
    });
    expect(fetchImpl.calls).toHaveLength(0);
  });

  it('HTTP 403 → érthető hiba a User-Agentről; hibás JSON-szerkezet → INVALID_RESPONSE', async () => {
    const forbidden = await provider(() => jsonResponse({}, 403)).get(
      listing('AAPL@XNAS'),
      'annual',
    );
    expect(!forbidden.ok && forbidden.error.message).toContain('SEC_USER_AGENT');
    const broken = await provider((url) =>
      url.endsWith('company_tickers.json')
        ? jsonResponse(tickers)
        : jsonResponse({ cik: 'x', facts: [] }),
    ).get(listing('AAPL@XNAS'), 'annual');
    expect(broken).toMatchObject({ ok: false, error: { failure: 'INVALID_RESPONSE' } });
  });

  it('egy tag hibás tényformátuma (pl. val: "abc") → INVALID_RESPONSE, nem csendes 0', async () => {
    const bad = {
      cik: 320193,
      entityName: 'Apple Inc.',
      facts: {
        'us-gaap': {
          Revenues: {
            units: {
              USD: [
                { end: '2025-09-27', val: 'abc', accn: 'a', form: '10-K', filed: '2025-10-31' },
              ],
            },
          },
        },
      },
    };
    const r = await provider((url) =>
      url.endsWith('company_tickers.json') ? jsonResponse(tickers) : jsonResponse(bad),
    ).get(listing('AAPL@XNAS'), 'annual');
    expect(r).toMatchObject({ ok: false, error: { failure: 'INVALID_RESPONSE' } });
  });
});
