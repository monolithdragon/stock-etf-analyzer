// GET /api/v1/instruments/{listingId}/profile – instrumentum-profil (free: csak US, FMP).
import { getServerContext } from '@/server/server-context';

export function GET(request: Request, params: Record<string, string>): Promise<Response> {
  return getServerContext().handlers.profile(request, params);
}
