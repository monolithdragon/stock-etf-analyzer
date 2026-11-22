/**
 * Determinisztikus döntési engine (PHASE 10, feladat 6–7., D-075).
 *
 * 1. Dimenziók: kategóriák súlyozott átlaga (újranormalizálva) és/vagy közvetlen mutató-szabály.
 *    Nem csak az összpontszám számít: a szabályok dimenziónként adnak feltételt.
 * 2. Kapu: `INSUFFICIENT` confidence → `NOT_RATED` (nincs címke-kitalálás adathiányra).
 * 3. Szabályok sorrendben: az első, amelynek MINDEN feltétele `PASS`, adja az alapcímkét. A nem
 *    ismert érték (`null` pont / jelzés) feltétele `UNKNOWN` → a szabály NEM illeszkedik (óvatos).
 *    Az utolsó szabály feltétel nélküli fallback.
 * 4. Plafonok: ha egy plafon minden feltétele `PASS`, a címke legfeljebb `maxLabel` lehet.
 *
 * Nincs véletlen, nincs óra, nincs külső állapot: ugyanaz a bemenet → ugyanaz a kimenet.
 * A címkék elemzési kategóriák, NEM garantált előrejelzések és NEM befektetési tanács.
 */
import { scoreMetric } from './score-engine';
import { compare, formatNumber, roundScore, roundShare, weightedAverage } from './score-math';
import {
  DECISION_LABEL_RANK,
  type AnalysisConfidence,
  type AppliedCap,
  type ConditionEvaluation,
  type DecisionCondition,
  type DecisionConfig,
  type DecisionLabelKey,
  type DecisionResult,
  type DimensionValue,
  type FlagValue,
  type RuleEvaluation,
  type ScoreCard,
  type ScoringInput,
  type QualityPolicy,
} from './types';

export const DECISION_DISCLAIMER =
  'A címke szabályalapú ELEMZÉSI KATEGÓRIA a megadott adatokból és konfigurált küszöbökből. Nem garantált előrejelzés, nem hozamígéret és nem személyre szabott befektetési tanács. Az AI nem módosítja.';

export function computeDimensions(
  config: DecisionConfig,
  card: ScoreCard,
  input: ScoringInput,
  quality: QualityPolicy,
): DimensionValue[] {
  const categoryById = new Map(card.categories.map((c) => [c.id, c]));
  const featureById = new Map(input.features.map((f) => [f.id, f]));
  return config.dimensions.map((dimension) => {
    const parts: { id: string; value: number; weight: number }[] = [];
    const missing: string[] = [];
    for (const source of dimension.categories) {
      const category = categoryById.get(source.categoryId);
      if (category?.score === null || category === undefined) {
        missing.push(`${source.categoryId}: nincs pont`);
      } else {
        parts.push({ id: category.id, value: category.score, weight: source.weight });
      }
    }
    if (dimension.feature !== undefined) {
      const metric = scoreMetric(
        featureById.get(dimension.feature.featureId),
        { ...dimension.feature, weight: 1 },
        quality,
      );
      if (metric.score === null) {
        missing.push(`${metric.featureId}: ${metric.reason ?? 'nincs pont'}`);
      } else {
        const weight = dimension.categories.length === 0 ? 1 : dimension.feature.weight;
        parts.push({ id: metric.featureId, value: metric.score, weight });
      }
    }
    const average = weightedAverage(parts);
    const weightSum = parts.reduce((sum, p) => sum + p.weight, 0);
    return {
      id: dimension.id,
      label: dimension.label,
      score: average === null ? null : roundScore(average),
      sources: parts.map((p) => ({ id: p.id, weight: roundShare(p.weight / weightSum) })),
      reason:
        average === null
          ? `Nincs adat a dimenzióhoz (${missing.join('; ')}).`
          : missing.length > 0
            ? `Részleges: ${missing.join('; ')}.`
            : null,
    };
  });
}

export function computeFlags(config: DecisionConfig, input: ScoringInput): FlagValue[] {
  const featureById = new Map(input.features.map((f) => [f.id, f]));
  const fromRules: FlagValue[] = config.flagRules.map((rule) => {
    const feature = featureById.get(rule.featureId);
    const value =
      feature?.kind === 'numeric' && feature.value.status === 'OK'
        ? compare(feature.value.value, rule.comparator, rule.threshold)
        : null;
    return { id: rule.id, value, description: rule.description, source: 'rule' };
  });
  const external: FlagValue[] = Object.entries(config.externalFlags).map(([id, description]) => ({
    id,
    value: input.flags[id] ?? null,
    description,
    source: 'external',
  }));
  return [...fromRules, ...external];
}

export interface DecisionContext {
  readonly totalScore: number | null;
  readonly dimensions: ReadonlyMap<string, DimensionValue>;
  readonly flags: ReadonlyMap<string, FlagValue>;
  readonly confidence: AnalysisConfidence;
  readonly labels: DecisionConfig['labels'];
}

function rangeOutcome(
  value: number | null,
  min: number | undefined,
  max: number | undefined,
): ConditionEvaluation['outcome'] {
  if (value === null) return 'UNKNOWN';
  const okMin = min === undefined || value >= min;
  const okMax = max === undefined || value < max;
  return okMin && okMax ? 'PASS' : 'FAIL';
}

function rangeText(name: string, min: number | undefined, max: number | undefined): string {
  if (min !== undefined && max !== undefined) {
    return `${formatNumber(min)} ≤ ${name} < ${formatNumber(max)}`;
  }
  return min !== undefined
    ? `${name} ≥ ${formatNumber(min)}`
    : `${name} < ${formatNumber(max ?? 0)}`;
}

