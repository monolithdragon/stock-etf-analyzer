/**
 * Kiinduló DCF-feltevések és megjelenítési konvenciók (PHASE 07, D-064).
 *
 * EZEK NEM A CÉGRE KALIBRÁLT ÉRTÉKEK és nem piaci adatok: általános, szándékosan kerek kiinduló
 * feltevések, hogy a modell azonnal futtatható és vizsgálható legyen. Minden mező felülírható,
 * és a kimenet megjelöli, hogy alapértelmezett (`default`) vagy felhasználói (`user`) érték fut.
 */
import { DCF_DEFAULT_EXPLICIT_YEARS, type DcfScenarioId } from '@/calculations';

export interface ScenarioDefault {
  readonly label: string;
  /** Konstans éves FCF-növekedés az explicit évekre. */
  readonly growthRate: number;
  readonly discountRate: number;
  readonly terminalGrowth: number;
}

export const DEFAULT_DCF_SCENARIOS: Readonly<Record<DcfScenarioId, ScenarioDefault>> = {
  bear: { label: 'Bear (óvatos)', growthRate: 0.02, discountRate: 0.1, terminalGrowth: 0.015 },
  base: { label: 'Base (kiinduló)', growthRate: 0.05, discountRate: 0.09, terminalGrowth: 0.025 },
  bull: { label: 'Bull (kedvező)', growthRate: 0.08, discountRate: 0.08, terminalGrowth: 0.03 },
};

export const DEFAULT_EXPLICIT_YEARS = DCF_DEFAULT_EXPLICIT_YEARS;

/** Szenzitivitási tengelyek a Base r és g körül: ±2 lépés (5 × 5 cella). */
export const DEFAULT_SENSITIVITY = {
  discountRateStep: 0.01,
  terminalGrowthStep: 0.005,
  stepsEachSide: 2,
} as const;

/** Megjelenítés: a belső érték 3 értékes jegyre, a MOS egész százalékra (nincs hamis pontosság). */
export const DCF_DISPLAY_SIGNIFICANT_DIGITS = 3;

export const DCF_DISCLAIMER =
  'A DCF-eredmény becslés, nem előrejelzés és nem befektetési tanács: a feltevések (növekedés, diszkontráta, terminális növekedés) kis változása is nagyban módosítja. Mindig a feltevésekkel, a forgatókönyvekkel és a szenzitivitási táblával együtt értelmezd.';

/** Szám kerekítése értékes jegyekre (csak megjelenítési javaslathoz; a nyers érték megmarad). */
export function roundToSignificant(value: number, digits: number): number {
  if (value === 0 || !Number.isFinite(value)) return value;
  return Number(value.toPrecision(digits));
}
