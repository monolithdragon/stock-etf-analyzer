/**
 * PHASE 15 – az alap üzleti folyamatok végponttól végpontig, EGY láncban, élő adatmódban:
 *
 *   createAppServices (live) → eszköz-cache → proxy gateway → VALÓDI HTTP-kliens (timeout,
 *   JSON, contract-séma) → [fetch-híd] → VALÓDI szerver-handlerek → mock szolgáltató / mock AI
 *
 * Folyamatok (PHASE 15 prompt 3. pont):
 *   1. részvény: keresés → adatlekérés/validálás → mutatók → score/döntés → magyarázat (template +
 *      LLM a proxyn át);
 *   2. ETF: ugyanez ETF-re (DCF és P/E nélkül);
 *   3. portfólió: pozíció hozzáadása → értékelés → kitettség → magyarázat (beleegyezéssel).
 *
 * Plusz hibautak ugyanezen a láncon: rate limit, nem-JSON hosztválasz, időtúllépés, offline.
 * Valódi szolgáltatót és valódi LLM-et NEM hív (a mock provider demóadata `kind: 'mock'`).
 */
import { buildInstrumentAiInput, buildPortfolioAiInput } from '@/application';
import { createAppServices } from '@/config/container';
import { parseCurrencyCode, parseListingId, type Result } from '@/domain';
import { createMockAiProvider } from '@/server/ai/mock-ai-provider';
import type { ServerLogEntry } from '@/server/logging';
import { createServerContext, type ServerContext } from '@/server/server-context';
import { fakeFetch } from '@/server/testing/test-helpers';

function must<T>(result: Result<T>): T {
  if (!result.ok) throw new Error(`${result.error.kind}: ${result.error.message}`);
  return result.value;
}

const BASE = 'http://proxy.test';
const clock = { now: () => new Date('2026-11-24T10:00:00Z') };

function route(server: ServerContext, input: string, init?: RequestInit): Promise<Response> {
  const { handlers } = server;
  const url = new URL(input);
  const path = url.pathname;
  const request = new Request(url.toString(), init);
  let m: RegExpMatchArray | null;
  if (path === '/api/v1/ai/explain') return server.ai.explain(request);
  if (path === '/api/v1/fx') return handlers.fx(request);
  if (path === '/api/v1/search') return handlers.search(request);
  if ((m = path.match(/^\/api\/v1\/stocks\/([^/]+)\/financials$/))) {
    return handlers.financials(request, { id: decodeURIComponent(m[1] ?? '') });
  }
  if ((m = path.match(/^\/api\/v1\/instruments\/([^/]+)\/(quote|prices|profile|dividends)$/))) {
    const endpoint = m[2] as 'quote' | 'prices' | 'profile' | 'dividends';
    return handlers[endpoint](request, { id: decodeURIComponent(m[1] ?? '') });
  }
  return Promise.resolve(new Response('Not found', { status: 404 }));
}

type Interceptor = (path: string) => Response | 'offline' | null;

/** Élő módú app a valódi proxyhoz kötve; az `intercept` hibát szimulálhat egy útvonalon. */
function liveApp(intercept: Interceptor = () => null) {
  const logs: ServerLogEntry[] = [];
  const server = createServerContext({
    rawEnv: { PROXY_DATA_MODE: 'mock', AI_PROVIDER: 'mock', AI_ENABLED: 'true' },
    aiProvider: createMockAiProvider(),
    fetchImpl: fakeFetch(() => new Response('{}', { status: 404 })),
    now: clock.now,
    logger: { info: (entry) => logs.push(entry) },
  });
  const paths: string[] = [];
  const urls: string[] = [];
  const fetchImpl = (input: string, init?: RequestInit): Promise<Response> => {
    const path = new URL(input).pathname;
    paths.push(path);
    urls.push(input);
    const intercepted = intercept(path);
    if (intercepted === 'offline') {
      return Promise.reject(new TypeError('Network request failed'));
    }
    if (intercepted !== null) return Promise.resolve(intercepted);
    return route(server, input, init);
  };
  const services = createAppServices({ dataMode: 'live', apiBaseUrl: BASE }, { clock, fetchImpl });
  return { services, paths, urls, logs };
}

