/**
 * Alkalmazási réteg: use case-ek és portok. A UI csak ezen keresztül ér el adatot
 * (soha nem hív közvetlenül szolgáltatói API-t vagy `fetch`-et).
 */
import type { ConvertMoney } from './use-cases/convert-money';
import type { GetListingQuote } from './use-cases/get-listing-quote';
import type {
  GetDividendHistory,
  GetInstrumentProfile,
  GetPriceHistory,
  SearchInstruments,
} from './use-cases/get-market-data';
import type {
  GetFinancialStatements,
  GetSecurityListings,
} from './use-cases/get-market-reference-data';
import type { RecordTransaction } from './use-cases/record-transaction';

export type * from './ports';
export * from './use-cases/convert-money';
export * from './use-cases/get-listing-quote';
export * from './use-cases/get-market-data';
export * from './use-cases/get-market-reference-data';
export * from './use-cases/record-transaction';

/** A UI számára elérhető szolgáltatások – a composition root (`src/config/container.ts`) állítja elő. */
export interface AppServices {
  readonly getListingQuote: GetListingQuote;
  readonly getSecurityListings: GetSecurityListings;
  readonly getFinancialStatements: GetFinancialStatements;
  readonly getPriceHistory: GetPriceHistory;
  readonly getInstrumentProfile: GetInstrumentProfile;
  readonly getDividendHistory: GetDividendHistory;
  readonly searchInstruments: SearchInstruments;
  readonly convertMoney: ConvertMoney;
  readonly recordTransaction: RecordTransaction;
}
