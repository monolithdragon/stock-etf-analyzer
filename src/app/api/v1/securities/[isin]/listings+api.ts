// GET /api/v1/securities/{isin}/listings – egy értékpapír tőzsdei jegyzései (D-025).
import { getServerContext } from '@/server/server-context';

export function GET(request: Request, params: Record<string, string>): Promise<Response> {
  return getServerContext().handlers.securityListings(request, params);
}
