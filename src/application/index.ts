/**
 * Alkalmazási réteg: use case-ek és portok. A UI csak ezen keresztül ér el adatot
 * (soha nem hív közvetlenül szolgáltatói API-t vagy `fetch`-et).
 */
import type { GetListingQuote } from './use-cases/get-listing-quote';
import type { RecordTransaction } from './use-cases/record-transaction';

export type * from './ports';
export * from './use-cases/get-listing-quote';
export * from './use-cases/record-transaction';

/** A UI számára elérhető szolgáltatások – a composition root (`src/config/container.ts`) állítja elő. */
export interface AppServices {
  readonly getListingQuote: GetListingQuote;
  readonly recordTransaction: RecordTransaction;
}
