/**
 * Konfiguráció-validáció (PHASE 10, feladat 3.): a súlyok összege, a horgonyok és a szabályok
 * épsége AUTOMATIKUSAN ellenőrzött. A motor minden futáskor validál; hibás konfigurációval nem
 * pontoz (VALIDATION hiba, mezőútvonallal).
 */
import { AppErrors, err, ok, type Result, type ValidationIssue } from '@/domain';

import {
  DECISION_LABEL_KEYS,
  type DecisionCondition,
  type DecisionConfig,
  type MetricRuleConfig,
  type ScoreConfig,
} from './types';

/** Lebegőpontos tűrés a súlyösszegekhez. */
export const WEIGHT_TOLERANCE = 1e-9;

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

const isScore = (value: number) => isFiniteNumber(value) && value >= 0 && value <= 100;
const isShare = (value: number) => isFiniteNumber(value) && value >= 0 && value <= 1;

function validateMetricRule(rule: MetricRuleConfig, path: string): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (!isFiniteNumber(rule.weight) || rule.weight <= 0) {
    issues.push({ path: `${path}.weight`, message: 'A mutatósúly pozitív véges szám.' });
  }
  const r = rule.rule;
  if (r.kind === 'linear') {
    if (!isFiniteNumber(r.worst) || !isFiniteNumber(r.best) || r.worst === r.best) {
      issues.push({
        path: `${path}.rule`,
        message: 'Lineáris szabály: worst és best véges és különböző.',
      });
    }
  } else if (r.kind === 'linear_money') {
    const entries = Object.entries(r.byCurrency);
    if (entries.length === 0) {
      issues.push({ path: `${path}.rule`, message: 'Legalább egy pénznem kell.' });
    }
    for (const [currency, anchors] of entries) {
      if (
        !isFiniteNumber(anchors.worst) ||
        !isFiniteNumber(anchors.best) ||
        anchors.worst === anchors.best
      ) {
        issues.push({
          path: `${path}.rule.byCurrency.${currency}`,
          message: 'worst és best véges és különböző.',
        });
      }
    }
  } else {
    const entries = Object.entries(r.scores);
    if (entries.length === 0) {
      issues.push({ path: `${path}.rule`, message: 'Legalább egy kategória kell.' });
    }
    for (const [key, score] of entries) {
      if (!isScore(score)) {
        issues.push({ path: `${path}.rule.scores.${key}`, message: 'A pont 0 és 100 közötti.' });
      }
    }
  }
  return issues;
}

function sumsTo(values: readonly number[], expected: number): boolean {
  return Math.abs(values.reduce((sum, v) => sum + v, 0) - expected) <= WEIGHT_TOLERANCE;
}

