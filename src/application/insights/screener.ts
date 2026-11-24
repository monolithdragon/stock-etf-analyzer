/**
 * Szabályalapú screener (PHASE 14, D-087).
 *
 * - Univerzum: a lokálisan ismert instrumentumok (figyelőlista + portfólió) pillanatképei – nem
 *   piaci szintű szűrés (ahhoz fizetős, teljes univerzumot adó forrás kellene, DP-05).
 * - A szűrés CSAK ténylegesen elérhető mezőn fut: hiányzó mutatónál a feltétel
 *   `NOT_EVALUABLE` (nem „nem felel meg”, és soha nem 0-val számolva).
 * - Minden találat feltételenként visszaadja a használt értéket és annak provenance-ét
 *   (forrás, lekérés ideje, időszak, frissesség) – a találat visszavezethető az adatra.
 * - Az előre beállított szűrők küszöbei szemléltető kiinduló értékek, nem ajánlások.
 */
import { parseCurrencyCode, type Metric } from '@/domain';

import { snapshotMetric, type InstrumentSnapshot, type SnapshotKind } from './instrument-snapshot';

export const SCREENER_CATEGORIES = [
  'valuation',
  'growth',
  'quality',
  'dividend',
  'etf_cost',
  'etf_size',
  'etf_tracking',
  'etf_concentration',
] as const;
export type ScreenerCategory = (typeof SCREENER_CATEGORIES)[number];

export const SCREENER_CATEGORY_LABEL: Readonly<Record<ScreenerCategory, string>> = {
  valuation: 'Értékelés',
  growth: 'Növekedés',
  quality: 'Minőség',
  dividend: 'Osztalék',
  etf_cost: 'ETF költség (TER)',
  etf_size: 'ETF méret (AUM)',
  etf_tracking: 'ETF követés',
  etf_concentration: 'ETF koncentráció',
};

export type ScreenerUnit = 'ratio' | 'multiple' | 'money' | 'count';

export interface ScreenerField {
  readonly id: string;
  readonly label: string;
  readonly category: ScreenerCategory;
  readonly appliesTo: SnapshotKind;
  readonly unit: ScreenerUnit;
  /** Elfogadott küszöbtartomány (tizedes törtben a `ratio` mezőknél). */
  readonly min: number;
  readonly max: number;
}

const f = (
  id: string,
  label: string,
  category: ScreenerCategory,
  appliesTo: SnapshotKind,
  unit: ScreenerUnit,
  min: number,
  max: number,
): ScreenerField => ({ id, label, category, appliesTo, unit, min, max });

export const SCREENER_FIELDS: readonly ScreenerField[] = [
  f('pe', 'P/E', 'valuation', 'stock', 'multiple', 0, 1000),
  f('pfcf', 'P/FCF', 'valuation', 'stock', 'multiple', 0, 1000),
  f('evToEbitda', 'EV/EBITDA', 'valuation', 'stock', 'multiple', -1000, 1000),
  f('fcfYield', 'FCF-hozam', 'valuation', 'stock', 'ratio', -1, 1),
  f('mosBase', 'Biztonsági sáv (Base DCF)', 'valuation', 'stock', 'ratio', -10, 0.99),
  f('revenueCagr3y', 'Árbevétel CAGR 3 év', 'growth', 'stock', 'ratio', -1, 10),
  f('revenueCagr5y', 'Árbevétel CAGR 5 év', 'growth', 'stock', 'ratio', -1, 10),
  f('epsCagr3y', 'EPS CAGR 3 év', 'growth', 'stock', 'ratio', -1, 10),
  f('revenueGrowth', 'Árbevétel-növekedés (YoY)', 'growth', 'stock', 'ratio', -1, 10),
  f('roic', 'ROIC', 'quality', 'stock', 'ratio', -10, 10),
  f('roe', 'ROE', 'quality', 'stock', 'ratio', -10, 10),
  f('grossMargin', 'Bruttó árrés', 'quality', 'stock', 'ratio', -10, 1),
  f('operatingMargin', 'Üzemi árrés', 'quality', 'stock', 'ratio', -10, 1),
  f('debtToEquity', 'Adósság / saját tőke', 'quality', 'stock', 'multiple', -100, 100),
  f('netDebtToEbitda', 'Nettó adósság / EBITDA', 'quality', 'stock', 'multiple', -100, 100),
  f('dividendYield', 'Osztalékhozam (TTM)', 'dividend', 'stock', 'ratio', 0, 1),
  f('ter', 'TER', 'etf_cost', 'etf', 'ratio', 0, 0.05),
  f('aum', 'Alapméret (AUM)', 'etf_size', 'etf', 'money', 0, 1e13),
  f('distributionYieldTtm', 'Kifizetési hozam (TTM)', 'dividend', 'etf', 'ratio', 0, 1),
  f('trackingError', 'Tracking error', 'etf_tracking', 'etf', 'ratio', 0, 1),
  f(
    'annualizedTrackingDifference',
    'Évesített tracking difference',
    'etf_tracking',
    'etf',
    'ratio',
    -1,
    1,
  ),
  f('top10Weight', 'Top 10 súlya', 'etf_concentration', 'etf', 'ratio', 0, 1.5),
  f('largestHoldingWeight', 'Legnagyobb pozíció', 'etf_concentration', 'etf', 'ratio', 0, 1),
  f('effectiveHoldings', 'Effektív pozíciószám', 'etf_concentration', 'etf', 'count', 0, 20000),
];

