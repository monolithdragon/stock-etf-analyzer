/**
 * PHASE 11 – végponttól végpontig, hálózat és élő LLM nélkül:
 *   valós fixture → elemzés → AiInputDto → explainAnalysis (kliens) → proxy AI-gateway
 *   → [hamis fetch] → VALÓDI `POST /api/v1/ai/explain` handler → AiExplainService → mock provider
 *
 * Plusz: a handler bemeneti validációja (méret, JSON, strict séma, beleegyezés), a HTTP-hibakódok
 * leképezése mindkét irányban, a napló adatmentessége és az env-alapú kill switch.
 */
import {
  buildInstrumentAiInput,
  buildStockEvaluation,
  createRecalculateStockValuation,
  type AiGateway,
} from '@/application';
import { createAppServices } from '@/config/container';
import { PORTFOLIO_DTO, STOCK_DTO, validStockContent } from '@/contracts/ai-testing';
import { AppErrors, err, ok } from '@/domain';
import { parseAiConfig } from '@/server/ai/ai-config';
import type { AiProvider } from '@/server/ai/ai-provider';
import { createMockAiProvider, type MockAiScript } from '@/server/ai/mock-ai-provider';
import type { ServerLogEntry } from '@/server/logging';
import { createServerContext } from '@/server/server-context';
import { fakeFetch } from '@/server/testing/test-helpers';
import { analyze, clock } from '@/testing/stock-analysis-fixtures';

const BASE = 'http://proxy.test';

function serverWith(provider: AiProvider | null, env: Record<string, string> = {}) {
  const logs: ServerLogEntry[] = [];
  const server = createServerContext({
    rawEnv: { PROXY_DATA_MODE: 'mock', AI_PROVIDER: 'mock', AI_ENABLED: 'true', ...env },
    fetchImpl: fakeFetch(() => new Response('{}', { status: 404 })),
    now: clock.now,
    logger: { info: (entry) => logs.push(entry) },
    aiProvider: provider,
  });
  return { server, logs };
}

const post = (body: string, method = 'POST') =>
  new Request(`${BASE}/api/v1/ai/explain`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    ...(method === 'POST' ? { body } : {}),
  });

async function errorCode(response: Response) {
  return ((await response.json()) as { error: { code: string } }).error.code;
}