export function scoreConfigIssues(config: ScoreConfig): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (!isFiniteNumber(config.totalWeight) || config.totalWeight <= 0) {
    issues.push({ path: 'totalWeight', message: 'Az elvárt súlyösszeg pozitív szám.' });
  }
  if (!isShare(config.minTotalCoverage)) {
    issues.push({ path: 'minTotalCoverage', message: '0 és 1 közötti arány.' });
  }
  const ids = new Set<string>();
  config.categories.forEach((category, index) => {
    const path = `categories[${index}]`;
    if (ids.has(category.id)) {
      issues.push({ path: `${path}.id`, message: `Duplikált kategória: ${category.id}.` });
    }
    ids.add(category.id);
    if (!isFiniteNumber(category.weight) || category.weight < 0) {
      issues.push({ path: `${path}.weight`, message: 'A kategóriasúly nemnegatív véges szám.' });
    }
    if (!isShare(category.minCoverage)) {
      issues.push({ path: `${path}.minCoverage`, message: '0 és 1 közötti arány.' });
    }
    if (category.weight === 0) {
      if (category.metrics.length > 0 || category.notScoredReason === undefined) {
        issues.push({
          path,
          message: '0 súlyú kategória: nincs mutató, és kötelező a `notScoredReason`.',
        });
      }
      return;
    }
    if (category.metrics.length === 0) {
      issues.push({ path: `${path}.metrics`, message: 'Pozitív súlyú kategóriához mutató kell.' });
      return;
    }
    const featureIds = new Set<string>();
    category.metrics.forEach((metric, metricIndex) => {
      const metricPath = `${path}.metrics[${metricIndex}]`;
      if (featureIds.has(metric.featureId)) {
        issues.push({ path: metricPath, message: `Duplikált mutató: ${metric.featureId}.` });
      }
      featureIds.add(metric.featureId);
      issues.push(...validateMetricRule(metric, metricPath));
    });
    if (
      !sumsTo(
        category.metrics.map((m) => m.weight),
        1,
      )
    ) {
      issues.push({
        path: `${path}.metrics`,
        message: `A(z) ${category.id} mutatósúlyainak összege 1 kell legyen.`,
      });
    }
  });
  if (
    !sumsTo(
      config.categories.map((c) => c.weight),
      config.totalWeight,
    )
  ) {
    issues.push({
      path: 'categories',
      message: `A kategóriasúlyok összege ${config.totalWeight} kell legyen (most: ${config.categories
        .reduce((sum, c) => sum + c.weight, 0)
        .toString()}).`,
    });
  }
  const q = config.quality;
  for (const [key, value] of [...Object.entries(q.kind), ...Object.entries(q.freshness)]) {
    if (!isShare(value)) issues.push({ path: `quality.${key}`, message: '0 és 1 közötti szorzó.' });
  }
  if (!isShare(q.shortWindow)) {
    issues.push({ path: 'quality.shortWindow', message: '0 és 1 közötti szorzó.' });
  }
  if (!(isShare(q.levels.high) && isShare(q.levels.medium) && q.levels.medium < q.levels.high)) {
    issues.push({ path: 'quality.levels', message: '0 ≤ medium < high ≤ 1 szükséges.' });
  }
  return issues;
}

function conditionIssues(
  condition: DecisionCondition,
  path: string,
  dimensionIds: ReadonlySet<string>,
  flagIds: ReadonlySet<string>,
): ValidationIssue[] {
  switch (condition.kind) {
    case 'dimension':
    case 'total': {
      const issues: ValidationIssue[] = [];
      if (condition.kind === 'dimension' && !dimensionIds.has(condition.dimension)) {
        issues.push({ path, message: `Ismeretlen dimenzió: ${condition.dimension}.` });
      }
      if (condition.min === undefined && condition.max === undefined) {
        issues.push({ path, message: 'Legalább min vagy max kell.' });
      }
      if (condition.min !== undefined && !isScore(condition.min)) {
        issues.push({ path: `${path}.min`, message: '0 és 100 közötti pont.' });
      }
      if (condition.max !== undefined && !isScore(condition.max)) {
        issues.push({ path: `${path}.max`, message: '0 és 100 közötti pont.' });
      }
      return issues;
    }
    case 'flag':
      return flagIds.has(condition.flag)
        ? []
        : [{ path, message: `Ismeretlen jelzés: ${condition.flag}.` }];
    case 'confidence':
      return condition.levels.length === 0
        ? [{ path, message: 'Legalább egy confidence-szint kell.' }]
        : [];
  }
}

