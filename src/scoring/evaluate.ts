/**
 * A score- és döntési lánc egy hívásban (PHASE 10): validáció → score → confidence → döntés →
 * thesis. Tiszta függvény: nincs óra, véletlen, hálózat vagy mutáció.
 */
import { AppErrors, err, type Result } from '@/domain';

import { assessConfidence } from './confidence';
import { validateConfigs } from './config-validation';
import { decide } from './decision-engine';
import { buildScoreCard } from './score-engine';
import { assessThesis } from './thesis';
import type {
  AnalysisConfidence,
  DecisionConfig,
  DecisionResult,
  InvalidationCondition,
  ScoreCard,
  ScoreConfig,
  ScoringInput,
  ThesisAssessment,
} from './types';

export interface ScoringOutcome {
  readonly score: ScoreCard;
  readonly confidence: AnalysisConfidence;
  readonly decision: DecisionResult;
  readonly thesis: ThesisAssessment;
}

export function evaluateScoring(
  input: ScoringInput,
  scoreConfig: ScoreConfig,
  decisionConfig: DecisionConfig,
  extraInvalidation: (decision: DecisionResult) => readonly InvalidationCondition[] = () => [],
): Result<ScoringOutcome> {
  const valid = validateConfigs(scoreConfig, decisionConfig, input.subjectKind);
  if (!valid.ok) return valid;
  const seen = new Set<string>();
  const duplicates = input.features.filter((f) => seen.size === seen.add(f.id).size);
  if (duplicates.length > 0) {
    // Duplikált azonosítónál a sorrend döntene → rejtett nem-determinizmus. Inkább hiba.
    return err(
      AppErrors.validation(
        'Duplikált feature-azonosító a pontozás bemenetében.',
        duplicates.map((f) => ({ path: `features.${f.id}`, message: 'Többször szerepel.' })),
      ),
    );
  }
  const score = buildScoreCard(scoreConfig, input.features);
  const confidence = assessConfidence(score, decisionConfig.confidence);
  const decision = decide(decisionConfig, score, input, confidence, scoreConfig.quality);
  const thesis = assessThesis(
    decisionConfig.thesis,
    score,
    input,
    decision,
    decision.label === 'NOT_RATED' ? [] : extraInvalidation(decision),
  );
  return { ok: true, value: { score, confidence, decision, thesis } };
}
