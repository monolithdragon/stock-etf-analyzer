/**
 * PHASE 11 – Anthropic provider hamis klienssel (élő hívás nincs): kérésparaméterek,
 * szövegösszefűzés, refusal, és az SDK-hibaosztályok leképezése.
 */
import Anthropic from '@anthropic-ai/sdk';

import { STOCK_DTO, validStockContent } from '@/contracts/ai-testing';

import {
  createAnthropicAiProvider,
  mapAnthropicError,
  type AnthropicMessageLike,
  type AnthropicMessagesClient,
} from './anthropic-ai-provider';

type Params = Parameters<AnthropicMessagesClient['create']>[0];

function fakeClient(reply: AnthropicMessageLike | Error) {
  const calls: Params[] = [];
  const client: AnthropicMessagesClient = {
    create: (params) => {
      calls.push(params);
      return reply instanceof Error ? Promise.reject(reply) : Promise.resolve(reply);
    },
  };
  return { client, calls };
}

const message = (overrides: Partial<AnthropicMessageLike> = {}): AnthropicMessageLike => ({
  model: 'claude-opus-5-5',
  stop_reason: 'end_turn',
  content: [
    { type: 'thinking' },
    { type: 'text', text: JSON.stringify(validStockContent()).slice(0, 20) },
    { type: 'text', text: JSON.stringify(validStockContent()).slice(20) },
  ],
  usage: { input_tokens: 5000, output_tokens: 900 },
  ...overrides,
});

const request = () => ({
  system: 'rendszer',
  user: 'adat',
  input: STOCK_DTO,
  maxOutputTokens: 8000,
  signal: new AbortController().signal,
});

describe('createAnthropicAiProvider', () => {
  it('strukturált kimenet, effort, szerveroldali fallback (Opus 5.5)', async () => {
    const { client, calls } = fakeClient(message());
    const provider = createAnthropicAiProvider({ model: 'claude-opus-5-5', effort: 'low', client });
    const result = await provider.generate(request());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(JSON.parse(result.value.rawText)).toEqual(validStockContent());
    expect(result.value.usage).toEqual({ inputTokens: 5000, outputTokens: 900 });
    const params = calls[0]!;
    expect(params).toMatchObject({
      model: 'claude-opus-5-5',
      max_tokens: 8000,
      system: 'rendszer',
      messages: [{ role: 'user', content: 'adat' }],
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
    });
    expect(params.output_config?.effort).toBe('low');
    expect(params.output_config?.format?.type).toBe('json_schema');
    expect(Object.keys(params.output_config?.format?.schema ?? {})).toEqual(
      expect.arrayContaining(['type', 'properties']),
    );
    // Gondolkodás és mintavételi paraméterek nincsenek (Opus 5.5-ön 400-at adnának).
    expect(params).not.toHaveProperty('thinking');
    expect(params).not.toHaveProperty('temperature');
  });

  it('Haiku 5.5-nél nincs szerveroldali fallback (nem támogatott)', async () => {
    const { client, calls } = fakeClient(message({ model: 'claude-haiku-5-5' }));
    await createAnthropicAiProvider({ model: 'claude-haiku-5-5', effort: 'low', client }).generate(
      request(),
    );
    expect(calls[0]).not.toHaveProperty('fallbacks');
    expect(calls[0]).not.toHaveProperty('betas');
  });

  it('refusal → AI_REFUSED', async () => {
    const { client } = fakeClient(message({ stop_reason: 'refusal', content: [] }));
    const result = await createAnthropicAiProvider({
      model: 'claude-opus-5-5',
      effort: 'low',
      client,
    }).generate(request());
    expect(result).toMatchObject({ ok: false, error: { kind: 'AI', failure: 'AI_REFUSED' } });
  });

  it('max_tokens és ismeretlen stop_reason továbbadva (a szolgáltatás dönt)', async () => {
    const { client } = fakeClient(message({ stop_reason: 'max_tokens' }));
    const result = await createAnthropicAiProvider({
      model: 'claude-opus-5-5',
      effort: 'low',
      client,
    }).generate(request());
    expect(result.ok && result.value.stopReason).toBe('max_tokens');
    const other = fakeClient(message({ stop_reason: 'pause_turn' }));
    const r2 = await createAnthropicAiProvider({
      model: 'claude-opus-5-5',
      effort: 'low',
      client: other.client,
    }).generate(request());
    expect(r2.ok && r2.value.stopReason).toBe('other');
  });

  it('kivétel → AppError (nem dob tovább)', async () => {
    const { client } = fakeClient(new Anthropic.APIConnectionTimeoutError());
    const result = await createAnthropicAiProvider({
      model: 'claude-opus-5-5',
      effort: 'low',
      client,
    }).generate(request());
    expect(result).toMatchObject({ ok: false, error: { failure: 'AI_TIMEOUT' } });
  });
});

describe('mapAnthropicError', () => {
  const headers = new Headers();
  it.each([
    ['timeout', new Anthropic.APIConnectionTimeoutError(), { kind: 'AI', failure: 'AI_TIMEOUT' }],
    ['megszakítás', new Anthropic.APIUserAbortError(), { kind: 'AI', failure: 'AI_TIMEOUT' }],
    [
      '429',
      new Anthropic.RateLimitError(429, undefined, 'rate', headers),
      { kind: 'AI', failure: 'AI_RATE_LIMITED' },
    ],
    [
      '401',
      new Anthropic.AuthenticationError(401, undefined, 'auth', headers),
      { kind: 'AI', failure: 'AI_DISABLED' },
    ],
    [
      '403',
      new Anthropic.PermissionDeniedError(403, undefined, 'perm', headers),
      { kind: 'AI', failure: 'AI_DISABLED' },
    ],
    [
      '529 túlterhelés',
      new Anthropic.APIError(529, undefined, 'overloaded', headers),
      { kind: 'AI', failure: 'AI_RATE_LIMITED' },
    ],
    [
      '500',
      new Anthropic.InternalServerError(500, undefined, 'x', headers),
      { kind: 'UPSTREAM', sourceId: 'anthropic' },
    ],
    ['kapcsolat', new Anthropic.APIConnectionError({ message: 'dns' }), { kind: 'NETWORK' }],
    ['ismeretlen', new Error('???'), { kind: 'UPSTREAM' }],
  ])('%s', (_case, error, expected) => {
    expect(mapAnthropicError(error)).toMatchObject(expected);
  });

  it('a hibaüzenet nem tartalmazza a szolgáltató eredeti szövegét (szivárgás ellen)', () => {
    const mapped = mapAnthropicError(
      new Anthropic.APIError(400, undefined, 'invalid x-api-key sk-ant-secret', headers),
    );
    expect(mapped.message).not.toContain('sk-ant');
  });
});
