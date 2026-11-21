// GET /api/v1/stocks/{listingId}/financials?period=annual|quarterly – normalizált kimutatások.
import { getServerContext } from '@/server/server-context';

export function GET(request: Request, params: Record<string, string>): Promise<Response> {
  return getServerContext().handlers.financials(request, params);
}
