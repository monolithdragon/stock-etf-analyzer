/**
 * ETF-átfedés és részvény–ETF kitettség (PHASE 14, D-086).
 *
 * Szabályok:
 * - Átfedés csak AZONOS napra vagy kompatibilis (legfeljebb `MAX_SNAPSHOT_GAP_DAYS` nap eltérésű)
 *   holdings-pillanatképekre számolható. Nagyobb eltérésnél NEM számolunk (`INCOMPATIBLE_DATES`),
 *   mert két különböző időpont összetételét vetnénk össze. Mindkét adatdátum mindig látszik.
 * - Átfedés = Σ min(w_A, w_B) a közös ISIN-ekre (a calculations-motor `holdingsOverlap`-ja).
 *   Ez egyszer számolja a közös vállalatot. A „közös súly A-ban” és „közös súly B-ben” külön
 *   látszik, és KIFEJEZETTEN jelezzük, hogy a kettő összeadása kétszer számolná ugyanazt a céget.
 *   Az 50/50 keverék közös kitettsége: Σ (w_A + w_B) / 2 – cégenként egyszer.
 * - Részleges lista → alsó becslés (jelölve). ISIN nélküli tétel nem párosítható (név alapján
 *   nem találgatunk). Ugyanannak a kibocsátónak több részvényosztálya (külön ISIN) külön tétel.
 */
import { holdingsOverlap, type HoldingsOverlap } from '@/calculations';
import {
  metricMissing,
  metricOk,
  toEpochMs,
  type DataProvenance,
  type EtfHoldingsSnapshot,
  type IsoDate,
  type Metric,
} from '@/domain';

import type { InstrumentSnapshot } from './instrument-snapshot';

/** Két pillanatkép ennyi nap eltérésig kompatibilis (havi közzétételi ciklus). */
export const MAX_SNAPSHOT_GAP_DAYS = 31;

export type OverlapStatus =
  | 'OK'
  | 'MISSING'
  | 'NOT_APPLICABLE'
  | 'INCOMPATIBLE_DATES'
  | 'INVALID_INPUT'
  | 'INSUFFICIENT_DATA';

export interface OverlapSide {
  readonly listingId: string;
  readonly asOf: IsoDate | null;
  readonly completeness: 'complete' | 'partial' | null;
  readonly holdingsCount: number | null;
  readonly provenance: DataProvenance | null;
}

export interface EtfOverlapAnalysis {
  readonly status: OverlapStatus;
  readonly reason: string | null;
  readonly a: OverlapSide;
  readonly b: OverlapSide;
  readonly dateGapDays: number | null;
  readonly sameDate: boolean;
  readonly maxGapDays: number;
  readonly overlap: HoldingsOverlap | null;
  /** Σ w_A a közös tételekre: A-nak ekkora része van olyan cégben, amit B is tart. */
  readonly commonWeightInA: number | null;
  readonly commonWeightInB: number | null;
  /** 50/50 keverék közös kitettsége, cégenként egyszer számolva. */
  readonly equalMixCommonExposure: number | null;
  readonly isLowerBound: boolean;
  readonly notes: readonly string[];
}

export const DOUBLE_COUNT_NOTE =
  'A „közös súly A-ban” és „közös súly B-ben” nem adható össze: ugyanazt a céget kétszer számolná. Az átfedés (Σ min) és az 50/50 keverék kitettsége cégenként egyszer számol.';

const DAY_MS = 86_400_000;

function side(listingId: string, holdings: Metric<EtfHoldingsSnapshot>): OverlapSide {
  if (holdings.status !== 'OK') {
    return { listingId, asOf: null, completeness: null, holdingsCount: null, provenance: null };
  }
  return {
    listingId,
    asOf: holdings.value.asOf,
    completeness: holdings.value.completeness,
    holdingsCount: holdings.value.holdings.length,
    provenance: holdings.value.provenance,
  };
}

function empty(
  status: OverlapStatus,
  reason: string,
  a: OverlapSide,
  b: OverlapSide,
  gap: number | null,
): EtfOverlapAnalysis {
  return {
    status,
    reason,
    a,
    b,
    dateGapDays: gap,
    sameDate: gap === 0,
    maxGapDays: MAX_SNAPSHOT_GAP_DAYS,
    overlap: null,
    commonWeightInA: null,
    commonWeightInB: null,
    equalMixCommonExposure: null,
    isLowerBound: false,
    notes: [],
  };
}

