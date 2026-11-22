/**
 * Use case: portfólióelemzés (PHASE 09).
 *
 * Lépések: portfólió + tranzakciók a tárolóból → napló-validáció (azonosító-ütközésnél
 * `VALIDATION` hiba) → árfolyam a nyitott pozíciókra, profil (opcionális), FX az ügyleti
 * napokra és mára, ártörténet (csak kérésre) → tiszta `buildPortfolioAnalysis`.
 *
 * Részleges hibatűrés: egy sikertelen lekérés csak az érintett pozíció/mutató állapotát rontja
 * (okkal), az elemzés többi része elkészül.
 *
 * Költség (szolgáltatói hívás): nyitott pozíciónként 1 árfolyam + (alapból) jegyzésenként
 * 1 profil + kérésre jegyzésenként 1–2 ártörténet; az FX az ECB-ből (kvóta nélkül). KI-76.
 */
import { RISK_MIN_OBSERVATIONS } from '@/calculations';
import {
  AppErrors,
  createEtfHoldingsSnapshot,
  createPortfolioAssetMetadata,
  err,
  ok,
  orderTransactions,
  parseCurrencyCode,
  parseIsoDate,
  parseListingId,
  parsePortfolioId,
  toIsoTimestamp,
  toLocalIsoDate,
  toMajor,
  validateFields,
  validateTransactionLedger,
  type AppError,
  type CurrencyCode,
  type EtfHoldingsSnapshot,
  type InstrumentProfile,
  type IsoDate,
  type ListingId,
  type PortfolioAssetMetadata,
  type PriceSeries,
  type Result,
  type Transaction,
  type ValidationIssue,
} from '@/domain';

import type { ConvertMoney } from './convert-money';
import type { GetListingQuote } from './get-listing-quote';
import type { GetInstrumentProfile, GetPriceHistory } from './get-market-data';
import {
  collectFxRequests,
  fxKey,
  majorOf,
  type FxEntry,
  type FxLookup,
} from '../portfolio/fx-lookup';
import { buildPortfolioAnalysis } from '../portfolio/portfolio-analysis';
import type { FxDailyPoint } from '../portfolio/portfolio-history';
import type { PortfolioAnalysis, PortfolioAnalysisOptions } from '../portfolio/types';
import type { Clock, PortfolioRepository } from '../ports';

export type AnalyzePortfolio = (
  portfolioId: string,
  options?: PortfolioAnalysisOptions,
) => Promise<Result<PortfolioAnalysis, AppError>>;

export interface AnalyzePortfolioDeps {
  readonly portfolioRepository: PortfolioRepository;
  readonly getListingQuote: GetListingQuote;
  readonly getInstrumentProfile: GetInstrumentProfile;
  readonly getPriceHistory: GetPriceHistory;
  readonly convertMoney: ConvertMoney;
  readonly clock: Clock;
}

