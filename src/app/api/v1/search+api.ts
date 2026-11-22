// GET /api/v1/search?q= – instrumentum-keresés ticker, név vagy ISIN alapján (FMP → EODHD).
import { getServerContext } from '@/server/server-context';

export function GET(request: Request): Promise<Response> {
  return getServerContext().handlers.search(request);
}
