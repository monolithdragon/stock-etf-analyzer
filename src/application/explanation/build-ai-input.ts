/**
 * PHASE 11 – AI-bemenet építése (D-076): a determinisztikus motor kimenetéből (PHASE 06–10)
 * szigorú, hivatkozható `AiInputDto`.
 *
 * Mi kerül bele: számított mutatók (érték VAGY a hiány oka), adatminőség, frissesség, forrás,
 * időbélyeg, kategória-pontok, döntés (címke, szabálynyom, plafonok), confidence, thesis,
 * DCF-feltevések és -eredmények (becslésként jelölve), adathiányok.
 * Mi NEM: nyers szolgáltatói szöveg, portfólió-összegek/darabszámok/árak (adatminimalizálás).
 *
 * Minden szöveg a `sanitizeAiText`-en megy át (vezérlőkarakter, `<`/`>` ki, hosszkorlát).
 * A kimenetet a `aiInputDtoSchema` is ellenőrzi: hibás DTO → `VALIDATION` hiba (programozási hiba
 * vagy váratlan adat), nem csendes továbbküldés.
 */
import {
  AI_LIMITS,
  AI_SCHEMA_VERSION,
  aiInputDtoSchema,
  sanitizeAiText,
  type AiInputDto,
  type AiInputMetric,
} from '@/contracts';
import {
  AppErrors,
  METRIC_STATUSES,
  err,
  ok,
  type MeasurementUnit,
  type Metric,
  type MetricStatus,
  type Result,
} from '@/domain';
import {
  DECISION_LABEL_KEYS,
  DEFAULT_DECISION_LABELS,
  type DecisionConfig,
  type MetricScore,
  type ScoringFeature,
} from '@/scoring';

import type { PortfolioAnalysis, PortfolioMetric } from '../portfolio/types';
import type { InstrumentEvaluation } from '../scoring/types';
import type { StockValuationAnalysis } from '../valuation/types';

type Gap = AiInputDto['dataGaps'][number];

const text = (value: string, max?: number) => sanitizeAiText(value, max);
const shortText = (value: string) => sanitizeAiText(value, AI_LIMITS.shortText);

/** Hivatkozás-azonosító: csak engedélyezett karakterek (a `ref` regexe). */
export function aiRef(prefix: string, id: string): string {
  const safe = id.replace(/[^A-Za-z0-9_.@:-]/g, '_').slice(0, 100) || '_';
  return `${prefix}:${safe}`;
}

// --- Megjelenítési alak (az AI csak ezt idézheti) --------------------------------------------

const huNumber = (value: number, decimals: number) =>
  value.toFixed(decimals).replace('-', '−').replace('.', ',').replace('−', '-');

function compactMoney(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1e12) return `${huNumber(value / 1e12, 2)} billió`;
  if (abs >= 1e9) return `${huNumber(value / 1e9, 2)} Mrd`;
  if (abs >= 1e6) return `${huNumber(value / 1e6, 2)} M`;
  return huNumber(value, 2);
}

/** Szám → rövid magyar megjelenítés az egység szerint (D-009: kerekítés csak itt). */
export function formatAiDisplay(
  value: number,
  unit: MeasurementUnit | null,
  currency: string | null,
): string {
  const cur = currency === null ? '' : ` ${currency}`;
  switch (unit) {
    case 'ratio':
      return `${huNumber(value * 100, 1)}%`;
    case 'multiple':
      return `${huNumber(value, 1)}x`;
    case 'money':
      return `${compactMoney(value)}${cur}`;
    case 'money_per_share':
      return `${huNumber(value, 2)}${cur}`;
    case 'shares':
      return `${compactMoney(value)} db`;
    case 'count':
      return huNumber(value, 0);
    default:
      return huNumber(value, 2);
  }
}

function asMetricStatus(status: string): MetricStatus {
  return (METRIC_STATUSES as readonly string[]).includes(status)
    ? (status as MetricStatus)
    : 'ERROR';
}

function metricReason(metric: Metric<unknown>): string | null {
  return metric.status === 'OK' ? null : text(metric.reason);
}

