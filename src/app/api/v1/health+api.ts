// GET /api/v1/health – a proxy állapota és képességei (kulcs és személyes adat nélkül).
import { getServerContext } from '@/server/server-context';

export function GET(request: Request): Promise<Response> {
  return getServerContext().handlers.health(request);
}
