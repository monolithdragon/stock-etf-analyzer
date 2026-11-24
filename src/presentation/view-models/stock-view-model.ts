/**
 * Részvényelemzés → képernyőmodell (PHASE 12). KÜLÖN logika az ETF-től és a portfóliótól.
 *
 * Csak leképez és formáz: minden szám a PHASE 06/07/10 use case-ek kimenetéből jön.
 * A hiányzó mutató N/A/N/M jelöléssel és okkal jelenik meg, soha nem 0-ként, és a sorrend
 * nem a hiányzó értékek „nullaként” rendezése (a sorrend fix, szakmai csoportosítás).
 */
import type { StockEvaluationResult } from '@/application';
import type { ModelValueCategory } from '@/calculations';
import type {
  AppError,
  FundamentalMetric,
  FundamentalMetricId,
  Metric,
  MetricRow as DomainMetricRow,
  MetricStatus,
} from '@/domain';
import type { DataNotice } from '@/presentation/components/states';
import { formatMoney, formatNumber, formatPercent } from '@/presentation/format';

import { buildEvaluationViewModel, type EvaluationViewModel } from './evaluation-view-model';
import { buildMetricRow, type MetricRowModel } from './metric-row';

/** Magyar mutatónevek (DATA_DICTIONARY 13–14. alapján). */
export const STOCK_METRIC_LABELS: Partial<Record<FundamentalMetricId | string, string>> = {
  price: 'Árfolyam',
  marketCap: 'Piaci kapitalizáció',
  sharesOutstanding: 'Kibocsátott részvények',
  beta: 'Béta (szolgáltatói)',
  week52High: '52 hetes csúcs',
  week52Low: '52 hetes mélypont',
  enterpriseValue: 'Vállalatérték (EV)',
  pe: 'P/E',
  forwardPe: 'Előretekintő P/E',
  ps: 'P/S',
  pb: 'P/B',
  pfcf: 'P/FCF',
  fcfYield: 'FCF-hozam',
  evToEbitda: 'EV/EBITDA',
  peg: 'PEG',
  dividendYield: 'Osztalékhozam',
  dividendPerShareTtm: 'Osztalék/részvény (TTM)',
  revenue: 'Árbevétel',
  grossProfit: 'Bruttó fedezet',
  grossMargin: 'Bruttó árrés',
  operatingIncome: 'Üzemi eredmény',
  operatingMargin: 'Üzemi árrés',
  netIncome: 'Nettó eredmény',
  netMargin: 'Nettó árrés',
  eps: 'EPS (hígított)',
  revenueGrowth: 'Árbevétel-növekedés',
  netIncomeGrowth: 'Nettóeredmény-növekedés',
  epsGrowth: 'EPS-növekedés',
  cashAndEquivalents: 'Készpénz és egyenértékesei',
  totalDebt: 'Teljes adósság',
  totalAssets: 'Mérlegfőösszeg',
  totalLiabilities: 'Összes kötelezettség',
  shareholdersEquity: 'Saját tőke',
  netDebt: 'Nettó adósság',
  netCash: 'Nettó készpénz',
  debtToEquity: 'Adósság / saját tőke',
  operatingCashFlow: 'Működési cash flow',
  capitalExpenditure: 'Beruházás (CapEx)',
  fcf: 'Szabad cash flow (FCF)',
  fcfMargin: 'FCF-árrés',
  fcfConversion: 'FCF-konverzió',
  ebitda: 'EBITDA',
  effectiveTaxRate: 'Effektív adókulcs',
  roe: 'ROE',
  roa: 'ROA',
  roic: 'ROIC',
};

export function stockMetricLabel(id: string): string {
  return STOCK_METRIC_LABELS[id] ?? id;
}

const GROWTH_IDS = ['revenueGrowth', 'netIncomeGrowth', 'epsGrowth'] as const;
const PROFITABILITY_IDS = [
  'revenue',
  'grossMargin',
  'operatingMargin',
  'netMargin',
  'eps',
  'roe',
  'roa',
  'roic',
  'effectiveTaxRate',
] as const;
const BALANCE_IDS = [
  'cashAndEquivalents',
  'totalDebt',
  'netDebt',
  'shareholdersEquity',
  'totalAssets',
  'totalLiabilities',
  'debtToEquity',
] as const;
const CASH_FLOW_IDS = [
  'operatingCashFlow',
  'capitalExpenditure',
  'fcf',
  'fcfMargin',
  'fcfConversion',
  'ebitda',
] as const;

const BAND_LABEL = { LOW: 'alacsony sáv', MODERATE: 'közepes sáv', HIGH: 'magas sáv' } as const;

