/**
 * ETF-elemzés – bemeneti opciók és kimeneti modell (PHASE 08, DATA_DICTIONARY 15., D-066…D-069).
 *
 * Elvek:
 * - Az ETF NEM részvény: vállalati P/E, DCF és minőségi modell nem fut (lásd `notApplicable`).
 * - Minden mutató `Metric`: érték + provenance VAGY a hiány oka; az eredet-címke (`origin`)
 *   UI- és AI-barát összefoglaló.
 * - A lefedettségi korlátok mezőnként láthatók (`coverage`).
 * - A score-feature modell SÚLYOZÁS NÉLKÜLI; a döntési engine a PHASE 10 feladata.
 * - Elemzési kimenet, NEM befektetési tanács és NEM hozamígéret.
 */
import type { RiskReliability } from '@/calculations';
import type {
  CurrencyCode,
  DisplayCurrency,
  EtfClassificationKey,
  EtfHoldingsSnapshotInput,
  EtfProfile,
  EtfProfileField,
  IsoDate,
  IsoTimestamp,
  ListingId,
  MeasurementUnit,
  Metric,
  MetricOrigin,
  MetricStatus,
  Money,
  PriceSeries,
} from '@/domain';

// --- Bemenet ---------------------------------------------------------------------------------

/**
 * ETF-metaadat a free forrásokon túlról: felhasználói bevitel (`user_input`, pl. a kibocsátó
 * KID/factsheet dokumentumából) vagy egy későbbi szolgáltató (`reported`). Futásidőben validált.
 * Egy mező hiánya (`undefined`/`null`) = nem adták meg → `MISSING` (nem 0, nem alapérték).
 */
export interface EtfMetadataInput {
  readonly source: {
    readonly kind: 'user_input' | 'reported';
    readonly sourceId: string;
    readonly sourceName: string;
    /** A metaadat érvényességi dátuma (pl. factsheet dátuma), ÉÉÉÉ-HH-NN. */
    readonly asOf: string | null;
  };
  readonly name?: string | null;
  readonly isin?: string | null;
  readonly issuer?: string | null;
  readonly domicile?: string | null;
  readonly fundBaseCurrency?: string | null;
  readonly aum?: {
    readonly amount: number;
    readonly currency: string;
    readonly asOf?: string | null;
  } | null;
  readonly inceptionDate?: string | null;
  /** Tizedes tört: 0.0022 = 0,22%. */
  readonly ter?: number | null;
  readonly replication?: string | null;
  readonly benchmark?: string | null;
  readonly distribution?: string | null;
  readonly ucits?: boolean | null;
  readonly currencyHedged?: boolean | null;
  readonly hedgeCurrency?: string | null;
  readonly classification?: Partial<Record<EtfClassificationKey, string | null>>;
  /** Holdings-pillanatkép; a provenance a `source`-ból jön, `asOf` = a pillanatkép dátuma. */
  readonly holdings?: Omit<EtfHoldingsSnapshotInput, 'provenance'> | null;
}

/** Az index hozamának alapja: tracking difference csak total return indexszel értelmes. */
export type BenchmarkReturnBasis = 'net_total_return' | 'gross_total_return' | 'price';

export interface EtfBenchmarkInput {
  readonly name: string;
  readonly returnBasis: BenchmarkReturnBasis;
  /** Az index napi szintjei (a `series.adjustment` itt nem releváns – a `returnBasis` dönt). */
  readonly series: PriceSeries;
}

export interface EtfAnalysisOptions {
  readonly metadata?: EtfMetadataInput;
  /** Tracking és béta csak indexsorral. Ma nincs indexforrás → a hívó adja (vagy hiányzik). */
  readonly benchmark?: EtfBenchmarkInput;
  /** Kockázatmentes hozam (éves, tört) a Sharpe/Sortino-hoz – felhasználói beállítás. */
  readonly riskFreeRate?: number;
  /** Kijelzési pénznem (AUM-átváltás, devizakockázat viszonyítási alapja). */
  readonly displayCurrency?: DisplayCurrency;
  /** TER hosszú távú hatásának feltevései (alapérték: 10 év, 6% bruttó hozam – jelölve). */
  readonly terImpact?: { readonly years?: number; readonly assumedGrossReturn?: number };
  /** Átlagos napi forgalom (a normalizált ártörténet nem tartalmaz volument, KI-67). */
  readonly liquidity?: {
    readonly averageDailyTradedValue: number;
    readonly currency: string;
    readonly asOf: string;
    readonly sourceName: string;
  };
  /** A kockázati mutatók minimális periódushozam-száma (alap: 126 ≈ fél év napi adat). */
  readonly minRiskObservations?: number;
}

