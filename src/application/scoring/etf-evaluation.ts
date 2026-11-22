/**
 * ETF-értékelés (PHASE 10): PHASE 08 `EtfAnalysis.features` (+ opcionális PHASE 09 portfólió) →
 * semleges feature-lista → `src/scoring` motor, a RÉSZVÉNYTŐL KÜLÖN konfigurációval.
 *
 * A PHASE 08 feature-modell 1:1 átkerül (érték vagy hiány oka, provenance, D-070 megbízhatóság);
 * a súlyozás és a küszöbök a `src/scoring/config/etf-config.ts`-ben vannak.
 */
import type { Result } from '@/domain';
import {
  DEFAULT_ETF_DECISION_CONFIG,
  DEFAULT_ETF_SCORE_CONFIG,
  evaluateScoring,
  type ScoringFeature,
} from '@/scoring';

import { portfolioWeightFeature } from './portfolio-context';
import { EVALUATION_DISCLAIMER, type EvaluationOptions, type InstrumentEvaluation } from './types';
import type { EtfAnalysis } from '../etf-analysis/types';

export function buildEtfFeatures(
  etf: EtfAnalysis,
  options: Pick<EvaluationOptions, 'portfolio'> = {},
): ScoringFeature[] {
  const features = etf.features.features.map((feature): ScoringFeature =>
    feature.kind === 'numeric'
      ? {
          id: feature.id,
          label: feature.metric.label,
          kind: 'numeric',
          unit: feature.metric.unit,
          value: feature.metric.value,
          reliability: feature.metric.reliability,
        }
      : {
          id: feature.id,
          label: feature.label,
          kind: 'categorical',
          value: feature.value,
          reliability: null,
        },
  );
  if (options.portfolio !== undefined) {
    features.push(portfolioWeightFeature(options.portfolio, etf.listingId));
  }
  return features;
}

export function buildEtfEvaluation(
  etf: EtfAnalysis,
  options: EvaluationOptions = {},
): Result<InstrumentEvaluation> {
  const scoreConfig = options.scoreConfig ?? DEFAULT_ETF_SCORE_CONFIG;
  const decisionConfig = options.decisionConfig ?? DEFAULT_ETF_DECISION_CONFIG;
  const features = buildEtfFeatures(etf, options);
  const outcome = evaluateScoring(
    { subjectKind: 'etf', features, flags: {} },
    scoreConfig,
    decisionConfig,
  );
  if (!outcome.ok) return outcome;
  return {
    ok: true,
    value: {
      subjectKind: 'etf',
      listingId: etf.listingId,
      evaluatedAt: etf.generatedAt,
      configs: {
        score: { id: scoreConfig.id, version: scoreConfig.version },
        decision: { id: decisionConfig.id, version: decisionConfig.version },
      },
      features,
      ...outcome.value,
      aiInvolvement: 'none',
      warnings: etf.coverage.limitations,
      disclaimer: EVALUATION_DISCLAIMER,
    },
  };
}
