/**
 * Értékelési motor (PHASE 07): szorzók + sávok, DCF Bear/Base/Bull, szenzitivitási tábla,
 * magyarázható kimenet. Tiszta függvény a PHASE 06 elemzés fölött – nem kér le adatot, így a
 * UI a feltevések állításakor újrahívhatja (hálózat nélkül). Minden DCF-szám a
 * `@/calculations` `runDcf`-jéből jön; itt csak bemenet-kiválasztás és összerakás van.
 */
import {
  DCF_SCENARIO_IDS,
  DEFAULT_MOS_THRESHOLDS,
  DEFAULT_MULTIPLE_BANDS,
  VALUATION_BAND_METRICS,
  VALUATION_THRESHOLD_DISCLAIMER,
  classifyMarginOfSafety,
  classifyMultipleBand,
  constantGrowthRates,
  dcfSensitivityTable,
  runDcfScenarios,
  sensitivityAxis,
  type CalcFailure,
  type CalcFailureStatus,
  type CalcResult,
  type DcfCompanyInputs,
  type DcfResult,
  type DcfScenarioId,
  type DcfSensitivityTable,
  type MarginOfSafetyCategory,
} from '@/calculations';
import type { IsoTimestamp, MetricStatus, StockFundamentalAnalysis } from '@/domain';

import { buildDcfInputModel } from './dcf-inputs';
import {
  DCF_DISCLAIMER,
  DCF_DISPLAY_SIGNIFICANT_DIGITS,
  DEFAULT_DCF_SCENARIOS,
  DEFAULT_EXPLICIT_YEARS,
  DEFAULT_SENSITIVITY,
  roundToSignificant,
} from './defaults';
import type {
  DcfAssumptionSet,
  DcfInputField,
  DcfInputModel,
  DcfScenarioAssumptionsView,
  DcfScenarioOutput,
  MultipleBandOutput,
  StockValuationAnalysis,
  StockValuationOptions,
  ValuationContextItem,
  ValuationExplanation,
  ValuationThresholds,
} from './types';

const REQUIRED_DCF_INPUTS = ['baseFcf', 'totalDebt', 'cash', 'sharesOutstanding'] as const;

/** Nem-OK mutató-státusz → motor-hibastátusz (a forrásoldali `UNAVAILABLE`/`ERROR` → `MISSING`). */
function toCalcFailureStatus(status: Exclude<MetricStatus, 'OK'>): CalcFailureStatus {
  return status === 'UNAVAILABLE' || status === 'ERROR' ? 'MISSING' : status;
}

function inputFailure(field: DcfInputField): CalcFailure {
  const status = field.status === 'OK' ? 'MISSING' : field.status;
  return {
    status: toCalcFailureStatus(status),
    reason: `A(z) „${field.label}” bemenet nem használható (${status}): ${field.reason ?? 'ismeretlen ok'} Szükség esetén felhasználói értékkel felülírható.`,
  };
}

function resolveAssumptions(options: StockValuationOptions): DcfScenarioAssumptionsView[] {
  const years = options.explicitYears ?? DEFAULT_EXPLICIT_YEARS;
  return DCF_SCENARIO_IDS.map((id) => {
    const defaults = DEFAULT_DCF_SCENARIOS[id];
    const override = options.scenarios?.[id] ?? {};
    const growthRates = override.growthRates ?? constantGrowthRates(defaults.growthRate, years);
    const userTouched =
      options.explicitYears !== undefined ||
      override.growthRates !== undefined ||
      override.discountRate !== undefined ||
      override.terminalGrowth !== undefined;
    return {
      growthRates: [...growthRates],
      discountRate: override.discountRate ?? defaults.discountRate,
      terminalGrowth: override.terminalGrowth ?? defaults.terminalGrowth,
      explicitYears: growthRates.length,
      source: userTouched ? 'user' : 'default',
    };
  });
}

function companyInputs(inputs: DcfInputModel): DcfCompanyInputs {
  const value = (field: DcfInputField) => (field.status === 'OK' ? field.value : null);
  return {
    baseFcf: value(inputs.fields.baseFcf),
    totalDebt: value(inputs.fields.totalDebt),
    cash: value(inputs.fields.cash),
    sharesOutstanding: value(inputs.fields.sharesOutstanding),
    marketPrice: value(inputs.fields.marketPrice),
  };
}

/** A MOS „nincs ár” indokát a konkrét bemeneti okkal pontosítja (pl. eltérő pénznem). */
function withPriceReason(
  result: CalcResult<DcfResult>,
  price: DcfInputField,
): CalcResult<DcfResult> {
  if (result.status !== 'OK' || result.value.marginOfSafety.status !== 'MISSING') return result;
  if (price.status === 'OK' || price.reason === null || price.reason === '') return result;
  return {
    ...result,
    value: {
      ...result.value,
      marginOfSafety: {
        status: 'MISSING',
        reason: `A biztonsági sáv nem számolható: ${price.reason}`,
      },
    },
  };
}