function sourceOf(metric: Metric<unknown>): AiInputMetric['source'] {
  const p = metric.provenance;
  if (p === undefined) return null;
  return {
    sourceId: shortText(p.sourceId),
    sourceName: shortText(p.sourceName),
    kind: p.kind,
    fetchedAt: p.fetchedAt,
  };
}

// --- Részvény / ETF ---------------------------------------------------------------------------

function featureMetric(
  feature: ScoringFeature | undefined,
  scored: { readonly metric: MetricScore; readonly categoryId: string } | undefined,
  featureId: string,
): AiInputMetric {
  const ref = aiRef('metric', featureId);
  const label = shortText(feature?.label ?? scored?.metric.label ?? featureId);
  const categoryRef = scored === undefined ? null : aiRef('category', scored.categoryId);
  const score = scored?.metric.score ?? null;
  if (feature === undefined) {
    return {
      ref,
      label,
      value: null,
      display: null,
      unit: scored?.metric.unit ?? null,
      currency: null,
      status: 'NO_FEATURE',
      reason: text(scored?.metric.reason ?? 'A leképező nem adta át ezt a mutatót.'),
      categoryRef,
      score,
      asOf: null,
      freshness: null,
      source: null,
    };
  }
  const metric: Metric<number> | Metric<string> = feature.value;
  const unit = feature.kind === 'numeric' ? feature.unit : null;
  const currency = metric.provenance?.currency ?? null;
  const value: number | string | null =
    metric.status === 'OK'
      ? typeof metric.value === 'number'
        ? metric.value
        : shortText(metric.value)
      : null;
  return {
    ref,
    label,
    value,
    display:
      typeof value === 'number' ? formatAiDisplay(value, unit, currency) : (value as string | null),
    unit,
    currency,
    status: metric.status,
    reason: metricReason(metric),
    categoryRef,
    score,
    asOf: metric.provenance?.asOf ?? null,
    freshness: metric.provenance?.freshness ?? null,
    source: sourceOf(metric),
  };
}

function dcfSection(valuation: StockValuationAnalysis): NonNullable<AiInputDto['dcf']> {
  const fields = Object.values(valuation.dcf.inputs.fields);
  const inputs: AiInputMetric[] = fields.map((field) => ({
    ref: aiRef('dcfinput', field.id),
    label: shortText(field.label),
    value: field.value,
    display: field.value === null ? null : formatAiDisplay(field.value, field.unit, field.currency),
    unit: field.unit,
    currency: field.currency,
    status: field.status,
    reason: field.reason === null ? null : text(field.reason),
    categoryRef: null,
    score: null,
    asOf: field.source?.asOf ?? null,
    freshness: null,
    source:
      field.source === null
        ? null
        : {
            sourceId: shortText(field.source.sourceId),
            sourceName: shortText(field.source.sourceName),
            kind: field.overridden ? 'user_input' : null,
            fetchedAt: field.source.fetchedAt,
          },
  }));
  const pct = (r: number) => `${huNumber(r * 100, 1)}%`;
  const scenarios = valuation.dcf.scenarios.map((s) => {
    const a = s.assumptions;
    const growth = a.growthRates.map(pct).join(' / ');
    const iv = s.display?.intrinsicValuePerShare ?? null;
    const mos = s.display?.marginOfSafetyPercent ?? null;
    const currency = valuation.dcf.inputs.currency ?? '';
    const result =
      s.result.status === 'OK'
        ? `belső érték/részvény ${iv === null ? 'N/A' : `${huNumber(iv, 2)} ${currency}`.trim()}, biztonsági sáv ${mos === null ? 'N/A' : `${mos}%`}`
        : `nem számolható (${s.result.reason})`;
    return {
      ref: aiRef('dcf', s.id),
      label: shortText(s.label),
      assumptionSource: a.source,
      explicitYears: a.explicitYears,
      growthRates: [...a.growthRates],
      discountRate: a.discountRate,
      terminalGrowth: a.terminalGrowth,
      display: text(
        `${s.label}: növekedés ${growth}, diszkontráta ${pct(a.discountRate)}, terminális növekedés ${pct(a.terminalGrowth)}, ${a.explicitYears} év; ${result}`,
      ),
      status: s.result.status === 'OK' ? ('OK' as const) : asMetricStatus(s.result.status),
      intrinsicValuePerShare: iv,
      marginOfSafetyPercent: mos,
      reason: s.result.status === 'OK' ? null : text(s.result.reason),
    };
  });
  return {
    provenanceKind: 'estimated',
    currency: valuation.dcf.inputs.currency,
    inputs,
    scenarios,
    notes: [...valuation.dcf.scenarioNotes, ...valuation.dcf.inputs.warnings]
      .slice(0, AI_LIMITS.listItems)
      .map((n) => text(n)),
  };
}

