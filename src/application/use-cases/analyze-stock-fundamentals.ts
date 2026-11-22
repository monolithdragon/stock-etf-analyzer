/**
 * Use case: részvény fundamentális elemzés (PHASE 06).
 *
 * Mit csinál?
 * 1. Párhuzamosan lekéri a meglévő use case-eken át: éves és negyedéves kimutatások, ár,
 *    profil, 1 éves ártörténet, 2 éves osztaléktörténet. A frissességet ezek a use case-ek a
 *    SAJÁT óránkkal számolják.
 * 2. Egy forrás kiesése NEM dönti el az elemzést: az érintett mutatók `UNAVAILABLE` / `MISSING` /
 *    `ERROR` státuszt kapnak indokkal, a `dataQuality.sources` pedig megmutatja a hibát.
 *    Csak érvénytelen bemenet (listing-azonosító, kvalitatív lelet) ad `VALIDATION` hibát.
 * 3. Számol: kimutatás-nézetek (+ Q4, TTM), időszaki mutatók, értékelés, trendek/CAGR,
 *    minőségi adatmodell (pontszám nélkül).
 *
 * Nem csinál: pontozást / BUY-HOLD-SELL jelzést (PHASE 10), DCF-et (PHASE 07), AI-magyarázatot
 * (PHASE 11), FX-átváltást a szorzókhoz (KI-50).
 */
import {
  STOCK_ANALYSIS_DISCLAIMER,
  createQualitativeFinding,
  ok,
  parseListingId,
  splitListingId,
  toIsoTimestamp,
  toUtcIsoDate,
  validateFields,
  type AppError,
  type FinancialStatementSet,
  type DataProvenance,
  type FundamentalMetric,
  type FundamentalMetricId,
  type MetricRow,
  type PeriodMetricTable,
  type QualitativeFinding,
  type QualitativeFindingInput,
  type Result,
  type SourceSummary,
  type StockDataQuality,
  type StockFundamentalAnalysis,
  type StockOverview,
  AppErrors,
} from '@/domain';

import type { Clock } from '../ports';
import type { GetListingQuote } from './get-listing-quote';
import type { GetDividendHistory, GetInstrumentProfile, GetPriceHistory } from './get-market-data';
import type { GetFinancialStatements } from './get-market-reference-data';
import { PERIOD_METRIC_IDS, computePeriodMetrics } from '../stock-analysis/period-metrics';
import { buildQualityAnalysis } from '../stock-analysis/quality';
import {
  buildStatementTables,
  buildTtm,
  deriveQ4,
  groupByPeriod,
  type PeriodStatements,
} from '../stock-analysis/statement-periods';
import { buildTrends } from '../stock-analysis/trends';
import { computeValuation } from '../stock-analysis/valuation';

const DAY_MS = 24 * 60 * 60 * 1000;

export interface AnalyzeStockOptions {
  /** Forrásolt kvalitatív leletek (pl. a felhasználó ellenőrizhető indoklása). */
  readonly qualitativeFindings?: readonly QualitativeFindingInput[];
}

export type AnalyzeStockFundamentals = (
  listingId: string,
  options?: AnalyzeStockOptions,
) => Promise<Result<StockFundamentalAnalysis, AppError>>;

export interface AnalyzeStockFundamentalsDeps {
  readonly getFinancialStatements: GetFinancialStatements;
  readonly getListingQuote: GetListingQuote;
  readonly getInstrumentProfile: GetInstrumentProfile;
  readonly getPriceHistory: GetPriceHistory;
  readonly getDividendHistory: GetDividendHistory;
  readonly clock: Clock;
}

/** A teljesség-összesítő fő mutatói (legutóbbi FY + értékelés). */
const KEY_ANNUAL_IDS: readonly FundamentalMetricId[] = [
  'revenue',
  'grossMargin',
  'operatingMargin',
  'netMargin',
  'eps',
  'revenueGrowth',
  'fcf',
  'netDebt',
  'debtToEquity',
  'roe',
];
const KEY_VALUATION_IDS: readonly FundamentalMetricId[] = [
  'marketCap',
  'pe',
  'ps',
  'pb',
  'evToEbitda',
  'fcfYield',
  'dividendYield',
];

function parseFindings(
  inputs: readonly QualitativeFindingInput[],
): Result<QualitativeFinding[], AppError> {
  const findings: QualitativeFinding[] = [];
  for (const [index, input] of inputs.entries()) {
    const finding = createQualitativeFinding(input);
    if (!finding.ok) {
      return {
        ok: false,
        error: AppErrors.validation('Érvénytelen kvalitatív lelet.', [
          { path: `qualitativeFindings.${index}`, message: finding.error.message },
        ]),
      };
    }
    findings.push(finding.value);
  }
  return ok(findings);
}

