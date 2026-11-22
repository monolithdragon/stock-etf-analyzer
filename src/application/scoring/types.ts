/**
 * PHASE 10 – értékelés (score + döntés) az alkalmazási rétegben: bemenetek és kimenet.
 *
 * Az alkalmazási réteg csak LEKÉPEZ: a PHASE 06–09 kimeneteiből semleges `ScoringFeature`-listát
 * készít, a pontozás és a döntés a `src/scoring` tiszta motorjában fut. Az AI nem vesz részt
 * (`aiInvolvement: 'none'`) – a PHASE 11 legfeljebb magyarázza ezt a kimenetet.
 */
import type { IsoTimestamp, ListingId } from '@/domain';
import type {
  AnalysisConfidence,
  DecisionConfig,
  DecisionResult,
  ScoreCard,
  ScoreConfig,
  ScoringFeature,
  SubjectKind,
  ThesisAssessment,
} from '@/scoring';

import type { PortfolioAnalysis } from '../portfolio/types';

export interface EvaluationOptions {
  /** Saját score-konfiguráció (alapértelmezett: a `src/scoring/config` kiinduló értékei). */
  readonly scoreConfig?: ScoreConfig;
  readonly decisionConfig?: DecisionConfig;
  /**
   * Portfólió-kontextus (PHASE 09): ha megadott, a pozíció közvetlen súlya `portfolioWeight`
   * feature-ként kerül a döntésbe (túlsúly-plafon, koncentrációs kockázat).
   */
  readonly portfolio?: PortfolioAnalysis;
}

export const EVALUATION_DISCLAIMER =
  'Szabályalapú elemzési kimenet konfigurált súlyokkal és küszöbökkel. A címkék elemzési kategóriák, nem garantált előrejelzések, nem hozamígéretek és nem személyre szabott befektetési tanácsok. Az AnalysisConfidence az adatok teljessége és minősége, nem a hozam valószínűsége.';

export interface InstrumentEvaluation {
  readonly subjectKind: SubjectKind;
  readonly listingId: ListingId;
  /** A felhasznált elemzés időbélyege (a motor nem olvas órát → determinisztikus). */
  readonly evaluatedAt: IsoTimestamp;
  readonly configs: {
    readonly score: { readonly id: string; readonly version: string };
    readonly decision: { readonly id: string; readonly version: string };
  };
  /** A motor ténylegesen kapott bemenetei (visszakövethetőség). */
  readonly features: readonly ScoringFeature[];
  readonly score: ScoreCard;
  readonly confidence: AnalysisConfidence;
  readonly decision: DecisionResult;
  readonly thesis: ThesisAssessment;
  /** Az AI nem hoz döntést és nem módosítja a pontokat (PHASE 10 elfogadási feltétel). */
  readonly aiInvolvement: 'none';
  readonly warnings: readonly string[];
  readonly disclaimer: string;
}