export function createAnalyzePortfolio(deps: AnalyzePortfolioDeps): AnalyzePortfolio {
  return async (rawPortfolioId, options = {}) => {
    const parsed = validateFields(
      { portfolioId: parsePortfolioId(rawPortfolioId) },
      'Érvénytelen portfólió.',
    );
    if (!parsed.ok) return parsed;
    const { portfolioId } = parsed.value;

    const portfolio = await deps.portfolioRepository.getPortfolio(portfolioId);
    if (!portfolio.ok) return portfolio;
    if (portfolio.value === null) return err(AppErrors.notFound('portfólió', portfolioId));
    const listed = await deps.portfolioRepository.listTransactions(portfolioId);
    if (!listed.ok) return listed;
    const transactions = listed.value;

    const preliminary = validateTransactionLedger(portfolio.value, transactions);
    if (preliminary.blocking) {
      const issues: ValidationIssue[] = preliminary.issues
        .filter((i) => i.code === 'DUPLICATE_ID' || i.code === 'PORTFOLIO_MISMATCH')
        .map((i) => ({ path: `transactions.${i.transactionId}`, message: i.message }));
      return err(
        AppErrors.validation(
          'A tranzakciónapló sérült (azonosító-ütközés vagy idegen tranzakció).',
          issues,
        ),
      );
    }

    const parsedOptions = parseOptions(options);
    if (!parsedOptions.ok) return parsedOptions;
    const { assets, holdings, fxSeries, historyFrom } = parsedOptions.value;

    const now = deps.clock.now();
    const ordered = orderTransactions(transactions);
    const listings = [...new Set(ordered.map((t) => t.listingId))];
    const native = nativeCurrencies(ordered);
    const open = openListings(ordered, preliminary.invalidListings);
    const historyEnabled = options.history?.enabled === true;

    const [quotes, profiles, series, fx] = await Promise.all([
      fetchAll(open, (id) => deps.getListingQuote(id)),
      options.fetchProfiles === false
        ? Promise.resolve(new Map<ListingId, Result<InstrumentProfile, AppError>>())
        : fetchAll(listings, (id) => deps.getInstrumentProfile(id)),
      historyEnabled
        ? fetchAll(listings, (id) =>
            fetchSeries(
              deps.getPriceHistory,
              id,
              historyFrom ?? ordered[0]?.tradeDate ?? null,
              now,
            ),
          )
        : Promise.resolve(new Map<ListingId, Result<PriceSeries, AppError>>()),
      resolveFx(deps.convertMoney, portfolio.value.baseCurrency, ordered, open, native),
    ]);

    return ok(
      buildPortfolioAnalysis({
        portfolio: portfolio.value,
        transactions,
        now,
        quotes,
        fx,
        metadata: mergeMetadata(listings, profiles, assets),
        holdings,
        history: { enabled: historyEnabled, from: historyFrom, priceSeries: series, fxSeries },
        riskFreeRate: options.riskFreeRate ?? null,
        minRiskObservations: options.minRiskObservations ?? RISK_MIN_OBSERVATIONS,
      }),
    );
  };
}

// --- Lekérések -----------------------------------------------------------------------------

async function fetchAll<T>(
  ids: readonly ListingId[],
  fetch: (id: ListingId) => Promise<Result<T, AppError>>,
): Promise<Map<ListingId, Result<T, AppError>>> {
  const results = await Promise.all(ids.map(async (id) => [id, await fetch(id)] as const));
  return new Map(results);
}

async function fetchSeries(
  getPriceHistory: GetPriceHistory,
  listingId: ListingId,
  from: IsoDate | null,
  now: Date,
): Promise<Result<PriceSeries, AppError>> {
  const to = toLocalIsoDate(now);
  const start = from ?? to;
  const split = await getPriceHistory(listingId, { from: start, to, adjustment: 'SPLIT' });
  // Ha a forrás nem ad csak split-korrigált sort (EODHD: NOT_COVERED, hívás nélkül), a nyers sor.
  return !split.ok && split.error.kind === 'UNAVAILABLE' && split.error.reason === 'NOT_COVERED'
    ? getPriceHistory(listingId, { from: start, to, adjustment: 'NONE' })
    : split;
}

async function resolveFx(
  convertMoney: ConvertMoney,
  base: CurrencyCode,
  transactions: readonly Transaction[],
  open: readonly ListingId[],
  native: ReadonlyMap<ListingId, CurrencyCode>,
): Promise<FxLookup> {
  const openCurrencies = new Map<ListingId, CurrencyCode>();
  for (const id of open) {
    const currency = native.get(id);
    if (currency !== undefined) openCurrencies.set(id, currency);
  }
  const requests = collectFxRequests(base, transactions, openCurrencies);
  const resolved = await Promise.all(
    requests.map(async (request) => {
      const result = await convertMoney({
        money: { amount: 1, currency: request.currency },
        target: base,
        date: request.date,
      });
      const entry: FxEntry =
        result.ok && result.value.rate !== null
          ? {
              ok: true,
              rate: {
                currency: request.currency,
                rate: result.value.rate.rate,
                asOf: result.value.rate.asOf,
                source: 'market',
                provenance: result.value.rate.provenance,
              },
            }
          : result.ok
            ? { ok: true, rate: null }
            : {
                ok: false,
                reason: `${request.currency} → ${base}${request.date === null ? ' (mai)' : ` (${request.date})`}: ${result.error.message}`,
              };
      return [request, entry] as const;
    }),
  );
  const current = new Map<CurrencyCode, FxEntry>();
  const historical = new Map<string, FxEntry>();
  for (const [request, entry] of resolved) {
    if (request.date === null) current.set(request.currency, entry);
    else historical.set(fxKey(request.currency, request.date), entry);
  }
  return { base, current, historical };
}

