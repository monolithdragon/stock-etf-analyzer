/**
 * Értékelés (score + döntés + confidence + tézis) → megjelenítési modell (PHASE 12).
 *
 * Szabályok (PHASE 10/12 prompt):
 * - A címke KIZÁRÓLAG a döntési engine kimenetéből jön (`decision.label` / `labelText`); a UI
 *   nem számol pontot és nem állít saját BUY/SELL-t.
 * - `NOT_RATED` = „Nem értékelhető”, semleges tónussal – nem negatív ítélet.
 * - A pont mellett mindig: lefedettség, hiányok, confidence-okok és a nyilatkozat.
 * - Az `AnalysisConfidence` adatteljesség és -minőség, NEM hozam-valószínűség.
 */
import type { InstrumentEvaluation } from '@/application';
import type { StatusTone } from '@/presentation/components/status-badge';
import { formatNumber, formatPercent } from '@/presentation/format';
import type {
  CategoryStatus,
  ConfidenceLevel,
  DecisionLabelKey,
  ThesisSeverity,
  TotalScoreStatus,
} from '@/scoring';

export const DECISION_TONE: Readonly<Record<DecisionLabelKey, StatusTone>> = {
  STRONG_BUY: 'positive',
  BUY: 'positive',
  WATCH: 'info',
  HOLD: 'info',
  REDUCE: 'negative',
  SELL: 'negative',
  STRONG_SELL: 'negative',
  NOT_RATED: 'neutral',
};

const TOTAL_STATUS_LABEL: Readonly<Record<TotalScoreStatus, string>> = {
  SCORED: 'teljes lefedettséggel',
  PARTIAL: 'részleges adatokkal (újranormalizált súlyokkal)',
  INSUFFICIENT_DATA: 'nincs elég adat az összpontszámhoz',
};

export const CATEGORY_STATUS_LABEL: Readonly<Record<CategoryStatus, string>> = {
  SCORED: 'pontozva',
  PARTIAL: 'részleges',
  INSUFFICIENT_DATA: 'kevés adat',
  NOT_SCORED: 'szándékosan nem pontozott',
};

export const CONFIDENCE_LABEL: Readonly<Record<ConfidenceLevel, string>> = {
  HIGH: 'magas',
  MEDIUM: 'közepes',
  LOW: 'alacsony',
  INSUFFICIENT: 'elégtelen',
};

const SEVERITY_LABEL: Readonly<Record<ThesisSeverity, string>> = {
  HIGH: 'magas',
  MEDIUM: 'közepes',
  LOW: 'alacsony',
};

const STANCE_LABEL = {
  positive: 'pozitív',
  neutral: 'semleges',
  negative: 'negatív',
  not_rated: 'nem értékelhető',
} as const;

export interface CategoryViewModel {
  readonly id: string;
  readonly label: string;
  readonly scoreText: string;
  readonly statusText: string;
  readonly weightText: string;
  readonly coverageText: string;
  readonly rule: string;
  readonly rationale: readonly string[];
  readonly missing: readonly string[];
}

export interface EvaluationViewModel {
  readonly decision: {
    readonly labelKey: DecisionLabelKey;
    readonly labelText: string;
    readonly description: string;
    readonly tone: StatusTone;
    /** Van-e érvényes (nem `NOT_RATED`) döntés a motortól. */
    readonly rated: boolean;
    /** Plafon (cap) módosította-e az alapszabály címkéjét. */
    readonly caps: readonly string[];
    readonly drivers: readonly string[];
    readonly configText: string;
  };
  readonly score: {
    readonly totalText: string;
    readonly statusText: string;
    readonly coverageText: string;
    readonly formula: string;
    readonly missingDataPolicy: string;
    readonly categories: readonly CategoryViewModel[];
  };
  readonly confidence: {
    readonly levelText: string;
    readonly scoreText: string;
    readonly reasons: readonly string[];
    readonly meaning: string;
  };
  readonly thesis: {
    readonly stanceText: string;
    readonly note: string;
    readonly risks: readonly { readonly id: string; readonly text: string }[];
    readonly invalidation: readonly { readonly id: string; readonly text: string }[];
  };
  readonly warnings: readonly string[];
  readonly disclaimers: readonly string[];
}

const scoreText = (score: number | null): string =>
  score === null ? 'N/A' : `${formatNumber(score, 1)} / 100`;

export function buildEvaluationViewModel(evaluation: InstrumentEvaluation): EvaluationViewModel {
  const { decision, score, confidence, thesis } = evaluation;
  const rated = decision.label !== 'NOT_RATED';
  return {
    decision: {
      labelKey: decision.label,
      labelText: decision.labelText,
      description: decision.labelDescription,
      tone: DECISION_TONE[decision.label],
      rated,
      caps: decision.appliedCaps.map((cap) => cap.description),
      drivers: decision.drivers,
      configText: `${decision.configId} · ${decision.configVersion}`,
    },
    score: {
      totalText: scoreText(score.totalScore),
      statusText: TOTAL_STATUS_LABEL[score.totalStatus],
      coverageText: `Adatlefedettség: ${formatPercent(score.dataCoverage, { decimals: 0 })}`,
      formula: score.formula,
      missingDataPolicy: score.missingDataPolicy,
      categories: score.categories.map((category) => ({
        id: category.id,
        label: category.label,
        scoreText: scoreText(category.score),
        statusText: CATEGORY_STATUS_LABEL[category.status],
        weightText: `súly: ${formatNumber(category.weight, 0)}`,
        coverageText: `lefedettség: ${formatPercent(category.coverage, { decimals: 0 })}`,
        rule: category.rule,
        rationale: category.rationale,
        missing: category.missing.map((m) => `${m.featureId}: ${m.reason}`),
      })),
    },
    confidence: {
      levelText: CONFIDENCE_LABEL[confidence.level],
      scoreText: `${formatNumber(confidence.score, 1)} / 100`,
      reasons: confidence.reasons,
      meaning: confidence.meaning,
    },
    thesis: {
      stanceText: STANCE_LABEL[thesis.stance],
      note: thesis.note,
      risks: thesis.risks.map((risk) => ({
        id: risk.id,
        text: `[${SEVERITY_LABEL[risk.severity]}] ${risk.statement}`,
      })),
      invalidation: thesis.invalidation.map((c) => ({ id: c.id, text: c.statement })),
    },
    warnings: evaluation.warnings,
    disclaimers: [evaluation.disclaimer, decision.disclaimer],
  };
}