// --- Kimenet: mutatók ------------------------------------------------------------------------

export interface AnalysisWindow {
  readonly start: IsoDate;
  readonly end: IsoDate;
  /** Periódushozamok száma (napi sornál: kereskedési napok − 1). */
  readonly observations: number;
}

export interface EtfMetric {
  readonly id: string;
  readonly label: string;
  readonly unit: MeasurementUnit;
  /** A képlet emberi nyelvű definíciója (DATA_DICTIONARY 15.). */
  readonly formula: string;
  readonly value: Metric<number>;
  readonly origin: MetricOrigin;
  readonly window: AnalysisWindow | null;
  /**
   * Csak kiszámolt kockázati/követési mutatónál: `standard` (≈ ≥ 1 év) vagy `short_window`
   * (a minimum felett, de rövidebb ablak – D-070). Minden más esetben `null`.
   */
  readonly reliability: RiskReliability | null;
  readonly notes: readonly string[];
}

// --- Kimenet: szakaszok ----------------------------------------------------------------------

export interface EtfCoverageItem {
  readonly field: EtfProfileField | `classification.${EtfClassificationKey}`;
  readonly status: MetricStatus;
  readonly origin: MetricOrigin;
  /** A hiány oka (nem-OK státusznál). */
  readonly reason: string | null;
}

export interface EtfCoverage {
  readonly items: readonly EtfCoverageItem[];
  readonly available: number;
  readonly total: number;
  /** Ember által olvasható korlátok (pl. „free csomag: nincs ETF-metaadat”). */
  readonly limitations: readonly string[];
}

export interface EtfCurrencyAnalysis {
  readonly tradingCurrency: Metric<CurrencyCode>;
  readonly fundBaseCurrency: Metric<CurrencyCode>;
  readonly hedged: Metric<boolean>;
  readonly hedgeCurrency: Metric<CurrencyCode>;
  /** Mögöttes devizakitettség a holdings devizája szerint (tört, csökkenő). */
  readonly underlyingExposure: Metric<
    readonly { readonly currency: string; readonly weight: number }[]
  >;
  /** A kijelzési devizához viszonyított fedezetlen idegen kitettség. */
  readonly unhedgedForeignShare: EtfMetric;
  readonly displayCurrency: DisplayCurrency | null;
  /** AUM a kijelzési pénznemben (ha kért és van FX), egyébként a hiány oka. */
  readonly aumInDisplayCurrency: Metric<Money>;
  readonly notes: readonly string[];
}

export type TotalReturnMethod =
  /** Split- és osztalék-korrigált ártörténetből. */
  | 'adjusted_series'
  /** Akkumuláló ETF: az ár már tartalmazza az újrabefektetett hozamot. */
  | 'accumulating_price'
  /** Disztribúciós ETF: árhozam + az időszak kifizetései (újrabefektetés nélkül). */
  | 'price_plus_distributions';

/** Az ETF-hozam összehasonlítási alapja. */
export type ReturnComparisonBasis = 'total_return' | 'price_return_only' | 'none';

export interface EtfReturnAnalysis {
  readonly priceReturn: EtfMetric;
  readonly totalReturn: EtfMetric;
  readonly totalReturnMethod: TotalReturnMethod | null;
  readonly annualizedTotalReturn: EtfMetric;
  readonly distributionYieldTtm: EtfMetric;
  /**
   * Összehasonlítási alap: két ETF hozama csak azonos alapon (`total_return`) vethető össze.
   * `price_return_only`: csak árfolyamhozam van – disztribúciós ETF-nél félrevezető.
   */
  readonly comparisonBasis: ReturnComparisonBasis;
  readonly notes: readonly string[];
}

