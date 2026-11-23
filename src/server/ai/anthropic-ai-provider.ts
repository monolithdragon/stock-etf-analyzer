/**
 * Anthropic Claude provider (PHASE 11, D-016, D-078) – a hivatalos `@anthropic-ai/sdk`-val.
 *
 * - Strukturált kimenet: `output_config.format` a közös zod-sémából (`betaZodOutputFormat`), így a
 *   modell a sémának megfelelő JSON-t ad. A választ ennek ellenére a szolgáltatás újra validálja
 *   (séma + tartalmi őr): a provider kimenete nem megbízható.
 * - `effort` alapból `low` (költség); a gondolkodás az Opus 5.5-ön nem kapcsolható ki.
 * - `stop_reason: "refusal"` → `AI_REFUSED`. A támogatott modelleknél szerveroldali
 *   `fallbacks: "default"` (béta) van bekapcsolva: elutasításkor a szolgáltató egy tartalék
 *   modellel próbálja újra ugyanazon a hívásban.
 * - A kulcs csak itt (szerveren) él; az SDK-hibák üzenete nem kerül a kliensbe.
 */
import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import type { MessageCreateParamsNonStreaming as BetaMessageCreateParamsNonStreaming } from '@anthropic-ai/sdk/resources/beta/messages/messages';

import { aiExplanationContentSchema } from '@/contracts';
import { AppErrors, err, ok, type AppError, type Result } from '@/domain';

import type { AiEffort } from './ai-config';
import type { AiProvider, AiProviderResponse, AiStopReason } from './ai-provider';

/** A ténylegesen használt mezők (a `BetaMessage` szerkezetileg megfelel neki). */
export interface AnthropicMessageLike {
  readonly model: string;
  readonly stop_reason: string | null;
  readonly content: readonly { readonly type: string; readonly text?: string }[];
  readonly usage: { readonly input_tokens: number; readonly output_tokens: number };
}

/** Szűk port az SDK fölött – tesztben hamisítható, élő hívás nélkül. */
export interface AnthropicMessagesClient {
  create(
    params: BetaMessageCreateParamsNonStreaming,
    options: { readonly signal: AbortSignal },
  ): Promise<AnthropicMessageLike>;
}

/** Modellek, amelyeknél a szerveroldali `fallbacks: "default"` támogatott (claude-api, 2026-11). */
const FALLBACK_MODELS = new Set([
  'claude-opus-5-5',
  'claude-opus-5',
  'claude-sonnet-5-5',
  'claude-fable-5-1',
  'claude-fable-5-2',
]);
const FALLBACK_BETA = 'server-side-fallback-2026-07-01';

export function createSdkMessagesClient(options: {
  readonly apiKey: string;
  readonly timeoutMs: number;
}): AnthropicMessagesClient {
  // maxRetries: 1 – a 429/5xx-et az SDK egyszer újrapróbálja; a többit a hívó kezeli (költség).
  const client = new Anthropic({
    apiKey: options.apiKey,
    timeout: options.timeoutMs,
    maxRetries: 1,
  });
  return {
    create: (params, requestOptions) =>
      client.beta.messages.create(params, { signal: requestOptions.signal }),
  };
}

/** SDK-hiba → AppError (a legspecifikusabb osztálytól a legáltalánosabbig). */
export function mapAnthropicError(error: unknown): AppError {
  if (
    error instanceof Anthropic.APIConnectionTimeoutError ||
    error instanceof Anthropic.APIUserAbortError
  ) {
    return AppErrors.ai('AI_TIMEOUT', 'Az AI-szolgáltató nem válaszolt időben.');
  }
  if (error instanceof Anthropic.RateLimitError) {
    return AppErrors.ai(
      'AI_RATE_LIMITED',
      'Az AI-szolgáltató rate limitje betelt; próbáld később.',
    );
  }
  if (
    error instanceof Anthropic.AuthenticationError ||
    error instanceof Anthropic.PermissionDeniedError
  ) {
    return AppErrors.ai(
      'AI_DISABLED',
      'Az AI-szolgáltató elutasította a hitelesítést (kulcs/jogosultság).',
    );
  }
  if (error instanceof Anthropic.APIConnectionError) {
    return AppErrors.network('Az AI-szolgáltató nem érhető el (hálózati hiba).');
  }
  if (error instanceof Anthropic.APIError) {
    const status = typeof error.status === 'number' ? error.status : null;
    if (status === 529 || status === 503) {
      return AppErrors.ai('AI_RATE_LIMITED', 'Az AI-szolgáltató túlterhelt; próbáld később.');
    }
    return AppErrors.upstream(
      'HTTP_ERROR',
      `Az AI-szolgáltató hibát adott${status === null ? '' : ` (HTTP ${status})`}.`,
      'anthropic',
    );
  }
  return AppErrors.upstream('HTTP_ERROR', 'Váratlan hiba az AI-hívásban.', 'anthropic');
}

function mapStopReason(reason: string | null): AiStopReason {
  if (reason === 'end_turn' || reason === 'max_tokens' || reason === 'refusal') return reason;
  return 'other';
}

export function createAnthropicAiProvider(options: {
  readonly model: string;
  readonly effort: AiEffort;
  readonly client: AnthropicMessagesClient;
}): AiProvider {
  const outputFormat = betaZodOutputFormat(aiExplanationContentSchema);
  const useFallbacks = FALLBACK_MODELS.has(options.model);
  return {
    id: 'anthropic',
    model: options.model,
    async generate(request): Promise<Result<AiProviderResponse>> {
      const params: BetaMessageCreateParamsNonStreaming = {
        model: options.model,
        max_tokens: request.maxOutputTokens,
        system: request.system,
        messages: [{ role: 'user', content: request.user }],
        output_config: { effort: options.effort, format: outputFormat },
        ...(useFallbacks ? { betas: [FALLBACK_BETA], fallbacks: 'default' as const } : {}),
      };
      let message: AnthropicMessageLike;
      try {
        message = await options.client.create(params, { signal: request.signal });
      } catch (error) {
        return err(mapAnthropicError(error));
      }
      const stopReason = mapStopReason(message.stop_reason);
      if (stopReason === 'refusal') {
        return err(
          AppErrors.ai(
            'AI_REFUSED',
            'Az AI-szolgáltató elutasította a kérést; a szabályalapú összefoglaló érvényes.',
          ),
        );
      }
      const rawText = message.content
        .filter((block) => block.type === 'text' && typeof block.text === 'string')
        .map((block) => block.text ?? '')
        .join('');
      return ok({
        rawText,
        model: message.model,
        stopReason,
        usage: {
          inputTokens: message.usage.input_tokens,
          outputTokens: message.usage.output_tokens,
        },
      });
    },
  };
}
