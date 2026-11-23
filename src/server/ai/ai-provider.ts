/**
 * `AiProvider` – a cserélhető LLM-adapter portja a szerveren (PHASE 11, D-016, D-078).
 *
 * A provider CSAK szöveget állít elő a kapott promptból: nem parse-ol, nem validál, nem cache-el.
 * A JSON-értelmezés, a sémaellenőrzés, a tartalmi őr, a cache, a napi keret és a timeout az
 * `AiExplainService` dolga – így minden provider ugyanazon a szűrőn megy át.
 *
 * Hibák (`AppError`, `kind: 'AI'`): `AI_TIMEOUT`, `AI_RATE_LIMITED` (újrapróbálható),
 * `AI_DISABLED` (pl. hitelesítés), `AI_REFUSED`; egyéb szolgáltatói hiba → `UPSTREAM`.
 */
import type { AiInputDto } from '@/contracts';
import type { AppError, Result } from '@/domain';

export interface AiProviderRequest {
  readonly system: string;
  readonly user: string;
  /** A validált bemenet (a mock provider ebből válaszol; valódi provider a promptot kapja). */
  readonly input: AiInputDto;
  readonly maxOutputTokens: number;
  readonly signal: AbortSignal;
}

export type AiStopReason = 'end_turn' | 'max_tokens' | 'refusal' | 'other';

export interface AiProviderResponse {
  /** A modell nyers szöveges kimenete (JSON-nak kell lennie). */
  readonly rawText: string;
  readonly model: string;
  readonly stopReason: AiStopReason;
  readonly usage: { readonly inputTokens: number; readonly outputTokens: number } | null;
}

export interface AiProvider {
  readonly id: 'anthropic' | 'mock';
  readonly model: string;
  generate(request: AiProviderRequest): Promise<Result<AiProviderResponse, AppError>>;
}