export interface EtfRiskAnalysis {
  readonly volatility: EtfMetric;
  readonly maxDrawdown: EtfMetric;
  readonly downsideDeviation: EtfMetric;
  readonly sharpe: EtfMetric;
  readonly sortino: EtfMetric;
  readonly beta: EtfMetric;
  /** Évesítési konvenció (D-066). */
  readonly conventions: readonly string[];
}

export interface EtfCostAnalysis {
  readonly ter: EtfMetric;
  /** Éves TER-költség 10 000 egység befektetésre (pénznem-független illusztráció). */
  readonly annualCostPer10k: EtfMetric;
  /** A TER hosszú távú hatása: az elmaradt vagyon aránya (feltevésekkel, `estimated`). */
  readonly longTermCostShare: EtfMetric;
  readonly assumptions: {
    readonly years: number;
    readonly assumedGrossReturn: number;
    readonly source: 'default' | 'user';
  };
}

export interface EtfTrackingAnalysis {
  readonly benchmarkName: string | null;
  readonly benchmarkBasis: BenchmarkReturnBasis | null;
  readonly trackingDifference: EtfMetric;
  readonly annualizedTrackingDifference: EtfMetric;
  readonly trackingError: EtfMetric;
  readonly definitions: readonly string[];
}

export interface EtfExposureGroup {
  readonly key: string;
  readonly weight: number;
}

export interface EtfHoldingsAnalysis {
  readonly asOf: IsoDate | null;
  readonly completeness: 'complete' | 'partial' | null;
  readonly holdingsCount: EtfMetric;
  readonly coveredWeight: EtfMetric;
  readonly top5Weight: EtfMetric;
  readonly top10Weight: EtfMetric;
  readonly top20Weight: EtfMetric;
  readonly herfindahl: EtfMetric;
  readonly effectiveHoldings: EtfMetric;
  readonly largestHoldingWeight: EtfMetric;
  readonly countryWeights: Metric<readonly EtfExposureGroup[]>;
  readonly sectorWeights: Metric<readonly EtfExposureGroup[]>;
  readonly largestCountryWeight: EtfMetric;
  readonly largestSectorWeight: EtfMetric;
  readonly notes: readonly string[];
}

/** A PHASE 10 ETF-score feature-csoportjai (feladat 9.). */
export const ETF_FEATURE_GROUPS = [
  'diversification',
  'cost',
  'tracking',
  'liquidity',
  'size',
  'structure',
  'risk',
  'concentration',
  'currency',
] as const;
export type EtfFeatureGroup = (typeof ETF_FEATURE_GROUPS)[number];

/** Melyik irány „kedvezőbb” – a PHASE 10 súlyozásnak; nem pontszám. */
export type FeatureDirection = 'higher_is_better' | 'lower_is_better' | 'context';

export type EtfFeature =
  | {
      readonly id: string;
      readonly group: EtfFeatureGroup;
      readonly kind: 'numeric';
      readonly direction: FeatureDirection;
      readonly metric: EtfMetric;
    }
  | {
      readonly id: string;
      readonly group: EtfFeatureGroup;
      readonly kind: 'categorical';
      readonly label: string;
      readonly value: Metric<string>;
      readonly origin: MetricOrigin;
    };

export interface EtfFeatureModel {
  readonly features: readonly EtfFeature[];
  /** Csoportonként: hány feature-nek van értéke (adatteljesség, NEM pontszám). */
  readonly groupCoverage: Readonly<
    Record<EtfFeatureGroup, { readonly available: number; readonly total: number }>
  >;
  readonly note: string;
}

export interface NotApplicableAnalysis {
  readonly id: 'pe' | 'forwardPe' | 'dcf' | 'fundamentalQuality';
  readonly label: string;
  readonly reason: string;
}

export interface EtfAnalysis {
  readonly listingId: ListingId;
  readonly generatedAt: IsoTimestamp;
  readonly profile: EtfProfile;
  readonly coverage: EtfCoverage;
  readonly currency: EtfCurrencyAnalysis;
  readonly returns: EtfReturnAnalysis;
  readonly risk: EtfRiskAnalysis;
  readonly costs: EtfCostAnalysis;
  readonly tracking: EtfTrackingAnalysis;
  readonly holdings: EtfHoldingsAnalysis;
  readonly features: EtfFeatureModel;
  readonly notApplicable: readonly NotApplicableAnalysis[];
  readonly warnings: readonly string[];
  readonly disclaimer: string;
}
