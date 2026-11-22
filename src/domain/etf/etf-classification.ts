/**
 * ETF-kategóriák (PHASE 08, DATA_DICTIONARY 15.2).
 *
 * Minden dimenzió `Metric`, mert a free források NEM adnak ETF-metaadatot (PLAN_LIMIT): az érték
 * felhasználói bevitelből (`user_input`), egy későbbi szolgáltatóból (`reported`) vagy – csak a
 * régiónál – holdings-országsúlyból levezetve (`calculated`) jön. Kitalált kategória nincs.
 */
import type { Metric } from '../shared';

/** Földrajzi fókusz (feladat 3.). */
export const ETF_REGIONS = ['US', 'EUROPE', 'JAPAN', 'EMERGING', 'GLOBAL', 'OTHER'] as const;
export type EtfRegion = (typeof ETF_REGIONS)[number];

/** Eszközosztály – a kockázati és koncentrációs mutatók értelmezéséhez. */
export const ETF_ASSET_CLASSES = ['equity', 'bond', 'commodity', 'multi_asset', 'other'] as const;
export type EtfAssetClass = (typeof ETF_ASSET_CLASSES)[number];

/** Méretszegmens (`all_cap`: large + mid + small). */
export const ETF_SIZE_SEGMENTS = ['large', 'mid', 'small', 'large_mid', 'all_cap'] as const;
export type EtfSizeSegment = (typeof ETF_SIZE_SEGMENTS)[number];

/** Stílus / faktor. */
export const ETF_STYLES = ['growth', 'value', 'quality', 'momentum', 'blend'] as const;
export type EtfStyle = (typeof ETF_STYLES)[number];

/** Osztalékfókusz (az index szabálya, NEM a kifizetési mód – az a `distribution`). */
export const ETF_DIVIDEND_FOCUSES = ['none', 'dividend', 'dividend_growth'] as const;
export type EtfDividendFocus = (typeof ETF_DIVIDEND_FOCUSES)[number];

/** Súlyozási módszer. */
export const ETF_WEIGHTINGS = ['market_cap', 'equal', 'factor', 'fundamental'] as const;
export type EtfWeighting = (typeof ETF_WEIGHTINGS)[number];

export interface EtfClassification {
  readonly region: Metric<EtfRegion>;
  readonly assetClass: Metric<EtfAssetClass>;
  readonly sizeSegment: Metric<EtfSizeSegment>;
  readonly style: Metric<EtfStyle>;
  readonly dividendFocus: Metric<EtfDividendFocus>;
  readonly weighting: Metric<EtfWeighting>;
}

export type EtfClassificationKey = keyof EtfClassification;

/** Az egyes dimenziók megengedett értékei – futásidejű validációhoz (külső/kézi bevitel). */
export const ETF_CLASSIFICATION_VALUES: {
  readonly [K in EtfClassificationKey]: readonly string[];
} = {
  region: ETF_REGIONS,
  assetClass: ETF_ASSET_CLASSES,
  sizeSegment: ETF_SIZE_SEGMENTS,
  style: ETF_STYLES,
  dividendFocus: ETF_DIVIDEND_FOCUSES,
  weighting: ETF_WEIGHTINGS,
};