function finalize(dto: AiInputDto): Result<AiInputDto> {
  const parsed = aiInputDtoSchema.safeParse(dto);
  if (parsed.success) return ok(parsed.data);
  return err(
    AppErrors.validation(
      'Az AI-bemenet nem felel meg a sémának.',
      parsed.error.issues.slice(0, 10).map((i) => ({
        path: i.path.map(String).join('.'),
        message: i.message,
      })),
    ),
  );
}

export interface InstrumentAiInputOptions {
  /** Megjelenítési név (pl. „Apple Inc.”) – szolgáltatói szöveg, tisztítva kerül be. */
  readonly displayName?: string | null;
  /** Részvénynél a PHASE 07 értékelés (DCF-feltevések); ETF-nél nem adható meg. */
  readonly valuation?: StockValuationAnalysis | null;
  /**
   * A döntési konfiguráció címkéi (ha a felhasználó saját címkeszöveget állított be); az AI
   * egyiket sem használhatja a ténylegesen kapott címkén kívül. Alapértelmezés: D-075 címkék.
   */
  readonly labels?: DecisionConfig['labels'];
}

/** Részvény- vagy ETF-értékelés → `AiInputDto`. */
export function buildInstrumentAiInput(
  evaluation: InstrumentEvaluation,
  options: InstrumentAiInputOptions = {},
): Result<AiInputDto> {
  const featureById = new Map(evaluation.features.map((f) => [f.id, f]));
  const scoredById = new Map<string, { metric: MetricScore; categoryId: string }>();
  for (const category of evaluation.score.categories) {
    for (const metric of category.metrics) {
      if (!scoredById.has(metric.featureId)) {
        scoredById.set(metric.featureId, { metric, categoryId: category.id });
      }
    }
  }
  const ids = [...new Set([...scoredById.keys(), ...featureById.keys()])].slice(
    0,
    AI_LIMITS.metrics,
  );
  const metrics = ids.map((id) => featureMetric(featureById.get(id), scoredById.get(id), id));

  const gaps = new Map<string, Gap>();
  const addGap = (id: string, label: string, reason: string) => {
    const ref = aiRef('gap', id);
    if (!gaps.has(ref)) gaps.set(ref, { ref, label: shortText(label), reason: text(reason) });
  };
  for (const m of metrics) {
    if (m.status !== 'OK') addGap(m.ref.slice('metric:'.length), m.label, m.reason ?? m.status);
  }
  for (const category of evaluation.score.categories) {
    if (category.status === 'INSUFFICIENT_DATA') {
      addGap(
        `category.${category.id}`,
        category.label,
        `A kategória lefedettsége (${Math.round(category.coverage * 100)}%) a minimum alatt – nincs pontszám.`,
      );
    }
  }

  const { score, decision, confidence, thesis } = evaluation;
  const dcf =
    evaluation.subjectKind === 'stock' && options.valuation != null
      ? dcfSection(options.valuation)
      : null;
  if (dcf !== null) {
    for (const input of dcf.inputs) {
      if (input.status !== 'OK') {
        addGap(
          `dcfinput.${input.ref.slice('dcfinput:'.length)}`,
          input.label,
          input.reason ?? input.status,
        );
      }
    }
  }

  const labelTexts = options.labels ?? DEFAULT_DECISION_LABELS;
  return finalize({
    schemaVersion: AI_SCHEMA_VERSION,
    kind: evaluation.subjectKind,
    subject: {
      id: shortText(evaluation.listingId),
      displayName: options.displayName == null ? null : shortText(options.displayName),
    },
    analysisGeneratedAt: evaluation.evaluatedAt,
    metrics,
    evaluation: {
      totalScore: {
        ref: 'score:total',
        value: score.totalScore,
        status: score.totalStatus,
        dataCoverage: score.dataCoverage,
      },
      categories: score.categories.map((c) => ({
        ref: aiRef('category', c.id),
        label: shortText(c.label),
        status: c.status,
        score: c.score,
        weight: c.weight,
        coverage: c.coverage,
        dataQuality: c.dataQuality.level,
        rationale: c.rationale.slice(0, AI_LIMITS.listItems).map((r) => text(r)),
      })),
      decision: {
        ref: 'decision:label',
        configId: shortText(decision.configId),
        configVersion: shortText(decision.configVersion),
        labelKey: decision.label,
        labelText: shortText(decision.labelText),
        baseLabelKey: decision.baseLabel,
        otherLabelTexts: DECISION_LABEL_KEYS.filter((k) => k !== decision.label)
          .map((k) => labelTexts[k].text)
          .filter((t) => t !== decision.labelText)
          .map(shortText),
        matchedRule:
          decision.matchedRuleId === null
            ? null
            : {
                ref: aiRef('rule', decision.matchedRuleId),
                description: text(
                  decision.ruleTrace.find((r) => r.ruleId === decision.matchedRuleId)
                    ?.description ?? decision.matchedRuleId,
                ),
              },
        appliedCaps: decision.appliedCaps.map((c) => ({
          ref: aiRef('cap', c.capId),
          description: text(c.description),
          from: c.from,
          to: c.to,
        })),
        drivers: decision.drivers.slice(0, AI_LIMITS.listItems).map((d) => text(d)),
        disclaimer: text(decision.disclaimer, 1000),
      },
      confidence: {
        ref: 'confidence:analysis',
        level: confidence.level,
        score: confidence.score,
        reasons: confidence.reasons.slice(0, AI_LIMITS.listItems).map((r) => text(r)),
        meaning: text(confidence.meaning, 1000),
      },
      thesis: {
        stance: thesis.stance,
        risks: thesis.risks.map((r) => ({
          ref: aiRef('risk', r.id),
          kind: r.kind,
          severity: r.severity,
          statement: text(r.statement),
        })),
        invalidation: thesis.invalidation.map((i) => ({
          ref: aiRef('invalidation', i.id),
          statement: text(i.statement),
          currentValue:
            typeof i.currentValue === 'string' ? shortText(i.currentValue) : i.currentValue,
          threshold: typeof i.threshold === 'string' ? shortText(i.threshold) : i.threshold,
        })),
        note: text(thesis.note, 1000),
      },
    },
    dcf,
    portfolio: null,
    dataGaps: [...gaps.values()].slice(0, AI_LIMITS.metrics),
    warnings: evaluation.warnings.slice(0, AI_LIMITS.listItems).map((w) => text(w)),
    disclaimer: text(evaluation.disclaimer, 1000),
  });
}

