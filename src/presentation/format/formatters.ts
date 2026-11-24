/**
 * Közös pénzügyi formázók (PHASE 12, D-079).
 *
 * Elvek:
 * - Csak MEGJELENÍT, nem számol: a nyers érték a domainben marad, a kerekítés itt történik.
 * - Magyar (hu-HU) konvenció: tizedesvessző, ezres tagolás nem törő szóközzel, ÉÉÉÉ. HH. NN.
 * - Kézi megvalósítás `Intl` helyett: a Hermes (telefon) és a Node (teszt) `Intl`-adatai
 *   eltérhetnek, így a kimenet determinisztikus és tesztelhető marad.
 * - A hiányzó érték NEM nulla: a nem-OK státuszú mutató szöveges jelölést kap (N/A, N/M, …),
 *   soha nem „0”.
 */
import type {
  CurrencyCode,
  Freshness,
  MeasurementUnit,
  Metric,
  MetricOrigin,
  MetricStatus,
  ProvenanceKind,
} from '@/domain';

/** Nem törő szóköz: a szám és a tagolás nem törhet sorvégen. */
const NBSP = ' ';

/** 0 tizedesre kerekített pénznemek (a megjelenítésben). */
const ZERO_DECIMAL_CURRENCIES = new Set(['HUF', 'JPY', 'KRW', 'GBX']);

function groupThousands(integerDigits: string): string {
  return integerDigits.replace(/\B(?=(\d{3})+(?!\d))/g, NBSP);
}

/**
 * Szám formázása: `1234567.891` → `1 234 567,89` (2 tizedes).
 * A `-0` kerekítés utáni előjelét elhagyja.
 */
export function formatNumber(value: number, decimals = 2): string {
  if (!Number.isFinite(value)) return 'N/A';
  const fixed = Math.abs(value).toFixed(decimals);
  const [intPart = '0', fracPart] = fixed.split('.');
  const isZero = Number(fixed) === 0;
  const sign = value < 0 && !isZero ? '-' : '';
  const grouped = groupThousands(intPart);
  return fracPart === undefined ? `${sign}${grouped}` : `${sign}${grouped},${fracPart}`;
}

function signPrefix(value: number, decimals: number): string {
  return value > 0 && Number(Math.abs(value).toFixed(decimals)) !== 0 ? '+' : '';
}

/**
 * Tört → százalék: `0.153` → `15,3%`. `signed` esetén pozitívnál `+` előjel
 * (a negatív mindig előjelet kap) – így a jelentés nem csak színből derül ki.
 */
export function formatPercent(
  ratio: number,
  options: { readonly decimals?: number; readonly signed?: boolean } = {},
): string {
  const decimals = options.decimals ?? 1;
  const pct = ratio * 100;
  const prefix = options.signed === true ? signPrefix(pct, decimals) : '';
  return `${prefix}${formatNumber(pct, decimals)}%`;
}

/** Szorzó: `18.43` → `18,4x`. */
export function formatMultiple(value: number, decimals = 1): string {
  return `${formatNumber(value, decimals)}x`;
}

export function currencyDecimals(currency: string | null | undefined): number {
  return currency !== null && currency !== undefined && ZERO_DECIMAL_CURRENCIES.has(currency)
    ? 0
    : 2;
}

/** Pénzösszeg: `1234.5, 'USD'` → `1 234,50 USD`; pénznem nélkül csak a szám. */
export function formatMoney(
  amount: number,
  currency: string | null | undefined,
  options: { readonly decimals?: number; readonly signed?: boolean } = {},
): string {
  const decimals = options.decimals ?? currencyDecimals(currency);
  const prefix = options.signed === true ? signPrefix(amount, decimals) : '';
  const number = `${prefix}${formatNumber(amount, decimals)}`;
  return currency === null || currency === undefined ? number : `${number}${NBSP}${currency}`;
}

const LARGE_UNITS = [
  { threshold: 1e12, divisor: 1e12, suffix: `ezer${NBSP}Mrd` },
  { threshold: 1e9, divisor: 1e9, suffix: 'Mrd' },
  { threshold: 1e6, divisor: 1e6, suffix: 'M' },
  { threshold: 1e3, divisor: 1e3, suffix: 'e' },
] as const;

/**
 * Nagy szám rövid alakja (magyar rövidítésekkel): `1_234_000_000` → `1,23 Mrd`.
 * 1000 alatt a teljes szám (`decimals` tizedessel).
 */
export function formatLargeNumber(value: number, decimals = 2): string {
  if (!Number.isFinite(value)) return 'N/A';
  const abs = Math.abs(value);
  for (const unit of LARGE_UNITS) {
    if (abs >= unit.threshold) {
      return `${formatNumber(value / unit.divisor, decimals)}${NBSP}${unit.suffix}`;
    }
  }
  return formatNumber(value, abs >= 100 || Number.isInteger(value) ? 0 : decimals);
}

/** Nagy pénzösszeg: `2.5e9, 'USD'` → `2,50 Mrd USD`. */
export function formatLargeMoney(amount: number, currency: string | null | undefined): string {
  const number = formatLargeNumber(amount);
  return currency === null || currency === undefined ? number : `${number}${NBSP}${currency}`;
}

/** Egy szám a mértékegysége szerint (a `Metric` OK értékéhez). */
export function formatUnitValue(
  value: number,
  unit: MeasurementUnit | null,
  currency?: string | null,
): string {
  switch (unit) {
    case 'money':
      return formatLargeMoney(value, currency);
    case 'money_per_share':
      return formatMoney(value, currency);
    case 'shares':
      return formatLargeNumber(value);
    case 'ratio':
      return formatPercent(value);
    case 'multiple':
      return formatMultiple(value);
    case 'count':
      return formatNumber(value, Number.isInteger(value) ? 0 : 2);
    default:
      return formatNumber(value);
  }
}

