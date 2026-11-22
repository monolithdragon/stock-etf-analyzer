/**
 * Portfólió-kontextus a döntéshez (PHASE 10, D-075): a pozíció KÖZVETLEN súlya a PHASE 09
 * `PositionAnalysis.weight` mezőjéből. Hiányzó súly (pl. nincs ár) → nem-OK feature (nem 0).
 *
 * Korlát: az ETF-eken át meglévő (look-through) kitettség itt nem számít bele – az ISIN szerinti
 * összesítés a `PortfolioAnalysis.concentration.singleNames`-ben látható (KI-83).
 */
import { metricNotApplicable, type ListingId } from '@/domain';
import type { ScoringFeature } from '@/scoring';

import type { PortfolioAnalysis } from '../portfolio/types';

export function portfolioWeightFeature(
  analysis: PortfolioAnalysis,
  listingId: ListingId,
): ScoringFeature {
  const position = analysis.positions.find((p) => p.listingId === listingId);
  return {
    id: 'portfolioWeight',
    label: 'Súly a portfólióban (közvetlen)',
    kind: 'numeric',
    unit: 'ratio',
    value:
      position === undefined
        ? metricNotApplicable(
            `A(z) ${listingId} nincs a(z) „${analysis.portfolioName}” portfólióban.`,
          )
        : position.weight,
    reliability: null,
  };
}
