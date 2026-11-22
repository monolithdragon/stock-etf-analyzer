/**
 * Részvény fundamentális elemzés – eredmény-modell (PHASE 06, D-060…D-063, DATA_DICTIONARY 13.).
 *
 * Elvek:
 * - A numerikus mutatók (`FundamentalMetric`) és a kvalitatív értékelés (`QualityAnalysis`)
 *   KÜLÖN szerkezetben vannak. A kvalitatív rész nem tartalmaz pontszámot (az a PHASE 10 dolga).
 * - Minden mutató hordozza az értéket VAGY a hiány okát (`Metric`), és egy egyszerű eredet-címkét
 *   (`MetricOrigin`): reported / calculated / estimated / stale / missing / unavailable.
 * - Ez elemzési kimenet, NEM befektetési tanács és NEM hozamígéret.
 */
import type { AnalysisCompleteness } from './analysis-result';
import type { FinancialMetricId } from '../fundamentals/financial-metric';
import type {
  BalanceSheetItem,
  CashFlowItem,
  IncomeStatementItem,
  StatementType,
} from '../fundamentals/financial-statement';
import type { StatementFrequency } from '../fundamentals/financial-statement-set';
import {
  invalid,
  ok,
  parseIsoDate,
  requireNonEmpty,
  type AppError,
  type CurrencyCode,
  type DataProvenance,
  type Freshness,
  type FiscalPeriod,
  type IsoDate,
  type IsoTimestamp,
  type ListingId,
  type MeasurementUnit,
  type Metric,
  type Result,
} from '../shared';

// --- Eredet-címke (feladat 9.) ----------------------------------------------------------------

/**
 * Egyetlen, UI- és AI-barát címke arról, honnan jön egy érték (vagy miért nincs).
 * Elsőbbség: unavailable → missing → mock → stale → (reported | calculated | estimated | user_input).
 * A `missing` gyűjtőcímke: a pontos ok a `Metric.status`-ban marad (MISSING, NOT_MEANINGFUL,
 * INSUFFICIENT_DATA, INVALID_INPUT, ERROR…). A `stale` elfedi a fajtát, de a
 * `provenance.kind` továbbra is elérhető.
 */
export const METRIC_ORIGINS = [
  'reported',
  'calculated',
  'estimated',
  'stale',
  'missing',
  'unavailable',
  /** Demóadat – a UI-ban mindig feltűnően jelölendő. */
  'mock',
  /** A felhasználó adta meg (a PHASE 06-ban még nem fordul elő numerikus mutatónál). */
  'user_input',
] as const;
export type MetricOrigin = (typeof METRIC_ORIGINS)[number];

export function classifyMetricOrigin(metric: Metric<unknown>): MetricOrigin {
  if (metric.status === 'UNAVAILABLE') return 'unavailable';
  if (metric.status !== 'OK') return 'missing';
  const { kind, freshness } = metric.provenance;
  if (kind === 'mock') return 'mock';
  if (freshness === 'STALE' || freshness === 'EXPIRED') return 'stale';
  switch (kind) {
    case 'reported':
      return 'reported';
    case 'calculated':
      return 'calculated';
    case 'user_input':
      return 'user_input';
    // Az `ai_interpretation` numerikus mutatónál tiltott (createFinancialMetric); ha mégis
    // előfordulna, a legóvatosabb címkét kapja.
    case 'estimated':
    case 'ai_interpretation':
      return 'estimated';
  }
}

// --- Numerikus mutatók ------------------------------------------------------------------------

/** A piaci / áttekintő mutatók saját azonosítói (nem kimutatás-tételek). */
export const MARKET_METRIC_IDS = [
  'price',
  'beta',
  'week52High',
  'week52Low',
  'dividendPerShareTtm',
] as const;
export type MarketMetricId = (typeof MARKET_METRIC_IDS)[number];

export type FundamentalMetricId =
  FinancialMetricId | IncomeStatementItem | BalanceSheetItem | CashFlowItem | MarketMetricId;

export interface FundamentalMetric {
  readonly id: FundamentalMetricId;
  readonly unit: MeasurementUnit;
  /** Ember által olvasható definíció (jelentett tételnél: „jelentett (forrás)”). */
  readonly formula: string;
  /** `null`: pontszerű piaci mutató (pl. ár, P/E az aktuális árral). */
  readonly period: FiscalPeriod | null;
  readonly value: Metric<number>;
  readonly origin: MetricOrigin;
  /** A képlet megjegyzései (pl. „csak záró saját tőke”, „FY2026 alapján”). */
  readonly notes: readonly string[];
}

