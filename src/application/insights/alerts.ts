/**
 * Ár- és mutatóriasztás – ALAP (PHASE 14, D-088).
 *
 * Képesség (dokumentált, ennél több NINCS):
 * - szabályok: ár > / < érték (a jegyzés pénznemében), Base DCF MOS > / < küszöb (részvény),
 *   P/E > / < küszöb (részvény), TER > / < küszöb (ETF);
 * - tartós tárolás az eszközön (SQLite, 2. migráció);
 * - kiértékelés CSAK az alkalmazáson belül: a Riasztások képernyő megnyitásakor és kézi
 *   „Ellenőrzés most” gombra. Az eredmény az appban látszik (jelzés + „újonnan teljesült”).
 * - NINCS push- és NINCS rendszerértesítés, NINCS háttérben futó ellenőrzés (bezárt appnál).
 *   Okok és követelmények: `ALERT_PLATFORM_LIMITATIONS`, D-088, a fázis-útmutató.
 *
 * Elavult vagy offline tartalékból jött adatnál a kiértékelés megtörténik, de jelölve
 * (`stale`), hogy régi adat alapján teljesült/nem teljesült.
 */
import { z } from 'zod';

import { parseCurrencyCode, type Metric } from '@/domain';

import type { InstrumentSnapshot, SnapshotKind } from './instrument-snapshot';
import { snapshotMetric } from './instrument-snapshot';

export const ALERT_METRICS = ['price', 'mosBase', 'pe', 'ter'] as const;
export type AlertMetric = (typeof ALERT_METRICS)[number];
export const ALERT_COMPARATORS = ['above', 'below'] as const;
export type AlertComparator = (typeof ALERT_COMPARATORS)[number];
export const ALERT_STATES = ['TRIGGERED', 'NOT_TRIGGERED', 'NOT_EVALUABLE'] as const;
export type AlertState = (typeof ALERT_STATES)[number];

export const ALERT_METRIC_INFO: Readonly<
  Record<
    AlertMetric,
    {
      readonly label: string;
      readonly appliesTo: readonly SnapshotKind[];
      readonly unit: 'money_per_share' | 'ratio' | 'multiple';
      /** Kell-e hozzá teljes elemzés (különben elég az ár-lekérés). */
      readonly needsAnalysis: boolean;
      readonly min: number;
      readonly max: number;
    }
  >
> = {
  price: {
    label: 'Árfolyam',
    appliesTo: ['stock', 'etf'],
    unit: 'money_per_share',
    needsAnalysis: false,
    min: 0,
    max: 1e9,
  },
  mosBase: {
    label: 'Biztonsági sáv (Base DCF)',
    appliesTo: ['stock'],
    unit: 'ratio',
    needsAnalysis: true,
    min: -10,
    max: 0.99,
  },
  pe: {
    label: 'P/E',
    appliesTo: ['stock'],
    unit: 'multiple',
    needsAnalysis: true,
    min: 0,
    max: 1000,
  },
  ter: { label: 'TER', appliesTo: ['etf'], unit: 'ratio', needsAnalysis: true, min: 0, max: 0.05 },
};

export const MAX_ALERT_RULES = 50;

export const ALERT_DELIVERY = 'in_app' as const;

/** A riasztás működési korlátai – a UI és a dokumentáció ugyanezt mutatja. */
export const ALERT_PLATFORM_LIMITATIONS: readonly string[] = [
  'A riasztások csak az alkalmazáson belül értékelődnek ki: a Riasztások képernyő megnyitásakor és az „Ellenőrzés most” gombra.',
  'Nincs push-értesítés és nincs rendszerértesítés: bezárt alkalmazásnál nem kapsz jelzést.',
  'Távoli (push) értesítés Expo Go-ban Androidon az SDK 53 óta nem érhető el; development build, FCM/APNs hitelesítés és értesítő backend kellene (a projektben nincs).',
  'Helyi (ütemezett) értesítés Expo Go-ban is működne az expo-notifications csomaggal és engedélykéréssel, de háttér-ellenőrzés nélkül nem tudna friss árat nézni – ezért nincs bekötve.',
  'Háttérben futó ellenőrzés (expo-background-task) nem garantált: Androidon legalább 15 perces, iOS-en a rendszer által választott ritka időpontokban fut, és a felhasználó által bezárt appnál leáll.',
  'Az ár késleltetett lehet (a szolgáltató szerint), és elavult/offline adatnál a kiértékelést jelöljük.',
];

export interface AlertRule {
  readonly id: string;
  readonly listingId: string;
  readonly kind: SnapshotKind;
  readonly metric: AlertMetric;
  readonly comparator: AlertComparator;
  /** Tizedes tört a `ratio` mutatóknál (MOS 0.2 = 20%, TER 0.002 = 0,2%). */
  readonly threshold: number;
  /** Csak ár-szabálynál: a küszöb pénzneme (a jegyzés pénzneme kell legyen). */
  readonly currency: string | null;
  readonly enabled: boolean;
  readonly createdAt: string;
  readonly lastState: AlertState | null;
  readonly lastEvaluatedAt: string | null;
  readonly lastTriggeredAt: string | null;
}

export const alertRuleSchema = z.strictObject({
  id: z.string().min(1).max(64),
  listingId: z.string().min(1).max(64),
  kind: z.enum(['stock', 'etf']),
  metric: z.enum(ALERT_METRICS),
  comparator: z.enum(ALERT_COMPARATORS),
  threshold: z.number().finite(),
  currency: z.string().length(3).nullable(),
  enabled: z.boolean(),
  createdAt: z.string().min(1).max(40),
  lastState: z.enum(ALERT_STATES).nullable(),
  lastEvaluatedAt: z.string().max(40).nullable(),
  lastTriggeredAt: z.string().max(40).nullable(),
});

