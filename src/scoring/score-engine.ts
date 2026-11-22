/**
 * Score engine (PHASE 10, feladat 1–5., D-073, D-074).
 *
 * mutató → (szabály) → 0–100 pont → kategória (súlyozott átlag) → összpontszám (súlyozott átlag)
 *
 * Hiányzó adat (D-074): a hiányzó vagy nem pontozható mutató SOHA nem 0 pont. Kimarad, és a
 * maradék súlya újranormalizálódik – DE csak akkor, ha a lefedettség eléri a konfigurált
 * minimumot; alatta a kategória (ill. az összpontszám) `INSUFFICIENT_DATA`, `null` ponttal.
 * Minden kimaradás látható (`missing`), és a lefedettség csökkenti a confidence-t.
 */
import { classifyMetricOrigin, type Freshness, type IsoDate, type IsoTimestamp } from '@/domain';

import {
  formatNumber,
  linearScore,
  roundScore,
  roundShare,
  weightedAverage,
  worstFreshness,
} from './score-math';
import type {
  CategoryConfig,
  CategoryScore,
  CategoryStatus,
  DataQualityLevel,
  MetricRule,
  MetricRuleConfig,
  MetricScore,
  QualityPolicy,
  ScoreCard,
  ScoreConfig,
  ScoringFeature,
} from './types';

export const MISSING_DATA_POLICY =
  'Hiányzó adat nem 0 pont: a nem pontozható mutató kimarad, a maradék súlya újranormalizálódik, ha a lefedettség eléri a minimumot (különben a kategória / az összpontszám INSUFFICIENT_DATA). Minden kimaradás a `missing` listában látható, és a lefedettség csökkenti az AnalysisConfidence-t (D-074).';

export const SCORE_FORMULA =
  'mutatópont = szabály(érték) ∈ [0, 100]; kategória = Σ(mutatópont × súly) / Σ(pontozott súly); összpontszám = Σ(kategória × súly) / Σ(pontozott kategória súlya); minden szint egy tizedesre kerekítve, a felső szint a kerekített alsóból számol.';

export function describeRule(rule: MetricRule, unit: string | null): string {
  const fmt = (v: number) =>
    unit === 'ratio' ? `${formatNumber(roundScore(v * 1000) / 10)}%` : formatNumber(v);
  switch (rule.kind) {
    case 'linear':
      return `lineáris: ${fmt(rule.worst)} → 0 pont, ${fmt(rule.best)} → 100 pont (köztük arányos, kívül levágva)`;
    case 'linear_money':
      return `lineáris pénznemenként: ${Object.entries(rule.byCurrency)
        .map(([c, a]) => `${c} ${formatNumber(a.worst)} → 0, ${formatNumber(a.best)} → 100`)
        .join('; ')}`;
    case 'categorical':
      return `kategória → pont: ${Object.entries(rule.scores)
        .map(([k, v]) => `${k} = ${formatNumber(v)}`)
        .join(', ')}`;
  }
}

function qualityFactor(feature: ScoringFeature, policy: QualityPolicy): number {
  if (feature.value.status !== 'OK') return 0;
  const { kind, freshness } = feature.value.provenance;
  const reliability = feature.reliability === 'short_window' ? policy.shortWindow : 1;
  return roundShare(policy.kind[kind] * policy.freshness[freshness] * reliability);
}

export function qualityLevel(factor: number, policy: QualityPolicy): DataQualityLevel {
  if (factor >= policy.levels.high) return 'HIGH';
  if (factor >= policy.levels.medium) return 'MEDIUM';
  return 'LOW';
}

