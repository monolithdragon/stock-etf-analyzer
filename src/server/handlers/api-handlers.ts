/**
 * A proxy végpontjainak hosztfüggetlen `Request → Response` handlerei (D-004).
 * Az Expo Router `+api.ts` fájljai csak ezeket hívják; tesztben közvetlenül hívhatók.
 *
 * Allowlist (ARCHITECTURE 6.4/2): csak az itt felsorolt végpontok léteznek; nincs általános
 * továbbító. Minden bemenet validált, mielőtt szolgáltatóhoz érne. A forrást a
 * `ProviderRouter` választja (PHASE 04B); a válasz `warnings` mezője megmondja, ha tartalék
 * forrás adott választ, vagy ha egy forrás csomagkorlát/kvóta miatt kimaradt.
 */
import type { z } from 'zod';

import {
  PROVIDER_CAPABILITIES,
  dividendHistoryDtoSchema,
  financialStatementSetDtoSchema,
  fxRateSetDtoSchema,
  healthDtoSchema,
  instrumentProfileDtoSchema,
  instrumentSearchResultDtoSchema,
  priceSeriesDtoSchema,
  providerStatusDtoSchema,
  quoteDtoSchema,
  quoteToDto,
  securityListingsDtoSchema,
  type HealthDto,
  type ProviderStatusDto,
  type RoutingMarket,
} from '@/contracts';
import {
  AppErrors,
  DISPLAY_CURRENCIES,
  PRICE_ADJUSTMENTS,
  STATEMENT_FREQUENCIES,
  err,
  ok,
  parseCurrencyCode,
  parseIsin,
  parseIsoDate,
  parseListingId,
  parseSearchQuery,
  toIsoTimestamp,
  toUtcIsoDate,
  validateFields,
  type CurrencyCode,
  type IsoDate,
  type PriceAdjustment,
  type Result,
  type StatementFrequency,
} from '@/domain';

import type { ServerLogger } from '../logging';
import { appErrorToResponse, errorResponse, okResponse } from './http';
import {
  capabilitiesOf,
  type ImplementableCapability,
  type ProviderRegistry,
  type ProviderWith,
} from '../providers/market-data-provider';
import { marketOfListing } from '../routing/markets';
import { ROUTING_TABLE, type ProviderRouter, type RouteOutcome } from '../routing/provider-router';
import type { QuotaGuard } from '../routing/quota';

export interface ApiHandlerContext {
  readonly registry: ProviderRegistry;
  readonly router: ProviderRouter;
  /** Szolgáltatónkénti napi kvóta (providers/status). */
  readonly quotas: ReadonlyMap<string, QuotaGuard>;
  readonly now: () => Date;
  readonly logger: ServerLogger;
}

type RouteParams = Readonly<Record<string, string | undefined>>;
export type ApiHandler = (request: Request, params?: RouteParams) => Promise<Response>;

interface HandlerOutcome {
  readonly response: Response;
  readonly provider?: string;
  readonly errorKind?: string;
  readonly fallbackFrom?: string;
}

const MAX_FX_QUOTES = 30;
const DAY_MS = 24 * 60 * 60 * 1000;
/** Alapértelmezett időszak, ha a kliens nem ad `from`-ot. */
const DEFAULT_PRICE_DAYS = 365;
const DEFAULT_DIVIDEND_DAYS = 5 * 365;
/** Józansági felső korlát egy kérés időszakára. */
const MAX_RANGE_DAYS = 40 * 366;

const invalidRequest = (path: string, message: string) =>
  err(AppErrors.validation('Érvénytelen kérés.', [{ path, message }]));

