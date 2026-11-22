/**
 * Score- és döntési engine – típusok (PHASE 10, D-073…D-075, DATA_DICTIONARY 16.).
 *
 * A `src/scoring` réteg TISZTA szabálymotor: csak a domaint és a calculations-t látja. Nem tud
 * a részvény- vagy ETF-elemzés szerkezetéről – a bemenet egy semleges feature-lista
 * (`ScoringInput`), amelyet az alkalmazási réteg leképezői (`src/application/scoring`) állítanak
 * elő. Így ugyanaz a motor pontoz részvényt és ETF-et, de KÜLÖN konfigurációval, és a kettő
 * soha nem keveredik (`subjectKind`-őr).
 *
 * Elemzési kimenet: a címkék (Strong Buy … Strong Sell) elemzési kategóriák, NEM garantált
 * előrejelzések, NEM befektetési tanács. Az `AnalysisConfidence` adatteljesség és -minőség,
 * NEM a jövőbeli hozam valószínűsége.
 */
import type {
  Freshness,
  IsoDate,
  IsoTimestamp,
  MeasurementUnit,
  Metric,
  MetricOrigin,
  MetricStatus,
  ProvenanceKind,
} from '@/domain';

// --- Bemenet ---------------------------------------------------------------------------------

export type SubjectKind = 'stock' | 'etf';

/** Kockázati mutató megbízhatósága (D-070); minden más mutatónál `null`. */
export type FeatureReliability = 'standard' | 'short_window' | null;

/** A motor bemeneti egysége: egy mutató értéke VAGY a hiány oka, provenance-szel. */
export type ScoringFeature =
  | {
      readonly id: string;
      readonly label: string;
      readonly kind: 'numeric';
      readonly unit: MeasurementUnit;
      readonly value: Metric<number>;
      readonly reliability: FeatureReliability;
    }
  | {
      readonly id: string;
      readonly label: string;
      readonly kind: 'categorical';
      readonly value: Metric<string>;
      readonly reliability: null;
    };

export interface ScoringInput {
  readonly subjectKind: SubjectKind;
  readonly features: readonly ScoringFeature[];
  /**
   * Külső, igen/nem jellegű jelzések (pl. DCF MOS-kategória a PHASE 07 küszöbeivel).
   * `null` = nem ismert (a rá épülő feltétel `UNKNOWN`, nem `false`).
   */
  readonly flags: Readonly<Record<string, boolean | null>>;
}

// --- Konfiguráció: pontozás -------------------------------------------------------------------

/**
 * Lineáris pontozás: `worst` értéknél 0, `best` értéknél 100 pont, köztük egyenes, kívül
 * levágva. Az irány a két horgonyból adódik (`best < worst` = „alacsonyabb a jobb”).
 */
export interface LinearRule {
  readonly kind: 'linear';
  readonly worst: number;
  readonly best: number;
}

/** Pénzösszeg lineáris pontozása pénznemenként (más pénznemben a mutató nem pontozható). */
export interface MoneyLinearRule {
  readonly kind: 'linear_money';
  readonly byCurrency: Readonly<Record<string, { readonly worst: number; readonly best: number }>>;
}

/** Kategória → pont (0–100). Ismeretlen kategória nem pontozható (nem 0). */
export interface CategoricalRule {
  readonly kind: 'categorical';
  readonly scores: Readonly<Record<string, number>>;
}

export type MetricRule = LinearRule | MoneyLinearRule | CategoricalRule;

export interface MetricRuleConfig {
  readonly featureId: string;
  /** Súly a kategórián belül; a kategória mutatósúlyainak összege 1. */
  readonly weight: number;
  readonly rule: MetricRule;
  /** Miért ez a horgony (emberi nyelven). */
  readonly rationale: string;
}

export interface CategoryConfig {
  readonly id: string;
  readonly label: string;
  /** Súly a teljes score-ban; a kategóriasúlyok összege = `ScoreConfig.totalWeight`. */
  readonly weight: number;
  readonly description: string;
  readonly metrics: readonly MetricRuleConfig[];
  /**
   * A pontozott mutatók súlyarányának minimuma (0–1). Alatta a kategória
   * `INSUFFICIENT_DATA` (score: `null`), felette újranormalizált átlag.
   */
  readonly minCoverage: number;
  /**
   * Szándékosan nem pontozott kategória (súly 0, nincs mutató) indoka – pl. MOAT, amíg nincs
   * forrásolt, irányt is hordozó kvalitatív bemenet.
   */
  readonly notScoredReason?: string;
}