export function createFundamentalMetric(input: {
  readonly id: FundamentalMetricId;
  readonly unit: MeasurementUnit;
  readonly formula: string;
  readonly period: FiscalPeriod | null;
  readonly value: Metric<number>;
  readonly notes?: readonly string[];
}): FundamentalMetric {
  // Alapelv: AI nem lehet számszerű mutató forrása (CLAUDE.md). Ilyen bemenet hibává válik.
  const value: Metric<number> =
    input.value.status === 'OK' && input.value.provenance.kind === 'ai_interpretation'
      ? { status: 'INVALID_INPUT', reason: 'Számszerű mutató forrása nem lehet AI-értelmezés.' }
      : input.value;
  return {
    id: input.id,
    unit: input.unit,
    formula: input.formula,
    period: input.period,
    value,
    origin: classifyMetricOrigin(value),
    notes: [...(input.notes ?? [])],
  };
}

// --- Áttekintés (feladat 2.) ------------------------------------------------------------------

export interface StockOverview {
  readonly listingId: ListingId;
  readonly ticker: string;
  /** Tőzsde (MIC) a jegyzés-azonosítóból – mindig ismert. */
  readonly mic: string;
  /** A forrás (profil vagy kimutatás) szerinti név; `null`, ha egyik sem adja. */
  readonly name: string | null;
  readonly exchangeName: string | null;
  readonly sector: string | null;
  readonly industry: string | null;
  /** ISO 3166-1 alpha-2. */
  readonly country: string | null;
  /** A jegyzés (ár) pénzneme. */
  readonly tradingCurrency: CurrencyCode | null;
  /** A kimutatások (beszámoló) pénzneme – eltérhet a jegyzésitől (pl. ADR). */
  readonly reportingCurrency: CurrencyCode | null;
  /** A legutóbbi pénzügyi év záródátuma (eltérő év végek jelzéséhez). */
  readonly latestFiscalYearEnd: IsoDate | null;
  readonly price: FundamentalMetric;
  readonly marketCap: FundamentalMetric;
  readonly sharesOutstanding: FundamentalMetric;
  readonly beta: FundamentalMetric;
  readonly week52High: FundamentalMetric;
  readonly week52Low: FundamentalMetric;
  /** A metaadat (név, szektor…) forrása; `null`, ha a profil nem érhető el. */
  readonly profileProvenance: DataProvenance | null;
}

// --- Kimutatás-nézetek (feladat 3.) -----------------------------------------------------------

export interface StatementRow {
  readonly item: IncomeStatementItem | BalanceSheetItem | CashFlowItem;
  readonly unit: MeasurementUnit;
  /** A `periods`-szal azonos sorrendben; hiány esetén nem-OK `Metric` (soha nem 0). */
  readonly cells: readonly Metric<number>[];
}

export interface StatementTable {
  readonly statementType: StatementType;
  readonly frequency: StatementFrequency;
  /** `null`, ha nincs egyetlen kimutatás sem. */
  readonly currency: CurrencyCode | null;
  /** Legfrissebb elöl. Negyedévesnél a származtatott Q4 is itt van (calculated). */
  readonly periods: readonly FiscalPeriod[];
  /** A `periods`-szal azonos sorrendben: `true` = származtatott (pl. Q4), nem jelentett. */
  readonly derived: readonly boolean[];
  readonly rows: readonly StatementRow[];
  readonly notes: readonly string[];
}

export interface StatementViews {
  readonly annual: readonly StatementTable[];
  readonly quarterly: readonly StatementTable[];
}

// --- Időszaki mutatók (feladat 4.) ------------------------------------------------------------

export interface MetricRow {
  readonly id: FundamentalMetricId;
  readonly unit: MeasurementUnit;
  readonly formula: string;
  /** A tábla `columns` sorrendjében. */
  readonly cells: readonly FundamentalMetric[];
}

/**
 * Egy oszlop: egy pénzügyi időszak (FY / Q1–Q4), vagy TTM (az utolsó 4 egymást követő
 * negyedév). A TTM nem `FiscalPeriod` (nem jelentett időszak), ezért külön `kind`-ot kap.
 */