/** Egy mutató pontozása egy szabállyal; hiány esetén `score: null` + ok (soha nem 0). */
export function scoreMetric(
  feature: ScoringFeature | undefined,
  config: MetricRuleConfig,
  policy: QualityPolicy,
): MetricScore {
  const unit = feature?.kind === 'numeric' ? feature.unit : null;
  const base = {
    featureId: config.featureId,
    weight: config.weight,
    rule: describeRule(config.rule, unit),
    rationale: config.rationale,
  };
  if (feature === undefined) {
    return {
      ...base,
      label: config.featureId,
      value: null,
      unit: null,
      currency: null,
      inputStatus: 'NO_FEATURE',
      score: null,
      origin: 'missing',
      provenanceKind: null,
      freshness: null,
      asOf: null,
      reliability: null,
      qualityFactor: null,
      reason: 'A mutatót a leképező nem adta át (nincs ilyen bemenet).',
    };
  }
  const metric = feature.value;
  const common = {
    ...base,
    label: feature.label,
    unit,
    origin: classifyMetricOrigin(metric),
    reliability: feature.reliability,
    inputStatus: metric.status,
  };
  if (metric.status !== 'OK') {
    return {
      ...common,
      value: null,
      currency: null,
      score: null,
      provenanceKind: metric.provenance?.kind ?? null,
      freshness: metric.provenance?.freshness ?? null,
      asOf: metric.provenance?.asOf ?? null,
      qualityFactor: null,
      reason: `${metric.status}: ${metric.reason}`,
    };
  }
  const provenance = metric.provenance;
  const withValue = {
    ...common,
    value: metric.value,
    currency: provenance.currency ?? null,
    provenanceKind: provenance.kind,
    freshness: provenance.freshness,
    asOf: provenance.asOf,
  };
  const notScored = (reason: string): MetricScore => ({
    ...withValue,
    score: null,
    qualityFactor: null,
    reason,
  });
  if (provenance.kind === 'ai_interpretation') {
    return notScored('AI-értelmezés nem lehet pontozott mutató forrása.');
  }
  const rule = config.rule;
  let score: number;
  if (rule.kind === 'categorical') {
    if (typeof metric.value !== 'string') return notScored('Kategória-szabály számértékre.');
    const mapped = rule.scores[metric.value];
    if (mapped === undefined) {
      return notScored(`A(z) „${metric.value}” kategóriához nincs pont a konfigurációban.`);
    }
    score = roundScore(mapped);
  } else {
    if (typeof metric.value !== 'number') return notScored('Számszabály kategória-értékre.');
    if (rule.kind === 'linear') {
      score = linearScore(metric.value, rule);
    } else {
      const currency = provenance.currency;
      const anchors = currency === undefined ? undefined : rule.byCurrency[currency];
      if (anchors === undefined) {
        return notScored(
          `A pénzösszeg pénzneme (${currency ?? 'ismeretlen'}) nincs a küszöbök között (${Object.keys(rule.byCurrency).join(', ')}); átváltás nélkül nem pontozható.`,
        );
      }
      score = linearScore(metric.value, anchors);
    }
  }
  return {
    ...withValue,
    score,
    qualityFactor: qualityFactor(feature, policy),
    reason: null,
  };
}

function rationaleLine(metric: MetricScore): string {
  if (metric.score === null) return `${metric.label}: nem pontozott – ${metric.reason ?? ''}`;
  const value =
    typeof metric.value === 'number'
      ? metric.unit === 'ratio'
        ? `${formatNumber(roundScore(metric.value * 1000) / 10)}%`
        : formatNumber(metric.value)
      : String(metric.value);
  return `${metric.label} = ${value} → ${formatNumber(metric.score)} pont (súly ${formatNumber(metric.weight)}; ${metric.rule})`;
}