// --- Segédek -------------------------------------------------------------------------------

function nativeCurrencies(ordered: readonly Transaction[]): ReadonlyMap<ListingId, CurrencyCode> {
  const map = new Map<ListingId, CurrencyCode>();
  for (const t of ordered) {
    if ((t.type === 'BUY' || t.type === 'SELL') && !map.has(t.listingId))
      map.set(t.listingId, t.price.currency);
  }
  return map;
}

function openListings(
  ordered: readonly Transaction[],
  invalid: ReadonlySet<ListingId>,
): readonly ListingId[] {
  const quantities = new Map<ListingId, number>();
  for (const t of ordered) {
    const held = quantities.get(t.listingId) ?? 0;
    if (t.type === 'BUY') quantities.set(t.listingId, held + t.quantity);
    else if (t.type === 'SELL') quantities.set(t.listingId, held - t.quantity);
    else if (t.type === 'SPLIT') quantities.set(t.listingId, (held * t.ratioTo) / t.ratioFrom);
  }
  // Hibás naplójú jegyzésnek is kérünk árat, ha pozitív a mennyisége (a validáció pénznem-ellenőrzéséhez).
  return [...quantities.entries()]
    .filter(([id, q]) => q > 1e-9 || invalid.has(id))
    .map(([id]) => id);
}

function mergeMetadata(
  listings: readonly ListingId[],
  profiles: ReadonlyMap<ListingId, Result<InstrumentProfile, AppError>>,
  assets: ReadonlyMap<ListingId, PortfolioAssetMetadata>,
): ReadonlyMap<ListingId, PortfolioAssetMetadata> {
  const merged = new Map<ListingId, PortfolioAssetMetadata>();
  for (const listingId of listings) {
    const user = assets.get(listingId);
    const profile = profiles.get(listingId);
    const fromProfile =
      profile !== undefined && profile.ok
        ? createPortfolioAssetMetadata({
            listingId,
            name: profile.value.name,
            isin: profile.value.isin,
            kind: profile.value.kindHint,
            // ETF-profil `country` mezője domicil – a kitettség-logika ETF-nél úgysem használja.
            country: profile.value.country,
            sector: profile.value.sector,
            source: { kind: 'reported', sourceName: profile.value.provenance.sourceName },
          })
        : null;
    const reported = fromProfile !== null && fromProfile.ok ? fromProfile.value : null;
    if (user === undefined) {
      if (reported !== null) merged.set(listingId, reported);
      continue;
    }
    // A kézi bevitel elsőbbséget élvez; a hiányzó kézi mezőt a szolgáltatói profil tölti.
    const kind = user.kind ?? reported?.kind ?? null;
    merged.set(listingId, {
      listingId,
      name: user.name ?? reported?.name ?? null,
      isin: user.isin ?? reported?.isin ?? null,
      kind,
      assetClass: kind === 'stock' ? 'equity' : (user.assetClass ?? reported?.assetClass ?? null),
      country: user.country ?? reported?.country ?? null,
      sector: user.sector ?? reported?.sector ?? null,
      hedgeCurrency: user.hedgeCurrency ?? reported?.hedgeCurrency ?? null,
      source:
        reported === null
          ? user.source
          : {
              kind: 'user_input',
              sourceName: `${user.source.sourceName} + ${reported.source.sourceName}`,
            },
    });
  }
  return merged;
}

interface ParsedOptions {
  readonly assets: ReadonlyMap<ListingId, PortfolioAssetMetadata>;
  readonly holdings: ReadonlyMap<ListingId, EtfHoldingsSnapshot>;
  readonly fxSeries: ReadonlyMap<CurrencyCode, readonly FxDailyPoint[]>;
  readonly historyFrom: IsoDate | null;
}