export interface NewAlertRule {
  readonly listingId: string;
  readonly kind: SnapshotKind | 'unknown';
  readonly metric: AlertMetric;
  readonly comparator: AlertComparator;
  readonly threshold: number;
  readonly currency?: string | null;
}

/** Új szabály ellenőrzése; üres lista = érvényes. */
export function validateNewAlertRule(input: NewAlertRule): readonly string[] {
  const issues: string[] = [];
  const info = ALERT_METRIC_INFO[input.metric];
  if (info === undefined) return [`Ismeretlen mutató: ${String(input.metric)}.`];
  if (input.kind === 'unknown') {
    issues.push('Ismeretlen típusú instrumentumra nem állítható riasztás (részvény vagy ETF?).');
  } else if (!info.appliesTo.includes(input.kind)) {
    issues.push(
      `A(z) ${info.label} riasztás csak ${info.appliesTo.includes('stock') ? 'részvényre' : 'ETF-re'} értelmezett.`,
    );
  }
  if (!ALERT_COMPARATORS.includes(input.comparator)) {
    issues.push('Érvénytelen reláció (felett / alatt).');
  }
  if (!Number.isFinite(input.threshold)) {
    issues.push('A küszöb nem szám.');
  } else if (input.threshold < info.min || input.threshold > info.max) {
    issues.push(
      `A küszöb a megengedett tartományon kívül van (${info.min} … ${info.max}${info.unit === 'ratio' ? ', tizedes törtben' : ''}).`,
    );
  } else if (input.metric === 'price' && input.threshold === 0) {
    issues.push('Az ár-küszöb legyen pozitív.');
  }
  if (input.metric === 'price' && !parseCurrencyCode(input.currency ?? '').ok) {
    issues.push('Ár-riasztáshoz a jegyzés pénzneme kell (pl. USD).');
  }
  return issues;
}

export interface AlertEvaluation {
  readonly ruleId: string;
  readonly listingId: string;
  readonly status: AlertState;
  /** A kiértékeléshez használt érték (provenance-szel) vagy a hiány oka. */
  readonly observed: Metric<number>;
  readonly reason: string | null;
  /** Elavult / offline tartalékból jött adat alapján. */
  readonly stale: boolean;
  /** Az előző kiértékeléskor még nem teljesült (élváltás – ismételt jelzés nincs). */
  readonly newlyTriggered: boolean;
  readonly evaluatedAt: string;
}

/** Az értéket adó forrás: teljes pillanatkép, vagy (ár-szabálynál) csak ár. */
export type AlertSubject =
  | { readonly kind: 'snapshot'; readonly snapshot: InstrumentSnapshot }
  | { readonly kind: 'price'; readonly price: Metric<number> }
  | { readonly kind: 'error'; readonly reason: string };

function observedValue(rule: AlertRule, subject: AlertSubject): Metric<number> {
  if (subject.kind === 'error') return { status: 'MISSING', reason: subject.reason };
  if (subject.kind === 'price') {
    return rule.metric === 'price'
      ? subject.price
      : { status: 'MISSING', reason: 'Ehhez a riasztáshoz elemzés kell.' };
  }
  return snapshotMetric(subject.snapshot, rule.metric);
}

export function evaluateAlertRule(
  rule: AlertRule,
  subject: AlertSubject,
  evaluatedAt: string,
): AlertEvaluation {
  const observed = observedValue(rule, subject);
  const base = { ruleId: rule.id, listingId: rule.listingId, observed, evaluatedAt };
  if (observed.status !== 'OK') {
    return {
      ...base,
      status: 'NOT_EVALUABLE',
      reason: observed.reason,
      stale: false,
      newlyTriggered: false,
    };
  }
  if (rule.metric === 'price' && observed.provenance.currency !== rule.currency) {
    return {
      ...base,
      status: 'NOT_EVALUABLE',
      reason: `Az ár pénzneme (${observed.provenance.currency ?? 'ismeretlen'}) eltér a szabályétól (${rule.currency ?? '?'}) – átváltva nem riasztunk.`,
      stale: false,
      newlyTriggered: false,
    };
  }
  const p = observed.provenance;
  const stale =
    p.freshness === 'STALE' || p.freshness === 'EXPIRED' || p.cache?.mode === 'offline_fallback';
  const triggered =
    rule.comparator === 'above' ? observed.value > rule.threshold : observed.value < rule.threshold;
  const status: AlertState = triggered ? 'TRIGGERED' : 'NOT_TRIGGERED';
  return {
    ...base,
    status,
    reason: stale ? 'Elavult vagy offline tartalékból jött adat alapján.' : null,
    stale,
    newlyTriggered: triggered && rule.lastState !== 'TRIGGERED',
  };
}

/** A kiértékelés eredménye a tárolt szabályra (utolsó állapot, időpontok). */
export function applyEvaluation(rule: AlertRule, evaluation: AlertEvaluation): AlertRule {
  return {
    ...rule,
    // NOT_EVALUABLE nem írja felül az élváltás alapját (különben adathiány után újra „jelezne”).
    lastState: evaluation.status === 'NOT_EVALUABLE' ? rule.lastState : evaluation.status,
    lastEvaluatedAt: evaluation.evaluatedAt,
    lastTriggeredAt: evaluation.newlyTriggered ? evaluation.evaluatedAt : rule.lastTriggeredAt,
  };
}