/** Adatminőségi szorzók (0–1) – a confidence és a kategória `dataQuality` alapja. */
export interface QualityPolicy {
  readonly kind: Readonly<Record<ProvenanceKind, number>>;
  readonly freshness: Readonly<Record<Freshness, number>>;
  /** Rövid ablakú kockázati mutató szorzója (D-070). */
  readonly shortWindow: number;
  /** Szint-határok a szorzóra: ≥ high → HIGH, ≥ medium → MEDIUM, alatta LOW. */
  readonly levels: { readonly high: number; readonly medium: number };
}

export interface ScoreConfig {
  readonly id: string;
  readonly version: string;
  readonly subjectKind: SubjectKind;
  /** Az elvárt súlyösszeg (100). */
  readonly totalWeight: number;
  readonly categories: readonly CategoryConfig[];
  /** A pontozott kategóriák súlyarányának minimuma; alatta nincs összpontszám. */
  readonly minTotalCoverage: number;
  readonly quality: QualityPolicy;
}

// --- Kimenet: pontozás ------------------------------------------------------------------------

export type DataQualityLevel = 'HIGH' | 'MEDIUM' | 'LOW';

export interface MetricScore {
  readonly featureId: string;
  readonly label: string;
  /** Súly a kategórián belül (konfigurált). */
  readonly weight: number;
  /** A bemenet értéke (számszerű vagy kategória); `null`, ha hiányzik. */
  readonly value: number | string | null;
  readonly unit: MeasurementUnit | null;
  /** A pénznem pénzösszeg-mutatónál (a provenance-ből). */
  readonly currency: string | null;
  /** A bemenet státusza; `NO_FEATURE`, ha a leképező nem adta át. */
  readonly inputStatus: MetricStatus | 'NO_FEATURE';
  /** 0–100, egy tizedesre kerekítve; `null` = nem pontozott (hiány vagy nem alkalmazható szabály). */
  readonly score: number | null;
  /** A szabály emberi nyelven, pl. „lineáris: 5% → 0 pont, 20% → 100 pont”. */
  readonly rule: string;
  readonly rationale: string;
  readonly origin: MetricOrigin;
  readonly provenanceKind: ProvenanceKind | null;
  readonly freshness: Freshness | null;
  readonly asOf: IsoDate | IsoTimestamp | null;
  readonly reliability: FeatureReliability;
  /** Adatminőségi szorzó (0–1); csak pontozott mutatónál. */
  readonly qualityFactor: number | null;
  /** Miért nincs pont (hiány oka vagy szabály-ütközés); pontozottnál `null`. */
  readonly reason: string | null;
}

export type CategoryStatus =
  /** Minden mutató pontozott. */
  | 'SCORED'
  /** Van hiány, de a lefedettség eléri a minimumot → újranormalizált átlag. */
  | 'PARTIAL'
  /** A lefedettség a minimum alatt → nincs pont (nem 0). */
  | 'INSUFFICIENT_DATA'
  /** Szándékosan nem pontozott kategória (súly 0). */
  | 'NOT_SCORED';

export interface CategoryScore {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly status: CategoryStatus;
  /** 0–100, egy tizedes; `null`, ha `INSUFFICIENT_DATA` vagy `NOT_SCORED`. */
  readonly score: number | null;
  /** Konfigurált súly (a `totalWeight`-ből). */
  readonly weight: number;
  /** Az összpontszámban ténylegesen használt, újranormalizált súly (0–1); `null`, ha kimaradt. */
  readonly effectiveWeight: number | null;
  /** A pontozott mutatók súlyaránya a kategórián belül (0–1). */
  readonly coverage: number;
  readonly metrics: readonly MetricScore[];
  /** A kategória szabálya (képlet) emberi nyelven. */
  readonly rule: string;
  /** Mutatónkénti indoklás (érték → pont), olvasható formában. */
  readonly rationale: readonly string[];
  readonly missing: readonly {
    readonly featureId: string;
    readonly status: MetricStatus | 'NO_FEATURE' | 'RULE_NOT_APPLICABLE';
    readonly reason: string;
  }[];
  readonly dataQuality: {
    /** A pontozott mutatók súlyozott minőségi szorzója; `null`, ha nincs pontozott mutató. */
    readonly factor: number | null;
    readonly level: DataQualityLevel | null;
    readonly issues: readonly string[];
  };
  readonly freshness: {
    /** A legrosszabb frissesség a pontozott mutatók közül. */
    readonly worst: Freshness | null;
    readonly oldestAsOf: IsoDate | IsoTimestamp | null;
  };
}

export type TotalScoreStatus = 'SCORED' | 'PARTIAL' | 'INSUFFICIENT_DATA';

