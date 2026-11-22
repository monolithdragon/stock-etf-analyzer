// GET /api/v1/instruments/{listingId}/dividends – osztalék-események (?from&to).
import { getServerContext } from '@/server/server-context';

export function GET(request: Request, params: Record<string, string>): Promise<Response> {
  return getServerContext().handlers.dividends(request, params);
}