describe('E2E 1 – részvény: keresés → adat → mutatók → score/döntés → magyarázat', () => {
  it('a teljes lánc élő módban, a valódi proxy-szerződésen át', async () => {
    const { services, paths, logs } = liveApp();

    // 1. Keresés (a proxy validálja a lekérdezést, a kliens a választ).
    const search = must(await services.searchInstruments('demo'));
    const hit = search.hits.find((h) => h.kindHint === 'stock');
    expect(hit).toBeDefined();
    if (hit === undefined) return;

    // 2–4. Adatlekérés + validálás → mutatók → score/döntés.
    const result = must(await services.evaluateStock(hit.listingId));
    const id = encodeURIComponent(hit.listingId);
    expect(paths).toEqual(
      expect.arrayContaining([
        '/api/v1/search',
        `/api/v1/stocks/${id}/financials`,
        `/api/v1/instruments/${id}/quote`,
        `/api/v1/instruments/${id}/prices`,
      ]),
    );
    // A forrás jelölt: demóadat (mock), nem valós szolgáltatói adat.
    expect(result.fundamentals.overview.name).toBeTruthy();
    expect(result.evaluation.listingId).toBe(hit.listingId);
    expect(result.evaluation.subjectKind).toBe('stock');
    expect(result.evaluation.decision.label).toBeTruthy();
    // A score a determinisztikus motoré; az AI nem írja felül (lásd lent).
    const label = result.evaluation.decision.labelText;

    // 5. Magyarázat: a szabályalapú mindig, az LLM a proxyn át.
    const input = must(
      buildInstrumentAiInput(result.evaluation, {
        valuation: result.valuation,
        displayName: result.fundamentals.overview.name,
      }),
    );
    expect(input.kind).toBe('stock');
    expect(input.evaluation?.decision.labelText).toBe(label);

    const template = must(await services.explainAnalysis({ input, mode: 'template' }));
    expect(template.llm.status).toBe('not_requested');
    expect(template.display.meta.provenanceKind).toBe('calculated');

    const llm = must(await services.explainAnalysis({ input, mode: 'llm' }));
    expect(llm.llm.status).toBe('ok');
    expect(llm.display.meta.provenanceKind).toBe('mock');
    expect(paths).toContain('/api/v1/ai/explain');

    // A proxy naplója csak útvonalat/státuszt tartalmaz, adatot nem.
    expect(logs.length).toBeGreaterThan(0);
    expect(logs.every((l) => !l.route.includes('?'))).toBe(true);
    expect(JSON.stringify(logs)).not.toMatch(/Demo Corp|labelText|sk-ant/);
  });
});

describe('E2E 2 – ETF: keresés → adat → ETF-mutatók → score/döntés → magyarázat', () => {
  it('a teljes lánc élő módban; DCF nincs az ETF-nél', async () => {
    const { services } = liveApp();
    const search = must(await services.searchInstruments('demoetf'));
    const hit = search.hits.find((h) => h.kindHint === 'etf');
    expect(hit).toBeDefined();
    if (hit === undefined) return;

    const result = must(await services.evaluateEtf(hit.listingId));
    expect(result.evaluation.subjectKind).toBe('etf');
    expect(result.evaluation.decision.label).toBeTruthy();

    const input = must(buildInstrumentAiInput(result.evaluation, { displayName: hit.name }));
    expect(input.kind).toBe('etf');
    expect(input.dcf).toBeNull();

    const llm = must(await services.explainAnalysis({ input, mode: 'llm' }));
    expect(llm.llm.status).toBe('ok');
    expect(llm.display.meta.provenanceKind).toBe('mock');
  });
});

describe('E2E 3 – portfólió: pozíció hozzáadása → értékelés → kitettség → magyarázat', () => {
  it('két pozíció (USD részvény, EUR ETF) EUR bázisdevizával, FX a proxyn át', async () => {
    const { services, paths } = liveApp();
    const EUR = must(parseCurrencyCode('EUR'));
    const USD = must(parseCurrencyCode('USD'));
    must(await services.createPortfolio({ id: 'main', name: 'Fő', baseCurrency: EUR }));
    must(
      await services.recordTransaction({
        portfolioId: 'main',
        listingId: must(parseListingId('DEMO@XNAS')),
        type: 'BUY',
        tradeDate: '2026-11-20',
        quantity: 2,
        price: 90,
        priceCurrency: USD,
        fees: 1,
        feesCurrency: USD,
      }),
    );
    must(
      await services.recordTransaction({
        portfolioId: 'main',
        listingId: must(parseListingId('DEMOETF@XETR')),
        type: 'BUY',
        tradeDate: '2026-11-20',
        quantity: 4,
        price: 48,
        priceCurrency: EUR,
        fees: 0,
        feesCurrency: EUR,
      }),
    );

    const analysis = must(await services.analyzePortfolio('main'));
    expect(analysis.positions.map((p) => p.listingId).sort()).toEqual([
      'DEMO@XNAS',
      'DEMOETF@XETR',
    ]);
    // FX: a USD pozíció EUR-ra váltásához a proxy FX-végpontja kellett, a ráta forrással rögzítve.
    expect(paths).toContain('/api/v1/fx');
    expect(analysis.fxRatesUsed.length).toBeGreaterThan(0);
    // Kitettség: legalább egy dimenzió, a súlyok nem 0-ként kezelt hiánnyal.
    expect(analysis.exposures.length).toBeGreaterThan(0);
    expect(analysis.concentration).toBeDefined();

    const input = must(buildPortfolioAiInput(analysis));
    expect(input.kind).toBe('portfolio');
    // Pénzösszeg nem kerül az AI-bemenetbe (adattakarékosság).
    expect(JSON.stringify(input)).not.toMatch(/"amount"/);

    // Beleegyezés nélkül az LLM nem hívható portfólióra.
    const noConsent = await services.explainAnalysis({ input, mode: 'llm' });
    const blocked = noConsent.ok ? noConsent.value.llm.status : 'error';
    expect(blocked).not.toBe('ok');
    const withConsent = must(
      await services.explainAnalysis({
        input,
        mode: 'llm',
        consent: { shareWithAiProvider: true },
      }),
    );
    expect(withConsent.llm.status).toBe('ok');
  });
});