export interface ScoreCard {
  readonly configId: string;
  readonly configVersion: string;
  readonly subjectKind: SubjectKind;
  readonly totalScore: number | null;
  readonly totalStatus: TotalScoreStatus;
  /** A pontozott kategóriák konfigurált súlyaránya (0–1). */
  readonly scoredWeightShare: number;
  /** Lefedettség mutató-szinten: Σ(kategóriasúly × kategória-lefedettség) / Σ súly. */
  readonly dataCoverage: number;
  readonly categories: readonly CategoryScore[];
  /** A hiányzó adat kezelésének leírása (D-074). */
  readonly missingDataPolicy: string;
  readonly formula: string;
}

// --- Confidence -------------------------------------------------------------------------------

export type ConfidenceLevel = 'HIGH' | 'MEDIUM' | 'LOW' | 'INSUFFICIENT';

export interface ConfidenceConfig {
  readonly high: number;
  readonly medium: number;
}

export interface AnalysisConfidence {
  readonly level: ConfidenceLevel;
  /** 0–100 = 100 × adatlefedettség × adatminőség (egy tizedes). */
  readonly score: number;
  readonly dataCompleteness: number;
  readonly dataQuality: number;
  readonly reasons: readonly string[];
  /** Kötelező értelmezés: nem hozam-valószínűség. */
  readonly meaning: string;
}

// --- Döntés -----------------------------------------------------------------------------------

export const DECISION_LABEL_KEYS = [
  'STRONG_BUY',
  'BUY',
  'WATCH',
  'HOLD',
  'REDUCE',
  'SELL',
  'STRONG_SELL',
  'NOT_RATED',
] as const;
export type DecisionLabelKey = (typeof DECISION_LABEL_KEYS)[number];

/** Rangsor a plafonokhoz (nagyobb = kedvezőbb); a `NOT_RATED` nincs a skálán. */
export const DECISION_LABEL_RANK: Readonly<Record<Exclude<DecisionLabelKey, 'NOT_RATED'>, number>> =
  {
    STRONG_SELL: 0,
    SELL: 1,
    REDUCE: 2,
    HOLD: 3,
    WATCH: 4,
    BUY: 5,
    STRONG_BUY: 6,
  };

export type Comparator = 'lt' | 'lte' | 'gt' | 'gte' | 'eq';

export type DecisionCondition =
  | {
      readonly kind: 'dimension';
      readonly dimension: string;
      /** Feltétel: score ≥ min. */
      readonly min?: number;
      /** Feltétel: score < max. */
      readonly max?: number;
    }
  | { readonly kind: 'total'; readonly min?: number; readonly max?: number }
  | { readonly kind: 'flag'; readonly flag: string; readonly equals: boolean }
  | { readonly kind: 'confidence'; readonly levels: readonly ConfidenceLevel[] };

export interface DecisionRule {
  readonly id: string;
  readonly label: Exclude<DecisionLabelKey, 'NOT_RATED'>;
  readonly description: string;
  /** Minden feltételnek teljesülnie kell; üres lista = alapértelmezett (fallback) szabály. */
  readonly all: readonly DecisionCondition[];
}

export interface DecisionCap {
  readonly id: string;
  readonly description: string;
  readonly when: readonly DecisionCondition[];
  /** A címke legfeljebb ez lehet (a rangsor szerint). */
  readonly maxLabel: Exclude<DecisionLabelKey, 'NOT_RATED'>;
}

/** Döntési dimenzió: kategóriák súlyozott átlaga ÉS/VAGY egy közvetlen mutató-szabály. */
export interface DimensionConfig {
  readonly id: string;
  readonly label: string;
  readonly categories: readonly { readonly categoryId: string; readonly weight: number }[];
  /** Közvetlen mutató (pl. béta a részvény kockázati dimenziójához). */
  readonly feature?: MetricRuleConfig;
}

/** Mutatóból képzett jelzés (pl. portfólió-túlsúly). */
export interface FlagRule {
  readonly id: string;
  readonly featureId: string;
  readonly comparator: Exclude<Comparator, 'eq'>;
  readonly threshold: number;
  readonly description: string;
}

export interface DecisionLabelText {
  readonly text: string;
  readonly description: string;
}

export interface DecisionConfig {
  readonly id: string;
  readonly version: string;
  readonly subjectKind: SubjectKind;
  readonly dimensions: readonly DimensionConfig[];
  readonly flagRules: readonly FlagRule[];
  /** Külső jelzések leírása (a leképező adja az értéket). */
  readonly externalFlags: Readonly<Record<string, string>>;
  /** Sorrendben értékelve, az első teljesülő nyer; az utolsó kötelezően fallback (`all: []`). */
  readonly rules: readonly DecisionRule[];
  readonly caps: readonly DecisionCap[];
  readonly labels: Readonly<Record<DecisionLabelKey, DecisionLabelText>>;
  readonly confidence: ConfidenceConfig;
  readonly thesis: ThesisConfig;
}

