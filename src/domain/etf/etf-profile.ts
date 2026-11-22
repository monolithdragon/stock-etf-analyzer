/**
 * ETF-profil – az ETF-elemzés bemeneti modellje egy konkrét jegyzésre (PHASE 08, DATA_DICTIONARY 15.1).
 *
 * Különbség a `domain/instrument` `Etf` entitástól: az `Etf` az értékpapír (security) szintű
 * metaadat; az `EtfProfile` az elemzéshez kell, és egy jegyzéshez (ticker@MIC) kötődik, így
 * tartalmazza a jegyzési devizát, a fedezési devizát, a kategóriákat és a holdings-t is.
 *
 * Minden forrásfüggő mező `Metric<T>`: érték + provenance, VAGY a hiány oka. A free csomagban
 * az ETF-specifikus mezők `UNAVAILABLE / PLAN_LIMIT` státuszúak, amíg a felhasználó meg nem adja
 * őket (`user_input`) – így a lefedettségi korlát mezőnként látható.
 *
 * Deviza-fogalmak (D-068) – a három NEM ugyanaz:
 * - `tradingCurrency`: a jegyzés pénzneme (pl. VWCE@XETR: EUR, ISF@XLON: GBX);
 * - `fundBaseCurrency`: az alap könyvelési devizája (pl. VWCE: USD);
 * - a mögöttes kitettség: a holdings devizái (pl. ~60% USD); fedezett osztálynál a `hedgeCurrency`.
 */
import type { EtfDistribution, EtfReplication } from '../instrument/instrument';
import type { CurrencyCode, IsoDate, Isin, ListingId, Metric, Money } from '../shared';
import type { EtfClassification } from './etf-classification';
import type { EtfHoldingsSnapshot } from './etf-holdings';

export interface EtfProfile {
  readonly listingId: ListingId;
  /** A ticker (a `listingId` szimbólum része). */
  readonly ticker: string;
  /** A tőzsde MIC-kódja (a `listingId` része). */
  readonly exchange: string;
  readonly name: Metric<string>;
  readonly isin: Metric<Isin>;
  readonly issuer: Metric<string>;
  /** Domicil (ISO 3166-1 alpha-2), pl. `IE`, `LU`, `US`. */
  readonly domicile: Metric<string>;
  readonly tradingCurrency: Metric<CurrencyCode>;
  readonly fundBaseCurrency: Metric<CurrencyCode>;
  readonly aum: Metric<Money>;
  readonly inceptionDate: Metric<IsoDate>;
  /** Teljes költséghányad tizedes törtként (0.0022 = 0,22%/év). */
  readonly ter: Metric<number>;
  readonly replication: Metric<EtfReplication>;
  readonly benchmark: Metric<string>;
  readonly distribution: Metric<EtfDistribution>;
  /** UCITS státusz; nem európai domicilnél `NOT_APPLICABLE`. */
  readonly ucits: Metric<boolean>;
  readonly currencyHedged: Metric<boolean>;
  /** A fedezés célpénzneme; fedezetlen osztálynál `NOT_APPLICABLE`. */
  readonly hedgeCurrency: Metric<CurrencyCode>;
  readonly classification: EtfClassification;
  readonly holdings: Metric<EtfHoldingsSnapshot>;
}

/** Az `EtfProfile` mezői, amelyek lefedettségét az elemzés mezőnként kimutatja. */
export const ETF_PROFILE_FIELDS = [
  'name',
  'isin',
  'issuer',
  'domicile',
  'tradingCurrency',
  'fundBaseCurrency',
  'aum',
  'inceptionDate',
  'ter',
  'replication',
  'benchmark',
  'distribution',
  'ucits',
  'currencyHedged',
  'hedgeCurrency',
  'holdings',
] as const satisfies readonly (keyof EtfProfile)[];
export type EtfProfileField = (typeof ETF_PROFILE_FIELDS)[number];