export function fundamentalRow(
  metric: FundamentalMetric,
  hint: string | null = null,
): MetricRowModel {
  return buildMetricRow({
    key: metric.id,
    label: stockMetricLabel(metric.id),
    value: metric.value,
    unit: metric.unit,
    origin: metric.origin,
    formula: metric.formula,
    period: metric.period,
    notes: metric.notes,
    hint,
  });
}

/** A legfrissebb időszak cellája (az oszlopok sorrendje: legfrissebb elöl). */
function latestCellRows(
  rows: readonly DomainMetricRow[],
  ids: readonly string[],
  columnLabel: string | null,
): MetricRowModel[] {
  const out: MetricRowModel[] = [];
  for (const id of ids) {
    const row = rows.find((r) => r.id === id);
    const cell = row?.cells[0];
    if (cell === undefined) continue;
    out.push(fundamentalRow(cell, columnLabel));
  }
  return out;
}

export interface StockSection {
  readonly id:
    'overview' | 'valuation' | 'growth' | 'profitability' | 'balance' | 'cashflow' | 'risk';
  readonly title: string;
  readonly rows: readonly MetricRowModel[];
  readonly notes: readonly string[];
  /** Pl. „5/12 elérhető”. */
  readonly summary: string;
}

export interface DcfScenarioViewModel {
  readonly id: string;
  readonly label: string;
  readonly valueText: string;
  readonly mosText: string;
  readonly categoryText: string;
  readonly assumptionsText: string;
  readonly reason: string | null;
}

export interface StockViewModel {
  /**
   * Ha MINDEN adatforrás-lekérés hibás volt, az elemzés üres: a képernyő ilyenkor
   * hibaállapotot mutat újrapróbálással (az első hibával), nem egy csupa N/A oldalt.
   */
  readonly blockingError: AppError | null;
  readonly header: {
    readonly title: string;
    readonly subtitle: string;
    readonly priceText: string;
    readonly priceHint: string;
    readonly meta: readonly string[];
  };
  readonly notices: readonly DataNotice[];
  readonly evaluation: EvaluationViewModel;
  readonly sections: readonly StockSection[];
  readonly dcf: {
    readonly available: boolean;
    readonly currency: string | null;
    readonly inputs: readonly MetricRowModel[];
    readonly scenarios: readonly DcfScenarioViewModel[];
    readonly sensitivity: {
      readonly available: boolean;
      readonly reason: string | null;
      readonly header: readonly string[];
      readonly rows: readonly { readonly label: string; readonly cells: readonly string[] }[];
    };
    readonly warnings: readonly string[];
    readonly conventions: readonly string[];
    readonly disclaimer: string;
  };
  readonly dataQuality: {
    readonly completenessText: string;
    readonly gaps: readonly string[];
    readonly warnings: readonly string[];
    readonly sources: readonly string[];
  };
  readonly disclaimers: readonly string[];
}

/** DCF-bemenet nem-OK státusza → `Metric` (az `UNAVAILABLE` ok-kódja itt nem ismert). */
function missingMetric(status: MetricStatus, reason: string): Metric<number> {
  if (status === 'UNAVAILABLE') {
    return { status: 'UNAVAILABLE', unavailableReason: 'NOT_COVERED', reason };
  }
  return { status: status === 'OK' ? 'MISSING' : status, reason };
}

function summarize(rows: readonly MetricRowModel[]): string {
  const ok = rows.filter((r) => r.status === 'OK').length;
  return `${ok}/${rows.length} mutató elérhető`;
}

function section(
  id: StockSection['id'],
  title: string,
  rows: readonly MetricRowModel[],
  notes: readonly string[] = [],
): StockSection {
  return { id, title, rows, notes, summary: summarize(rows) };
}

const COMPLETENESS_LABEL: Readonly<Record<string, string>> = {
  COMPLETE: 'teljes',
  PARTIAL: 'részleges',
  INSUFFICIENT: 'elégtelen',
};

const SCENARIO_CATEGORY_LABEL: Readonly<Record<ModelValueCategory, string>> = {
  DISCOUNT_TO_MODEL: 'az ár érdemben a modellérték alatt',
  NEAR_MODEL: 'az ár a modellérték közelében',
  PREMIUM_TO_MODEL: 'az ár érdemben a modellérték felett',
};