function metricTable(
  basis: PeriodMetricTable['basis'],
  columns: readonly PeriodStatements[],
  metricsOf: (ps: PeriodStatements) => FundamentalMetric[],
  notes: readonly string[],
): PeriodMetricTable {
  const perColumn = columns.map(metricsOf);
  const rows: MetricRow[] = PERIOD_METRIC_IDS.map((id, rowIndex) => {
    const first = perColumn[0]?.[rowIndex];
    return {
      id,
      unit: first?.unit ?? 'money',
      formula: first?.formula ?? '',
      cells: perColumn.map((metrics) => metrics[rowIndex]!),
    };
  });
  return { basis, columns: columns.map((c) => c.column), rows, notes };
}

function sourceOf(
  resource: SourceSummary['resource'],
  result: Result<{ readonly provenance: DataProvenance }, AppError>,
): SourceSummary {
  if (!result.ok) {
    return {
      resource,
      sourceId: null,
      fetchedAt: null,
      asOf: null,
      freshness: 'UNKNOWN',
      error: result.error,
    };
  }
  const p = result.value.provenance;
  return {
    resource,
    sourceId: p.sourceId,
    fetchedAt: p.fetchedAt,
    asOf: p.asOf,
    freshness: p.freshness,
    error: null,
  };
}

