/**
 * DCF bemeneti modell a PHASE 06 fundamentális elemzésből (PHASE 07, D-064).
 *
 * Kiválasztási szabályok:
 * - `baseFcf`: a legutóbbi teljes pénzügyi év (FY) `fcf` sora (OCF − CapEx; D-062-vel azonos alap).
 * - `totalDebt`, `cash`: a legfrissebb mérlegnap – az éves és a negyedéves tábla első oszlopa közül
 *   a későbbi (egyezésnél az éves). Becsült adósság (`estimated`, D-059) öröklődik és figyelmeztet.
 * - `sharesOutstanding`: az áttekintő (legfrissebb mérleg) kint lévő részvényszáma.
 * - `marketPrice`: az aktuális ár, CSAK ha a jegyzési és a beszámolói pénznem egyezik (KI-50).
 * - Felülírás: bármelyik bemenet felhasználói értékkel (`user_input`) cserélhető; az eredeti
 *   érték a megjegyzésben marad.
 */
import type {
  CurrencyCode,
  FundamentalMetric,
  PeriodColumn,
  PeriodMetricTable,
  StockFundamentalAnalysis,
} from '@/domain';

import {
  DCF_INPUT_IDS,
  type DcfInputField,
  type DcfInputId,
  type DcfInputModel,
  type DcfInputOverrides,
} from './types';

export const DCF_INPUT_LABELS: Readonly<Record<DcfInputId, string>> = {
  baseFcf: 'Kiinduló szabad pénzáram (FCF)',
  totalDebt: 'Teljes adósság',
  cash: 'Pénzeszközök',
  sharesOutstanding: 'Kint lévő részvények száma',
  marketPrice: 'Piaci ár',
};

interface Located {
  readonly metric: FundamentalMetric;
  readonly column: PeriodColumn;
}

function firstCell(table: PeriodMetricTable, id: string): Located | null {
  const column = table.columns[0];
  const metric = table.rows.find((row) => row.id === id)?.cells[0];
  return column === undefined || metric === undefined ? null : { metric, column };
}

function latestBalanceTable(analysis: StockFundamentalAnalysis): PeriodMetricTable {
  const { annual, quarterly } = analysis.periodMetrics;
  const a = annual.columns[0]?.end;
  const q = quarterly.columns[0]?.end;
  return q !== undefined && (a === undefined || q > a) ? quarterly : annual;
}

function fieldFromMetric(
  id: DcfInputId,
  metric: FundamentalMetric | null,
  basis: string,
  missingReason: string,
): DcfInputField {
  const base = {
    id,
    label: DCF_INPUT_LABELS[id],
    basis,
    overridden: false,
    notes: metric?.notes ?? [],
  };
  if (metric === null) {
    return {
      ...base,
      value: null,
      status: 'MISSING',
      origin: 'missing',
      unit: id === 'sharesOutstanding' ? 'shares' : 'money',
      currency: null,
      source: null,
      reason: missingReason,
    };
  }
  const v = metric.value;
  if (v.status !== 'OK') {
    return {
      ...base,
      value: null,
      status: v.status,
      origin: metric.origin,
      unit: metric.unit,
      currency: null,
      source: null,
      reason: v.reason,
    };
  }
  const p = v.provenance;
  return {
    ...base,
    value: v.value,
    status: 'OK',
    origin: metric.origin,
    unit: metric.unit,
    currency: p.currency ?? null,
    source: {
      sourceId: p.sourceId,
      sourceName: p.sourceName,
      fetchedAt: p.fetchedAt,
      asOf: p.asOf,
    },
    reason: null,
  };
}

function applyOverride(
  field: DcfInputField,
  value: number,
  currency: CurrencyCode | null,
): DcfInputField {
  const original =
    field.value === null ? `nem volt használható (${field.status})` : `eredeti: ${field.value}`;
  const valid = Number.isFinite(value);
  return {
    ...field,
    value: valid ? value : null,
    status: valid ? 'OK' : 'INVALID_INPUT',
    origin: 'user_input',
    currency: field.unit === 'shares' ? null : currency,
    basis: 'felhasználói bevitel',
    source: null,
    reason: valid ? null : `Nem véges felhasználói érték: ${String(value)}.`,
    notes: [`Felhasználói felülírás (${original}).`],
    overridden: true,
  };
}

