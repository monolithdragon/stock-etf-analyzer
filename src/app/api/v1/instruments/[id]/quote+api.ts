// GET /api/v1/instruments/{listingId}/quote – legutóbbi ár (élő forrás: PHASE 04B).
import { getServerContext } from '@/server/server-context';

export function GET(request: Request, params: Record<string, string>): Promise<Response> {
  return getServerContext().handlers.quote(request, params);
}