export const MAX_SCREENER_CRITERIA = 10;

export type ScreenerOperator = 'gte' | 'lte';

export interface ScreenerCriterion {
  readonly fieldId: string;
  readonly operator: ScreenerOperator;
  /** Tizedes tört a `ratio` mezőknél (0.15 = 15%). */
  readonly value: number;
  /** Pénzösszeg-mezőnél kötelező (pl. AUM ≥ 1 mrd EUR). */
  readonly currency?: string | null;
}

export interface ScreenerQuery {
  readonly universe: SnapshotKind;
  readonly criteria: readonly ScreenerCriterion[];
}

export interface ScreenerIssue {
  /** A hibás feltétel indexe; `null` = az egész lekérdezésre vonatkozik. */
  readonly index: number | null;
  readonly message: string;
}

export function screenerField(id: string): ScreenerField | undefined {
  return SCREENER_FIELDS.find((field) => field.id === id);
}

/** Érvénytelen szűrő → hibalista (a UI a feltétel alatt mutatja). Üres lista = érvényes. */
export function validateScreenerQuery(query: ScreenerQuery): readonly ScreenerIssue[] {
  const issues: ScreenerIssue[] = [];
  if (query.criteria.length === 0) {
    issues.push({ index: null, message: 'Adj meg legalább egy feltételt.' });
  }
  if (query.criteria.length > MAX_SCREENER_CRITERIA) {
    issues.push({
      index: null,
      message: `Legfeljebb ${MAX_SCREENER_CRITERIA} feltétel adható meg.`,
    });
  }
  query.criteria.forEach((criterion, index) => {
    const field = screenerField(criterion.fieldId);
    if (field === undefined) {
      issues.push({ index, message: `Ismeretlen mező: ${criterion.fieldId}.` });
      return;
    }
    if (field.appliesTo !== query.universe) {
      issues.push({
        index,
        message: `A(z) ${field.label} csak ${field.appliesTo === 'stock' ? 'részvényre' : 'ETF-re'} értelmezett.`,
      });
    }
    if (criterion.operator !== 'gte' && criterion.operator !== 'lte') {
      issues.push({ index, message: 'Érvénytelen reláció (≥ vagy ≤ lehet).' });
    }
    if (!Number.isFinite(criterion.value)) {
      issues.push({ index, message: `A(z) ${field.label} küszöbe nem szám.` });
    } else if (criterion.value < field.min || criterion.value > field.max) {
      issues.push({
        index,
        message: `A(z) ${field.label} küszöbe a megengedett tartományon kívül van (${field.min} … ${field.max}${field.unit === 'ratio' ? ', tizedes törtben' : ''}).`,
      });
    }
    if (field.unit === 'money') {
      const currency = parseCurrencyCode(criterion.currency ?? '');
      if (!currency.ok) {
        issues.push({ index, message: `A(z) ${field.label} feltételhez pénznem kell (pl. EUR).` });
      }
    }
    const duplicate = query.criteria.findIndex(
      (other, i) =>
        i < index && other.fieldId === criterion.fieldId && other.operator === criterion.operator,
    );
    if (duplicate >= 0) {
      issues.push({ index, message: `Ugyanez a feltétel már szerepel (#${duplicate + 1}).` });
    }
  });
  // Ellentmondás: ugyanarra a mezőre ≥ X és ≤ Y, ahol X > Y → üres tartomány.
  for (const field of SCREENER_FIELDS) {
    const lower = query.criteria.filter((c) => c.fieldId === field.id && c.operator === 'gte');
    const upper = query.criteria.filter((c) => c.fieldId === field.id && c.operator === 'lte');
    for (const lo of lower) {
      for (const hi of upper) {
        if (lo.value > hi.value) {
          issues.push({
            index: query.criteria.indexOf(hi),
            message: `Ellentmondó feltételek: ${field.label} ≥ ${lo.value} és ≤ ${hi.value} – egyetlen instrumentum sem felelhet meg.`,
          });
        }
      }
    }
  }
  return issues;
}

