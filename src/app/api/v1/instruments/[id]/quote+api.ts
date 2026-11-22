// GET /api/v1/instruments/{listingId}/quote – legutóbbi (késleltetett) ár: US → FMP, tartalék EODHD.
import { getServerContext } from '@/server/server-context';

export function GET(request: Request, params: Record<string, string>): Promise<Response> {
  return getServerContext().handlers.quote(request, params);
}
