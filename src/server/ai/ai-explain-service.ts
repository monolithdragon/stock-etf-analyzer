/**
 * AI-magyarázó szolgáltatás a proxyn (PHASE 11, D-077, D-078).
 *
 * Sorrend (minden lépés hibája jól definiált `AppError`, az app ettől használható marad):
 *   1. kill switch / nincs provider        → AI_DISABLED
 *   2. cache (bemenet-hash + modell + promptverzió) → találatnál nincs LLM-hívás, nincs költség
 *   3. napi keret (`AI_DAILY_LIMIT`)       → AI_RATE_LIMITED (retryAfter: UTC éjfélig)
 *   4. provider-hívás saját timeouttal     → AI_TIMEOUT / AI_RATE_LIMITED / AI_REFUSED / UPSTREAM
 *   5. `max_tokens` leállás                → AI_INVALID_OUTPUT (csonka JSON-t nem javítunk)
 *   6. JSON.parse                          → AI_INVALID_OUTPUT
 *   7. zod-séma (hiányzó / extra mező)     → AI_INVALID_OUTPUT
 *   8. tartalmi őr (`validateAiExplanation`) → AI_INVALID_OUTPUT (hallucináció-gyanú)
 * Érvénytelen választ nem javítunk és nem próbálunk újra automatikusan (költség, determinizmus).
 */
import { createHash } from 'node:crypto';

import {
  AI_SCHEMA_VERSION,
  aiExplanationContentSchema,
  validateAiExplanation,
  type AiExplainRequestDto,
  type AiExplanationDto,
} from '@/contracts';
import { AppErrors, err, ok, toIsoTimestamp, type AppError, type Result } from '@/domain';

import type { AiConfig } from './ai-config';
import type { AiProvider, AiProviderResponse } from './ai-provider';
import { buildSystemPrompt, buildUserPrompt, PROMPT_VERSION } from './prompts';
import { createDailyQuota, type QuotaGuard } from '../routing/quota';

export interface AiExplainService {
  explain(request: AiExplainRequestDto): Promise<Result<AiExplanationDto, AppError>>;
  /** Állapot a health/status végponthoz (kulcs nélkül). */
  status(): {
    readonly provider: string;
    readonly enabled: boolean;
    readonly model: string | null;
    readonly usedToday: number | null;
    readonly dailyLimit: number;
  };
}

export interface AiExplainServiceOptions {
  readonly config: AiConfig;
  /** `null`, ha az LLM ki van kapcsolva vagy nincs konfigurálva. */
  readonly provider: AiProvider | null;
  readonly now: () => Date;
  readonly cacheTtlMs?: number;
  readonly cacheMaxEntries?: number;
}

const DEFAULT_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const DEFAULT_CACHE_MAX = 200;

/** SHA-256 a validált DTO kanonikus JSON-jából (a zod kimenet kulcssorrendje a sémáé). */
export function hashAiInput(input: unknown): string {
  return createHash('sha256').update(JSON.stringify(input)).digest('hex');
}

function secondsUntil(iso: string, now: Date): number | null {
  const ms = Date.parse(iso) - now.getTime();
  return Number.isFinite(ms) ? Math.max(1, Math.ceil(ms / 1000)) : null;
}

