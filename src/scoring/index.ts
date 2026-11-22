/**
 * Score- és döntési engine (PHASE 10). Tiszta szabálymotor: csak `@/domain` és `@/calculations`.
 */
export * from './types';
export { roundScore, roundShare, linearScore, weightedAverage } from './score-math';
export {
  WEIGHT_TOLERANCE,
  scoreConfigIssues,
  decisionConfigIssues,
  validateConfigs,
} from './config-validation';
export {
  buildScoreCard,
  scoreCategory,
  scoreMetric,
  describeRule,
  MISSING_DATA_POLICY,
  SCORE_FORMULA,
} from './score-engine';
export { assessConfidence, CONFIDENCE_MEANING } from './confidence';
export { decide, computeDimensions, computeFlags, DECISION_DISCLAIMER } from './decision-engine';
export { assessThesis, stanceOf, THESIS_NOTE } from './thesis';
export { evaluateScoring, type ScoringOutcome } from './evaluate';
export {
  DEFAULT_CONFIDENCE,
  DEFAULT_DECISION_LABELS,
  DEFAULT_QUALITY_POLICY,
} from './config/shared-defaults';
export { DEFAULT_STOCK_SCORE_CONFIG, DEFAULT_STOCK_DECISION_CONFIG } from './config/stock-config';
export { DEFAULT_ETF_SCORE_CONFIG, DEFAULT_ETF_DECISION_CONFIG } from './config/etf-config';