// --- Dátum és idő ------------------------------------------------------------------------------

const pad2 = (n: number): string => String(n).padStart(2, '0');

/** ISO dátum (ÉÉÉÉ-HH-NN) → `2026. 11. 23.`; időbélyegnél a helyi naptári nap. */
export function formatDate(iso: string | null | undefined): string {
  if (iso === null || iso === undefined || iso === '') return 'N/A';
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (dateOnly !== null) return `${dateOnly[1]}. ${dateOnly[2]}. ${dateOnly[3]}.`;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return 'N/A';
  return `${date.getFullYear()}. ${pad2(date.getMonth() + 1)}. ${pad2(date.getDate())}.`;
}

/** ISO időbélyeg → `2026. 11. 23. 16:05` (helyi idő). Dátum-only bemenetnél csak a dátum. */
export function formatDateTime(iso: string | null | undefined): string {
  if (iso === null || iso === undefined || iso === '') return 'N/A';
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) return formatDate(iso);
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return 'N/A';
  return `${formatDate(iso)} ${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

// --- Státuszok ----------------------------------------------------------------------------------

/** Rövid jelölés nem-OK státuszra (a táblázat cellájába); a teljes ok a részletekben. */
export const METRIC_STATUS_SHORT: Readonly<Record<Exclude<MetricStatus, 'OK'>, string>> = {
  MISSING: 'N/A',
  NOT_APPLICABLE: 'N/A',
  NOT_MEANINGFUL: 'N/M',
  INSUFFICIENT_DATA: 'Kevés adat',
  INVALID_INPUT: 'Hibás bemenet',
  UNAVAILABLE: 'Nem elérhető',
  ERROR: 'Hiba',
};

/** Hosszú, érthető státusznév (akadálymentes címkéhez és a részletekhez). */
export const METRIC_STATUS_LABEL: Readonly<Record<MetricStatus, string>> = {
  OK: 'rendben',
  MISSING: 'hiányzó adat',
  NOT_APPLICABLE: 'nem alkalmazható',
  NOT_MEANINGFUL: 'nem értelmezhető',
  INSUFFICIENT_DATA: 'nincs elég adat',
  INVALID_INPUT: 'hibás bemenet',
  UNAVAILABLE: 'a jelenlegi forrásból nem elérhető',
  ERROR: 'hiba',
};

export const FRESHNESS_LABEL: Readonly<Record<Freshness, string>> = {
  FRESH: 'friss',
  STALE: 'elavult',
  EXPIRED: 'lejárt',
  UNKNOWN: 'ismeretlen frissesség',
};

export const PROVENANCE_KIND_LABEL: Readonly<Record<ProvenanceKind, string>> = {
  reported: 'jelentett',
  calculated: 'számított',
  estimated: 'becslés',
  ai_interpretation: 'AI-értelmezés',
  user_input: 'felhasználói bevitel',
  mock: 'demóadat',
};

export const ORIGIN_LABEL: Readonly<Record<MetricOrigin, string>> = {
  reported: 'jelentett',
  calculated: 'számított',
  estimated: 'becslés',
  stale: 'elavult',
  missing: 'hiányzik',
  unavailable: 'nem elérhető',
  mock: 'demóadat',
  user_input: 'felhasználói bevitel',
};

export interface FormattedMetric {
  /** A cellába írt szöveg: formázott érték vagy rövid státusz (soha nem „0” hiánynál). */
  readonly text: string;
  readonly status: MetricStatus;
  /** Nem-OK státusz oka; OK esetén `null`. */
  readonly reason: string | null;
  /** Felolvasható leírás (képernyőolvasó). */
  readonly accessibilityText: string;
}

/** `Metric<number>` → megjeleníthető szöveg + státusz + ok. */
export function formatMetric(
  metric: Metric<number>,
  unit: MeasurementUnit | null,
  currencyOverride?: string | null,
): FormattedMetric {
  if (metric.status === 'OK') {
    const currency = currencyOverride ?? metric.provenance.currency ?? null;
    const text = formatUnitValue(metric.value, unit, currency);
    return { text, status: 'OK', reason: null, accessibilityText: text };
  }
  const text = METRIC_STATUS_SHORT[metric.status];
  return {
    text,
    status: metric.status,
    reason: metric.reason,
    accessibilityText: `${METRIC_STATUS_LABEL[metric.status]}: ${metric.reason}`,
  };
}

/** Pénz-`Metric` (portfólió) formázása. */
export function formatMoneyMetric(
  metric: Metric<{ readonly amount: number; readonly currency: CurrencyCode }>,
  options: { readonly signed?: boolean } = {},
): FormattedMetric {
  if (metric.status === 'OK') {
    const text = formatMoney(metric.value.amount, metric.value.currency, options);
    return { text, status: 'OK', reason: null, accessibilityText: text };
  }
  return formatMetric(metric, null);
}

/** Előjel szöveges iránya (a szín mellé): pozitív / negatív / semleges. */
export type Direction = 'up' | 'down' | 'flat';

export function directionOf(value: number): Direction {
  if (value > 0) return 'up';
  if (value < 0) return 'down';
  return 'flat';
}

export const DIRECTION_LABEL: Readonly<Record<Direction, string>> = {
  up: 'növekedés',
  down: 'csökkenés',
  flat: 'változatlan',
};

/** `"1 234,5"` → `1234.5`; üres vagy hibás → `NaN` (a domain validáció utasítja el, okkal). */
export function parseDecimalInput(raw: string): number {
  const normalized = raw.replace(/[\s ]/g, '').replace(',', '.');
  if (normalized === '' || !/^-?\d*\.?\d+$/.test(normalized)) return Number.NaN;
  return Number(normalized);
}
