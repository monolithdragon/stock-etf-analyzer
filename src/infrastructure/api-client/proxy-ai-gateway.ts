/**
 * `AiGateway` a proxyn át (PHASE 11, D-078): `POST /api/v1/ai/explain`.
 *
 * A válasz a közös sémán (`aiExplanationDtoSchema`) megy át; a tartalmi ellenőrzést az
 * `explainAnalysis` use case végzi. Az LLM lassabb, ezért saját (hosszabb) timeoutot kap.
 */
import type { AiGateway } from '@/application';
import { aiExplanationDtoSchema } from '@/contracts';
import { AppErrors, err } from '@/domain';

import type { ProxyHttpClient } from './proxy-http-client';

export const AI_EXPLAIN_PATH = '/api/v1/ai/explain';
/** A proxy saját LLM-timeoutja (60 s) + tartalék. */
export const AI_CLIENT_TIMEOUT_MS = 75_000;

export function createProxyAiGateway(http: ProxyHttpClient): AiGateway {
  return {
    explain: (request) =>
      http.post(AI_EXPLAIN_PATH, request, aiExplanationDtoSchema, {
        timeoutMs: AI_CLIENT_TIMEOUT_MS,
      }),
  };
}

/** Demó módban / proxy nélkül: az LLM nem elérhető (a szabályalapú magyarázat ettől működik). */
export const disabledAiGateway: AiGateway = {
  explain: () =>
    Promise.resolve(
      err(
        AppErrors.ai(
          'AI_DISABLED',
          'Az LLM-magyarázat nem elérhető (demó mód vagy nincs beállított proxy). A szabályalapú összefoglaló működik.',
        ),
      ),
    ),
};