function parseFxQuery(
  url: URL,
  today: IsoDate,
): Result<{ base: CurrencyCode; quotes: CurrencyCode[]; date: IsoDate | null }> {
  const rawQuotes = url.searchParams.get('quotes');
  const quoteList = (rawQuotes ?? DISPLAY_CURRENCIES.join(','))
    .split(',')
    .map((q) => q.trim())
    .filter(Boolean);
  if (quoteList.length === 0 || quoteList.length > MAX_FX_QUOTES) {
    return invalidRequest('quotes', `1–${MAX_FX_QUOTES} deviza adható meg.`);
  }
  const quotes: CurrencyCode[] = [];
  for (const raw of quoteList) {
    const parsed = parseCurrencyCode(raw);
    if (!parsed.ok) return invalidRequest('quotes', parsed.error.message);
    if (!quotes.includes(parsed.value)) quotes.push(parsed.value);
  }
  const rawDate = url.searchParams.get('date');
  const fields = validateFields(
    {
      base: parseCurrencyCode(url.searchParams.get('base') ?? 'EUR'),
      date: rawDate === null ? ok(null) : parseIsoDate(rawDate),
    },
    'Érvénytelen kérés.',
  );
  if (!fields.ok) return fields;
  if (fields.value.date !== null && fields.value.date > today) {
    return invalidRequest('date', 'Jövőbeli dátumra nincs árfolyam.');
  }
  return ok({ base: fields.value.base, quotes, date: fields.value.date });
}

function parseFrequency(url: URL): Result<StatementFrequency> {
  const raw = url.searchParams.get('period') ?? 'annual';
  return (STATEMENT_FREQUENCIES as readonly string[]).includes(raw)
    ? ok(raw as StatementFrequency)
    : invalidRequest('period', 'annual | quarterly');
}

/** `from`/`to` (ÉÉÉÉ-HH-NN). Hiányzó `to` = ma; hiányzó `from` = `to` − `defaultDays`. */
function parseDateRange(
  url: URL,
  today: IsoDate,
  defaultDays: number,
): Result<{ from: IsoDate; to: IsoDate }> {
  const rawTo = url.searchParams.get('to');
  const rawFrom = url.searchParams.get('from');
  const to = rawTo === null ? ok(today) : parseIsoDate(rawTo);
  if (!to.ok) return invalidRequest('to', to.error.message);
  if (to.value > today) return invalidRequest('to', 'Jövőbeli dátumra nincs adat.');
  const defaultFrom = toUtcIsoDate(new Date(Date.parse(to.value) - defaultDays * DAY_MS));
  const from = rawFrom === null ? ok(defaultFrom) : parseIsoDate(rawFrom);
  if (!from.ok) return invalidRequest('from', from.error.message);
  if (from.value > to.value) return invalidRequest('from', 'A kezdőnap nem lehet a záró nap után.');
  if (Date.parse(to.value) - Date.parse(from.value) > MAX_RANGE_DAYS * DAY_MS) {
    return invalidRequest('from', 'Legfeljebb 40 éves időszak kérhető.');
  }
  return ok({ from: from.value, to: to.value });
}

/** `adjustment=none|split|split_dividend`; alapértelmezés: `split_dividend` (mindkét forrás adja). */
function parseAdjustment(url: URL): Result<PriceAdjustment> {
  const raw = (url.searchParams.get('adjustment') ?? 'split_dividend').toUpperCase();
  return (PRICE_ADJUSTMENTS as readonly string[]).includes(raw)
    ? ok(raw as PriceAdjustment)
    : invalidRequest('adjustment', 'none | split | split_dividend');
}

