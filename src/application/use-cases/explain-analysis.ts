/**
 * Use case: elemzés magyarázata (PHASE 11, D-026, D-078).
 *
 *   AiInputDto ─► template (mindig, offline, ingyenes) ─────────────► megjelenítés
 *              └► LLM a proxyn át (csak kérésre) ─► kliensoldali újra-ellenőrzés ─┘
 *
 * - A szabályalapú magyarázat MINDIG elkészül, így LLM-hiba (kikapcsolt AI, timeout, rate limit,
 *   érvénytelen vagy hallucináció-gyanús válasz) esetén is van mit megjeleníteni: az app
 *   használható marad, a hiba oka pedig külön mezőben látszik.
 * - Az LLM-választ a kliens IS ellenőrzi (séma a gateway-ben + `validateAiExplanation` itt):
 *   a proxy nem megbízható forrás a megjelenítés szempontjából (bizalmi határ).
 * - A magyarázat soha nem módosítja a pontot, a döntést vagy a confidence-t: csak a már kész
 *   `AiInputDto`-t olvassa.
 */
import {
  aiInputDtoSchema,
  validateAiExplanation,
  type AiExplanationDto,
  type AiInputDto,
} from '@/contracts';
import { AppErrors, err, ok, toIsoTimestamp, type AppError, type Result } from '@/domain';
import { explainWithTemplate } from '@/explanation';

import type { AiGateway, Clock } from '../ports';

export type ExplanationMode = 'template' | 'llm';

export interface ExplainAnalysisRequest {
  readonly input: AiInputDto;
  readonly mode: ExplanationMode;
  /** Portfólió + LLM esetén kötelező (NFR-04, R-13). */
  readonly consent?: { readonly shareWithAiProvider: true } | null;
}

export type LlmOutcome =
  | { readonly status: 'not_requested' }
  | { readonly status: 'ok'; readonly explanation: AiExplanationDto }
  | { readonly status: 'failed'; readonly error: AppError };

export interface ExplanationOutcome {
  /** Szabályalapú magyarázat (`calculated`) – mindig van. */
  readonly template: AiExplanationDto;
  readonly llm: LlmOutcome;
  /** Amit a UI megjelenít: sikeres LLM-válasz, különben a template. */
  readonly display: AiExplanationDto;
}

export type ExplainAnalysis = (
  request: ExplainAnalysisRequest,
) => Promise<Result<ExplanationOutcome, AppError>>;

function guardMessage(issues: readonly { path: string; message: string }[]): string {
  const first = issues
    .slice(0, 3)
    .map((i) => `${i.path}: ${i.message}`)
    .join(' ');
  return `Az AI-válasz nem ment át a tartalmi ellenőrzésen (${issues.length} hiba). ${first}`.slice(
    0,
    1000,
  );
}

export function createExplainAnalysis(deps: {
  readonly aiGateway: AiGateway;
  readonly clock: Clock;
}): ExplainAnalysis {
  return async (request) => {
    const parsed = aiInputDtoSchema.safeParse(request.input);
    if (!parsed.success) {
      return err(
        AppErrors.validation(
          'Érvénytelen AI-bemenet.',
          parsed.error.issues.slice(0, 10).map((i) => ({
            path: i.path.map(String).join('.'),
            message: i.message,
          })),
        ),
      );
    }
    const input = parsed.data;

    const content = explainWithTemplate(input);
    const templateIssues = validateAiExplanation(content, input);
    if (templateIssues.length > 0) {
      // Programozási hiba: a sablon csak a bemenetből építkezik – ezt tesztek őrzik.
      return err(
        AppErrors.validation(
          'A szabályalapú magyarázat belső ellenőrzése sikertelen.',
          templateIssues.map((i) => ({ path: i.path, message: i.message })),
        ),
      );
    }
    const template: AiExplanationDto = {
      content,
      meta: {
        provider: 'template',
        model: null,
        provenanceKind: 'calculated',
        generatedAt: toIsoTimestamp(deps.clock.now()),
        inputHash: null,
        cached: false,
      },
    };
    const withLlm = (llm: LlmOutcome): ExplanationOutcome => ({
      template,
      llm,
      display: llm.status === 'ok' ? llm.explanation : template,
    });

    if (request.mode === 'template') return ok(withLlm({ status: 'not_requested' }));

    const consent = request.consent ?? null;
    if (input.kind === 'portfolio' && consent === null) {
      return ok(
        withLlm({
          status: 'failed',
          error: AppErrors.validation(
            'Portfólió-adat csak explicit beleegyezéssel küldhető AI-szolgáltatónak.',
          ),
        }),
      );
    }

    const response = await deps.aiGateway.explain({ input, consent });
    if (!response.ok) return ok(withLlm({ status: 'failed', error: response.error }));

    const explanation = response.value;
    if (
      explanation.meta.provider === 'template' ||
      explanation.meta.provenanceKind === 'calculated'
    ) {
      return ok(
        withLlm({
          status: 'failed',
          error: AppErrors.ai(
            'AI_INVALID_OUTPUT',
            'A proxy LLM-válasza hibás eredet-jelölést hordoz.',
          ),
        }),
      );
    }
    const issues = validateAiExplanation(explanation.content, input);
    if (issues.length > 0) {
      return ok(
        withLlm({
          status: 'failed',
          error: AppErrors.ai('AI_INVALID_OUTPUT', guardMessage(issues)),
        }),
      );
    }
    return ok(withLlm({ status: 'ok', explanation }));
  };
}