export type CriterionStatus = 'PASS' | 'FAIL' | 'NOT_EVALUABLE';

export interface CriterionEvidence {
  readonly criterion: ScreenerCriterion;
  readonly field: ScreenerField;
  readonly status: CriterionStatus;
  /** A ténylegesen használt érték (provenance-szel) vagy a hiány oka. */
  readonly value: Metric<number>;
  readonly reason: string | null;
}

export interface ScreenerRow {
  readonly listingId: string;
  readonly name: string | null;
  readonly evidence: readonly CriterionEvidence[];
  /** Van-e a döntésben elavult vagy offline tartalékból jött adat. */
  readonly usesStaleData: boolean;
}

export interface ScreenerResult {
  readonly query: ScreenerQuery;
  readonly matches: readonly ScreenerRow[];
  readonly failed: readonly ScreenerRow[];
  readonly notEvaluable: readonly ScreenerRow[];
  /** Az univerzum azon elemei, amelyek nem vettek részt (más típus, betöltési hiba). */
  readonly skipped: readonly {
    readonly listingId: string;
    readonly reason: string;
  }[];
  readonly disclaimer: string;
}

export const SCREENER_DISCLAIMER =
  'Szabályalapú szűrés a lokális univerzumon (figyelőlista, portfólió). A küszöbök a te beállításaid vagy szemléltető kiinduló értékek – nem ajánlás és nem befektetési tanács.';

function evaluateCriterion(
  snapshot: InstrumentSnapshot,
  criterion: ScreenerCriterion,
  field: ScreenerField,
): CriterionEvidence {
  const value = snapshotMetric(snapshot, field.id);
  if (value.status !== 'OK') {
    return { criterion, field, status: 'NOT_EVALUABLE', value, reason: value.reason };
  }
  if (field.unit === 'money') {
    const currency = value.provenance.currency ?? null;
    if (currency === null || currency !== criterion.currency?.toUpperCase()) {
      return {
        criterion,
        field,
        status: 'NOT_EVALUABLE',
        value,
        reason: `Eltérő pénznem (${currency ?? 'ismeretlen'} vs ${criterion.currency ?? '?'}) – átváltás nélkül nem szűrünk.`,
      };
    }
  }
  const passed =
    criterion.operator === 'gte' ? value.value >= criterion.value : value.value <= criterion.value;
  return { criterion, field, status: passed ? 'PASS' : 'FAIL', value, reason: null };
}

function isStale(value: Metric<number>): boolean {
  if (value.status !== 'OK') return false;
  const p = value.provenance;
  return (
    p.freshness === 'STALE' || p.freshness === 'EXPIRED' || p.cache?.mode === 'offline_fallback'
  );
}