export function analyzeEtfOverlap(
  etfA: InstrumentSnapshot,
  etfB: InstrumentSnapshot,
  options: { readonly maxGapDays?: number } = {},
): EtfOverlapAnalysis {
  const maxGap = options.maxGapDays ?? MAX_SNAPSHOT_GAP_DAYS;
  const a = side(etfA.listingId, etfA.holdings);
  const b = side(etfB.listingId, etfB.holdings);
  if (etfA.kind !== 'etf' || etfB.kind !== 'etf') {
    return empty('NOT_APPLICABLE', 'Holdings-átfedés csak két ETF között értelmezett.', a, b, null);
  }
  if (etfA.listingId === etfB.listingId) {
    return empty('INVALID_INPUT', 'Ugyanazt az ETF-et nem hasonlítjuk önmagához.', a, b, null);
  }
  const missing = [etfA, etfB]
    .filter((e) => e.holdings.status !== 'OK')
    .map((e) => `${e.listingId}: ${e.holdings.status === 'OK' ? '' : e.holdings.reason}`);
  if (missing.length > 0) {
    return empty('MISSING', `Nincs holdings-adat – ${missing.join('; ')}`, a, b, null);
  }
  const gap = Math.round(Math.abs(toEpochMs(a.asOf!) - toEpochMs(b.asOf!)) / DAY_MS);
  if (gap > maxGap) {
    return empty(
      'INCOMPATIBLE_DATES',
      `A két holdings-pillanatkép dátuma ${gap} nappal tér el (${a.asOf} vs ${b.asOf}); legfeljebb ${maxGap} nap eltérés kompatibilis. Átfedést nem számolunk eltérő időpontok összetételéből.`,
      a,
      b,
      gap,
    );
  }
  const holdingsA = (etfA.holdings as { value: EtfHoldingsSnapshot }).value;
  const holdingsB = (etfB.holdings as { value: EtfHoldingsSnapshot }).value;
  const toItems = (s: EtfHoldingsSnapshot) =>
    s.holdings.map((h) => ({ key: h.isin as string | null, weight: h.weight }));
  const bothComplete =
    holdingsA.completeness === 'complete' && holdingsB.completeness === 'complete';
  const calc = holdingsOverlap({ a: toItems(holdingsA), b: toItems(holdingsB), bothComplete });
  if (calc.status !== 'OK') {
    return empty(
      calc.status === 'INVALID_INPUT' ? 'INVALID_INPUT' : 'INSUFFICIENT_DATA',
      calc.reason,
      a,
      b,
      gap,
    );
  }
  const overlap = calc.value;
  const commonWeightInA = overlap.common.reduce((s, c) => s + c.weightA, 0);
  const commonWeightInB = overlap.common.reduce((s, c) => s + c.weightB, 0);
  const notes = [...calc.notes, DOUBLE_COUNT_NOTE];
  notes.push(
    'Ugyanannak a kibocsátónak több részvényosztálya (külön ISIN) külön tételnek számít – kibocsátói azonosító nélkül nem vonjuk össze.',
  );
  if (gap > 0) {
    notes.push(
      `A pillanatképek ${gap} nappal térnek el (${a.asOf} vs ${b.asOf}) – kompatibilis, de nem azonos időpont.`,
    );
  }
  return {
    status: 'OK',
    reason: null,
    a,
    b,
    dateGapDays: gap,
    sameDate: gap === 0,
    maxGapDays: maxGap,
    overlap,
    commonWeightInA,
    commonWeightInB,
    equalMixCommonExposure: overlap.common.reduce((s, c) => s + (c.weightA + c.weightB) / 2, 0),
    isLowerBound: !bothComplete,
    notes,
  };
}

/**
 * Részvény súlya egy ETF-ben (részvény–ETF összehasonlítás „ahol értelmezhető”): ISIN szerinti
 * egyezés a holdings-listában. Teljes listán a hiány valódi 0 (az alap nem tartja); részleges
 * listán `MISSING` (lehet, hogy a nem felsorolt részben van).
 */
export function stockWeightInEtf(
  stock: InstrumentSnapshot,
  etf: InstrumentSnapshot,
): Metric<number> {
  if (stock.kind !== 'stock' || etf.kind !== 'etf') {
    return { status: 'NOT_APPLICABLE', reason: 'Egy részvény és egy ETF kell.' };
  }
  if (etf.holdings.status !== 'OK') {
    return metricMissing(`Az ETF holdings-adata nem elérhető: ${etf.holdings.reason}`);
  }
  if (stock.isin === null) {
    return metricMissing('A részvény ISIN-je nem ismert – név vagy ticker alapján nem párosítunk.');
  }
  const snapshot = etf.holdings.value;
  const provenance: DataProvenance = { ...snapshot.provenance, asOf: snapshot.asOf, unit: 'ratio' };
  const weight = snapshot.holdings
    .filter((h) => h.isin === stock.isin)
    .reduce((s, h) => s + h.weight, 0);
  const found = snapshot.holdings.some((h) => h.isin === stock.isin);
  if (!found && snapshot.completeness !== 'complete') {
    return metricMissing(
      `A részvény nem szerepel a részleges holdings-listában (${snapshot.asOf}); a nem felsorolt részben lehet.`,
      provenance,
    );
  }
  return metricOk(weight, provenance);
}