export interface PeriodColumn {
  readonly kind: 'FY' | 'Q1' | 'Q2' | 'Q3' | 'Q4' | 'TTM';
  /** Pl. `FY2026`, `Q3 FY2026`, `TTM 2026-06-27`. */
  readonly label: string;
  readonly fiscalYear: number;
  readonly start: IsoDate;
  readonly end: IsoDate;
  /** TTM-nél `null`; egyébként maga az időszak. */
  readonly period: FiscalPeriod | null;
  /** Származtatott oszlop (Q4 = FY − Q1..Q3, vagy TTM) – nem közvetlenül jelentett. */
  readonly derived: boolean;
  /** TTM esetén a 4 negyedév (legfrissebb elöl); egyébként üres. */
  readonly constituents: readonly FiscalPeriod[];
}

export interface PeriodMetricTable {
  readonly basis: 'annual' | 'quarterly' | 'ttm';
  /** Legfrissebb elöl. */
  readonly columns: readonly PeriodColumn[];
  readonly rows: readonly MetricRow[];
  readonly notes: readonly string[];
}

// --- Trendek és CAGR (feladat 5.) -------------------------------------------------------------

export const TREND_HORIZONS = [1, 3, 5, 10] as const;
export type TrendHorizon = (typeof TREND_HORIZONS)[number];

export const TREND_SERIES_IDS = [
  'revenue',
  'grossProfit',
  'operatingIncome',
  'netIncome',
  'eps',
  'operatingCashFlow',
  'fcf',
  'sharesOutstanding',
] as const;
export type TrendSeriesId = (typeof TREND_SERIES_IDS)[number];

export interface TrendPoint {
  readonly fiscalYear: number;
  readonly period: FiscalPeriod;
  readonly value: Metric<number>;
}

export interface TrendCagr {
  readonly years: TrendHorizon;
  readonly value: FundamentalMetric;
}

export interface TrendSeries {
  readonly id: TrendSeriesId;
  readonly unit: MeasurementUnit;
  /** Pénzügyi év szerint növekvő. */
  readonly points: readonly TrendPoint[];
  readonly cagr: readonly TrendCagr[];
  readonly notes: readonly string[];
}

// --- Minőségi elemzés (feladat 7–8.) ----------------------------------------------------------

export const QUALITY_THEMES = [
  'BUSINESS',
  'GROWTH',
  'PROFITABILITY',
  'BALANCE_SHEET',
  'CASH_FLOW',
  'MOAT',
  'MANAGEMENT',
  'VALUATION',
] as const;
export type QualityTheme = (typeof QUALITY_THEMES)[number];

/** Kvantitatív témák a numerikus bizonyítékból; kvalitatív (MOAT, MANAGEMENT) csak forrásolt leletből. */
export const QUALITATIVE_THEMES: readonly QualityTheme[] = ['MOAT', 'MANAGEMENT'];

/**
 * Egy téma adatállapota (NEM minősítés és NEM pontszám):
 * - `EVIDENCE_AVAILABLE`: minden felsorolt bizonyíték elérhető;
 * - `PARTIAL_EVIDENCE`: van elérhető és hiányzó bizonyíték is;
 * - `INSUFFICIENT_DATA`: nincs értékelhető (forrásolt) bizonyíték.
 */
export type QualityThemeStatus = 'EVIDENCE_AVAILABLE' | 'PARTIAL_EVIDENCE' | 'INSUFFICIENT_DATA';

export const QUALITATIVE_SOURCE_KINDS = [
  /** SEC-filing vagy más hivatalos jelentés szakasza (pl. 10-K Item 1, DEF 14A). */
  'filing',
  /** Adatszolgáltató által közölt tény. */
  'provider',
  /** A felhasználó saját, ellenőrizhető indoklása (pl. hivatkozott cikk / jelentés). */
  'user',
] as const;
export type QualitativeSourceKind = (typeof QUALITATIVE_SOURCE_KINDS)[number];

/**
 * Kvalitatív lelet (pl. „szabadalmi portfólió X db” – 10-K Item 1). Forrás nélkül nem hozható
 * létre: a `sourceReference` kötelező, és a `verifiableBy` megmondja, hogyan ellenőrizhető.
 */
export interface QualitativeFinding {
  readonly theme: QualityTheme;
  readonly statement: string;
  readonly sourceKind: QualitativeSourceKind;
  /** Pl. `10-K 2026 Item 1, accn=0000320193-26-000026` vagy URL. */
  readonly sourceReference: string;
  /** Hogyan ellenőrizheti a felhasználó (pl. „a 10-K 12. oldala”). */
  readonly verifiableBy: string;
  readonly asOf: IsoDate;
  readonly provenanceKind: 'reported' | 'user_input';
}