/** Időkorlát akkor is, ha a provider nem figyeli az AbortSignalt. */
async function withTimeout(
  run: (signal: AbortSignal) => Promise<Result<AiProviderResponse, AppError>>,
  timeoutMs: number,
): Promise<Result<AiProviderResponse, AppError>> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<Result<AiProviderResponse, AppError>>((resolve) => {
    timer = setTimeout(() => {
      controller.abort();
      resolve(err(AppErrors.ai('AI_TIMEOUT', `Az AI nem válaszolt ${timeoutMs} ms alatt.`)));
    }, timeoutMs);
  });
  try {
    return await Promise.race([run(controller.signal), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

const invalid = (message: string) => err(AppErrors.ai('AI_INVALID_OUTPUT', message.slice(0, 1000)));

export function createAiExplainService(options: AiExplainServiceOptions): AiExplainService {
  const { config, provider, now } = options;
  const ttl = options.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;
  const maxEntries = options.cacheMaxEntries ?? DEFAULT_CACHE_MAX;
  const cache = new Map<string, { readonly value: AiExplanationDto; readonly expiresAt: number }>();
  const quota: QuotaGuard = createDailyQuota({
    providerId: 'ai',
    dailyLimit: config.dailyLimit,
    now,
  });
  const active = config.enabled && provider !== null;

  return {
    status: () => ({
      provider: config.provider,
      enabled: active,
      model: active ? (provider?.model ?? null) : null,
      usedToday: quota.snapshot()?.usedToday ?? null,
      dailyLimit: config.dailyLimit,
    }),

    async explain(request) {
      if (!active || provider === null) {
        return err(
          AppErrors.ai(
            'AI_DISABLED',
            'Az LLM-magyarázat ki van kapcsolva a szerveren. A szabályalapú összefoglaló elérhető.',
          ),
        );
      }
      const { input } = request;
      const inputHash = hashAiInput(input);
      const cacheKey = `${provider.id}|${provider.model}|${PROMPT_VERSION}|${AI_SCHEMA_VERSION}|${inputHash}`;
      const nowMs = now().getTime();
      const hit = cache.get(cacheKey);
      if (hit !== undefined && hit.expiresAt > nowMs) {
        return ok({ ...hit.value, meta: { ...hit.value.meta, cached: true } });
      }
      if (hit !== undefined) cache.delete(cacheKey);

      const allowed = quota.consume(1);
      if (!allowed.ok) {
        const resetsAt = quota.snapshot()?.resetsAt ?? null;
        return err(
          AppErrors.ai(
            'AI_RATE_LIMITED',
            `Az AI napi kerete (${config.dailyLimit} hívás) elfogyott; UTC éjfélkor nullázódik.${
              resetsAt === null ? '' : ` Újra: ${secondsUntil(resetsAt, now()) ?? '?'} mp múlva.`
            }`,
          ),
        );
      }

      const response = await withTimeout(
        (signal) =>
          provider.generate({
            system: buildSystemPrompt(input.kind),
            user: buildUserPrompt(input),
            input,
            maxOutputTokens: config.maxOutputTokens,
            signal,
          }),
        config.timeoutMs,
      );
      if (!response.ok) return response;
      const { rawText, stopReason, model } = response.value;

      if (stopReason === 'refusal') {
        return err(AppErrors.ai('AI_REFUSED', 'Az AI elutasította a kérést.'));
      }
      if (stopReason === 'max_tokens') {
        return invalid(
          'Az AI-válasz a kimeneti korlátnál megszakadt (csonka). Nem jelenítjük meg.',
        );
      }

      let json: unknown;
      try {
        json = JSON.parse(rawText) as unknown;
      } catch {
        return invalid('Az AI-válasz nem érvényes JSON.');
      }
      const parsed = aiExplanationContentSchema.safeParse(json);
      if (!parsed.success) {
        const first = parsed.error.issues[0];
        const where =
          first === undefined
            ? ''
            : ` (${first.path.map(String).join('.') || 'gyökér'}: ${first.message})`;
        return invalid(`Az AI-válasz nem felel meg a sémának${where}.`);
      }
      const issues = validateAiExplanation(parsed.data, input);
      if (issues.length > 0) {
        const sample = issues
          .slice(0, 3)
          .map((i) => `${i.path} [${i.code}]: ${i.message}`)
          .join(' ');
        return invalid(
          `Az AI-válasz nem ment át a tartalmi ellenőrzésen (${issues.length} hiba). ${sample}`,
        );
      }

      const value: AiExplanationDto = {
        content: parsed.data,
        meta: {
          provider: provider.id,
          model,
          provenanceKind: provider.id === 'mock' ? 'mock' : 'ai_interpretation',
          generatedAt: toIsoTimestamp(now()),
          inputHash,
          cached: false,
        },
      };
      if (cache.size >= maxEntries) {
        const oldest = cache.keys().next().value;
        if (oldest !== undefined) cache.delete(oldest);
      }
      cache.set(cacheKey, { value, expiresAt: nowMs + ttl });
      return ok(value);
    },
  };
}