export type ConditionOutcome = 'PASS' | 'FAIL' | 'UNKNOWN';

export interface ConditionEvaluation {
  readonly condition: DecisionCondition;
  readonly description: string;
  /** A tényleges érték (pont, jelzés vagy confidence); `null`, ha nem ismert. */
  readonly actual: number | boolean | string | null;
  readonly outcome: ConditionOutcome;
}

export interface RuleEvaluation {
  readonly ruleId: string;
  readonly label: DecisionLabelKey;
  readonly description: string;
  readonly matched: boolean;
  readonly conditions: readonly ConditionEvaluation[];
}

export interface DimensionValue {
  readonly id: string;
  readonly label: string;
  readonly score: number | null;
  /** Mely kategóriák/mutatók adták (újranormalizált súllyal). */
  readonly sources: readonly { readonly id: string; readonly weight: number }[];
  readonly reason: string | null;
}

export interface FlagValue {
  readonly id: string;
  readonly value: boolean | null;
  readonly description: string;
  readonly source: 'rule' | 'external';
}

export interface AppliedCap {
  readonly capId: string;
  readonly description: string;
  readonly from: DecisionLabelKey;
  readonly to: DecisionLabelKey;
  readonly conditions: readonly ConditionEvaluation[];
}

export interface DecisionResult {
  readonly configId: string;
  readonly configVersion: string;
  readonly label: DecisionLabelKey;
  readonly labelText: string;
  readonly labelDescription: string;
  /** Az alapszabály címkéje a plafonok előtt. */
  readonly baseLabel: DecisionLabelKey;
  readonly matchedRuleId: string | null;
  /** Az értékelt szabályok sorrendben, az illeszkedőig (visszakövethetőség). */
  readonly ruleTrace: readonly RuleEvaluation[];
  readonly appliedCaps: readonly AppliedCap[];
  readonly dimensions: readonly DimensionValue[];
  readonly flags: readonly FlagValue[];
  /** Rövid, olvasható indoklás a döntés fő okairól. */
  readonly drivers: readonly string[];
  readonly disclaimer: string;
}

// --- Thesis -----------------------------------------------------------------------------------

export type ThesisRiskKind = 'fundamental' | 'valuation' | 'risk' | 'portfolio' | 'data';
export type ThesisSeverity = 'HIGH' | 'MEDIUM' | 'LOW';

export interface ThesisRiskRule {
  readonly id: string;
  readonly kind: ThesisRiskKind;
  readonly severity: ThesisSeverity;
  readonly dimension: string | null;
  /** Mutató-alapú szabály … */
  readonly featureId?: string;
  readonly comparator?: Comparator;
  readonly threshold?: number | string;
  /** … vagy jelzés-alapú (a jelzés `true` értéke váltja ki). */
  readonly flag?: string;
  /** Kockázat szövege (amikor teljesül). */
  readonly statement: string;
  /** Érvénytelenítő szöveg (pozitív álláspontnál: ha ez bekövetkezik). */
  readonly invalidatesPositive: string;
  /** Negatív álláspontnál: ha ez megszűnik. */
  readonly invalidatesNegative: string;
}

export interface ThesisConfig {
  readonly riskRules: readonly ThesisRiskRule[];
  /** Ilyen súlyú (≥) adathiányos kategória adat-kockázatot jelent. */
  readonly dataGapCategoryWeight: number;
}

export interface ThesisEvidence {
  readonly featureId: string | null;
  readonly flag: string | null;
  readonly value: number | string | boolean | null;
  readonly comparator: Comparator | null;
  readonly threshold: number | string | null;
}

export interface ThesisRisk {
  readonly id: string;
  readonly kind: ThesisRiskKind;
  readonly severity: ThesisSeverity;
  readonly dimension: string | null;
  readonly statement: string;
  readonly evidence: ThesisEvidence | null;
  readonly ruleId: string;
}

export type InvalidationKind = 'dimension' | 'total' | 'feature' | 'flag' | 'price';

export interface InvalidationCondition {
  readonly id: string;
  readonly kind: InvalidationKind;
  readonly statement: string;
  readonly target: string;
  readonly comparator: Comparator | null;
  readonly threshold: number | string | boolean | null;
  readonly currentValue: number | string | boolean | null;
  readonly ruleId: string;
}

export interface ThesisAssessment {
  readonly stance: 'positive' | 'neutral' | 'negative' | 'not_rated';
  readonly risks: readonly ThesisRisk[];
  readonly invalidation: readonly InvalidationCondition[];
  readonly note: string;
}
