/**
 * Thesis risks és „what would invalidate the thesis” (PHASE 10, feladat 9., D-075).
 *
 * Csak adat és szabály által alátámasztott tételek kerülnek ide – szabad szöveges „vélemény” nem:
 * - kockázat: egy konfigurált kockázati szabály teljesül (mutató vs. küszöb, vagy jelzés), vagy
 *   adat-kockázat (pont nélküli nagy súlyú kategória, demóadat, elavult adat);
 * - érvénytelenítés: (a) az illeszkedő döntési szabály feltételeinek megfordítása (pl. „a
 *   minőség-dimenzió 60 alá esik”), (b) pozitív álláspontnál a még NEM teljesülő kockázati
 *   szabályok (ha bekövetkeznek), negatívnál a teljesülők (ha megszűnnek), (c) az alkalmazott
 *   plafonok megszűnése, (d) a leképező által adott kiegészítő feltételek (pl. DCF-ből számolt
 *   árszint).
 */
import { compare, formatNumber } from './score-math';
import type {
  DecisionResult,
  InvalidationCondition,
  ScoreCard,
  ScoringFeature,
  ScoringInput,
  ThesisAssessment,
  ThesisConfig,
  ThesisRisk,
  ThesisRiskRule,
} from './types';

export const THESIS_NOTE =
  'A kockázatok és az érvénytelenítő feltételek a konfigurált szabályokból és a ténylegesen elérhető adatokból jönnek; nem teljes kockázati lista, és nem előrejelzés.';

type Stance = ThesisAssessment['stance'];

export function stanceOf(label: DecisionResult['label']): Stance {
  switch (label) {
    case 'STRONG_BUY':
    case 'BUY':
    case 'WATCH':
      return 'positive';
    case 'HOLD':
      return 'neutral';
    case 'REDUCE':
    case 'SELL':
    case 'STRONG_SELL':
      return 'negative';
    case 'NOT_RATED':
      return 'not_rated';
  }
}

function featureValue(feature: ScoringFeature | undefined): number | string | null {
  return feature !== undefined && feature.value.status === 'OK' ? feature.value.value : null;
}

/** Egy kockázati szabály állapota: `true` teljesül, `false` nem, `null` nem ismert. */
function ruleState(
  rule: ThesisRiskRule,
  features: ReadonlyMap<string, ScoringFeature>,
  flags: ReadonlyMap<string, boolean | null>,
): { readonly triggered: boolean | null; readonly value: number | string | boolean | null } {
  if (rule.flag !== undefined) {
    const value = flags.get(rule.flag) ?? null;
    return { triggered: value, value };
  }
  if (
    rule.featureId === undefined ||
    rule.comparator === undefined ||
    rule.threshold === undefined
  ) {
    return { triggered: null, value: null };
  }
  const value = featureValue(features.get(rule.featureId));
  return {
    triggered: value === null ? null : compare(value, rule.comparator, rule.threshold),
    value,
  };
}

function dataRisks(card: ScoreCard, config: ThesisConfig): ThesisRisk[] {
  const risks: ThesisRisk[] = [];
  for (const category of card.categories) {
    if (
      category.status === 'INSUFFICIENT_DATA' &&
      category.weight >= config.dataGapCategoryWeight
    ) {
      risks.push({
        id: `data-gap-${category.id}`,
        kind: 'data',
        severity: 'MEDIUM',
        dimension: null,
        statement: `A(z) „${category.label}” kategória (súly ${formatNumber(category.weight)}) adathiány miatt nem pontozott – az értékelés e nélkül készült.`,
        evidence: null,
        ruleId: 'data-gap',
      });
    }
  }
  const used = card.categories.flatMap((c) => c.metrics.filter((m) => m.score !== null));
  const mock = used.filter((m) => m.provenanceKind === 'mock');
  if (mock.length > 0) {
    risks.push({
      id: 'data-mock',
      kind: 'data',
      severity: 'HIGH',
      dimension: null,
      statement: `Demóadat (mock) szerepel a pontozásban: ${mock.map((m) => m.featureId).join(', ')}. Az eredmény nem valós elemzés.`,
      evidence: null,
      ruleId: 'data-mock',
    });
  }
  const stale = used.filter((m) => m.freshness === 'STALE' || m.freshness === 'EXPIRED');
  if (stale.length > 0) {
    risks.push({
      id: 'data-stale',
      kind: 'data',
      severity: 'LOW',
      dimension: null,
      statement: `Elavult adat a pontozásban: ${[...new Set(stale.map((m) => m.featureId))].join(', ')}.`,
      evidence: null,
      ruleId: 'data-stale',
    });
  }
  return risks;
}

