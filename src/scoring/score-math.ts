/**
 * Pontozási alapműveletek (PHASE 10, D-073). Tiszta, determinisztikus függvények.
 *
 * Kerekítés: minden kimeneti pont EGY tizedesre kerekül (`roundScore`), és a magasabb szint a már
 * kerekített alsó szintből számol (mutató → kategória → összpontszám). Így a megjelenített
 * számokból kézzel is pontosan visszaszámolható az eredmény, és nincs lebegőpontos „zaj” a
 * regressziós tesztekben.
 */
import type { Freshness } from '@/domain';

import type { Comparator, LinearRule } from './types';

/** Egy tizedesre kerekítés; a −0 helyett 0 (stabil összehasonlítás). */
export function roundScore(value: number): number {
  const rounded = Math.round(value * 10) / 10;
  return rounded === 0 ? 0 : rounded;
}

/** Arányszám (súly, lefedettség) kerekítése 4 tizedesre. */
export function roundShare(value: number): number {
  const rounded = Math.round(value * 10_000) / 10_000;
  return rounded === 0 ? 0 : rounded;
}

/**
 * Lineáris pont: `worst` → 0, `best` → 100, köztük egyenes, kívül levágva (0–100).
 * Előfeltétel (a konfiguráció-validáció biztosítja): `worst ≠ best`, mindkettő véges.
 */
export function linearScore(value: number, rule: Pick<LinearRule, 'worst' | 'best'>): number {
  const raw = ((value - rule.worst) / (rule.best - rule.worst)) * 100;
  return roundScore(Math.min(100, Math.max(0, raw)));
}

/** Súlyozott átlag újranormalizálással: csak a megadott (nem `null`) tételek számítanak. */
export function weightedAverage(
  items: readonly { readonly value: number; readonly weight: number }[],
): number | null {
  const weightSum = items.reduce((sum, item) => sum + item.weight, 0);
  if (items.length === 0 || weightSum <= 0) return null;
  return items.reduce((sum, item) => sum + item.value * item.weight, 0) / weightSum;
}

export function compare(
  value: number | string,
  comparator: Comparator,
  threshold: number | string,
): boolean {
  if (comparator === 'eq') return value === threshold;
  if (typeof value !== 'number' || typeof threshold !== 'number') return false;
  switch (comparator) {
    case 'lt':
      return value < threshold;
    case 'lte':
      return value <= threshold;
    case 'gt':
      return value > threshold;
    case 'gte':
      return value >= threshold;
  }
}

export const COMPARATOR_TEXT: Readonly<Record<Comparator, string>> = {
  lt: '<',
  lte: '≤',
  gt: '>',
  gte: '≥',
  eq: '=',
};

/** Frissesség súlyossági sorrend (rosszabb elöl) – a „legrosszabb” kiválasztásához. */
const FRESHNESS_SEVERITY: readonly Freshness[] = ['EXPIRED', 'STALE', 'UNKNOWN', 'FRESH'];

export function worstFreshness(values: readonly Freshness[]): Freshness | null {
  return FRESHNESS_SEVERITY.find((level) => values.includes(level)) ?? null;
}

/** Számok determinisztikus, olvasható formázása az indoklásokhoz (nem UI-formázó). */
export function formatNumber(value: number): string {
  if (Number.isInteger(value)) return String(value);
  return String(Number(value.toPrecision(6)));
}
