/**
 * ETF-kitettség levezetése holdings-adatból: földrajzi régió és mögöttes devizakockázat.
 * DATA_DICTIONARY 15.5–15.6, D-067, D-068.
 *
 * A levezetett régió SZÁMÍTOTT besorolás (heurisztika dokumentált küszöbökkel). Ha a forrás
 * vagy a felhasználó megadja a régiót, az elsődleges; eltérés esetén az alkalmazási réteg jelez.
 */
import type { ExposureGroup } from './holdings';
import {
  calcInsufficientData,
  calcInvalidInput,
  calcOk,
  type CalcResult,
} from '../core/calc-result';

export type DerivedRegion = 'US' | 'EUROPE' | 'JAPAN' | 'EMERGING' | 'GLOBAL' | 'OTHER';

/** Fejlett európai piacok (ISO 3166-1 alpha-2). */
// prettier-ignore
const EUROPE = new Set([
  'AT', 'BE', 'CH', 'DE', 'DK', 'ES', 'FI', 'FR', 'GB', 'IE', 'IT', 'LU', 'NL', 'NO', 'PT', 'SE',
]);

/**
 * Feltörekvő piacok – az MSCI EM listája szerint (2026). Megjegyzés: Dél-Korea az MSCI-nél
 * feltörekvő, az FTSE-nél fejlett; Lengyelország az FTSE-nél fejlett. Itt az MSCI szerint.
 */
// prettier-ignore
const EMERGING = new Set([
  'AE', 'BR', 'CL', 'CN', 'CO', 'CZ', 'EG', 'GR', 'HU', 'ID', 'IN', 'KR', 'KW', 'MX', 'MY', 'PE',
  'PH', 'PL', 'QA', 'SA', 'TH', 'TR', 'TW', 'ZA',
]);

export function regionOfCountry(country: string): Exclude<DerivedRegion, 'GLOBAL'> {
  if (country === 'US') return 'US';
  if (country === 'JP') return 'JAPAN';
  if (EUROPE.has(country)) return 'EUROPE';
  if (EMERGING.has(country)) return 'EMERGING';
  return 'OTHER';
}

/** Egy régió „domináns”, ha az ismert országsúly legalább ekkora részét adja. */
export const REGION_DOMINANCE_THRESHOLD = 0.8;
/** A „globális” besoroláshoz legalább ennyi régió kell, egyenként legalább `…_MIN_SHARE` súllyal. */
export const GLOBAL_MIN_REGIONS = 3;
export const GLOBAL_REGION_MIN_SHARE = 0.05;
/** Ennél kisebb ismert országsúly mellett nem vezetünk le régiót. */
export const REGION_MIN_KNOWN_WEIGHT = 0.5;
const THRESHOLD_TOLERANCE = 1e-9;

export interface RegionDerivation {
  readonly region: DerivedRegion;
  /** Régiósúlyok az ismert országsúlyra normalizálva. */
  readonly regionShares: Readonly<Record<Exclude<DerivedRegion, 'GLOBAL'>, number>>;
}

/**
 * Régió országsúlyokból (D-067):
 * 1. ha egy régió ≥ 80% → az a régió;
 * 2. különben, ha az USA ≥ 5% és legalább 3 régió egyenként ≥ 5% → `GLOBAL`;
 * 3. különben `OTHER` (pl. fejlett ex-US vagy vegyes).
 * Ha az ismert országsúly < 50% → `INSUFFICIENT_DATA`.
 */
export function deriveRegion(
  countryGroups: readonly ExposureGroup[],
): CalcResult<RegionDerivation> {
  const known = countryGroups.filter((group) => group.weight > 0);
  const total = known.reduce((sum, group) => sum + group.weight, 0);
  if (total < REGION_MIN_KNOWN_WEIGHT) {
    return calcInsufficientData(
      `Az ismert országsúly (${(total * 100).toFixed(1)}%) kevés a régió levezetéséhez.`,
    );
  }
  const shares = { US: 0, EUROPE: 0, JAPAN: 0, EMERGING: 0, OTHER: 0 };
  for (const group of known) shares[regionOfCountry(group.key)] += group.weight / total;
  const entries = Object.entries(shares) as [keyof typeof shares, number][];
  // Küszöb-összevetés tűréssel: 8 × 0.1 lebegőpontosan 0.7999…, ami nem eshet a 80% alá.
  const atLeast = (share: number, threshold: number) => share >= threshold - THRESHOLD_TOLERANCE;
  const dominant = entries.find(([, share]) => atLeast(share, REGION_DOMINANCE_THRESHOLD));
  const significant = entries.filter(([, share]) => atLeast(share, GLOBAL_REGION_MIN_SHARE)).length;
  const region: DerivedRegion = dominant
    ? dominant[0]
    : atLeast(shares.US, GLOBAL_REGION_MIN_SHARE) && significant >= GLOBAL_MIN_REGIONS
      ? 'GLOBAL'
      : 'OTHER';
  return calcOk({ region, regionShares: shares }, [
    'Holdings-országsúlyokból levezetett (heurisztikus) besorolás.',
  ]);
}

export interface CurrencyRisk {
  /** A befektető devizájától eltérő, FEDEZETLEN mögöttes kitettség aránya (0 … 1). */
  readonly unhedgedForeignShare: number;
  /** A mögöttes kitettség fedezés utáni devizánkénti megoszlása (normalizálva). */
  readonly effectiveExposure: readonly ExposureGroup[];
}

/**
 * Mögöttes devizakockázat a befektető (kijelzési) devizájához képest (D-068).
 *
 * - A kitettség a holdings DEVIZÁJA szerint (nem a jegyzési deviza: egy EUR-ban jegyzett
 *   világ-ETF mögött főleg USD kitettség van).
 * - Fedezett osztálynál (`hedgedTo`) a teljes kitettséget a fedezési devizába soroljuk
 *   (feltevés: teljes, folyamatos fedezés – a valóságban a havi újrafedezés miatt maradhat
 *   kis nyitott kitettség; megjegyzéssel).
 * - A súlyok az ismert devizasúlyra normalizálódnak.
 */
export function currencyRisk(input: {
  readonly exposures: readonly ExposureGroup[];
  readonly investorCurrency: string;
  readonly hedgedTo: string | null;
}): CalcResult<CurrencyRisk> {
  const bad = input.exposures.find((group) => !Number.isFinite(group.weight) || group.weight < 0);
  if (bad !== undefined) {
    return calcInvalidInput(`Érvénytelen devizasúly (${bad.key}: ${bad.weight}).`);
  }
  const total = input.exposures.reduce((sum, group) => sum + group.weight, 0);
  if (input.hedgedTo !== null) {
    const unhedged = input.hedgedTo === input.investorCurrency ? 0 : 1;
    return calcOk(
      { unhedgedForeignShare: unhedged, effectiveExposure: [{ key: input.hedgedTo, weight: 1 }] },
      [
        'Fedezett osztály: feltevés a teljes devizafedezés; a maradék nyitott kitettség kicsi, de nem nulla.',
      ],
    );
  }
  if (total <= 0) return calcInsufficientData('Nincs ismert mögöttes devizakitettség.');
  const effective = input.exposures
    .filter((group) => group.weight > 0)
    .map((group) => ({ key: group.key, weight: group.weight / total }))
    .sort((a, b) => b.weight - a.weight);
  const foreign = effective
    .filter((group) => group.key !== input.investorCurrency)
    .reduce((sum, group) => sum + group.weight, 0);
  return calcOk({ unhedgedForeignShare: foreign, effectiveExposure: effective });
}
