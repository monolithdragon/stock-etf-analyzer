/**
 * `openfigi` adapter: ISIN → az értékpapír tőzsdei jegyzései (D-024, D-025).
 *
 * Végpont (igazolva 2026-11-21): `POST https://api.openfigi.com/v3/mapping`
 *   törzs: `[{ "idType": "ID_ISIN", "idValue": "IE00BK5BQT80" }]`
 *   válasz: jobonként `{ data: [...] }` | `{ warning: "No identifier found." }` | `{ error: "…" }`
 * Limit kulcs nélkül: `ratelimit-limit: 25` / 60 mp (válaszfejléc); kulccsal magasabb.
 *
 * Amit az OpenFIGI NEM ad: jegyzési pénznemet, MIC-et, dátumot. Ezért:
 * - a MIC az igazolt `exchCode` táblából jön, ami nincs benne, azt kihagyjuk és MEGSZÁMOLJUK;
 * - a `tradingCurrency` `null` (nem találjuk ki; árforrás adja, PHASE 04B);
 * - a provenance `asOf` mezője `null`.
 */
import { z } from 'zod';

import {
  AppErrors,
  createListingCandidate,
  err,
  ok,
  securityIdFromIsin,
  toIsoTimestamp,
  type InstrumentKind,
  type IsoTimestamp,
  type Isin,
  type ListingCandidate,
  type Result,
  type SecurityListings,
} from '@/domain';

import {
  DEFAULT_UPSTREAM_TIMEOUT_MS,
  invalidUpstream,
  requestJson,
  type FetchLike,
} from '../../http/request-json';
import type { MarketDataProvider } from '../market-data-provider';
import { OPENFIGI_EXCHANGE_CODES, isCompositeRow } from './exchange-codes';

export const OPENFIGI_SOURCE = { sourceId: 'openfigi', sourceName: 'OpenFIGI' } as const;
export const OPENFIGI_MAPPING_URL = 'https://api.openfigi.com/v3/mapping';

const rowSchema = z.object({
  figi: z.string().min(1).max(20),
  name: z.string().max(200).nullish(),
  ticker: z.string().max(40).nullish(),
  exchCode: z.string().max(10).nullish(),
  compositeFIGI: z.string().max(20).nullish(),
  securityType: z.string().max(100).nullish(),
});

const jobResultSchema = z.union([
  z.object({ data: z.array(rowSchema).max(2000) }),
  z.object({ warning: z.string().max(500) }),
  z.object({ error: z.string().max(500) }),
]);

const mappingResponseSchema = z.array(jobResultSchema).min(1).max(100);

type OpenFigiRow = z.output<typeof rowSchema>;

function kindHintOf(securityType: string | null | undefined): InstrumentKind | null {
  if (securityType === 'ETP') return 'etf';
  if (securityType === 'Common Stock') return 'stock';
  return null;
}

/** OpenFIGI tickerformátum → a miénk (pl. `BRK/B` → `BRK.B`). */
function normalizeTicker(ticker: string): string {
  return ticker.trim().replace(/\//g, '.');
}

/** Tiszta normalizáló: egy job sorai → `SecurityListings`. */
export function normalizeOpenFigiRows(
  isin: Isin,
  rows: readonly OpenFigiRow[],
  fetchedAt: IsoTimestamp,
): SecurityListings {
  const listings: ListingCandidate[] = [];
  const seen = new Set<string>();
  const omitted = { unmappedVenue: 0, composite: 0, invalidSymbol: 0 };

  for (const row of rows) {
    const mapping = row.exchCode == null ? undefined : OPENFIGI_EXCHANGE_CODES[row.exchCode];
    if (mapping === undefined) {
      if (isCompositeRow(row)) omitted.composite += 1;
      else omitted.unmappedVenue += 1;
      continue;
    }
    const candidate = createListingCandidate({
      isin,
      symbol: normalizeTicker(row.ticker ?? ''),
      mic: mapping.mic,
      exchangeName: mapping.exchangeName,
      tradingCurrency: null,
      figi: row.figi,
      compositeFigi: row.compositeFIGI ?? null,
      kindHint: kindHintOf(row.securityType),
      sourceName: row.name?.trim() || null,
    });
    if (!candidate.ok) {
      omitted.invalidSymbol += 1;
      continue;
    }
    // Ugyanaz a ticker@MIC több soron is jöhet (pl. két szegmens) – az elsőt tartjuk meg.
    if (seen.has(candidate.value.listingId)) continue;
    seen.add(candidate.value.listingId);
    listings.push(candidate.value);
  }

  return {
    isin,
    securityId: securityIdFromIsin(isin),
    listings,
    omitted,
    provenance: {
      ...OPENFIGI_SOURCE,
      kind: 'reported',
      fetchedAt,
      asOf: null, // az OpenFIGI nem közöl dátumot
      freshness: 'UNKNOWN',
      reference: 'https://www.openfigi.com/api/documentation',
    },
  };
}

export interface OpenFigiProviderDeps {
  readonly fetchImpl: FetchLike;
  readonly now: () => Date;
  /** Opcionális: magasabb limit. Csak szerver env-ből (OPENFIGI_API_KEY). */
  readonly apiKey: string | null;
  readonly timeoutMs?: number;
}

export function createOpenFigiProvider(deps: OpenFigiProviderDeps): MarketDataProvider {
  return {
    info: {
      id: OPENFIGI_SOURCE.sourceId,
      name: OPENFIGI_SOURCE.sourceName,
      kind: 'live',
      configured: true,
      note:
        deps.apiKey === null
          ? 'Kulcs nélkül: 25 kérés/perc. Jegyzési pénznemet nem ad.'
          : 'Kulccsal (magasabb limit). Jegyzési pénznemet nem ad.',
    },

    async getSecurityListings(isin): Promise<Result<SecurityListings>> {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (deps.apiKey !== null) headers['X-OPENFIGI-APIKEY'] = deps.apiKey;

      const response = await requestJson({
        url: OPENFIGI_MAPPING_URL,
        method: 'POST',
        headers,
        body: JSON.stringify([{ idType: 'ID_ISIN', idValue: isin }]),
        sourceId: OPENFIGI_SOURCE.sourceId,
        fetchImpl: deps.fetchImpl,
        timeoutMs: deps.timeoutMs ?? DEFAULT_UPSTREAM_TIMEOUT_MS,
        notFound: { resource: 'értékpapír (ISIN)', id: isin },
      });
      if (!response.ok) return response;

      const parsed = mappingResponseSchema.safeParse(response.value);
      if (!parsed.success) {
        return err(invalidUpstream(OPENFIGI_SOURCE.sourceId, parsed.error.issues[0]));
      }
      const job = parsed.data[0];
      if (job === undefined || 'warning' in job) {
        return err(AppErrors.notFound('értékpapír (ISIN)', isin));
      }
      if ('error' in job) {
        return err(
          AppErrors.upstream(
            'HTTP_ERROR',
            `Az OpenFIGI elutasította a kérést: ${job.error}`,
            OPENFIGI_SOURCE.sourceId,
          ),
        );
      }
      return ok(normalizeOpenFigiRows(isin, job.data, toIsoTimestamp(deps.now())));
    },
  };
}