export function scoreCategory(
  category: CategoryConfig,
  features: ReadonlyMap<string, ScoringFeature>,
  policy: QualityPolicy,
): CategoryScore {
  const common = {
    id: category.id,
    label: category.label,
    description: category.description,
    weight: category.weight,
  };
  if (category.weight === 0) {
    return {
      ...common,
      status: 'NOT_SCORED',
      score: null,
      effectiveWeight: null,
      coverage: 0,
      metrics: [],
      rule: 'Nem pontozott kategória (súly 0).',
      rationale: [category.notScoredReason ?? 'Nem pontozott.'],
      missing: [],
      dataQuality: { factor: null, level: null, issues: [] },
      freshness: { worst: null, oldestAsOf: null },
    };
  }
  const metrics = category.metrics.map((rule) =>
    scoreMetric(features.get(rule.featureId), rule, policy),
  );
  const scored = metrics.filter(
    (m): m is MetricScore & { score: number; qualityFactor: number } => m.score !== null,
  );
  const coverage = roundShare(scored.reduce((sum, m) => sum + m.weight, 0));
  const average = weightedAverage(scored.map((m) => ({ value: m.score, weight: m.weight })));
  const status: CategoryStatus =
    scored.length === metrics.length
      ? 'SCORED'
      : average !== null && coverage >= category.minCoverage
        ? 'PARTIAL'
        : 'INSUFFICIENT_DATA';
  const score = status === 'INSUFFICIENT_DATA' || average === null ? null : roundScore(average);
  const qualityAverage = weightedAverage(
    scored.map((m) => ({ value: m.qualityFactor, weight: m.weight })),
  );
  const factor = qualityAverage === null ? null : roundShare(qualityAverage);
  const issues = scored.flatMap((m) => {
    const out: string[] = [];
    if (
      m.provenanceKind !== null &&
      m.provenanceKind !== 'reported' &&
      m.provenanceKind !== 'calculated'
    ) {
      out.push(`${m.featureId}: ${m.provenanceKind}`);
    }
    if (m.freshness !== null && m.freshness !== 'FRESH') {
      out.push(`${m.featureId}: frissesség ${m.freshness}`);
    }
    if (m.reliability === 'short_window') out.push(`${m.featureId}: rövid ablak (D-070)`);
    return out;
  });
  const asOfs = scored
    .map((m) => m.asOf)
    .filter((a): a is IsoDate | IsoTimestamp => a !== null)
    .sort();
  return {
    ...common,
    status,
    score,
    effectiveWeight: null,
    coverage,
    metrics,
    rule: `Súlyozott átlag a pontozott mutatókból (minimális lefedettség: ${formatNumber(category.minCoverage * 100)}% mutatósúly).`,
    rationale: [
      ...metrics.map(rationaleLine),
      ...(status === 'INSUFFICIENT_DATA'
        ? [
            `A pontozott mutatók súlyaránya ${formatNumber(roundScore(coverage * 1000) / 10)}% < ${formatNumber(category.minCoverage * 100)}% → nincs kategóriapont.`,
          ]
        : []),
    ],
    missing: metrics
      .filter((m) => m.score === null)
      .map((m) => ({
        featureId: m.featureId,
        status: m.inputStatus === 'OK' ? 'RULE_NOT_APPLICABLE' : m.inputStatus,
        reason: m.reason ?? '',
      })),
    dataQuality: {
      factor,
      level: factor === null ? null : qualityLevel(factor, policy),
      issues,
    },
    freshness: {
      worst: worstFreshness(
        scored.map((m) => m.freshness).filter((f): f is Freshness => f !== null),
      ),
      oldestAsOf: asOfs[0] ?? null,
    },
  };
}

/** A teljes score-kártya. A konfigurációt a hívó előtte validálja (`validateConfigs`). */
export function buildScoreCard(
  config: ScoreConfig,
  features: readonly ScoringFeature[],
): ScoreCard {
  const byId = new Map<string, ScoringFeature>();
  for (const feature of features) {
    if (!byId.has(feature.id)) byId.set(feature.id, feature);
  }
  const raw = config.categories.map((category) => scoreCategory(category, byId, config.quality));
  const weighted = raw.filter((c) => c.weight > 0);
  const weightSum = weighted.reduce((sum, c) => sum + c.weight, 0);
  const scored = weighted.filter((c): c is CategoryScore & { score: number } => c.score !== null);
  const scoredWeight = scored.reduce((sum, c) => sum + c.weight, 0);
  const scoredWeightShare = weightSum > 0 ? roundShare(scoredWeight / weightSum) : 0;
  const dataCoverage =
    weightSum > 0
      ? roundShare(weighted.reduce((sum, c) => sum + c.weight * c.coverage, 0) / weightSum)
      : 0;
  const enough = scored.length > 0 && scoredWeightShare >= config.minTotalCoverage;
  const average = weightedAverage(scored.map((c) => ({ value: c.score, weight: c.weight })));
  const totalScore = enough && average !== null ? roundScore(average) : null;
  const categories = raw.map((category) =>
    category.score !== null && totalScore !== null
      ? { ...category, effectiveWeight: roundShare(category.weight / scoredWeight) }
      : category,
  );
  const allScored = totalScore !== null && weighted.every((c) => c.status === 'SCORED');
  return {
    configId: config.id,
    configVersion: config.version,
    subjectKind: config.subjectKind,
    totalScore,
    totalStatus: totalScore === null ? 'INSUFFICIENT_DATA' : allScored ? 'SCORED' : 'PARTIAL',
    scoredWeightShare,
    dataCoverage,
    categories,
    missingDataPolicy: MISSING_DATA_POLICY,
    formula: SCORE_FORMULA,
  };
}
