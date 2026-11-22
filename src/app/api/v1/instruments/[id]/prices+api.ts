// GET /api/v1/instruments/{listingId}/prices – napi ártörténet (?from&to&adjustment=none|split|split_dividend).
import { getServerContext } from '@/server/server-context';

export function GET(request: Request, params: Record<string, string>): Promise<Response> {
  return getServerContext().handlers.prices(request, params);
}