function withInvalidCurrency(field: DcfInputField, expected: CurrencyCode): DcfInputField {
  return {
    ...field,
    value: null,
    status: 'INVALID_INPUT',
    reason: `Eltérő pénznem (${field.currency ?? '?'} ≠ ${expected}) – FX-átváltás nélkül nem keverünk pénznemet.`,
  };
}

export function buildDcfInputModel(
  analysis: StockFundamentalAnalysis,
  overrides: DcfInputOverrides = {},
): DcfInputModel {
  const { overview, periodMetrics } = analysis;
  const currency = overview.reportingCurrency;
  const warnings: string[] = [];

  const fcf = firstCell(periodMetrics.annual, 'fcf');
  const balanceTable = latestBalanceTable(analysis);
  const debt = firstCell(balanceTable, 'totalDebt');
  const cash = firstCell(balanceTable, 'cashAndEquivalents');
  const columnBasis = (located: Located | null) =>
    located === null ? '–' : `${located.column.label} (záró: ${located.column.end})`;
  const noFy = 'Nincs teljes pénzügyi év (FY) a kimutatásokban.';
  const noBalance = 'Nincs mérlegadat a kimutatásokban.';

  let fields: Record<DcfInputId, DcfInputField> = {
    baseFcf: fieldFromMetric('baseFcf', fcf?.metric ?? null, columnBasis(fcf), noFy),
    totalDebt: fieldFromMetric('totalDebt', debt?.metric ?? null, columnBasis(debt), noBalance),
    cash: fieldFromMetric('cash', cash?.metric ?? null, columnBasis(cash), noBalance),
    sharesOutstanding: fieldFromMetric(
      'sharesOutstanding',
      overview.sharesOutstanding,
      'legfrissebb mérlegnap',
      noBalance,
    ),
    marketPrice: fieldFromMetric('marketPrice', overview.price, 'aktuális jegyzés', ''),
  };

  const trading = overview.tradingCurrency;
  if (trading !== null && currency !== null && trading !== currency) {
    fields.marketPrice = {
      ...fields.marketPrice,
      value: null,
      status: 'MISSING',
      origin: 'missing',
      reason: `A jegyzési (${trading}) és a beszámolói (${currency}) pénznem eltér; FX-átváltás nélkül az ár nem vethető össze a belső értékkel (KI-50). Azonos pénznemű ár felülírással megadható.`,
    };
    warnings.push(
      `Eltérő jegyzési (${trading}) és beszámolói (${currency}) pénznem: a DCF ${currency}-ban számol, a biztonsági sáv ár nélkül nem számolható (KI-50).`,
    );
  }

  if (currency !== null) {
    for (const id of ['baseFcf', 'totalDebt', 'cash'] as const) {
      const f = fields[id];
      if (f.status === 'OK' && f.currency !== null && f.currency !== currency) {
        fields[id] = withInvalidCurrency(f, currency);
      }
    }
  }

  for (const id of DCF_INPUT_IDS) {
    const value = overrides[id];
    if (value !== undefined)
      fields = { ...fields, [id]: applyOverride(fields[id], value, currency) };
  }

  if (fields.totalDebt.status === 'OK' && fields.totalDebt.origin === 'estimated') {
    warnings.push(
      'A teljes adósság becslés (egy rövid lejáratú komponens hiányzik, 0-nak vettük; D-059) – az equity-érték és a belső érték is becsült adósságon alapul.',
    );
  }
  const stale = DCF_INPUT_IDS.filter((id) => fields[id].origin === 'stale');
  if (stale.length > 0) {
    warnings.push(
      `Elavult bemenet: ${stale.map((id) => DCF_INPUT_LABELS[id]).join(', ')} – az eredmény ennek megfelelően értelmezendő.`,
    );
  }
  return { currency, fields, warnings };
}
