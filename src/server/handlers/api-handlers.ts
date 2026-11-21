/**
 * A proxy végpontjainak hosztfüggetlen `Request → Response` handlerei (D-004).
 * Az Expo Router `+api.ts` fájljai csak ezeket hívják; tesztben közvetlenül hívhatók.
 *
 * Allowlist (ARCHITECTURE 6.4/2): csak az itt felsorolt végpontok léteznek; nincs általános
 * továbbító. Minden bemenet validált, mielőtt szolgáltatóhoz érne.
 */
import {
  PROVIDER_CAPABILITIES,
  financialStatementSetDtoSchema,
  fxRateSetDtoSchema,
  healthDtoSchema,
  quoteDtoSchema,
  quoteToDto,
  securityListingsDtoSchema,
  type HealthDto,
  type ProviderCapability,
} from '@/contracts';
import {
  AppErrors,
  DISPLAY_CURRENCIES,
  STATEMENT_FREQUENCIES,
  err,
  ok,
  parseCurrencyCode,
  parseIsin,
  parseIsoDate,
  parseListingId,
  toIsoTimestamp,
  toUtcIsoDate,
  validateFields,
  type AppError,
  type CurrencyCode,
  type IsoDate,
  type Result,
  type StatementFrequency,
} from '@/domain';

import type { ServerLogger } from '../logging';
import { appErrorToResponse, errorResponse, okResponse } from './http';
import {
  capabilitiesOf,
  findProvider,
  type ProviderRegistry,
} from '../providers/market-data-provider';

export interface ApiHandlerContext {
  readonly registry: ProviderRegistry;
  readonly now: () => Date;
  readonly logger: ServerLogger;
}

type RouteParams = Readonly<Record<string, string | undefined>>;
export type ApiHandler = (request: Request, params?: RouteParams) => Promise<Response>;

const MAX_FX_QUOTES = 30;

function capabilityUnavailable(capability: ProviderCapability): AppError {
  return AppErrors.missingData(
    ['source'],
    `Ehhez a képességhez (${capability}) nincs bekötött adatforrás. Az árfolyam-, ártörténet- és profilforrások (FMP, EODHD) a PHASE 04B-ben jönnek.`,
  );
}

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
    return err(
      AppErrors.validation('Érvénytelen kérés.', [
        { path: 'quotes', message: `1–${MAX_FX_QUOTES} deviza adható meg.` },
      ]),
    );
  }
  const quotes: CurrencyCode[] = [];
  for (const raw of quoteList) {
    const parsed = parseCurrencyCode(raw);
    if (!parsed.ok)
      return err(
        AppErrors.validation('Érvénytelen kérés.', [
          { path: 'quotes', message: parsed.error.message },
        ]),
      );
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
    return err(
      AppErrors.validation('Érvénytelen kérés.', [
        { path: 'date', message: 'Jövőbeli dátumra nincs árfolyam.' },
      ]),
    );
  }
  return ok({ base: fields.value.base, quotes, date: fields.value.date });
}

function parseFrequency(url: URL): Result<StatementFrequency> {
  const raw = url.searchParams.get('period') ?? 'annual';
  return (STATEMENT_FREQUENCIES as readonly string[]).includes(raw)
    ? ok(raw as StatementFrequency)
    : err(
        AppErrors.validation('Érvénytelen kérés.', [
          { path: 'period', message: 'annual | quarterly' },
        ]),
      );
}

export function createApiHandlers(ctx: ApiHandlerContext) {
  /** Közös keret: időmérés, napló (titok és személyes adat nélkül), hibából válasz. */
  function handle(
    route: string,
    run: (
      url: URL,
      params: RouteParams,
    ) => Promise<{ response: Response; provider?: string; errorKind?: string }>,
  ): ApiHandler {
    return async (request, params = {}) => {
      const started = Date.now();
      let outcome: { response: Response; provider?: string; errorKind?: string };
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
      });
      return outcome.response;
    };
  }

  function respond<T>(
    result: Result<T>,
    schema: Parameters<typeof okResponse>[1],
    provider?: string,
  ) {
    if (!result.ok)
      return { response: appErrorToResponse(result.error), provider, errorKind: result.error.kind };
    const { response, contractError } = okResponse(result.value, schema);
    return {
      response,
      provider,
      errorKind: contractError === null ? undefined : `CONTRACT:${contractError}`,
    };
  }

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

    fx: handle('fx', async (url) => {
      const query = parseFxQuery(url, toUtcIsoDate(ctx.now()));
      if (!query.ok) return respond(query, fxRateSetDtoSchema);
      const provider = findProvider(ctx.registry, 'fxRates');
      if (provider === null)
        return respond(err(capabilityUnavailable('fxRates')), fxRateSetDtoSchema);
      return respond(await provider.getFxRates(query.value), fxRateSetDtoSchema, provider.info.id);
    }),

    securityListings: handle('securities/listings', async (_url, params) => {
      const isin = parseIsin(params.isin ?? '');
      if (!isin.ok) return respond(isin, securityListingsDtoSchema);
      const provider = findProvider(ctx.registry, 'listings');
      if (provider === null)
        return respond(err(capabilityUnavailable('listings')), securityListingsDtoSchema);
      return respond(
        await provider.getSecurityListings(isin.value),
        securityListingsDtoSchema,
        provider.info.id,
      );
    }),

    financials: handle('stocks/financials', async (url, params) => {
      const fields = validateFields(
        { listingId: parseListingId(params.id ?? ''), frequency: parseFrequency(url) },
        'Érvénytelen kérés.',
      );
      if (!fields.ok) return respond(fields, financialStatementSetDtoSchema);
      const provider = findProvider(ctx.registry, 'financialStatements');
      if (provider === null) {
        return respond(
          err(capabilityUnavailable('financialStatements')),
          financialStatementSetDtoSchema,
        );
      }
      const result = await provider.getFinancialStatements(
        fields.value.listingId,
        fields.value.frequency,
      );
      return respond(result, financialStatementSetDtoSchema, provider.info.id);
    }),

    quote: handle('instruments/quote', async (_url, params) => {
      const listingId = parseListingId(params.id ?? '');
      if (!listingId.ok) return respond(listingId, quoteDtoSchema);
      const provider = findProvider(ctx.registry, 'quote');
      if (provider === null) return respond(err(capabilityUnavailable('quote')), quoteDtoSchema);
      const quote = await provider.getQuote(listingId.value);
      return respond(
        quote.ok ? ok(quoteToDto(quote.value)) : quote,
        quoteDtoSchema,
        provider.info.id,
      );
    }),
  };
}

export type ApiHandlers = ReturnType<typeof createApiHandlers>;