function categoryOf(
  result: CalcResult<DcfResult>,
  options: StockValuationOptions,
): CalcResult<MarginOfSafetyCategory> {
  if (result.status !== 'OK') return { status: result.status, reason: result.reason };
  const mos = result.value.marginOfSafety;
  if (mos.status !== 'OK') return mos;
  return classifyMarginOfSafety(
    mos.value,
    options.marginOfSafetyThresholds ?? DEFAULT_MOS_THRESHOLDS,
  );
}

function displayOf(result: CalcResult<DcfResult>) {
  if (result.status !== 'OK') return null;
  const mos = result.value.marginOfSafety;
  return {
    intrinsicValuePerShare: roundToSignificant(
      result.value.intrinsicValuePerShare,
      DCF_DISPLAY_SIGNIFICANT_DIGITS,
    ),
    marginOfSafetyPercent: mos.status === 'OK' ? Math.round(mos.value * 100) : null,
  };
}

function sensitivity(
  base: DcfAssumptionSet,
  company: DcfCompanyInputs,
  blocked: CalcFailure | null,
  options: StockValuationOptions,
): CalcResult<DcfSensitivityTable> {
  if (blocked !== null) return blocked;
  const axis = (custom: readonly number[] | undefined, center: number, step: number) =>
    custom === undefined
      ? sensitivityAxis(center, step, DEFAULT_SENSITIVITY.stepsEachSide)
      : ({ status: 'OK', value: [...custom], notes: [] } as const);
  const rates = axis(
    options.sensitivity?.discountRates,
    base.discountRate,
    DEFAULT_SENSITIVITY.discountRateStep,
  );
  if (rates.status !== 'OK') return rates;
  const growths = axis(
    options.sensitivity?.terminalGrowthRates,
    base.terminalGrowth,
    DEFAULT_SENSITIVITY.terminalGrowthStep,
  );
  if (growths.status !== 'OK') return growths;
  return dcfSensitivityTable({
    base: { ...company, ...base },
    discountRates: rates.value,
    terminalGrowthRates: growths.value,
  });
}

function multipleBands(
  analysis: StockFundamentalAnalysis,
  thresholds: ValuationThresholds['multiples'],
): MultipleBandOutput[] {
  return VALUATION_BAND_METRICS.map((metricId) => {
    const metric = analysis.valuation.find((m) => m.id === metricId) ?? null;
    if (metric === null) {
      return {
        metricId,
        metric,
        band: { status: 'MISSING', reason: 'A mutató nem szerepel az értékelésben.' },
      };
    }
    const v = metric.value;
    const band: MultipleBandOutput['band'] =
      v.status === 'OK'
        ? classifyMultipleBand(v.value, thresholds[metricId])
        : { status: toCalcFailureStatus(v.status), reason: v.reason };
    return { metricId, metric, band };
  });
}

function contextItems(analysis: StockFundamentalAnalysis): ValuationContextItem[] {
  const items: ValuationContextItem[] = [];
  const cagr = (seriesId: string, years: number, label: string) => {
    const metric = analysis.trends
      .find((t) => t.id === seriesId)
      ?.cagr.find((c) => c.years === years)?.value;
    if (metric !== undefined) items.push({ label, metric });
  };
  cagr('fcf', 3, 'FCF CAGR (3 év)');
  cagr('fcf', 5, 'FCF CAGR (5 év)');
  cagr('revenue', 3, 'Árbevétel CAGR (3 év)');
  cagr('revenue', 5, 'Árbevétel CAGR (5 év)');
  const fcfMargin = analysis.periodMetrics.annual.rows.find((r) => r.id === 'fcfMargin')?.cells[0];
  if (fcfMargin !== undefined) items.push({ label: 'FCF-árrés (legutóbbi FY)', metric: fcfMargin });
  items.push({ label: 'Béta (szolgáltatói, tájékoztató)', metric: analysis.overview.beta });
  return items;
}

const FORMULAS: ValuationExplanation['formulas'] = [
  { id: 'fcf_t', formula: 'FCF_t = FCF_{t−1} × (1 + g_t), FCF_0 = kiinduló FCF' },
  { id: 'pv_t', formula: 'PV_t = FCF_t / (1 + r)^t (év végi diszkontálás)' },
  { id: 'terminalValue', formula: 'TV = FCF_n × (1 + g_term) / (r − g_term), csak ha r > g_term' },
  { id: 'pvTerminalValue', formula: 'PV_TV = TV / (1 + r)^n' },
  { id: 'enterpriseValue', formula: 'EV_dcf = Σ PV_t + PV_TV' },
  { id: 'equityValue', formula: 'Equity = EV_dcf − teljes adósság + pénzeszközök' },
  { id: 'intrinsicValuePerShare', formula: 'IV/részvény = Equity / kint lévő részvények' },
  {
    id: 'marginOfSafety',
    formula: 'MOS = (IV/részvény − ár) / IV/részvény; csak IV > 0 és azonos pénznemű ár esetén',
  },
];