// --- Portfólió --------------------------------------------------------------------------------

function portfolioMetric(m: PortfolioMetric, prefix: string): AiInputMetric {
  const value = m.value.status === 'OK' ? m.value.value : null;
  return {
    ref: aiRef('metric', `${prefix}.${m.id}`),
    label: shortText(m.label),
    value,
    display: value === null ? null : formatAiDisplay(value, m.unit, null),
    unit: m.unit,
    currency: null,
    status: m.value.status,
    reason: metricReason(m.value),
    categoryRef: null,
    score: null,
    asOf: m.value.provenance?.asOf ?? null,
    freshness: m.value.provenance?.freshness ?? null,
    source: sourceOf(m.value),
  };
}

const PORTFOLIO_DISCLAIMER =
  'Portfólió-elemzés a rögzített tranzakciókból és a forrásolt árakból. Elemzési kimenet, nem befektetési tanács és nem hozamígéret.';

/**
 * Portfólió-elemzés → `AiInputDto` (külön sablon). Adatminimalizálás: nincs pénzösszeg,
 * darabszám, ár, portfólió-név és tranzakció – csak súlyok, típusok és százalékos mutatók.
 */
export function buildPortfolioAiInput(portfolio: PortfolioAnalysis): Result<AiInputDto> {
  const c = portfolio.concentration;
  const h = portfolio.history;
  const metrics: AiInputMetric[] = [
    portfolioMetric(portfolio.totals.totalReturnPct, 'totals'),
    portfolioMetric(c.top5Weight, 'concentration'),
    portfolioMetric(c.top10Weight, 'concentration'),
    portfolioMetric(c.herfindahl, 'concentration'),
    portfolioMetric(c.effectivePositions, 'concentration'),
    ...[
      h.cumulativeReturn,
      h.annualizedReturn,
      h.volatility,
      h.maxDrawdown,
      h.downsideDeviation,
      h.sharpe,
      h.sortino,
    ].map((m) => portfolioMetric(m, 'history')),
  ];
  for (const exposure of portfolio.exposures) {
    if (exposure.groups.status !== 'OK') continue;
    const top = [...exposure.groups.value].sort((a, b) => b.weight - a.weight).slice(0, 3);
    for (const group of top) {
      metrics.push({
        ref: aiRef('metric', `exposure.${exposure.dimension}.${exposure.method}.${group.key}`),
        label: shortText(`Kitettség (${exposure.dimension}, ${exposure.method}): ${group.key}`),
        value: group.weight,
        display: formatAiDisplay(group.weight, 'ratio', null),
        unit: 'ratio',
        currency: null,
        status: 'OK',
        reason: null,
        categoryRef: null,
        score: null,
        asOf: exposure.groups.provenance.asOf,
        freshness: exposure.groups.provenance.freshness,
        source: sourceOf(exposure.groups),
      });
    }
  }

  const gaps: Gap[] = metrics
    .filter((m) => m.status !== 'OK')
    .map((m) => ({
      ref: aiRef('gap', m.ref.slice('metric:'.length)),
      label: m.label,
      reason: m.reason ?? m.status,
    }));
  const missingValue = portfolio.totals.marketValue.missing;
  if (missingValue.length > 0) {
    gaps.push({
      ref: 'gap:totals.marketValue',
      label: 'Piaci érték',
      reason: text(`Hiányzó érték ${missingValue.length} pozíciónál (ár, FX vagy hibás napló).`),
    });
  }

  const positions = portfolio.positions.slice(0, 60).map((p) => {
    const weight = p.weight.status === 'OK' ? p.weight.value : null;
    return {
      ref: aiRef('position', p.listingId),
      listingId: shortText(p.listingId),
      instrumentKind: p.metadata?.kind ?? null,
      status: p.status,
      weight,
      weightDisplay: weight === null ? null : formatAiDisplay(weight, 'ratio', null),
    };
  });

  return finalize({
    schemaVersion: AI_SCHEMA_VERSION,
    kind: 'portfolio',
    subject: { id: 'portfolio', displayName: null },
    analysisGeneratedAt: portfolio.generatedAt,
    metrics: metrics.slice(0, AI_LIMITS.metrics),
    evaluation: null,
    dcf: null,
    portfolio: {
      baseCurrency: portfolio.baseCurrency,
      openPositionCount: portfolio.totals.openPositions,
      positions,
    },
    dataGaps: gaps.slice(0, AI_LIMITS.metrics),
    // A figyelmeztetések tartalmazhatnak összeget vagy nevet → csak a darabszámuk kerül át.
    warnings:
      portfolio.warnings.length === 0
        ? []
        : [
            `A portfólió-elemzés ${portfolio.warnings.length} figyelmeztetést adott (részletek az appban).`,
          ],
    disclaimer: PORTFOLIO_DISCLAIMER,
  });
}