export function assessThesis(
  config: ThesisConfig,
  card: ScoreCard,
  input: ScoringInput,
  decision: DecisionResult,
  extraInvalidation: readonly InvalidationCondition[] = [],
): ThesisAssessment {
  const features = new Map(input.features.map((f) => [f.id, f]));
  const flags = new Map(decision.flags.map((f) => [f.id, f.value]));
  const stance = stanceOf(decision.label);
  const states = config.riskRules.map((rule) => ({ rule, ...ruleState(rule, features, flags) }));

  const risks: ThesisRisk[] = [
    ...states
      .filter((s) => s.triggered === true)
      .map(({ rule, value }): ThesisRisk => ({
        id: rule.id,
        kind: rule.kind,
        severity: rule.severity,
        dimension: rule.dimension,
        statement: rule.statement,
        evidence: {
          featureId: rule.featureId ?? null,
          flag: rule.flag ?? null,
          value,
          comparator: rule.comparator ?? null,
          threshold: rule.threshold ?? null,
        },
        ruleId: rule.id,
      })),
    ...dataRisks(card, config),
  ];

  if (stance === 'not_rated') {
    return { stance, risks, invalidation: [], note: THESIS_NOTE };
  }

  const fromDecision: InvalidationCondition[] = [];
  const matchedTrace = decision.ruleTrace.find((r) => r.matched);
  for (const evaluation of matchedTrace?.conditions ?? []) {
    const c = evaluation.condition;
    if (c.kind === 'dimension' || c.kind === 'total') {
      const target = c.kind === 'dimension' ? c.dimension : 'total';
      const name = decision.dimensions.find((d) => d.id === target)?.label ?? target;
      if (c.min !== undefined) {
        fromDecision.push({
          id: `rule-${matchedTrace?.ruleId ?? ''}-${target}-min`,
          kind: c.kind,
          statement: `Ha ${c.kind === 'total' ? 'az összpontszám' : `a(z) „${name}” dimenzió`} ${formatNumber(c.min)} alá esik, a(z) ${matchedTrace?.ruleId ?? ''} szabály már nem teljesül.`,
          target,
          comparator: 'lt',
          threshold: c.min,
          currentValue: typeof evaluation.actual === 'number' ? evaluation.actual : null,
          ruleId: matchedTrace?.ruleId ?? '',
        });
      }
      if (c.max !== undefined) {
        fromDecision.push({
          id: `rule-${matchedTrace?.ruleId ?? ''}-${target}-max`,
          kind: c.kind,
          statement: `Ha ${c.kind === 'total' ? 'az összpontszám' : `a(z) „${name}” dimenzió`} eléri a(z) ${formatNumber(c.max)} pontot, a(z) ${matchedTrace?.ruleId ?? ''} szabály már nem teljesül.`,
          target,
          comparator: 'gte',
          threshold: c.max,
          currentValue: typeof evaluation.actual === 'number' ? evaluation.actual : null,
          ruleId: matchedTrace?.ruleId ?? '',
        });
      }
    } else if (c.kind === 'flag') {
      fromDecision.push({
        id: `rule-${matchedTrace?.ruleId ?? ''}-${c.flag}`,
        kind: 'flag',
        statement: `Ha megszűnik: ${evaluation.description}.`,
        target: c.flag,
        comparator: 'eq',
        threshold: !c.equals,
        currentValue: typeof evaluation.actual === 'boolean' ? evaluation.actual : null,
        ruleId: matchedTrace?.ruleId ?? '',
      });
    }
  }

  const fromRisks: InvalidationCondition[] = states
    .filter((s) =>
      stance === 'positive'
        ? s.triggered === false
        : stance === 'negative'
          ? s.triggered === true
          : false,
    )
    .map(({ rule, value }) => ({
      id: `risk-${rule.id}`,
      kind: rule.flag !== undefined ? 'flag' : 'feature',
      statement: stance === 'positive' ? rule.invalidatesPositive : rule.invalidatesNegative,
      target: rule.flag ?? rule.featureId ?? rule.id,
      comparator: rule.comparator ?? 'eq',
      threshold: rule.threshold ?? stance === 'positive',
      currentValue: value,
      ruleId: rule.id,
    }));

  const fromCaps: InvalidationCondition[] = decision.appliedCaps.map((cap) => ({
    id: `cap-${cap.capId}`,
    kind: 'flag',
    statement: `Ha megszűnik a plafon feltétele (${cap.description}), a címke visszaállhat: ${cap.to} → ${cap.from}.`,
    target: cap.capId,
    comparator: 'eq',
    threshold: false,
    currentValue: true,
    ruleId: cap.capId,
  }));

  return {
    stance,
    risks,
    invalidation: [...fromDecision, ...fromCaps, ...fromRisks, ...extraInvalidation],
    note: THESIS_NOTE,
  };
}
