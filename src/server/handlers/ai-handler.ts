/**
 * `POST /api/v1/ai/explain` (PHASE 11, ARCHITECTURE 6.3).
 *
 * Bemenet: `{ input: AiInputDto, consent }` – méretkorlát, JSON, szigorú zod-séma (ismeretlen
 * mező → 400), portfóliónál kötelező beleegyezés. Kimenet: `AiExplanationDto` a közös sémán
 * átfuttatva. A napló csak útvonalat, státuszt, késleltetést, providert és hibafajtát kap –
 * a bemenet és a válasz tartalma (portfólió!) SOHA nem kerül naplóba.
 */
import { AI_LIMITS, aiExplainRequestSchema, aiExplanationDtoSchema } from '@/contracts';
import { AppErrors } from '@/domain';

import type { AiExplainService } from '../ai/ai-explain-service';
import type { ServerLogger } from '../logging';
import { appErrorToResponse, errorResponse, okResponse } from './http';

export function createAiExplainHandler(deps: {
  readonly service: AiExplainService;
  readonly logger: ServerLogger;
  readonly now: () => Date;
}): (request: Request) => Promise<Response> {
  const route = '/api/v1/ai/explain';
  return async (request) => {
    const started = deps.now().getTime();
    const log = (status: number, errorKind?: string) =>
      deps.logger.info({
        route,
        status,
        latencyMs: deps.now().getTime() - started,
        provider: deps.service.status().provider,
        ...(errorKind === undefined ? {} : { errorKind }),
      });

    if (request.method !== 'POST') {
      log(405, 'METHOD');
      return errorResponse('VALIDATION_FAILED', 405, 'Csak POST engedélyezett.');
    }
    const body = await request.text();
    if (body.length > AI_LIMITS.requestBytes) {
      log(413, 'VALIDATION');
      return errorResponse('VALIDATION_FAILED', 413, 'A kérés túl nagy.');
    }
    let json: unknown;
    try {
      json = JSON.parse(body) as unknown;
    } catch {
      log(400, 'VALIDATION');
      return errorResponse('VALIDATION_FAILED', 400, 'A kérés törzse nem érvényes JSON.');
    }
    const parsed = aiExplainRequestSchema.safeParse(json);
    if (!parsed.success) {
      log(400, 'VALIDATION');
      return appErrorToResponse(
        AppErrors.validation(
          'Érvénytelen AI-kérés.',
          parsed.error.issues.slice(0, 5).map((i) => ({
            path: i.path.map(String).join('.'),
            message: i.message,
          })),
        ),
      );
    }
    const result = await deps.service.explain(parsed.data);
    if (!result.ok) {
      const response = appErrorToResponse(result.error);
      log(response.status, result.error.kind === 'AI' ? result.error.failure : result.error.kind);
      return response;
    }
    const { response, contractError } = okResponse(result.value, aiExplanationDtoSchema);
    log(response.status, contractError === null ? undefined : 'CONTRACT');
    return response;
  };
}