describe('POST /api/v1/ai/explain – handler', () => {
  it('érvényes kérés → 200, a válasz a közös sémán átment', async () => {
    const { server } = serverWith(createMockAiProvider());
    const response = await server.ai.explain(
      post(JSON.stringify({ input: STOCK_DTO, consent: null })),
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as { data: { meta: { provider: string } } };
    expect(body.data.meta.provider).toBe('mock');
  });

  it.each([
    ['nem POST', post('', 'GET'), 405],
    ['nem JSON', post('{nem json'), 400],
    [
      'ismeretlen mező',
      post(JSON.stringify({ input: STOCK_DTO, consent: null, prompt: 'x' })),
      400,
    ],
    [
      'ismeretlen mező a DTO-ban',
      post(JSON.stringify({ input: { ...STOCK_DTO, rawFiling: 'x' }, consent: null })),
      400,
    ],
    [
      'portfólió beleegyezés nélkül',
      post(JSON.stringify({ input: PORTFOLIO_DTO, consent: null })),
      400,
    ],
    [
      'túl nagy kérés',
      post(JSON.stringify({ input: STOCK_DTO, consent: null, pad: 'x'.repeat(100_000) })),
      413,
    ],
  ])('%s → %s', async (_case, request, status) => {
    const provider = createMockAiProvider();
    const { server } = serverWith(provider);
    const response = await server.ai.explain(request);
    expect(response.status).toBe(status);
    expect(await errorCode(response)).toBe('VALIDATION_FAILED');
    expect(provider.calls).toHaveLength(0);
  });

  it.each<[string, MockAiScript, number, string]>([
    [
      'hibás JSON',
      () => ok({ rawText: '{', model: 'm', stopReason: 'end_turn', usage: null }),
      502,
      'AI_INVALID_OUTPUT',
    ],
    [
      'refusal',
      () => ok({ rawText: '', model: 'm', stopReason: 'refusal', usage: null }),
      422,
      'AI_REFUSED',
    ],
    ['rate limit', () => err(AppErrors.ai('AI_RATE_LIMITED', '429')), 429, 'RATE_LIMITED'],
    ['timeout', () => err(AppErrors.ai('AI_TIMEOUT', 'lassú')), 504, 'TIMEOUT'],
    [
      'szolgáltatói hiba',
      () => err(AppErrors.upstream('HTTP_ERROR', 'x', 'anthropic')),
      502,
      'UPSTREAM_ERROR',
    ],
  ])('%s → HTTP %s %s', async (_case, script, status, code) => {
    const { server } = serverWith(createMockAiProvider({ script }));
    const response = await server.ai.explain(
      post(JSON.stringify({ input: STOCK_DTO, consent: null })),
    );
    expect(response.status).toBe(status);
    expect(await errorCode(response)).toBe(code);
  });

  it('kill switch (AI_ENABLED=false) → 503 AI_DISABLED', async () => {
    const { server } = serverWith(null, { AI_ENABLED: 'false' });
    const response = await server.ai.explain(
      post(JSON.stringify({ input: STOCK_DTO, consent: null })),
    );
    expect(response.status).toBe(503);
    expect(await errorCode(response)).toBe('AI_DISABLED');
  });

  it('a napló nem tartalmaz bemenetet vagy választ (portfólió, kulcs)', async () => {
    const { server, logs } = serverWith(createMockAiProvider(), {
      ANTHROPIC_API_KEY: 'sk-ant-titok',
    });
    await server.ai.explain(
      post(JSON.stringify({ input: PORTFOLIO_DTO, consent: { shareWithAiProvider: true } })),
    );
    const serialized = JSON.stringify(logs);
    expect(logs).toHaveLength(1);
    expect(serialized).not.toMatch(/AAPL|VWCE|60,0%|sk-ant|portfolio:/);
    expect(logs[0]).toMatchObject({ route: '/api/v1/ai/explain', status: 200, provider: 'mock' });
  });
});

describe('AI-konfiguráció (env)', () => {
  it('alapállapot: template, LLM kikapcsolva (D-026)', () => {
    expect(parseAiConfig({}).config).toMatchObject({
      provider: 'template',
      enabled: false,
      model: 'claude-opus-5-5',
      effort: 'low',
    });
  });

  it('anthropic kulcs nélkül → kikapcsolva + figyelmeztetés (a kulcs értéke nincs az üzenetben)', () => {
    const { config, issues } = parseAiConfig({ AI_PROVIDER: 'anthropic', AI_ENABLED: 'true' });
    expect(config.enabled).toBe(false);
    expect(issues.map((i) => i.variable)).toContain('ANTHROPIC_API_KEY');
  });

  it('érvénytelen értékek → alapérték + figyelmeztetés', () => {
    const { config, issues } = parseAiConfig({
      AI_PROVIDER: 'openai',
      AI_ENABLED: 'yes',
      AI_MODEL: 'Rossz Modell!',
      AI_EFFORT: 'max',
      AI_MAX_OUTPUT_TOKENS: '999999',
      AI_DAILY_LIMIT: '-1',
      AI_TIMEOUT_MS: 'abc',
    });
    expect(config).toMatchObject({
      provider: 'template',
      enabled: false,
      effort: 'low',
      maxOutputTokens: 8000,
      dailyLimit: 50,
      timeoutMs: 60000,
    });
    expect(issues).toHaveLength(7);
    const withKey = parseAiConfig({
      AI_PROVIDER: 'anthropic',
      AI_ENABLED: 'true',
      ANTHROPIC_API_KEY: 'sk-ant-titok',
      AI_MODEL: 'x y',
    });
    expect(JSON.stringify(withKey.issues)).not.toContain('sk-ant-titok');
    expect(withKey.config).toMatchObject({ enabled: true, model: 'claude-opus-5-5' });
  });
});

describe('kliens ↔ proxy végponttól végpontig', () => {
  function clientFor(provider: AiProvider | null, env: Record<string, string> = {}) {
    const { server } = serverWith(provider, env);
    const fetchImpl = async (input: string, init?: RequestInit) => {
      const url = new URL(input);
      if (url.pathname === '/api/v1/ai/explain') {
        return server.ai.explain(new Request(url.toString(), init));
      }
      return new Response('Not found', { status: 404 });
    };
    return createAppServices({ dataMode: 'live', apiBaseUrl: BASE }, { clock, fetchImpl });
  }

  async function aaplInput() {
    const fundamentals = await analyze('AAPL', true);
    const valuation = createRecalculateStockValuation({ clock })(fundamentals);
    const evaluation = buildStockEvaluation(fundamentals, valuation);
    if (!evaluation.ok) throw new Error(evaluation.error.message);
    const input = buildInstrumentAiInput(evaluation.value, { valuation });
    if (!input.ok) throw new Error(input.error.message);
    return input.value;
  }

  it('LLM-mód, mock provider → ok, a megjelenített magyarázat mock eredetű', async () => {
    const services = clientFor(createMockAiProvider());
    const outcome = await services.explainAnalysis({ input: await aaplInput(), mode: 'llm' });
    expect(outcome.ok && outcome.value.llm.status).toBe('ok');
    expect(outcome.ok && outcome.value.display.meta.provenanceKind).toBe('mock');
  });

  it('kikapcsolt AI a szerveren → a kliens AI-hibát kap, a template jelenik meg', async () => {
    const services = clientFor(null, { AI_ENABLED: 'false' });
    const outcome = await services.explainAnalysis({ input: await aaplInput(), mode: 'llm' });
    if (!outcome.ok) throw new Error(outcome.error.message);
    expect(outcome.value.llm).toMatchObject({
      status: 'failed',
      error: { kind: 'AI', failure: 'AI_DISABLED' },
    });
    expect(outcome.value.display.meta.provider).toBe('template');
  });

  it('LLM-hiba (érvénytelen kimenet) → a kliens AI_INVALID_OUTPUT-ot kap', async () => {
    const services = clientFor(
      createMockAiProvider({
        script: () =>
          ok({
            rawText: JSON.stringify({ ...validStockContent(), kind: 'stock' }),
            model: 'm',
            stopReason: 'end_turn',
            usage: null,
          }),
      }),
    );
    // A validStockContent a STOCK_DTO-hoz illik, nem az AAPL-hez → hivatkozási hibák.
    const outcome = await services.explainAnalysis({ input: await aaplInput(), mode: 'llm' });
    expect(outcome.ok && outcome.value.llm).toMatchObject({
      status: 'failed',
      error: { failure: 'AI_INVALID_OUTPUT' },
    });
  });

  it('demó mód (mock adat): az LLM nem elérhető, a template működik, nincs hálózat', async () => {
    const fetchImpl = jest.fn();
    const services = createAppServices(
      { dataMode: 'mock', apiBaseUrl: null },
      { clock, fetchImpl },
    );
    const outcome = await services.explainAnalysis({ input: STOCK_DTO, mode: 'llm' });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(outcome.ok && outcome.value.llm).toMatchObject({
      status: 'failed',
      error: { failure: 'AI_DISABLED' },
    });
    expect(outcome.ok && outcome.value.display.meta.provider).toBe('template');
  });

  it('a gateway típusa a port (fordítási ellenőrzés)', () => {
    const gateway: AiGateway = {
      explain: () => Promise.resolve(err(AppErrors.ai('AI_DISABLED', 'x'))),
    };
    expect(typeof gateway.explain).toBe('function');
  });
});