export function buildStockViewModel(result: StockEvaluationResult): StockViewModel {
  const { fundamentals: f, valuation: v, evaluation } = result;
  const o = f.overview;
  const annual = f.periodMetrics.annual;
  const latestAnnual = annual.columns[0]?.label ?? null;

  // --- fejléc ---------------------------------------------------------------------------------
  const price = o.price.value;
  const priceText =
    price.status === 'OK'
      ? formatMoney(price.value, price.provenance.currency ?? o.tradingCurrency)
      : 'N/A';
  const priceHint =
    price.status === 'OK'
      ? `${price.provenance.sourceName}`
      : `Az árfolyam nem elérhető: ${price.reason}`;

  // --- szakaszok ------------------------------------------------------------------------------
  const bandById = new Map(v.multiples.bands.map((b) => [b.metricId, b.band]));
  const valuationRows = f.valuation.map((metric) => {
    const band = bandById.get(metric.id as never);
    const hint = band !== undefined && band.status === 'OK' ? BAND_LABEL[band.value.band] : null;
    return fundamentalRow(metric, hint);
  });

  const trendNotes = f.trends.flatMap((trend) =>
    trend.cagr
      .filter((c) => c.value.value.status === 'OK')
      .map((c) => {
        const value = c.value.value;
        return value.status === 'OK'
          ? `${stockMetricLabel(trend.id)} ${c.years} éves CAGR: ${formatPercent(value.value, { signed: true })}`
          : '';
      }),
  );

  const sections: StockSection[] = [
    section('overview', 'Ár és alapadatok', [
      fundamentalRow(o.price),
      fundamentalRow(o.marketCap),
      fundamentalRow(o.sharesOutstanding),
      fundamentalRow(o.week52High),
      fundamentalRow(o.week52Low),
    ]),
    section('valuation', 'Értékeltség (szorzók)', valuationRows, [v.thresholds.disclaimer]),
    section('growth', 'Növekedés', latestCellRows(annual.rows, GROWTH_IDS, latestAnnual), [
      ...trendNotes,
      ...annual.notes,
    ]),
    section(
      'profitability',
      'Jövedelmezőség',
      latestCellRows(annual.rows, PROFITABILITY_IDS, latestAnnual),
    ),
    section('balance', 'Mérleg', latestCellRows(annual.rows, BALANCE_IDS, latestAnnual)),
    section('cashflow', 'Cash flow', latestCellRows(annual.rows, CASH_FLOW_IDS, latestAnnual)),
    section(
      'risk',
      'Kockázat',
      [fundamentalRow(o.beta)],
      ['A tézis kockázatai és érvénytelenítő feltételei a „Score és döntés” szakaszban.'],
    ),
  ];

  // --- DCF ------------------------------------------------------------------------------------
  const dcfCurrency = v.dcf.inputs.currency;
  const inputs = Object.values(v.dcf.inputs.fields).map((field) =>
    buildMetricRow({
      key: `dcf-${field.id}`,
      label: field.label,
      value:
        field.value !== null && field.status === 'OK' && field.source !== null
          ? {
              status: 'OK',
              value: field.value,
              provenance: {
                sourceId: field.source.sourceId,
                sourceName: field.source.sourceName,
                kind: field.overridden ? 'user_input' : 'reported',
                fetchedAt: field.source.fetchedAt,
                asOf: field.source.asOf,
                freshness: 'UNKNOWN',
                ...(field.currency !== null ? { currency: field.currency } : {}),
              },
            }
          : missingMetric(field.status, field.reason ?? 'A bemenet nem használható.'),
      unit: field.unit,
      origin: field.origin,
      currency: field.currency,
      hint: field.basis,
      notes: field.notes,
    }),
  );

  const scenarios: DcfScenarioViewModel[] = v.dcf.scenarios.map((s) => {
    const a = s.assumptions;
    const growth = a.growthRates.map((g) => formatPercent(g)).join(', ');
    const assumptionsText = `Növekedés: ${growth} (${a.explicitYears} év) · Diszkontráta: ${formatPercent(a.discountRate)} · Terminális növekedés: ${formatPercent(a.terminalGrowth)}${a.source === 'user' ? ' · saját feltevés' : ' · alapfeltevés'}`;
    const ok = s.result.status === 'OK' && s.display !== null;
    return {
      id: s.id,
      label: s.label,
      valueText:
        ok && s.display !== null
          ? `${formatMoney(s.display.intrinsicValuePerShare, dcfCurrency)} / részvény (becslés)`
          : 'N/A',
      mosText:
        s.display !== null && s.display.marginOfSafetyPercent !== null
          ? `Biztonsági sáv: ${formatNumber(s.display.marginOfSafetyPercent, 0)}%`
          : 'Biztonsági sáv: N/A',
      categoryText:
        s.category.status === 'OK'
          ? SCENARIO_CATEGORY_LABEL[s.category.value.category]
          : 'kategória: N/A',
      assumptionsText,
      reason: s.result.status === 'OK' ? null : s.result.reason,
    };
  });

  const table = v.dcf.sensitivity.table;
  const sensitivity =
    table.status === 'OK'
      ? {
          available: true,
          reason: null,
          header: ['r \\ g', ...table.value.terminalGrowthRates.map((g) => formatPercent(g))],
          rows: table.value.rows.map((row) => ({
            label: formatPercent(row.discountRate),
            cells: row.cells.map((cell) =>
              cell.intrinsicValuePerShare.status === 'OK'
                ? formatMoney(cell.intrinsicValuePerShare.value, dcfCurrency, { decimals: 0 })
                : 'N/A',
            ),
          })),
        }
      : { available: false, reason: table.reason, header: [], rows: [] };

  // --- jelzések -------------------------------------------------------------------------------
  const notices: DataNotice[] = [];
  const allProvenanceKinds = [o.price, o.marketCap, ...f.valuation].map((m) =>
    m.value.status === 'OK' ? m.value.provenance.kind : null,
  );
  if (
    f.dataQuality.sources.some((s) => s.sourceId === 'mock') ||
    allProvenanceKinds.includes('mock')
  ) {
    notices.push({
      id: 'mock',
      tone: 'info',
      title: 'Demóadat',
      message: 'Kitalált, nem valós adatok – csak a működés bemutatására.',
    });
  }
  const staleWarnings = f.dataQuality.warnings.filter((w) =>
    /STALE|EXPIRED|elavult|lejárt/i.test(w),
  );
  const priceStale =
    price.status === 'OK' &&
    (price.provenance.freshness === 'STALE' || price.provenance.freshness === 'EXPIRED');
  if (priceStale || staleWarnings.length > 0) {
    notices.push({
      id: 'stale',
      tone: 'warning',
      title: 'Elavult adat',
      message: [priceStale ? 'Az árfolyam nem friss.' : null, ...staleWarnings]
        .filter((x): x is string => x !== null)
        .join(' '),
    });
  }
  if (f.dataQuality.completeness !== 'COMPLETE' || f.dataQuality.gaps.length > 0) {
    notices.push({
      id: 'partial',
      tone: 'warning',
      title: 'Részleges adat',
      message: `${f.dataQuality.gaps.length} fő mutató hiányzik vagy nem értelmezhető. A hiány nem nulla: N/A vagy N/M jelöléssel, okkal látszik.`,
    });
  }

  const meta = [
    o.exchangeName ?? o.mic,
    o.tradingCurrency !== null ? `Kereskedési pénznem: ${o.tradingCurrency}` : null,
    o.reportingCurrency !== null && o.reportingCurrency !== o.tradingCurrency
      ? `Beszámolási pénznem: ${o.reportingCurrency}`
      : null,
    [o.sector, o.industry, o.country].filter((x) => x !== null).join(' · ') || null,
  ].filter((x): x is string => x !== null && x !== '');

  const sourceErrors = f.dataQuality.sources.map((s) => s.error);
  const blockingError =
    sourceErrors.length > 0 && sourceErrors.every((e) => e !== null)
      ? (sourceErrors[0] ?? null)
      : null;

  return {
    blockingError,
    header: {
      title: o.name ?? o.ticker,
      subtitle: `${o.ticker} · ${o.mic} · Részvény`,
      priceText,
      priceHint,
      meta,
    },
    notices,
    evaluation: buildEvaluationViewModel(evaluation),
    sections,
    dcf: {
      available: v.dcf.scenarios.some((s) => s.result.status === 'OK'),
      currency: dcfCurrency,
      inputs,
      scenarios,
      sensitivity,
      warnings: [...v.dcf.inputs.warnings, ...v.dcf.scenarioNotes, ...v.warnings],
      conventions: v.explanation.conventions,
      disclaimer: v.disclaimer,
    },
    dataQuality: {
      completenessText:
        COMPLETENESS_LABEL[f.dataQuality.completeness] ?? f.dataQuality.completeness,
      gaps: f.dataQuality.gaps.map((g) => `${stockMetricLabel(g.metricId)}: ${g.reason}`),
      warnings: f.dataQuality.warnings,
      sources: f.dataQuality.sources.map(
        (s) =>
          `${s.resource}: ${s.sourceId ?? 'nincs forrás'}${s.error !== null ? ` – hiba: ${s.error.message}` : ''}`,
      ),
    },
    disclaimers: [f.disclaimer, v.disclaimer],
  };
}