export function createApiHandlers(ctx: ApiHandlerContext) {
  /** Közös keret: időmérés, napló (titok és személyes adat nélkül), hibából válasz. */
  function handle(
    route: string,
    run: (url: URL, params: RouteParams) => Promise<HandlerOutcome>,
  ): ApiHandler {
    return async (request, params = {}) => {
      const started = Date.now();
      let outcome: HandlerOutcome;
      try {
        outcome = await run(new URL(request.url), params);
      } catch {
        // Programozási hiba: a részleteket nem adjuk ki a kliensnek.
        outcome = {
          response: errorResponse('INTERNAL', 500, 'Belső hiba.'),
          errorKind: 'EXCEPTION',
        };
      }
      ctx.logger.info({
        route,
        status: outcome.response.status,
        latencyMs: Date.now() - started,
        ...(outcome.provider === undefined ? {} : { provider: outcome.provider }),
        ...(outcome.errorKind === undefined ? {} : { errorKind: outcome.errorKind }),
        ...(outcome.fallbackFrom === undefined ? {} : { fallbackFrom: outcome.fallbackFrom }),
      });
      return outcome.response;
    };
  }

  function respond(
    result: Result<unknown>,
    schema: z.ZodType,
    extra: { provider?: string; warnings?: readonly string[]; fallbackFrom?: string } = {},
  ): HandlerOutcome {
    const base = {
      ...(extra.provider === undefined ? {} : { provider: extra.provider }),
      ...(extra.fallbackFrom === undefined ? {} : { fallbackFrom: extra.fallbackFrom }),
    };
    if (!result.ok) {
      return { ...base, response: appErrorToResponse(result.error), errorKind: result.error.kind };
    }
    const { response, contractError } = okResponse(result.value, schema, extra.warnings ?? []);
    return contractError === null
      ? { ...base, response }
      : { ...base, response, errorKind: `CONTRACT:${contractError}` };
  }

  /** A router kimenetéből válasz: provenance = a ténylegesen használt forrás; tartalék → warning. */
  function respondRouted<T>(
    outcome: RouteOutcome<T>,
    schema: z.ZodType,
    toDto: (value: T) => unknown = (value) => value,
  ): HandlerOutcome {
    const failed = outcome.attempts.filter((a) => a.outcome !== 'OK');
    const fallbackFrom =
      failed.length === 0 ? undefined : failed.map((a) => `${a.providerId}:${a.outcome}`).join(',');
    const result = outcome.result.ok ? ok(toDto(outcome.result.value)) : outcome.result;
    return respond(result, schema, {
      ...(outcome.providerId === null ? {} : { provider: outcome.providerId }),
      warnings: outcome.warnings,
      ...(fallbackFrom === undefined ? {} : { fallbackFrom }),
    });
  }

  function route<C extends ImplementableCapability, T>(
    capability: C,
    market: RoutingMarket,
    listingId: Parameters<ProviderRouter['run']>[2],
    invoke: (provider: ProviderWith<C>) => Promise<Result<T>>,
  ) {
    return ctx.router.run(capability, market, listingId, invoke);
  }

  const today = () => toUtcIsoDate(ctx.now());

  return {
    health: handle('health', async () => {
      const providers = ctx.registry.providers.map((p) => ({
        id: p.info.id,
        name: p.info.name,
        kind: p.info.kind,
        capabilities: [...capabilitiesOf(p)],
        configured: p.info.configured,
        note: p.info.note,
      }));
      const covered = new Set(providers.filter((p) => p.configured).flatMap((p) => p.capabilities));
      const data: HealthDto = {
        status: 'ok',
        serverTime: toIsoTimestamp(ctx.now()),
        dataMode: ctx.registry.dataMode,
        providers,
        unavailableCapabilities: PROVIDER_CAPABILITIES.filter((c) => !covered.has(c)),
      };
      return respond(ok(data), healthDtoSchema);
    }),

    providerStatus: handle('providers/status', async () => {
      const routing: ProviderStatusDto['routing'] = [];
      for (const capability of PROVIDER_CAPABILITIES) {
        for (const market of Object.keys(ROUTING_TABLE[capability]) as RoutingMarket[]) {
          const { chain, whenEmpty } = ctx.router.resolve(capability, market);
          const configured = chain.filter((p) => p.info.configured).map((p) => p.info.id);
          routing.push({
            capability,
            market,
            chain: configured,
            unavailableReason:
              configured.length > 0 ? null : chain.length > 0 ? 'NOT_COVERED' : whenEmpty,
          });
        }
      }
      const data: ProviderStatusDto = {
        serverTime: toIsoTimestamp(ctx.now()),
        dataMode: ctx.registry.dataMode,
        providers: ctx.registry.providers.map((p) => {
          const snapshot = ctx.quotas.get(p.info.id)?.snapshot() ?? null;
          return {
            id: p.info.id,
            name: p.info.name,
            kind: p.info.kind,
            configured: p.info.configured,
            plan: p.info.plan,
            capabilities: [...capabilitiesOf(p)],
            coverage: p.info.coverage,
            quota: snapshot === null ? null : { ...snapshot, scope: 'instance' as const },
            note: p.info.note,
          };
        }),
        routing,
      };
      return respond(ok(data), providerStatusDtoSchema);
    }),

    fx: handle('fx', async (url) => {
      const query = parseFxQuery(url, today());
      if (!query.ok) return respond(query, fxRateSetDtoSchema);
      const outcome = await route('fxRates', 'ANY', null, (p) => p.getFxRates(query.value));
      return respondRouted(outcome, fxRateSetDtoSchema);
    }),

    securityListings: handle('securities/listings', async (_url, params) => {
      const isin = parseIsin(params.isin ?? '');
      if (!isin.ok) return respond(isin, securityListingsDtoSchema);
      const outcome = await route('listings', 'ANY', null, (p) =>
        p.getSecurityListings(isin.value),
      );
      return respondRouted(outcome, securityListingsDtoSchema);
    }),

    financials: handle('stocks/financials', async (url, params) => {
      const fields = validateFields(
        { listingId: parseListingId(params.id ?? ''), frequency: parseFrequency(url) },
        'Érvénytelen kérés.',
      );
      if (!fields.ok) return respond(fields, financialStatementSetDtoSchema);
      const { listingId, frequency } = fields.value;
      const outcome = await route(
        'financialStatements',
        marketOfListing(listingId),
        listingId,
        (p) => p.getFinancialStatements(listingId, frequency),
      );
      return respondRouted(outcome, financialStatementSetDtoSchema);
    }),

    quote: handle('instruments/quote', async (_url, params) => {
      const listingId = parseListingId(params.id ?? '');
      if (!listingId.ok) return respond(listingId, quoteDtoSchema);
      const outcome = await route('quote', marketOfListing(listingId.value), listingId.value, (p) =>
        p.getQuote(listingId.value),
      );
      return respondRouted(outcome, quoteDtoSchema, quoteToDto);
    }),

    prices: handle('instruments/prices', async (url, params) => {
      const fields = validateFields(
        {
          listingId: parseListingId(params.id ?? ''),
          range: parseDateRange(url, today(), DEFAULT_PRICE_DAYS),
          adjustment: parseAdjustment(url),
        },
        'Érvénytelen kérés.',
      );
      if (!fields.ok) return respond(fields, priceSeriesDtoSchema);
      const { listingId, range, adjustment } = fields.value;
      const outcome = await route('priceHistory', marketOfListing(listingId), listingId, (p) =>
        p.getPriceHistory({ listingId, ...range, adjustment }),
      );
      return respondRouted(outcome, priceSeriesDtoSchema);
    }),

    profile: handle('instruments/profile', async (_url, params) => {
      const listingId = parseListingId(params.id ?? '');
      if (!listingId.ok) return respond(listingId, instrumentProfileDtoSchema);
      const outcome = await route(
        'profile',
        marketOfListing(listingId.value),
        listingId.value,
        (p) => p.getProfile(listingId.value),
      );
      return respondRouted(outcome, instrumentProfileDtoSchema);
    }),

    dividends: handle('instruments/dividends', async (url, params) => {
      const fields = validateFields(
        {
          listingId: parseListingId(params.id ?? ''),
          range: parseDateRange(url, today(), DEFAULT_DIVIDEND_DAYS),
        },
        'Érvénytelen kérés.',
      );
      if (!fields.ok) return respond(fields, dividendHistoryDtoSchema);
      const { listingId, range } = fields.value;
      const outcome = await route('dividends', marketOfListing(listingId), listingId, (p) =>
        p.getDividends({ listingId, ...range }),
      );
      return respondRouted(outcome, dividendHistoryDtoSchema);
    }),

    search: handle('search', async (url) => {
      const query = parseSearchQuery(url.searchParams.get('q') ?? '');
      if (!query.ok)
        return respond(invalidRequest('q', query.error.message), instrumentSearchResultDtoSchema);
      const outcome = await route('search', 'ANY', null, (p) => p.searchInstruments(query.value));
      return respondRouted(outcome, instrumentSearchResultDtoSchema);
    }),
  };
}

export type ApiHandlers = ReturnType<typeof createApiHandlers>;
