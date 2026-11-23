/**
 * Mock AI provider (PHASE 11): tesztekhez és `AI_PROVIDER=mock` demóhoz. Hálózatot nem hív.
 *
 * Alapviselkedés: minimális, ÉRVÉNYES válasz, amely semmit nem állít tényként – a bemenet
 * adathiányait sorolja fel, a confidence-t a bemenetből veszi. A `script` felülírással bármilyen
 * hibaág eljátszható (hibás JSON, hiányzó mező, timeout, rate limit, refusal, hallucináció).
 */
import { AI_SCHEMA_VERSION, type AiExplanationContent, type AiInputDto } from '@/contracts';
import { ok, type AppError, type Result } from '@/domain';

import type { AiProvider, AiProviderRequest, AiProviderResponse } from './ai-provider';

export const MOCK_AI_MODEL = 'mock-explainer-1';

export function minimalMockContent(input: AiInputDto): AiExplanationContent {
  return {
    schemaVersion: AI_SCHEMA_VERSION,
    kind: input.kind,
    summary: {
      text: 'Demó (mock) AI-válasz: tartalmi értelmezést nem ad; a számok és a döntés a determinisztikus motorból származnak.',
      basedOn: [],
      support: 'insufficient_data',
    },
    positives: [],
    negatives: [],
    keyRisks: [],
    valuationExplanation: [],
    dcfAssumptions: [],
    dataGaps: input.dataGaps.slice(0, 8).map((g) => ({
      text: `${g.label}: ${g.reason}`,
      basedOn: [g.ref],
      support: 'insufficient_data' as const,
    })),
    reviewTriggers: [],
    thesisInvalidators: [],
    confidence: {
      level: input.evaluation?.confidence.level ?? 'NOT_APPLICABLE',
      explanation: 'Az elemzés teljességét jelzi, nem a hozam valószínűségét.',
    },
  };
}

export type MockAiScript = (
  request: AiProviderRequest,
) => Promise<Result<AiProviderResponse, AppError>> | Result<AiProviderResponse, AppError>;

export function createMockAiProvider(
  options: { readonly script?: MockAiScript } = {},
): AiProvider & {
  readonly calls: AiProviderRequest[];
} {
  const calls: AiProviderRequest[] = [];
  return {
    id: 'mock',
    model: MOCK_AI_MODEL,
    calls,
    async generate(request) {
      calls.push(request);
      if (options.script !== undefined) return options.script(request);
      return ok({
        rawText: JSON.stringify(minimalMockContent(request.input)),
        model: MOCK_AI_MODEL,
        stopReason: 'end_turn',
        usage: null,
      });
    },
  };
}