export function evaluateCondition(
  condition: DecisionCondition,
  context: DecisionContext,
): ConditionEvaluation {
  switch (condition.kind) {
    case 'total':
      return {
        condition,
        description: rangeText('összpontszám', condition.min, condition.max),
        actual: context.totalScore,
        outcome: rangeOutcome(context.totalScore, condition.min, condition.max),
      };
    case 'dimension': {
      const dimension = context.dimensions.get(condition.dimension);
      const value = dimension?.score ?? null;
      return {
        condition,
        description: rangeText(
          dimension?.label ?? condition.dimension,
          condition.min,
          condition.max,
        ),
        actual: value,
        outcome: rangeOutcome(value, condition.min, condition.max),
      };
    }
    case 'flag': {
      const flag = context.flags.get(condition.flag);
      const value = flag?.value ?? null;
      return {
        condition,
        description: `${flag?.description ?? condition.flag} = ${condition.equals ? 'igen' : 'nem'}`,
        actual: value,
        outcome: value === null ? 'UNKNOWN' : value === condition.equals ? 'PASS' : 'FAIL',
      };
    }
    case 'confidence':
      return {
        condition,
        description: `confidence ∈ {${condition.levels.join(', ')}}`,
        actual: context.confidence.level,
        outcome: condition.levels.includes(context.confidence.level) ? 'PASS' : 'FAIL',
      };
  }
}

function capLabel(
  label: DecisionLabelKey,
  max: Exclude<DecisionLabelKey, 'NOT_RATED'>,
): DecisionLabelKey {
  if (label === 'NOT_RATED') return label;
  return DECISION_LABEL_RANK[label] > DECISION_LABEL_RANK[max] ? max : label;
}

export function decide(
  config: DecisionConfig,
  card: ScoreCard,
  input: ScoringInput,
  confidence: AnalysisConfidence,
  quality: QualityPolicy,
): DecisionResult {
  const dimensions = computeDimensions(config, card, input, quality);
  const flags = computeFlags(config, input);
  const context: DecisionContext = {
    totalScore: card.totalScore,
    dimensions: new Map(dimensions.map((d) => [d.id, d])),
    flags: new Map(flags.map((f) => [f.id, f])),
    confidence,
    labels: config.labels,
  };
  const base = {
    configId: config.id,
    configVersion: config.version,
    dimensions,
    flags,
    disclaimer: DECISION_DISCLAIMER,
  };
  if (confidence.level === 'INSUFFICIENT' || card.totalScore === null) {
    const text = config.labels.NOT_RATED;
    return {
      ...base,
      label: 'NOT_RATED',
      labelText: text.text,
      labelDescription: text.description,
      baseLabel: 'NOT_RATED',
      matchedRuleId: null,
      ruleTrace: [],
      appliedCaps: [],
      drivers: [
        'Nincs elég adat a döntéshez: a szabályok nem futottak (a hiány nem pontozódik nullával).',
        ...confidence.reasons,
      ],
    };
  }
  const ruleTrace: RuleEvaluation[] = [];
  let matched: (typeof config.rules)[number] | null = null;
  for (const rule of config.rules) {
    const conditions = rule.all.map((c) => evaluateCondition(c, context));
    const isMatch = conditions.every((c) => c.outcome === 'PASS');
    ruleTrace.push({
      ruleId: rule.id,
      label: rule.label,
      description: rule.description,
      matched: isMatch,
      conditions,
    });
    if (isMatch) {
      matched = rule;
      break;
    }
  }
  // A validáció garantálja a fallbacket; védelmi ág: ha mégsem illeszkedne semmi.
  const baseLabel: DecisionLabelKey = matched?.label ?? 'NOT_RATED';
  let label = baseLabel;
  const appliedCaps: AppliedCap[] = [];
  for (const cap of config.caps) {
    const conditions = cap.when.map((c) => evaluateCondition(c, context));
    if (!conditions.every((c) => c.outcome === 'PASS')) continue;
    const next = capLabel(label, cap.maxLabel);
    if (next !== label) {
      appliedCaps.push({
        capId: cap.id,
        description: cap.description,
        from: label,
        to: next,
        conditions,
      });
      label = next;
    }
  }
  const text = config.labels[label];
  const drivers: string[] = [
    `Összpontszám: ${formatNumber(card.totalScore)} (confidence: ${confidence.level}).`,
    ...(matched === null
      ? []
      : [
          `Illeszkedő szabály: ${matched.id} – ${matched.description}`,
          ...ruleTrace[ruleTrace.length - 1]!.conditions.map(
            (c) => `  ✓ ${c.description} (tényleges: ${String(c.actual)})`,
          ),
        ]),
    ...ruleTrace
      .filter((r) => !r.matched)
      .map((r) => {
        const failed = r.conditions.filter((c) => c.outcome !== 'PASS');
        return `Nem teljesült: ${r.ruleId} (${failed
          .map(
            (c) => `${c.description}: ${c.outcome === 'UNKNOWN' ? 'nincs adat' : String(c.actual)}`,
          )
          .join('; ')})`;
      }),
    ...appliedCaps.map((c) => `Plafon: ${c.capId} – ${c.description} (${c.from} → ${c.to}).`),
  ];
  return {
    ...base,
    label,
    labelText: text.text,
    labelDescription: text.description,
    baseLabel,
    matchedRuleId: matched?.id ?? null,
    ruleTrace,
    appliedCaps,
    drivers,
  };
}