/** Előfeltétel: `validateScreenerQuery(query)` üres. Érvénytelen lekérdezésnél nincs találat. */
export function runScreener(
  query: ScreenerQuery,
  snapshots: readonly InstrumentSnapshot[],
  skippedInput: readonly { readonly listingId: string; readonly reason: string }[] = [],
): ScreenerResult {
  const empty: ScreenerResult = {
    query,
    matches: [],
    failed: [],
    notEvaluable: [],
    skipped: [...skippedInput],
    disclaimer: SCREENER_DISCLAIMER,
  };
  if (validateScreenerQuery(query).length > 0) return empty;
  const matches: ScreenerRow[] = [];
  const failed: ScreenerRow[] = [];
  const notEvaluable: ScreenerRow[] = [];
  const skipped = [...skippedInput];
  for (const snapshot of snapshots) {
    if (snapshot.kind !== query.universe) {
      skipped.push({
        listingId: snapshot.listingId,
        reason:
          snapshot.kind === 'stock' ? 'Részvény (ETF-szűrő fut).' : 'ETF (részvényszűrő fut).',
      });
      continue;
    }
    const evidence = query.criteria.map((criterion) =>
      evaluateCriterion(snapshot, criterion, screenerField(criterion.fieldId)!),
    );
    const row: ScreenerRow = {
      listingId: snapshot.listingId,
      name: snapshot.name,
      evidence,
      usesStaleData: evidence.some((e) => isStale(e.value)),
    };
    if (evidence.some((e) => e.status === 'FAIL')) failed.push(row);
    else if (evidence.some((e) => e.status === 'NOT_EVALUABLE')) notEvaluable.push(row);
    else matches.push(row);
  }
  return { ...empty, matches, failed, notEvaluable, skipped };
}

export interface ScreenerPreset {
  readonly id: string;
  readonly label: string;
  readonly query: ScreenerQuery;
}

/** Szemléltető kiinduló szűrők (a felhasználó módosíthatja) – nem ajánlások. */
export const SCREENER_PRESETS: readonly ScreenerPreset[] = [
  {
    id: 'value',
    label: 'Értékelés: alacsony P/E + DCF-diszkont',
    query: {
      universe: 'stock',
      criteria: [
        { fieldId: 'pe', operator: 'lte', value: 20 },
        { fieldId: 'mosBase', operator: 'gte', value: 0.15 },
      ],
    },
  },
  {
    id: 'growth',
    label: 'Növekedés: árbevétel CAGR 3 év ≥ 10%',
    query: {
      universe: 'stock',
      criteria: [{ fieldId: 'revenueCagr3y', operator: 'gte', value: 0.1 }],
    },
  },
  {
    id: 'quality',
    label: 'Minőség: ROIC ≥ 15%, alacsony tőkeáttétel',
    query: {
      universe: 'stock',
      criteria: [
        { fieldId: 'roic', operator: 'gte', value: 0.15 },
        { fieldId: 'netDebtToEbitda', operator: 'lte', value: 2 },
      ],
    },
  },
  {
    id: 'dividend',
    label: 'Osztalék: osztalékhozam ≥ 3%',
    query: {
      universe: 'stock',
      criteria: [{ fieldId: 'dividendYield', operator: 'gte', value: 0.03 }],
    },
  },
  {
    id: 'etf-cheap-large',
    label: 'ETF: TER ≤ 0,25%, AUM ≥ 1 mrd EUR',
    query: {
      universe: 'etf',
      criteria: [
        { fieldId: 'ter', operator: 'lte', value: 0.0025 },
        { fieldId: 'aum', operator: 'gte', value: 1e9, currency: 'EUR' },
      ],
    },
  },
  {
    id: 'etf-tracking',
    label: 'ETF: tracking error ≤ 0,5%',
    query: {
      universe: 'etf',
      criteria: [{ fieldId: 'trackingError', operator: 'lte', value: 0.005 }],
    },
  },
  {
    id: 'etf-diversified',
    label: 'ETF: top 10 súly ≤ 30%',
    query: { universe: 'etf', criteria: [{ fieldId: 'top10Weight', operator: 'lte', value: 0.3 }] },
  },
];
