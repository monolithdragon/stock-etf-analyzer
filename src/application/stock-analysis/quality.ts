/**
 * Minőségi elemzés adatmodell (PHASE 06, feladat 7–8., D-063).
 *
 * - NINCS pontszám és NINCS „jó/rossz” minősítés: témánként csak azt gyűjtjük össze, milyen
 *   bizonyíték érhető el (numerikus mutatók eredettel) és mi hiányzik. A pontozás a PHASE 10-é.
 * - Kvantitatív témák (GROWTH, PROFITABILITY, BALANCE_SHEET, CASH_FLOW, VALUATION, BUSINESS):
 *   az állapot a bizonyíték elérhetőségéből jön.
 * - Kvalitatív témák (MOAT, MANAGEMENT): az állapot KIZÁRÓLAG forrásolt leletekből jön
 *   (`QualitativeFinding`, kötelező forrás-hivatkozással). Numerikus kontextust mutatunk, de az
 *   önmagában nem bizonyít versenyelőnyt vagy vezetői minőséget → lelet nélkül
 *   `INSUFFICIENT_DATA`.
 */
import {
  QUALITATIVE_THEMES,
  QUALITY_THEMES,
  type FundamentalMetric,
  type QualitativeFinding,
  type QualityAnalysis,
  type QualityTheme,
  type QualityThemeAssessment,
  type QualityThemeStatus,
  type StockOverview,
  type TrendSeries,
  type TrendSeriesId,
} from '@/domain';

export interface QualityInput {
  readonly overview: StockOverview;
  /** A legutóbbi éves oszlop mutatói (lehet üres, ha nincs FY). */
  readonly latestAnnual: readonly FundamentalMetric[];
  readonly valuation: readonly FundamentalMetric[];
  readonly trends: readonly TrendSeries[];
  readonly findings: readonly QualitativeFinding[];
}

const THEME_METRICS: Readonly<Partial<Record<QualityTheme, readonly string[]>>> = {
  BUSINESS: ['revenue'],
  GROWTH: ['revenueGrowth', 'netIncomeGrowth', 'epsGrowth'],
  PROFITABILITY: ['grossMargin', 'operatingMargin', 'netMargin', 'roe', 'roic'],
  BALANCE_SHEET: [
    'cashAndEquivalents',
    'totalDebt',
    'netDebt',
    'debtToEquity',
    'shareholdersEquity',
  ],
  CASH_FLOW: ['operatingCashFlow', 'fcf', 'fcfMargin', 'fcfConversion'],
  MOAT: ['grossMargin', 'roic'],
  VALUATION: ['pe', 'ps', 'pb', 'pfcf', 'evToEbitda', 'fcfYield', 'dividendYield', 'peg'],
};

/** Trend-CAGR bizonyítékok témánként: [sorozat, évek]. */
const THEME_TRENDS: Readonly<Partial<Record<QualityTheme, readonly [TrendSeriesId, number][]>>> = {
  GROWTH: [
    ['revenue', 3],
    ['revenue', 5],
    ['eps', 3],
    ['fcf', 3],
  ],
  MANAGEMENT: [['sharesOutstanding', 3]],
};

const NOTES: Readonly<Record<QualityTheme, string>> = {
  BUSINESS:
    'Üzleti profil: forrásolt metaadat (szektor, iparág, ország) és méret. A szolgáltatói leírást a rendszer nem értelmezi.',
  GROWTH: 'Növekedési bizonyíték (YoY és CAGR); minősítés nélkül.',
  PROFITABILITY: 'Jövedelmezőségi mutatók a legutóbbi teljes pénzügyi évre.',
  BALANCE_SHEET: 'Mérleg és eladósodottság a legutóbbi FY mérlegnapján.',
  CASH_FLOW: 'Működési és szabad cash flow a legutóbbi teljes pénzügyi évre.',
  MOAT: 'Versenyelőny csak forrásolt lelettel (pl. 10-K Item 1, szabadalmak, piaci részesedés hivatkozással) értékelhető. A bruttó árrés és a ROIC csak kontextus, önmagában nem bizonyíték.',
  MANAGEMENT:
    'Vezetés csak forrásolt lelettel (pl. proxy statement / DEF 14A, tőkeallokációs döntések hivatkozással) értékelhető. A részvényszám változása tény, nem minősítés.',
  VALUATION: 'Értékelési szorzók az aktuális árral és a legutóbbi FY-jal (D-062); nem ítélet.',
};