export interface QualitativeFindingInput {
  readonly theme: QualityTheme;
  readonly statement: string;
  readonly sourceKind: QualitativeSourceKind;
  readonly sourceReference: string;
  readonly verifiableBy: string;
  readonly asOf: string;
}

export function createQualitativeFinding(
  input: QualitativeFindingInput,
): Result<QualitativeFinding> {
  if (!(QUALITY_THEMES as readonly string[]).includes(input.theme)) {
    return invalid(`Ismeretlen minőségi téma: ${input.theme}.`);
  }
  if (!(QUALITATIVE_SOURCE_KINDS as readonly string[]).includes(input.sourceKind)) {
    return invalid(`Ismeretlen forrásfajta: ${input.sourceKind}.`);
  }
  const statement = requireNonEmpty(input.statement, 1000);
  if (!statement.ok) return invalid(`A lelet szövege: ${statement.error.message}`);
  const reference = requireNonEmpty(input.sourceReference, 500);
  if (!reference.ok) return invalid('Forrás nélküli kvalitatív lelet nem fogadható el.');
  const verifiable = requireNonEmpty(input.verifiableBy, 500);
  if (!verifiable.ok) return invalid('Meg kell adni, hogyan ellenőrizhető a lelet.');
  const asOf = parseIsoDate(input.asOf);
  if (!asOf.ok) return asOf;
  return ok({
    theme: input.theme,
    statement: statement.value,
    sourceKind: input.sourceKind,
    sourceReference: reference.value,
    verifiableBy: verifiable.value,
    asOf: asOf.value,
    provenanceKind: input.sourceKind === 'user' ? 'user_input' : 'reported',
  });
}

export interface QualityThemeAssessment {
  readonly theme: QualityTheme;
  readonly status: QualityThemeStatus;
  /** Numerikus bizonyíték – hivatkozás a kiszámolt mutatókra (érték + eredet), minősítés nélkül. */
  readonly evidence: readonly FundamentalMetric[];
  /** Forrásolt kvalitatív leletek (MOAT/MANAGEMENT-nél ez az értékelés egyetlen alapja). */
  readonly findings: readonly QualitativeFinding[];
  /** Mi hiányzik az értékeléshez (emberi nyelven). */
  readonly missing: readonly string[];
  readonly note: string;
}

export interface QualityAnalysis {
  readonly themes: readonly QualityThemeAssessment[];
  /** Kifejezetten: ebben a fázisban NINCS pontszám (PHASE 10). */
  readonly scoring: 'NOT_SCORED';
}

// --- Adatminőség és teljes eredmény -----------------------------------------------------------

export interface SourceSummary {
  readonly resource:
    'profile' | 'quote' | 'annualStatements' | 'quarterlyStatements' | 'prices' | 'dividends';
  readonly sourceId: string | null;
  readonly fetchedAt: IsoTimestamp | null;
  readonly asOf: IsoDate | IsoTimestamp | null;
  readonly freshness: Freshness;
  /** Sikertelen lekérésnél a hiba (a többi rész ettől még elkészül). */
  readonly error: AppError | null;
}

export interface StockDataQuality {
  readonly completeness: AnalysisCompleteness;
  /** A fő (legutóbbi időszaki + értékelési) mutatók közül a nem-OK-k. */
  readonly gaps: readonly {
    readonly metricId: FundamentalMetricId;
    readonly status: Metric<number>['status'];
    readonly reason: string;
  }[];
  readonly warnings: readonly string[];
  readonly sources: readonly SourceSummary[];
}

export const STOCK_ANALYSIS_DISCLAIMER =
  'Elemzési kimenet a közölt és számított adatokból. Nem befektetési tanács, nem hozamígéret, és nem személyre szabott ajánlás.';

export interface StockFundamentalAnalysis {
  readonly generatedAt: IsoTimestamp;
  readonly overview: StockOverview;
  readonly statements: StatementViews;
  readonly periodMetrics: {
    readonly annual: PeriodMetricTable;
    readonly quarterly: PeriodMetricTable;
    readonly ttm: PeriodMetricTable;
  };
  /** Pontszerű értékelési mutatók (aktuális ár + legutóbbi FY, D-062). */
  readonly valuation: readonly FundamentalMetric[];
  readonly trends: readonly TrendSeries[];
  readonly quality: QualityAnalysis;
  readonly dataQuality: StockDataQuality;
  readonly disclaimer: string;
}
