/**
 * AnalysisConfidence (PHASE 10, feladat 8., D-074).
 *
 * JELENTÉS: mennyire teljes és jó minőségű az az ADAT, amelyből a score és a döntés készült.
 * NEM a jövőbeli hozam valószínűsége, NEM a döntés „helyességének” esélye.
 *
 *   score = 100 × adatlefedettség × adatminőség
 *   - adatlefedettség = Σ(kategóriasúly × kategória-lefedettség) / Σ kategóriasúly
 *   - adatminőség = a pontozott mutatók minőségi szorzóinak súlyozott átlaga (fajta × frissesség ×
 *     megbízhatóság, `QualityPolicy`)
 *   Szint: ≥ high → HIGH, ≥ medium → MEDIUM, alatta LOW; nincs összpontszám → INSUFFICIENT.
 *   Demóadat (`mock`) esetén legfeljebb LOW.
 */
import { formatNumber, roundScore, roundShare, weightedAverage } from './score-math';
import type { AnalysisConfidence, ConfidenceConfig, ConfidenceLevel, ScoreCard } from './types';

export const CONFIDENCE_MEANING =
  'Az AnalysisConfidence az adatok teljességét és minőségét méri (lefedettség × minőség). NEM a jövőbeli hozam valószínűsége, és nem azt mondja meg, mennyire „biztos” a címke.';

const pct = (share: number) => `${formatNumber(roundScore(share * 1000) / 10)}%`;

export function assessConfidence(card: ScoreCard, config: ConfidenceConfig): AnalysisConfidence {
  const weighted = card.categories.filter((c) => c.weight > 0);
  const quality = weightedAverage(
    weighted
      .filter((c) => c.dataQuality.factor !== null && c.coverage > 0)
      .map((c) => ({ value: c.dataQuality.factor ?? 0, weight: c.weight * c.coverage })),
  );
  const dataQuality = quality === null ? 0 : roundShare(quality);
  const score = roundScore(100 * card.dataCoverage * dataQuality);
  const reasons: string[] = [
    `Adatlefedettség: ${pct(card.dataCoverage)} (a konfigurált mutatósúlyokból).`,
    `Adatminőség: ${pct(dataQuality)} (forrásfajta × frissesség × ablakhossz).`,
  ];
  const insufficient = weighted.filter((c) => c.status === 'INSUFFICIENT_DATA');
  if (insufficient.length > 0) {
    reasons.push(
      `Pont nélküli kategóriák (adathiány): ${insufficient.map((c) => c.label).join(', ')}.`,
    );
  }
  const notScored = card.categories.filter((c) => c.status === 'NOT_SCORED');
  if (notScored.length > 0) {
    reasons.push(`Szándékosan nem pontozott: ${notScored.map((c) => c.label).join(', ')}.`);
  }
  const usesMock = weighted.some((c) =>
    c.metrics.some((m) => m.score !== null && m.provenanceKind === 'mock'),
  );
  let level: ConfidenceLevel =
    card.totalScore === null
      ? 'INSUFFICIENT'
      : score >= config.high
        ? 'HIGH'
        : score >= config.medium
          ? 'MEDIUM'
          : 'LOW';
  if (card.totalScore === null) {
    reasons.push('Nincs összpontszám: a pontozott kategóriák súlyaránya a minimum alatt.');
  }
  if (usesMock && (level === 'HIGH' || level === 'MEDIUM')) {
    level = 'LOW';
    reasons.push('Demóadat (mock) szerepel a pontozásban → legfeljebb LOW.');
  }
  return {
    level,
    score,
    dataCompleteness: card.dataCoverage,
    dataQuality,
    reasons,
    meaning: CONFIDENCE_MEANING,
  };
}
