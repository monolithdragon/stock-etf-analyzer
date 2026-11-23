// POST /api/v1/ai/explain – opcionális LLM-magyarázat a validált AiInputDto-ból (PHASE 11).
import { getServerContext } from '@/server/server-context';

export function POST(request: Request): Promise<Response> {
  return getServerContext().ai.explain(request);
}