export function decisionConfigIssues(
  config: DecisionConfig,
  scoreConfig: ScoreConfig,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (config.subjectKind !== scoreConfig.subjectKind) {
    issues.push({
      path: 'subjectKind',
      message: `A döntési (${config.subjectKind}) és a score-konfiguráció (${scoreConfig.subjectKind}) eszközfajtája eltér.`,
    });
  }
  const categoryIds = new Set(scoreConfig.categories.map((c) => c.id));
  const dimensionIds = new Set<string>();
  config.dimensions.forEach((dimension, index) => {
    const path = `dimensions[${index}]`;
    if (dimensionIds.has(dimension.id)) {
      issues.push({ path, message: `Duplikált dimenzió: ${dimension.id}.` });
    }
    dimensionIds.add(dimension.id);
    if (dimension.categories.length === 0 && dimension.feature === undefined) {
      issues.push({ path, message: 'A dimenzióhoz kategória vagy mutató kell.' });
    }
    dimension.categories.forEach((source, sourceIndex) => {
      if (!categoryIds.has(source.categoryId)) {
        issues.push({
          path: `${path}.categories[${sourceIndex}]`,
          message: `Ismeretlen kategória: ${source.categoryId}.`,
        });
      }
      if (!isFiniteNumber(source.weight) || source.weight <= 0) {
        issues.push({
          path: `${path}.categories[${sourceIndex}].weight`,
          message: 'Pozitív súly.',
        });
      }
    });
    if (
      dimension.categories.length > 0 &&
      !sumsTo(
        dimension.categories.map((c) => c.weight),
        1,
      )
    ) {
      issues.push({ path: `${path}.categories`, message: 'A kategóriasúlyok összege 1.' });
    }
    if (dimension.feature !== undefined) {
      issues.push(...validateMetricRule({ ...dimension.feature, weight: 1 }, `${path}.feature`));
    }
  });
  const flagIds = new Set([
    ...config.flagRules.map((f) => f.id),
    ...Object.keys(config.externalFlags),
  ]);
  config.flagRules.forEach((flag, index) => {
    if (!isFiniteNumber(flag.threshold)) {
      issues.push({ path: `flagRules[${index}].threshold`, message: 'Véges küszöb.' });
    }
  });
  if (config.rules.length === 0) {
    issues.push({ path: 'rules', message: 'Legalább egy szabály kell.' });
  } else if ((config.rules[config.rules.length - 1]?.all.length ?? 0) > 0) {
    issues.push({
      path: `rules[${config.rules.length - 1}]`,
      message: 'Az utolsó szabály fallback (feltétel nélküli) kell legyen – mindig legyen címke.',
    });
  }
  config.rules.forEach((rule, index) => {
    rule.all.forEach((condition, conditionIndex) =>
      issues.push(
        ...conditionIssues(
          condition,
          `rules[${index}].all[${conditionIndex}]`,
          dimensionIds,
          flagIds,
        ),
      ),
    );
  });
  config.caps.forEach((cap, index) => {
    if (cap.when.length === 0) {
      issues.push({ path: `caps[${index}].when`, message: 'A plafonhoz feltétel kell.' });
    }
    cap.when.forEach((condition, conditionIndex) =>
      issues.push(
        ...conditionIssues(
          condition,
          `caps[${index}].when[${conditionIndex}]`,
          dimensionIds,
          flagIds,
        ),
      ),
    );
  });
  for (const key of DECISION_LABEL_KEYS) {
    if ((config.labels[key]?.text ?? '').trim() === '') {
      issues.push({ path: `labels.${key}`, message: 'Minden címkéhez szöveg kell.' });
    }
  }
  const c = config.confidence;
  if (!(isScore(c.medium) && isScore(c.high) && c.medium < c.high)) {
    issues.push({ path: 'confidence', message: '0 ≤ medium < high ≤ 100 szükséges.' });
  }
  config.thesis.riskRules.forEach((rule, index) => {
    const path = `thesis.riskRules[${index}]`;
    const featureBased =
      rule.featureId !== undefined && rule.comparator !== undefined && rule.threshold !== undefined;
    const flagBased = rule.flag !== undefined;
    if (featureBased === flagBased) {
      issues.push({ path, message: 'Pontosan egy: mutató-feltétel VAGY jelzés.' });
    }
    if (flagBased && rule.flag !== undefined && !flagIds.has(rule.flag)) {
      issues.push({ path, message: `Ismeretlen jelzés: ${rule.flag}.` });
    }
  });
  return issues;
}

/** Mindkét konfiguráció validálása; hiba esetén VALIDATION, minden hibával. */
export function validateConfigs(
  scoreConfig: ScoreConfig,
  decisionConfig: DecisionConfig,
  subjectKind: ScoreConfig['subjectKind'],
): Result<true> {
  const issues = [
    ...(scoreConfig.subjectKind === subjectKind
      ? []
      : [
          {
            path: 'scoreConfig.subjectKind',
            message: `A(z) ${subjectKind} pontozása nem futhat ${scoreConfig.subjectKind}-konfigurációval (a részvény- és az ETF-score külön rendszer).`,
          },
        ]),
    ...scoreConfigIssues(scoreConfig).map((i) => ({ ...i, path: `scoreConfig.${i.path}` })),
    ...decisionConfigIssues(decisionConfig, scoreConfig).map((i) => ({
      ...i,
      path: `decisionConfig.${i.path}`,
    })),
  ];
  return issues.length === 0
    ? ok(true)
    : err(AppErrors.validation('Érvénytelen score-/döntési konfiguráció.', issues));
}