export function createAnalyzeStockFundamentals(
  deps: AnalyzeStockFundamentalsDeps,
): AnalyzeStockFundamentals {
  return async (rawListingId, options = {}) => {
    const fields = validateFields(
      { listingId: parseListingId(rawListingId) },
      'Érvénytelen kérés.',
    );
    if (!fields.ok) return fields;
    const findings = parseFindings(options.qualitativeFindings ?? []);
    if (!findings.ok) return findings;
    const listingId = fields.value.listingId;
    const now = deps.clock.now();
    const calculatedAt = toIsoTimestamp(now);
    const today = toUtcIsoDate(now);

    const [annualSet, quarterlySet, quote, profile, prices, dividends] = await Promise.all([
      deps.getFinancialStatements(listingId, 'annual'),
      deps.getFinancialStatements(listingId, 'quarterly'),
      deps.getListingQuote(listingId),
      deps.getInstrumentProfile(listingId),
      deps.getPriceHistory(listingId, { adjustment: 'SPLIT_DIVIDEND' }),
      deps.getDividendHistory(listingId, {
        from: toUtcIsoDate(new Date(now.getTime() - 2 * 365 * DAY_MS)),
        to: today,
      }),
    ]);

    const annual = annualSet.ok ? groupByPeriod(annualSet.value) : [];
    const quarterlyReported = quarterlySet.ok ? groupByPeriod(quarterlySet.value) : [];
    const q4 = deriveQ4(annual, quarterlyReported, calculatedAt);
    const quarterly = [...quarterlyReported, ...q4.derived].sort((a, b) =>
      a.column.end < b.column.end ? 1 : a.column.end > b.column.end ? -1 : 0,
    );
    const ttm = buildTtm(quarterly, calculatedAt);

    const setNotes = (set: Result<FinancialStatementSet, AppError>) =>
      set.ok ? set.value.notes : [`A kimutatások nem érhetők el: ${set.error.message}`];
    const annualFy = annual.filter((p) => p.column.kind === 'FY');
    const byFiscalYear = (year: number) =>
      annualFy.find((p) => p.column.fiscalYear === year) ?? null;
    const annualTable = metricTable(
      'annual',
      annualFy,
      (ps) =>
        computePeriodMetrics({
          current: ps,
          comparable: byFiscalYear(ps.column.fiscalYear - 1),
          previousBalance: byFiscalYear(ps.column.fiscalYear - 1),
          basis: 'annual',
          calculatedAt,
        }),
      setNotes(annualSet),
    );
    const quarterlyTable = metricTable(
      'quarterly',
      quarterly,
      (ps) =>
        computePeriodMetrics({
          current: ps,
          comparable:
            quarterly.find(
              (q) =>
                q.column.kind === ps.column.kind &&
                q.column.fiscalYear === ps.column.fiscalYear - 1,
            ) ?? null,
          previousBalance: null,
          basis: 'quarterly',
          calculatedAt,
        }),
      [
        ...setNotes(quarterlySet),
        ...q4.notes,
        'Negyedéves növekedés: az előző év azonos negyedévéhez képest (YoY).',
      ],
    );
    const ttmTable = metricTable(
      'ttm',
      ttm === null ? [] : [ttm],
      (ps) =>
        computePeriodMetrics({
          current: ps,
          comparable: null,
          previousBalance: null,
          basis: 'ttm',
          calculatedAt,
        }),
      ttm === null
        ? [
            'Nincs 4 egymást követő negyedév (a származtatott Q4-gyel együtt sem) – TTM nem képezhető.',
          ]
        : ['TTM = az utolsó 4 egymást követő negyedév összege; mérlegtétel: a legutolsó negyedév.'],
    );

    const latestFy = annualFy[0] ?? null;
    const previousFy = latestFy === null ? null : byFiscalYear(latestFy.column.fiscalYear - 1);
    const latestBalance =
      [annual[0], quarterly[0]]
        .filter((p): p is PeriodStatements => p !== undefined && p.balance !== null)
        .sort((a, b) => (a.column.end < b.column.end ? 1 : -1))[0] ?? null;

    const valuation = computeValuation({
      quote,
      profile,
      prices,
      dividends,
      latestFy,
      previousFy,
      latestBalance,
      calculatedAt,
    });

    const { symbol, mic } = splitListingId(listingId);
    const p = profile.ok ? profile.value : null;
    const overview: StockOverview = {
      listingId,
      ticker: symbol,
      mic,
      name: p?.name ?? (annualSet.ok ? annualSet.value.entityName : null),
      exchangeName: p?.exchangeName ?? null,
      sector: p?.sector ?? null,
      industry: p?.industry ?? null,
      country: p?.country ?? null,
      tradingCurrency: quote.ok ? quote.value.price.currency : (p?.tradingCurrency ?? null),
      reportingCurrency: latestFy?.currency ?? latestBalance?.currency ?? null,
      latestFiscalYearEnd: latestFy?.column.end ?? null,
      ...valuation.overview,
      profileProvenance: p?.provenance ?? null,
    };

    const trends = buildTrends(annual, calculatedAt);
    const latestAnnualMetrics = annualTable.rows.flatMap((row) =>
      row.cells[0] === undefined ? [] : [row.cells[0]],
    );
    const quality = buildQualityAnalysis({
      overview,
      latestAnnual: latestAnnualMetrics,
      valuation: valuation.valuation,
      trends,
      findings: findings.value,
    });

    const keyMetrics = [
      ...latestAnnualMetrics.filter((m) => KEY_ANNUAL_IDS.includes(m.id)),
      ...valuation.valuation.filter((m) => KEY_VALUATION_IDS.includes(m.id)),
    ].filter((m) => m.value.status !== 'NOT_APPLICABLE');
    const gaps = keyMetrics.flatMap((m) =>
      m.value.status === 'OK'
        ? []
        : [{ metricId: m.id, status: m.value.status, reason: m.value.reason }],
    );
    if (latestFy === null) {
      gaps.unshift({
        metricId: 'revenue',
        status: annualSet.ok
          ? 'MISSING'
          : annualSet.error.kind === 'UNAVAILABLE'
            ? 'UNAVAILABLE'
            : 'ERROR',
        reason: annualSet.ok
          ? 'Nincs teljes pénzügyi év (FY) a kimutatásokban.'
          : `Éves kimutatások: ${annualSet.error.message}`,
      });
    }
    const okCount = keyMetrics.length - gaps.length;
    const sources: SourceSummary[] = [
      sourceOf('annualStatements', annualSet),
      sourceOf('quarterlyStatements', quarterlySet),
      sourceOf('quote', quote),
      sourceOf('profile', profile),
      sourceOf('prices', prices),
      sourceOf('dividends', dividends),
    ];
    const warnings = [...valuation.warnings];
    for (const s of sources) {
      if (s.freshness === 'STALE' || s.freshness === 'EXPIRED') {
        warnings.push(
          `Elavult adat (${s.freshness}): ${s.resource} – utolsó adatnap: ${s.asOf ?? 'ismeretlen'}.`,
        );
      }
      if (s.error !== null) warnings.push(`Nem elérhető: ${s.resource} – ${s.error.message}`);
    }
    const debt = latestBalance?.balance?.totalDebt;
    if (debt?.status === 'OK' && debt.provenance.kind === 'estimated') {
      warnings.push(
        'A teljes adósság becslés: egy rövid lejáratú komponensnek nincs ténye, 0-nak vettük (D-059). A nettó adósság, az EV és a D/E ezért szintén becslés.',
      );
    }
    if (latestFy !== null && latestFy.column.end.slice(5) !== '12-31') {
      warnings.push(
        `A pénzügyi év nem a naptári évvel zárul (utolsó FY vége: ${latestFy.column.end}); cégek közti összevetésnél az időszakok eltolódnak.`,
      );
    }
    const dataQuality: StockDataQuality = {
      completeness: okCount <= 0 ? 'INSUFFICIENT' : gaps.length === 0 ? 'COMPLETE' : 'PARTIAL',
      gaps,
      warnings,
      sources,
    };

    return ok({
      generatedAt: calculatedAt,
      overview,
      statements: {
        annual: buildStatementTables('annual', annual, setNotes(annualSet)),
        quarterly: buildStatementTables('quarterly', quarterly, [
          ...setNotes(quarterlySet),
          ...q4.notes,
        ]),
      },
      periodMetrics: { annual: annualTable, quarterly: quarterlyTable, ttm: ttmTable },
      valuation: valuation.valuation,
      trends,
      quality,
      dataQuality,
      disclaimer: STOCK_ANALYSIS_DISCLAIMER,
    });
  };
}