/** Az opciók futásidejű validálása (kézi bevitel / UI) – hiba esetén `VALIDATION` mezőútvonallal. */
function parseOptions(options: PortfolioAnalysisOptions): Result<ParsedOptions, AppError> {
  const issues: ValidationIssue[] = [];
  const fail = (path: string, error: AppError) => {
    const nested =
      error.kind === 'VALIDATION' && error.issues.length > 0
        ? error.issues
        : [{ path: '', message: error.message }];
    for (const issue of nested)
      issues.push({
        path: issue.path === '' ? path : `${path}.${issue.path}`,
        message: issue.message,
      });
  };

  const assets = new Map<ListingId, PortfolioAssetMetadata>();
  (options.assets ?? []).forEach((asset, index) => {
    const listingId = parseListingId(asset.listingId);
    if (!listingId.ok) return fail(`assets.${index}.listingId`, listingId.error);
    const meta = createPortfolioAssetMetadata({ ...asset, listingId: listingId.value });
    if (!meta.ok) return fail(`assets.${index}`, meta.error);
    assets.set(listingId.value, meta.value);
  });

  const holdings = new Map<ListingId, EtfHoldingsSnapshot>();
  (options.etfHoldings ?? []).forEach((entry, index) => {
    const listingId = parseListingId(entry.listingId);
    if (!listingId.ok) return fail(`etfHoldings.${index}.listingId`, listingId.error);
    const snapshot = createEtfHoldingsSnapshot({
      ...entry.snapshot,
      provenance: {
        sourceId: 'user',
        sourceName: entry.sourceName,
        kind: 'user_input',
        fetchedAt: toIsoTimestamp(new Date(0)),
        asOf: null,
        freshness: 'UNKNOWN',
      },
    });
    if (!snapshot.ok) return fail(`etfHoldings.${index}`, snapshot.error);
    holdings.set(listingId.value, {
      ...snapshot.value,
      provenance: { ...snapshot.value.provenance, asOf: snapshot.value.asOf },
    });
  });

  const fxSeries = new Map<CurrencyCode, FxDailyPoint[]>();
  for (const [code, points] of Object.entries(options.history?.fxSeries ?? {})) {
    const currency = parseCurrencyCode(code);
    if (!currency.ok) {
      fail(`history.fxSeries.${code}`, currency.error);
      continue;
    }
    if (toMajor(currency.value).divisor !== null) {
      fail(
        `history.fxSeries.${code}`,
        AppErrors.validation(`Alegység (${code}) helyett a fő pénznem rátája kell.`),
      );
      continue;
    }
    const parsedPoints: FxDailyPoint[] = [];
    points.forEach((point, index) => {
      const date = parseIsoDate(point.date);
      const previous = parsedPoints.at(-1);
      if (!date.ok) fail(`history.fxSeries.${code}.${index}.date`, date.error);
      else if (!Number.isFinite(point.rate) || point.rate <= 0) {
        fail(`history.fxSeries.${code}.${index}.rate`, AppErrors.validation('A ráta > 0 kell.'));
      } else if (previous !== undefined && date.value <= previous.date) {
        fail(
          `history.fxSeries.${code}.${index}.date`,
          AppErrors.validation('A dátumok szigorúan növekvők kell legyenek.'),
        );
      } else parsedPoints.push({ date: date.value, rate: point.rate });
    });
    fxSeries.set(majorOf(currency.value), parsedPoints);
  }

  let historyFrom: IsoDate | null = null;
  if (options.history?.from !== undefined) {
    const from = parseIsoDate(options.history.from);
    if (from.ok) historyFrom = from.value;
    else fail('history.from', from.error);
  }
  if (
    options.riskFreeRate !== undefined &&
    !(
      Number.isFinite(options.riskFreeRate) &&
      options.riskFreeRate > -1 &&
      options.riskFreeRate < 1
    )
  ) {
    issues.push({
      path: 'riskFreeRate',
      message: 'Tizedes tört kell (0.03 = 3%), −1 és 1 között.',
    });
  }
  if (
    options.minRiskObservations !== undefined &&
    !(Number.isInteger(options.minRiskObservations) && options.minRiskObservations >= 2)
  ) {
    issues.push({ path: 'minRiskObservations', message: 'Legalább 2 egész szám kell.' });
  }
  return issues.length > 0
    ? err(AppErrors.validation('Érvénytelen portfólióelemzési beállítás.', issues))
    : ok({ assets, holdings, fxSeries, historyFrom });
}
