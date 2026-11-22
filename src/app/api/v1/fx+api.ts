// GET /api/v1/fx?base=EUR&quotes=USD,HUF&date=YYYY-MM-DD – ECB referencia-árfolyamok.
import { getServerContext } from '@/server/server-context';

export function GET(request: Request): Promise<Response> {
  return getServerContext().handlers.fx(request);
}