function numericStatus(evidence: readonly FundamentalMetric[]): QualityThemeStatus {
  const relevant = evidence.filter((m) => m.value.status !== 'NOT_APPLICABLE');
  const okCount = relevant.filter((m) => m.value.status === 'OK').length;
  if (okCount === 0) return 'INSUFFICIENT_DATA';
  return okCount === relevant.length ? 'EVIDENCE_AVAILABLE' : 'PARTIAL_EVIDENCE';
}

function missingOf(evidence: readonly FundamentalMetric[]): string[] {
  return evidence.flatMap((m) =>
    m.value.status === 'OK' || m.value.status === 'NOT_APPLICABLE'
      ? []
      : [`${m.id}: ${m.value.status} – ${m.value.reason}`],
  );
}

function businessAssessment(
  input: QualityInput,
  evidence: readonly FundamentalMetric[],
  findings: readonly QualitativeFinding[],
): QualityThemeAssessment {
  const { overview } = input;
  const metadata: [string, string | null][] = [
    ['név', overview.name],
    ['szektor', overview.sector],
    ['iparág', overview.industry],
    ['ország', overview.country],
  ];
  const missingMeta = metadata.filter(([, v]) => v === null).map(([k]) => `${k}: nincs forrásadat`);
  const missing = [...missingMeta, ...missingOf(evidence)];
  const available =
    metadata.length - missingMeta.length + evidence.filter((m) => m.value.status === 'OK').length;
  const status: QualityThemeStatus =
    available === 0
      ? 'INSUFFICIENT_DATA'
      : missing.length === 0
        ? 'EVIDENCE_AVAILABLE'
        : 'PARTIAL_EVIDENCE';
  return { theme: 'BUSINESS', status, evidence, findings, missing, note: NOTES.BUSINESS };
}

export function buildQualityAnalysis(input: QualityInput): QualityAnalysis {
  const all = [...input.latestAnnual, ...input.valuation];
  const themes = QUALITY_THEMES.map((theme): QualityThemeAssessment => {
    const ids = THEME_METRICS[theme] ?? [];
    const metricEvidence = ids.flatMap((id) => {
      const found = all.find((m) => m.id === id);
      return found === undefined ? [] : [found];
    });
    const trendEvidence = (THEME_TRENDS[theme] ?? []).flatMap(([seriesId, years]) => {
      const cagr = input.trends.find((t) => t.id === seriesId)?.cagr.find((c) => c.years === years);
      return cagr === undefined ? [] : [cagr.value];
    });
    const evidence = [...metricEvidence, ...trendEvidence];
    const findings = input.findings.filter((f) => f.theme === theme);
    if (theme === 'BUSINESS') return businessAssessment(input, evidence, findings);
    if (QUALITATIVE_THEMES.includes(theme)) {
      return {
        theme,
        status: findings.length > 0 ? 'EVIDENCE_AVAILABLE' : 'INSUFFICIENT_DATA',
        evidence,
        findings,
        missing:
          findings.length > 0
            ? []
            : [
                'Nincs forrásolt kvalitatív lelet (pl. SEC-filing szakasz hivatkozással) és nincs ellenőrizhető felhasználói indoklás.',
              ],
        note: NOTES[theme],
      };
    }
    return {
      theme,
      status: numericStatus(evidence),
      evidence,
      findings,
      missing: missingOf(evidence),
      note: NOTES[theme],
    };
  });
  return { themes, scoring: 'NOT_SCORED' };
}