const CONVENTIONS: readonly string[] = [
  'Év végi diszkontálás (D-057); a félév közepi konvenció nem alapértelmezés.',
  'Kiinduló FCF = a legutóbbi teljes pénzügyi év OCF − CapEx értéke (D-062); nem normalizált – egyszeri tételeket nem szűrünk. Negatív/nulla FCF-nél a DCF nem fut, csak felhasználói (normalizált) felülírással.',
  'FCF-közelítés: US GAAP szerint az OCF a fizetett kamat után értendő, így ez nem tiszta FCFF. Diszkontrátával diszkontálva és EV-ként kezelve torzíthat (D-022).',
  'A diszkontráta felhasználói feltevés: WACC/CAPM-et nem számolunk, mert nincs forrásolt kockázatmentes hozam és kockázati prémium. A szolgáltatói béta csak tájékoztató.',
  'EV → equity híd: csak teljes adósság és pénzeszközök (kisebbségi részesedés, elsőbbségi részvény, lízing és rövid távú befektetések nélkül; KI-44).',
  'Részvényszám: a legfrissebb mérleg kint lévő részvényszáma (nem hígított; opciók/RSU nélkül).',
  'Pénznem: a beszámolói pénznem; eltérő jegyzési pénznemnél a biztonsági sáv FX-átváltás nélkül nem számolható (KI-50).',
  'A Bear/Base/Bull címkék csak elnevezések: a kiinduló feltevések (D-064) általánosak, nem a cégre kalibráltak, és mind felülírhatók.',
  'A szenzitivitási tábla a Base forgatókönyv bemeneteivel fut, csak a diszkontráta és a terminális növekedés változik; minden cella ugyanazt a DCF-függvényt hívja.',
];

/**
 * Értékelés összeállítása. `calculatedAt`: a hívó (use case) órájából.
 */
export function buildStockValuation(
  analysis: StockFundamentalAnalysis,
  options: StockValuationOptions,
  calculatedAt: IsoTimestamp,
): StockValuationAnalysis {
  const inputs = buildDcfInputModel(analysis, options.inputOverrides);
  const company = companyInputs(inputs);
  const failedField = REQUIRED_DCF_INPUTS.map((id) => inputs.fields[id]).find(
    (f) => f.status !== 'OK',
  );
  const blocked = failedField === undefined ? null : inputFailure(failedField);

  const assumptions = resolveAssumptions(options);
  const scenarioSet = Object.fromEntries(
    DCF_SCENARIO_IDS.map((id, i) => [id, assumptions[i]!]),
  ) as Record<DcfScenarioId, DcfScenarioAssumptionsView>;
  const run = runDcfScenarios(company, scenarioSet);

  const scenarios: DcfScenarioOutput[] = run.scenarios.map((s, i) => {
    const result = blocked ?? withPriceReason(s.result, inputs.fields.marketPrice);
    return {
      id: s.id,
      label: DEFAULT_DCF_SCENARIOS[s.id].label,
      assumptions: assumptions[i]!,
      result,
      category: categoryOf(result, options),
      display: displayOf(result),
    };
  });

  const thresholds: ValuationThresholds = {
    marginOfSafety: options.marginOfSafetyThresholds ?? DEFAULT_MOS_THRESHOLDS,
    multiples: { ...DEFAULT_MULTIPLE_BANDS, ...options.multipleBands },
    disclaimer: VALUATION_THRESHOLD_DISCLAIMER,
  };

  const warnings = [...inputs.warnings];
  if (blocked !== null) warnings.push(`A DCF nem futtatható: ${blocked.reason}`);
  if (analysis.dataQuality.completeness !== 'COMPLETE') {
    warnings.push(
      `A fundamentális adatok hiányosak (${analysis.dataQuality.completeness}); egyes szorzók vagy DCF-bemenetek hiányozhatnak.`,
    );
  }

  return {
    generatedAt: calculatedAt,
    fundamentalsGeneratedAt: analysis.generatedAt,
    listingId: analysis.overview.listingId,
    multiples: {
      metrics: analysis.valuation,
      bands: multipleBands(analysis, thresholds.multiples),
    },
    dcf: {
      provenanceKind: 'estimated',
      inputs,
      scenarios,
      scenarioNotes: blocked === null ? run.notes : [],
      sensitivity: {
        scenarioId: 'base',
        table: sensitivity(scenarioSet.base, company, blocked, options),
      },
    },
    thresholds,
    explanation: { formulas: FORMULAS, conventions: CONVENTIONS, context: contextItems(analysis) },
    warnings,
    disclaimer: DCF_DISCLAIMER,
  };
}
