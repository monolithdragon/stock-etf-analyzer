/**
 * Szerveroldali AI-konfiguráció (PHASE 11, D-078). CSAK a `src/server` olvassa.
 *
 * - Az LLM alapból KI van kapcsolva (`AI_PROVIDER=template`, D-026): a magyarázat ilyenkor a
 *   kliensen, szabályalapon készül. LLM csak `AI_PROVIDER=anthropic|mock` ÉS `AI_ENABLED=true`
 *   mellett fut (kill switch: `AI_ENABLED=false` azonnal leállítja, kódváltozás nélkül).
 * - Az `ANTHROPIC_API_KEY` TITOK: soha nem kerül naplóba, válaszba vagy a kliensbe.
 * - Költségkorlát: `AI_MAX_OUTPUT_TOKENS` (hívásonként), `AI_DAILY_LIMIT` (napi LLM-hívás),
 *   cache a bemenet hash-ére (ismételt kérés nem hív LLM-et).
 */
export type ServerAiProviderId = 'template' | 'anthropic' | 'mock';
export type AiEffort = 'low' | 'medium' | 'high';

export interface AiConfig {
  readonly provider: ServerAiProviderId;
  /** Kill switch: `false` → minden LLM-kérés `AI_DISABLED`. */
  readonly enabled: boolean;
  /** TITOK. */
  readonly anthropicApiKey: string | null;
  readonly model: string;
  readonly effort: AiEffort;
  readonly maxOutputTokens: number;
  readonly dailyLimit: number;
  readonly timeoutMs: number;
}

export interface RawAiEnv {
  readonly AI_PROVIDER?: string | undefined;
  readonly AI_ENABLED?: string | undefined;
  readonly ANTHROPIC_API_KEY?: string | undefined;
  readonly AI_MODEL?: string | undefined;
  readonly AI_EFFORT?: string | undefined;
  readonly AI_MAX_OUTPUT_TOKENS?: string | undefined;
  readonly AI_DAILY_LIMIT?: string | undefined;
  readonly AI_TIMEOUT_MS?: string | undefined;
}

export interface AiEnvIssue {
  readonly variable: string;
  readonly message: string;
}

/** D-016: alapértelmezett modell; a tulajdonos env-ből olcsóbbra állíthatja (DP-04). */
export const DEFAULT_AI_MODEL = 'claude-opus-5-5';
const MODEL_PATTERN = /^[a-z0-9][a-z0-9.-]{2,60}$/;

const DEFAULTS = {
  effort: 'low' as AiEffort,
  maxOutputTokens: 8_000,
  dailyLimit: 50,
  timeoutMs: 60_000,
};

function normalize(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed === undefined || trimmed === '' ? null : trimmed;
}

function parseIntIn(
  variable: string,
  raw: string | undefined,
  fallback: number,
  min: number,
  max: number,
  issues: AiEnvIssue[],
): number {
  const value = normalize(raw);
  if (value === null) return fallback;
  const n = Number(value);
  if (!Number.isInteger(n) || n < min || n > max) {
    issues.push({
      variable,
      message: `Egész szám kell ${min}–${max} között; alapérték: ${fallback}.`,
    });
    return fallback;
  }
  return n;
}

export function parseAiConfig(raw: RawAiEnv): { config: AiConfig; issues: AiEnvIssue[] } {
  const issues: AiEnvIssue[] = [];

  let provider: ServerAiProviderId = 'template';
  const rawProvider = normalize(raw.AI_PROVIDER)?.toLowerCase() ?? null;
  if (rawProvider === 'template' || rawProvider === 'anthropic' || rawProvider === 'mock') {
    provider = rawProvider;
  } else if (rawProvider !== null) {
    issues.push({
      variable: 'AI_PROVIDER',
      message: `Ismeretlen érték: "${rawProvider}". Engedélyezett: template | anthropic | mock. Az LLM ki van kapcsolva.`,
    });
  }

  const rawEnabled = normalize(raw.AI_ENABLED)?.toLowerCase() ?? null;
  let enabled = rawEnabled === 'true';
  if (rawEnabled !== null && rawEnabled !== 'true' && rawEnabled !== 'false') {
    issues.push({
      variable: 'AI_ENABLED',
      message: 'Engedélyezett: true | false. Az LLM ki van kapcsolva.',
    });
  }

  const anthropicApiKey = normalize(raw.ANTHROPIC_API_KEY);
  if (provider === 'anthropic' && enabled && anthropicApiKey === null) {
    issues.push({
      variable: 'ANTHROPIC_API_KEY',
      message: 'AI_PROVIDER=anthropic, de nincs kulcs (.env.local). Az LLM ki van kapcsolva.',
    });
    enabled = false;
  }
  if (provider === 'template') enabled = false;

  let model = normalize(raw.AI_MODEL) ?? DEFAULT_AI_MODEL;
  if (!MODEL_PATTERN.test(model)) {
    issues.push({
      variable: 'AI_MODEL',
      message: `Érvénytelen modellazonosító; alapérték: ${DEFAULT_AI_MODEL}.`,
    });
    model = DEFAULT_AI_MODEL;
  }

  let effort = DEFAULTS.effort;
  const rawEffort = normalize(raw.AI_EFFORT)?.toLowerCase() ?? null;
  if (rawEffort === 'low' || rawEffort === 'medium' || rawEffort === 'high') {
    effort = rawEffort;
  } else if (rawEffort !== null) {
    issues.push({
      variable: 'AI_EFFORT',
      message: 'Engedélyezett: low | medium | high; alapérték: low.',
    });
  }

  return {
    config: {
      provider,
      enabled,
      anthropicApiKey,
      model,
      effort,
      maxOutputTokens: parseIntIn(
        'AI_MAX_OUTPUT_TOKENS',
        raw.AI_MAX_OUTPUT_TOKENS,
        DEFAULTS.maxOutputTokens,
        1_000,
        32_000,
        issues,
      ),
      dailyLimit: parseIntIn(
        'AI_DAILY_LIMIT',
        raw.AI_DAILY_LIMIT,
        DEFAULTS.dailyLimit,
        0,
        10_000,
        issues,
      ),
      timeoutMs: parseIntIn(
        'AI_TIMEOUT_MS',
        raw.AI_TIMEOUT_MS,
        DEFAULTS.timeoutMs,
        5_000,
        300_000,
        issues,
      ),
    },
    issues,
  };
}