describe('E2E teljesítmény: nincs fölösleges lekérés', () => {
  it('egy részvényértékelés egyetlen URL-t sem kér le kétszer; ismételt értékelés TTL-en belül 0 hívás', async () => {
    const { services, urls } = liveApp();
    must(await services.evaluateStock('DEMO@XNAS'));
    expect(new Set(urls).size).toBe(urls.length);
    // A kimutatás két külön kérés: éves és negyedéves (nem duplikátum).
    const financials = urls.filter((u) => u.includes('/financials'));
    expect(financials.map((u) => new URL(u).searchParams.get('period')).sort()).toEqual([
      'annual',
      'quarterly',
    ]);
    const first = urls.length;
    must(await services.evaluateStock('DEMO@XNAS'));
    expect(urls.length).toBe(first);
  });
});

describe('E2E hibautak ugyanazon a láncon', () => {
  it('rate limit (hoszt: nem-JSON 429) → RATE_LIMITED a Retry-After értékkel', async () => {
    const { services } = liveApp((path) =>
      path.endsWith('/quote')
        ? new Response('Too Many Requests', { status: 429, headers: { 'Retry-After': '30' } })
        : null,
    );
    const quote = await services.getListingQuote('DEMO@XNAS');
    expect(quote.ok).toBe(false);
    if (quote.ok) return;
    expect(quote.error).toMatchObject({ kind: 'RATE_LIMITED', retryAfterSec: 30 });
  });

  it('a hoszt HTML-hibalapja (502) → UPSTREAM HTTP_ERROR, nem „szerződéssértés”', async () => {
    const { services } = liveApp((path) =>
      path.endsWith('/quote') ? new Response('<html>Bad gateway</html>', { status: 502 }) : null,
    );
    const quote = await services.getListingQuote('DEMO@XNAS');
    expect(!quote.ok && quote.error).toMatchObject({ kind: 'UPSTREAM', failure: 'HTTP_ERROR' });
  });

  it('érvénytelen JSON 200-zal → CONTRACT_MISMATCH (nem csendes üres adat)', async () => {
    const { services } = liveApp((path) =>
      path.endsWith('/quote') ? new Response('{"apiVersion":', { status: 200 }) : null,
    );
    const quote = await services.getListingQuote('DEMO@XNAS');
    expect(!quote.ok && quote.error).toMatchObject({
      kind: 'UPSTREAM',
      failure: 'CONTRACT_MISMATCH',
    });
  });

  it('offline, üres cache → „Nem értékelhető”, a hiány okkal jelölt, nincs kitalált érték', async () => {
    const { services } = liveApp(() => 'offline');
    const quote = await services.getListingQuote('DEMO@XNAS');
    expect(!quote.ok && quote.error.kind).toBe('NETWORK');

    // Az értékelés részleges eredményt ad (D-061: a hiány nem 0), nem hibát és nem demóadatot.
    const result = must(await services.evaluateStock('DEMO@XNAS'));
    expect(result.evaluation.decision.label).toBe('NOT_RATED');
    expect(result.evaluation.confidence.level).toBe('INSUFFICIENT');
    const price = result.fundamentals.overview.price.value;
    expect(price.status).toBe('ERROR');
    expect(price.status !== 'OK' && price.reason).toMatch(/Nincs kapcsolat/);
    expect(result.fundamentals.overview.name).toBeNull();
  });

  it('az AI-végpont kiesése után is van megjeleníthető (szabályalapú) magyarázat', async () => {
    const { services } = liveApp((path) => (path === '/api/v1/ai/explain' ? 'offline' : null));
    const result = must(await services.evaluateStock('DEMO@XNAS'));
    const input = must(buildInstrumentAiInput(result.evaluation, { valuation: result.valuation }));
    const outcome = must(await services.explainAnalysis({ input, mode: 'llm' }));
    expect(outcome.llm.status).toBe('failed');
    expect(outcome.display).toBe(outcome.template);
  });
});
