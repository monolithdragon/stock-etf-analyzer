// GET /api/v1/providers/status – csomagszint, képességek, mai kvóta, routing (kulcs nélkül!).
import { getServerContext } from '@/server/server-context';

export function GET(request: Request): Promise<Response> {
  return getServerContext().handlers.providerStatus(request);
}
