/**
 * `sec-edgar` adapter: US SEC-filerek JELENTETT éves/negyedéves kimutatásai (D-024).
 *
 * Végpontok (igazolva 2026-11-21, User-Agent kapcsolattartóval – nélküle HTTP 403):
 * - ticker → CIK: `GET https://www.sec.gov/files/company_tickers.json` (~10 400 sor)
 * - tények:       `GET https://data.sec.gov/api/xbrl/companyfacts/CIK##########.json`
 * Fair access: ≤ 10 kérés/mp (`createRequestScheduler(110)`), deklarált User-Agent.
 *
 * Lefedettség: csak US tőzsdei listing (MIC: XNAS, XNYS, ARCX, XASE, BATS). Más piac →
 * `UNSUPPORTED_MARKET` (nem US fundamentum free módban `UNAVAILABLE`, DATA_SOURCES 6.).
 */
import {
  AppErrors,
  err,
  ok,
  parseCik,
  parseSecurityId,
  splitListingId,
  toIsoTimestamp,
  type Cik,
  type ListingId,
  type Result,
} from '@/domain';

import { secCompanyFactsShellSchema, secTickersSchema } from './sec-dto';
import { SEC_SOURCE, normalizeSecCompanyFacts } from './sec-normalizer';
import {
  DEFAULT_UPSTREAM_TIMEOUT_MS,
  invalidUpstream,
  requestJson,
  type FetchLike,
} from '../../http/request-json';
import {
  createRequestScheduler,
  createTtlMemo,
  type RequestScheduler,
} from '../../http/request-scheduler';
import type { MarketDataProvider } from '../market-data-provider';

export const SEC_TICKERS_URL = 'https://www.sec.gov/files/company_tickers.json';
export const secCompanyFactsUrl = (cik: Cik): string =>
  `https://data.sec.gov/api/xbrl/companyfacts/CIK${cik}.json`;

/** US tőzsdék (üzemeltetői MIC), amelyeken SEC-filer jegyezhető. */
export const US_MICS: ReadonlySet<string> = new Set(['XNAS', 'XNYS', 'ARCX', 'XASE', 'BATS']);

/** SEC fair access: max. 10 kérés/mp → 110 ms szünet (tartalékkal). */
export const SEC_MIN_INTERVAL_MS = 110;
const TICKER_TTL_MS = 24 * 60 * 60 * 1000;

/** A mi tickerünk → a SEC-é (pl. `BRK.B` → `BRK-B`; a SEC kötőjelet használ). */
export function toSecTicker(symbol: string): string {
  return symbol.replace(/\./g, '-');
}

export interface SecEdgarProviderDeps {
  readonly fetchImpl: FetchLike;
  readonly now: () => Date;
  /** `null` → a szolgáltató „nincs konfigurálva”, minden hívás érthető hibát ad. */
  readonly userAgent: string | null;
  readonly timeoutMs?: number;
  readonly scheduler?: RequestScheduler;
}

export function createSecEdgarProvider(deps: SecEdgarProviderDeps): MarketDataProvider {
  const scheduler = deps.scheduler ?? createRequestScheduler(SEC_MIN_INTERVAL_MS);
  const tickerMemo = createTtlMemo<ReadonlyMap<string, Cik>>(TICKER_TTL_MS, () =>
    deps.now().getTime(),
  );
  const timeoutMs = deps.timeoutMs ?? DEFAULT_UPSTREAM_TIMEOUT_MS;

  async function secGet(url: string, notFound?: { resource: string; id: string }) {
    if (deps.userAgent === null) {
      return err(
        AppErrors.upstream(
          'NOT_IMPLEMENTED',
          'A SEC-forrás nincs konfigurálva: a proxy env-jében hiányzik a SEC_USER_AGENT.',
          SEC_SOURCE.sourceId,
        ),
      );
    }
    const userAgent = deps.userAgent;
    return scheduler.schedule(() =>
      requestJson({
        url,
        sourceId: SEC_SOURCE.sourceId,
        fetchImpl: deps.fetchImpl,
        timeoutMs,
        headers: { 'User-Agent': userAgent },
        notFound,
        mapStatus: (status) =>
          status === 403
            ? AppErrors.upstream(
                'HTTP_ERROR',
                'A SEC elutasította a kérést (HTTP 403): ellenőrizd a SEC_USER_AGENT formátumát, vagy túl sok kérés.',
                SEC_SOURCE.sourceId,
              )
            : null,
      }),
    );
  }

  async function tickerMap(): Promise<Result<ReadonlyMap<string, Cik>>> {
    const cached = tickerMemo.get();
    if (cached !== null) return ok(cached);
    const response = await secGet(SEC_TICKERS_URL);
    if (!response.ok) return response;
    const parsed = secTickersSchema.safeParse(response.value);
    if (!parsed.success) return err(invalidUpstream(SEC_SOURCE.sourceId, parsed.error.issues[0]));
    const map = new Map<string, Cik>();
    for (const row of Object.values(parsed.data)) {
      const cik = parseCik(String(row.cik_str).padStart(10, '0'));
      // Ugyanaz a ticker nem fordulhat elő kétszer; ha mégis, az első marad (determinisztikus).
      if (cik.ok && !map.has(row.ticker.toUpperCase()))
        map.set(row.ticker.toUpperCase(), cik.value);
    }
    tickerMemo.set(map);
    return ok(map);
  }

  async function resolveCik(listingId: ListingId): Promise<Result<Cik>> {
    const { symbol, mic } = splitListingId(listingId);
    if (!US_MICS.has(mic)) {
      return err(
        AppErrors.missingData(
          ['market'],
          `A SEC csak US-jegyzésű SEC-filereket fed le (${mic} nem US tőzsde).`,
        ),
      );
    }
    const map = await tickerMap();
    if (!map.ok) return map;
    const cik = map.value.get(toSecTicker(symbol));
    return cik === undefined ? err(AppErrors.notFound('SEC-filer (ticker)', symbol)) : ok(cik);
  }

  return {
    info: {
      id: SEC_SOURCE.sourceId,
      name: SEC_SOURCE.sourceName,
      kind: 'live',
      configured: deps.userAgent !== null,
      note:
        deps.userAgent === null
          ? 'Nincs konfigurálva: SEC_USER_AGENT hiányzik a proxy env-jéből.'
          : 'Csak US SEC-filerek; jelentett (reported) adat. ≤10 kérés/mp.',
    },

    async getFinancialStatements(listingId, frequency) {
      const cik = await resolveCik(listingId);
      if (!cik.ok) return cik;
      const url = secCompanyFactsUrl(cik.value);
      const response = await secGet(url, { resource: 'SEC companyfacts', id: cik.value });
      if (!response.ok) return response;

      const shell = secCompanyFactsShellSchema.safeParse(response.value);
      if (!shell.success) return err(invalidUpstream(SEC_SOURCE.sourceId, shell.error.issues[0]));

      const securityId = parseSecurityId(`sec-edgar:${cik.value}`);
      if (!securityId.ok) return securityId;
      return normalizeSecCompanyFacts(shell.data, {
        frequency,
        securityId: securityId.value,
        cik: cik.value,
        fetchedAt: toIsoTimestamp(deps.now()),
        sourceUrl: url,
      });
    },
  };
}
