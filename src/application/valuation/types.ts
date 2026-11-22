/**
 * PHASE 07 – értékelés és DCF: a kimenet alakja (D-064, D-065).
 *
 * Az eredmény BECSLÉS (`estimated`). Minden számhoz ott van: a felhasznált bemenet és annak
 * forrása/időbélyege/eredete, a feltevések, a képlet és az eredmény (vagy egy jól definiált,
 * indokolt nem-OK státusz). A UI (PHASE 12) csak megjelenít, nem számol.
 */
import type {
  CalcResult,
  DcfResult,
  DcfScenarioId,
  DcfSensitivityTable,
  MarginOfSafetyCategory,
  MarginOfSafetyThresholds,
  MultipleBandResult,
  MultipleBandThresholds,
  ValuationBandMetric,
} from '@/calculations';
import type {
  CurrencyCode,
  FundamentalMetric,
  IsoDate,
  IsoTimestamp,
  ListingId,
  MeasurementUnit,
  MetricOrigin,
  MetricStatus,
} from '@/domain';

// --- Bemenetek --------------------------------------------------------------------------------

export const DCF_INPUT_IDS = [
  'baseFcf',
  'totalDebt',
  'cash',
  'sharesOutstanding',
  'marketPrice',
] as const;
export type DcfInputId = (typeof DCF_INPUT_IDS)[number];

export interface DcfInputSource {
  readonly sourceId: string;
  readonly sourceName: string;
  readonly fetchedAt: IsoTimestamp;
  readonly asOf: IsoDate | IsoTimestamp | null;
}

/** Egy DCF-bemenet a teljes nyomonkövethetőséggel. */
export interface DcfInputField {
  readonly id: DcfInputId;
  readonly label: string;
  /** `null`, ha a bemenet nem használható (lásd `status` + `reason`). Hiány ≠ 0. */
  readonly value: number | null;
  readonly status: MetricStatus;
  readonly origin: MetricOrigin;
  readonly unit: MeasurementUnit;
  readonly currency: CurrencyCode | null;
  /** Melyik időszakból / mérlegnapból jön (pl. „FY2026 (záró: 2026-09-26)”). */
  readonly basis: string;
  readonly source: DcfInputSource | null;
  readonly reason: string | null;
  readonly notes: readonly string[];
  readonly overridden: boolean;
}

export interface DcfInputModel {
  /** A DCF pénzneme (beszámolói pénznem); `null`, ha nem ismert. */
  readonly currency: CurrencyCode | null;
  readonly fields: Readonly<Record<DcfInputId, DcfInputField>>;
  readonly warnings: readonly string[];
}

/** Felhasználói felülírás bemenetenként (pl. normalizált FCF negatív FY-FCF esetén). */
export type DcfInputOverrides = Partial<Readonly<Record<DcfInputId, number>>>;

// --- Feltevések és forgatókönyvek ---------------------------------------------------------------

export interface DcfAssumptionSet {
  readonly growthRates: readonly number[];
  readonly discountRate: number;
  readonly terminalGrowth: number;
}

/** Forgatókönyvenkénti felülírás: bármelyik mező külön is állítható. */
export type DcfAssumptionOverride = Partial<DcfAssumptionSet>;

export interface DcfScenarioAssumptionsView extends DcfAssumptionSet {
  readonly explicitYears: number;
  /** `default`: a D-064 kiinduló feltevései; `user`: legalább egy mezőt a felhasználó adott meg. */
  readonly source: 'default' | 'user';
}

export interface DcfScenarioOutput {
  readonly id: DcfScenarioId;
  readonly label: string;
  readonly assumptions: DcfScenarioAssumptionsView;
  readonly result: CalcResult<DcfResult>;
  readonly category: CalcResult<MarginOfSafetyCategory>;
  /** Megjelenítési javaslat hamis pontosság nélkül (a nyers érték a `result`-ban marad). */
  readonly display: DcfDisplayValues | null;
}

export interface DcfDisplayValues {
  /** Belső érték/részvény 3 értékes jegyre kerekítve. */
  readonly intrinsicValuePerShare: number;
  /** Biztonsági sáv egész százalékpontra kerekítve (pl. 23 = 23%); `null`, ha nem számolható. */
  readonly marginOfSafetyPercent: number | null;
}

export interface DcfSensitivityOutput {
  /** A tábla a Base forgatókönyv bemenetein alapul; csak r és g változik. */
  readonly scenarioId: 'base';
  readonly table: CalcResult<DcfSensitivityTable>;
}

// --- Szorzók és kategóriák ----------------------------------------------------------------------

export interface MultipleBandOutput {
  readonly metricId: ValuationBandMetric;
  readonly metric: FundamentalMetric | null;
  readonly band: CalcResult<MultipleBandResult>;
}

export interface ValuationThresholds {
  readonly marginOfSafety: MarginOfSafetyThresholds;
  readonly multiples: Readonly<Record<ValuationBandMetric, MultipleBandThresholds>>;
  readonly disclaimer: string;
}

// --- Magyarázat ----------------------------------------------------------------------------------

export interface FormulaExplanation {
  readonly id: string;
  readonly formula: string;
}

export interface ValuationContextItem {
  readonly label: string;
  readonly metric: FundamentalMetric;
}

export interface ValuationExplanation {
  readonly formulas: readonly FormulaExplanation[];
  readonly conventions: readonly string[];
  /** Történeti viszonyítási pontok a feltevések beállításához (nem kerülnek be automatikusan). */
  readonly context: readonly ValuationContextItem[];
}

export interface StockValuationAnalysis {
  readonly generatedAt: IsoTimestamp;
  /** A felhasznált fundamentális elemzés időbélyege (a forrásadatok ehhez képest frissek/elavultak). */
  readonly fundamentalsGeneratedAt: IsoTimestamp;
  readonly listingId: ListingId;
  readonly multiples: {
    readonly metrics: readonly FundamentalMetric[];
    readonly bands: readonly MultipleBandOutput[];
  };
  readonly dcf: {
    readonly provenanceKind: 'estimated';
    readonly inputs: DcfInputModel;
    readonly scenarios: readonly DcfScenarioOutput[];
    readonly scenarioNotes: readonly string[];
    readonly sensitivity: DcfSensitivityOutput;
  };
  readonly thresholds: ValuationThresholds;
  readonly explanation: ValuationExplanation;
  readonly warnings: readonly string[];
  readonly disclaimer: string;
}

// --- Beállítások ---------------------------------------------------------------------------------

export interface StockValuationOptions {
  /** Explicit időtáv az alapfeltevésekhez (konstans pálya); alapeset 5, támogatott 1–10 (pl. 3). */
  readonly explicitYears?: number;
  readonly scenarios?: Partial<Readonly<Record<DcfScenarioId, DcfAssumptionOverride>>>;
  readonly inputOverrides?: DcfInputOverrides;
  readonly sensitivity?: {
    readonly discountRates?: readonly number[];
    readonly terminalGrowthRates?: readonly number[];
  };
  readonly marginOfSafetyThresholds?: MarginOfSafetyThresholds;
  readonly multipleBands?: Partial<Readonly<Record<ValuationBandMetric, MultipleBandThresholds>>>;
}
