/**
 * Közös kiinduló beállítások (PHASE 10, D-073…D-075): címkék, adatminőségi szorzók,
 * confidence-szintek. Mind felülírható; a kimenet mindig hordozza a konfiguráció azonosítóját.
 */
import type { ConfidenceConfig, DecisionConfig, QualityPolicy } from '../types';

/**
 * Címkék: ELEMZÉSI KATEGÓRIÁK, nem garantált előrejelzések és nem befektetési tanács.
 * A szöveg szabadon átírható (pl. angol UI), a kulcs (rangsor) fix.
 */
export const DEFAULT_DECISION_LABELS: DecisionConfig['labels'] = {
  STRONG_BUY: {
    text: 'Strong Buy',
    description:
      'Minden fő dimenzió erős, és a DCF-modell érdemi diszkontot mutat. Elemzési kategória, nem hozamígéret.',
  },
  BUY: {
    text: 'Buy',
    description:
      'Erős minőség és elfogadható értékelés a konfigurált küszöbök szerint. Elemzési kategória, nem hozamígéret.',
  },
  WATCH: {
    text: 'Watch',
    description:
      'Jó minőség, de az értékelés vagy az adatminőség nem támasztja alá a pozitívabb kategóriát – figyelendő.',
  },
  HOLD: {
    text: 'Hold',
    description: 'Vegyes kép: sem a pozitív, sem a negatív szabályok nem teljesülnek egyértelműen.',
  },
  REDUCE: {
    text: 'Reduce',
    description: 'Gyengébb összkép a küszöbök szerint; a kitettség felülvizsgálata indokolt lehet.',
  },
  SELL: {
    text: 'Sell',
    description: 'Gyenge összkép több dimenzióban a konfigurált küszöbök szerint.',
  },
  STRONG_SELL: {
    text: 'Strong Sell',
    description: 'Nagyon gyenge összkép, gyenge mérleggel és cash flow-val.',
  },
  NOT_RATED: {
    text: 'Nem értékelhető',
    description:
      'Nincs elég vagy elég jó minőségű adat a döntési szabályokhoz. Ez nem negatív ítélet.',
  },
};

/**
 * Adatminőségi szorzók: a jelentett és a belőlük számolt adat 1; a felhasználói bevitel 0,8
 * (nem auditált); a becslés 0,7 (feltevésfüggő); a demóadat 0,3; AI-értelmezés 0 (nem lehet
 * mutató forrása). Frissesség: FRESH 1, UNKNOWN 0,9, STALE 0,75, EXPIRED 0,5.
 */
export const DEFAULT_QUALITY_POLICY: QualityPolicy = {
  kind: {
    reported: 1,
    calculated: 1,
    user_input: 0.8,
    estimated: 0.7,
    mock: 0.3,
    ai_interpretation: 0,
  },
  freshness: { FRESH: 1, UNKNOWN: 0.9, STALE: 0.75, EXPIRED: 0.5 },
  shortWindow: 0.8,
  levels: { high: 0.9, medium: 0.7 },
};

/**
 * Confidence-szintek a 0–100-as confidence-pontra (lefedettség × minőség). A HIGH küszöb (80)
 * úgy van megválasztva, hogy egy legalább 20 súlyú kategória (pl. az Értékelés, 25) teljes hiánya
 * mellett tökéletes adatminőséggel se lehessen HIGH (0,8 × 1,0 = 80 a határ; 0,75 × 1,0 = 75).
 */
export const DEFAULT_CONFIDENCE: ConfidenceConfig = { high: 80, medium: 45 };
