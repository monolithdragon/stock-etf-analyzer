/**
 * Use case: ETF-elemzés (PHASE 08).
 *
 * Lekéri a jegyzés árfolyamát, profilját, 3 éves ártörténetét (korrigált + árfolyamsor) és
 * osztaléktörténetét, majd a tiszta `buildEtfAnalysis`-szel összerakja az elemzést.
 * Részleges hibatűrés: egy sikertelen lekérés csak az érintett mutatókat teszi hiányossá.
 *
 * Kvótaköltség (free EODHD: 20 hívás/nap): 4–5 hívás / elemzés (KI-68). Cache: PHASE 13.
 *
 * Ha a szolgáltatói profil szerint a jegyzés RÉSZVÉNY, `VALIDATION` hibát ad: a részvényt a
 * részvényelemzés kezeli (az ETF- és a részvénylogika külön van választva).
 */
import {
  AppErrors,
  createMoney,
  err,
  parseCurrencyCode,
  parseListingId,
  toUtcIsoDate,
  type AppError,
  type FxConversion,
  type Result,
} from '@/domain';

import type { ConvertMoney } from './convert-money';
import type { GetListingQuote } from './get-listing-quote';
import type { GetDividendHistory, GetInstrumentProfile, GetPriceHistory } from './get-market-data';
import { buildEtfAnalysis } from '../etf-analysis/etf-analysis';
import type { EtfAnalysis, EtfAnalysisOptions } from '../etf-analysis/types';
import type { Clock } from '../ports';

const DAY_MS = 86_400_000;
/** A kért ártörténet hossza (a free EODHD 1 évre vágja – a sor `notes` mezője jelzi). */
export const ETF_PRICE_HISTORY_YEARS = 3;

export type AnalyzeEtf = (
  listingId: string,
  options?: EtfAnalysisOptions,
) => Promise<Result<EtfAnalysis, AppError>>;

export interface AnalyzeEtfDeps {
  readonly getListingQuote: GetListingQuote;
  readonly getPriceHistory: GetPriceHistory;
  readonly getDividendHistory: GetDividendHistory;
  readonly getInstrumentProfile: GetInstrumentProfile;
  readonly convertMoney: ConvertMoney;
  readonly clock: Clock;
}

export function createAnalyzeEtf(deps: AnalyzeEtfDeps): AnalyzeEtf {
  return async (rawListingId, options = {}) => {
    const parsed = parseListingId(rawListingId);
    if (!parsed.ok) return parsed;
    const listingId = parsed.value;
    const now = deps.clock.now();
    const to = toUtcIsoDate(now);
    const from = toUtcIsoDate(new Date(now.getTime() - ETF_PRICE_HISTORY_YEARS * 365 * DAY_MS));

    const [quote, instrumentProfile, totalSeries, splitSeries, dividends] = await Promise.all([
      deps.getListingQuote(listingId),
      deps.getInstrumentProfile(listingId),
      deps.getPriceHistory(listingId, { from, to, adjustment: 'SPLIT_DIVIDEND' }),
      deps.getPriceHistory(listingId, { from, to, adjustment: 'SPLIT' }),
      deps.getDividendHistory(listingId, { from, to }),
    ]);

    if (instrumentProfile.ok && instrumentProfile.value.kindHint === 'stock') {
      return err(
        AppErrors.validation(
          `A(z) ${listingId} a szolgáltató szerint részvény, nem ETF – használd a részvényelemzést.`,
          [{ path: 'listingId', message: 'Nem ETF.' }],
        ),
      );
    }

    // Ha a forrás nem ad csak split-korrigált sort (EODHD: NOT_COVERED, hívás nélkül), a nyers
    // sor a tartalék (split-figyelmeztetéssel).
    const priceSeries =
      !splitSeries.ok &&
      splitSeries.error.kind === 'UNAVAILABLE' &&
      splitSeries.error.reason === 'NOT_COVERED'
        ? await deps.getPriceHistory(listingId, { from, to, adjustment: 'NONE' })
        : splitSeries;

    return buildEtfAnalysis({
      listingId,
      now,
      options,
      quote,
      instrumentProfile,
      totalSeries,
      priceSeries,
      dividends,
      aumConversion: await convertAum(deps.convertMoney, options),
    });
  };
}

async function convertAum(
  convertMoney: ConvertMoney,
  options: EtfAnalysisOptions,
): Promise<Result<FxConversion, AppError> | null> {
  const aum = options.metadata?.aum;
  if (options.displayCurrency === undefined || aum === undefined || aum === null) return null;
  const currency = parseCurrencyCode(aum.currency);
  if (!currency.ok) return null; // a profil-építő validációs hibát ad
  const money = createMoney(aum.amount, currency.value);
  if (!money.ok) return null;
  const target = parseCurrencyCode(options.displayCurrency);
  if (!target.ok) return target;
  return convertMoney({ money: money.value, target: target.value });
}
