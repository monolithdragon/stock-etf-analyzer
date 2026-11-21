/**
 * `ecb-fx` adapter: ECB referencia-árfolyamok a Frankfurter v2 ECB providerén át (D-017, D-024).
 *
 * Végpont (igazolva 2026-11-21): `GET https://api.frankfurter.dev/v2/providers/ecb/rates`
 *   `?base=EUR&quotes=USD,HUF&date=YYYY-MM-DD`
 * Válasz: `[{ "date": "2026-11-20", "base": "EUR", "quote": "USD", "rate": 1.099 }, …]`
 * Megfigyelt viselkedés:
 * - hétvégi/ünnepnapi `date` → az előtte lévő utolsó ECB nap (pl. 2026-11-15 → 2026-11-13);
 * - az ECB által nem közölt, de létező deviza → üres tömb (HTTP 200);
 * - ismeretlen deviza / hibás dátum → HTTP 422 `{ "status": 422, "message": "…" }`;
 * - a válasz tartalmazhat `EUR → EUR = 1` sort, ezt eldobjuk.
 */
import { z } from 'zod';

import {
  AppErrors,
  createFxRate,
  createFxRateSet,
  err,
  ok,
  parseCurrencyCode,
  parseIsoDate,
  toIsoTimestamp,
  type CurrencyCode,
  type FxRate,
  type IsoTimestamp,
  type Result,
} from '@/domain';

import {
  DEFAULT_UPSTREAM_TIMEOUT_MS,
  invalidUpstream,
  requestJson,
  type FetchLike,
} from '../../http/request-json';
import type { FxRatesRequest, MarketDataProvider } from '../market-data-provider';

export const ECB_FX_SOURCE = {
  sourceId: 'ecb-fx',
  sourceName: 'ECB referencia-árfolyam (Frankfurter v2)',
} as const;
export const ECB_FX_BASE_URL = 'https://api.frankfurter.dev/v2/providers/ecb/rates';
const ECB_PIVOT = 'EUR';
const ECB_REFERENCE_URL =
  'https://www.ecb.europa.eu/stats/policy_and_exchange_rates/euro_reference_exchange_rates/html/index.en.html';

/** Szolgáltatói DTO – csak itt él, a domainbe nem szivárog. */
const frankfurterRatesSchema = z
  .array(
    z.object({
      date: z.string(),
      base: z.string(),
      quote: z.string(),
      rate: z.number(),
    }),
  )
  .max(500);

const frankfurterErrorSchema = z.object({ status: z.number(), message: z.string().max(500) });

export function normalizeFrankfurterRates(
  json: unknown,
  request: FxRatesRequest,
  fetchedAt: IsoTimestamp,
): Result<{ rates: FxRate[]; missing: CurrencyCode[] }> {
  const parsed = frankfurterRatesSchema.safeParse(json);
  if (!parsed.success) return err(invalidUpstream(ECB_FX_SOURCE.sourceId, parsed.error.issues[0]));

  const rates: FxRate[] = [];
  for (const [index, row] of parsed.data.entries()) {
    if (row.quote === row.base) continue; // EUR → EUR = 1, nem információ
    const base = parseCurrencyCode(row.base);
    const quote = parseCurrencyCode(row.quote);
    const asOf = parseIsoDate(row.date);
    if (!base.ok || !quote.ok || !asOf.ok || base.value !== request.base) {
      return err(
        invalidUpstream(ECB_FX_SOURCE.sourceId, {
          path: [index],
          message: `Váratlan sor: ${row.base}/${row.quote} @ ${row.date}.`,
        }),
      );
    }
    const rate = createFxRate({
      base: base.value,
      quote: quote.value,
      rate: row.rate,
      asOf: asOf.value,
      provenance: {
        ...ECB_FX_SOURCE,
        kind: 'reported',
        fetchedAt,
        asOf: asOf.value,
        freshness: 'UNKNOWN', // a kliens FxService-e ítéli meg a saját órájával
        reference: ECB_REFERENCE_URL,
      },
    });
    if (!rate.ok) {
      return err(
        invalidUpstream(ECB_FX_SOURCE.sourceId, { path: [index], message: rate.error.message }),
      );
    }
    rates.push(rate.value);
  }

  const present = new Set<string>(rates.map((r) => r.quote));
  const missing = request.quotes.filter((q) => q !== request.base && !present.has(q));
  return ok({ rates, missing });
}

export interface EcbFxProviderDeps {
  readonly fetchImpl: FetchLike;
  /** A lekérés időpontja (provenance `fetchedAt`); tesztben rögzített. */
  readonly now: () => Date;
  readonly timeoutMs?: number;
}

export function createEcbFxProvider(deps: EcbFxProviderDeps): MarketDataProvider {
  return {
    info: {
      id: ECB_FX_SOURCE.sourceId,
      name: ECB_FX_SOURCE.sourceName,
      kind: 'live',
      configured: true,
      note: 'Csak EUR bázis; munkanaponként ~16:00 CET. „Csak tájékoztató célra” (ECB).',
    },

    async getFxRates(request) {
      if (request.base !== ECB_PIVOT) {
        return err(
          AppErrors.validation(`Az ECB-forrás bázisa csak ${ECB_PIVOT} lehet.`, [
            { path: 'base', message: `Csak ${ECB_PIVOT}; a keresztárfolyamot a kliens számolja.` },
          ]),
        );
      }
      const params = new URLSearchParams({ base: request.base });
      const quotes = request.quotes.filter((q) => q !== request.base);
      if (quotes.length > 0) params.set('quotes', quotes.join(','));
      if (request.date !== null) params.set('date', request.date);

      const response = await requestJson({
        url: `${ECB_FX_BASE_URL}?${params.toString()}`,
        sourceId: ECB_FX_SOURCE.sourceId,
        fetchImpl: deps.fetchImpl,
        timeoutMs: deps.timeoutMs ?? DEFAULT_UPSTREAM_TIMEOUT_MS,
        mapStatus: (status, body) => {
          if (status !== 422) return null;
          const detail = frankfurterErrorSchema.safeParse(body);
          return AppErrors.validation('Az FX-forrás elutasította a kérést.', [
            { path: '', message: detail.success ? detail.data.message : 'HTTP 422' },
          ]);
        },
      });
      if (!response.ok) return response;

      const normalized = normalizeFrankfurterRates(
        response.value,
        request,
        toIsoTimestamp(deps.now()),
      );
      if (!normalized.ok) return normalized;
      return createFxRateSet({ base: request.base, ...normalized.value });
    },
  };
}
