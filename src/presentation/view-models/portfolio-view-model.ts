/**
 * Portfólióelemzés → képernyőmodell (PHASE 12). KÜLÖN logika a részvény- és ETF-nézettől.
 *
 * Kötelezően látható (ROADMAP PHASE 09 → 12): a két P/L-nézet jelölve (natív / bázis + FX),
 * az átlagár-módszer adózási figyelmeztetése, a napló-validáció hibái, a hiányzó árú pozíciók
 * és a korlátok. Hiányzó ár / FX soha nem 0: a részösszeg mellett a hiányzó tételek is látszanak.
 */
import type {
  PortfolioAnalysis,
  PortfolioMetric,
  PortfolioTotal,
  PositionAnalysis,
} from '@/application';
import type { Metric, Money } from '@/domain';
import type { DataNotice } from '@/presentation/components/states';
import type { StatusTone } from '@/presentation/components/status-badge';
import type { WeightItem } from '@/presentation/components/weight-bars';
import {
  directionOf,
  formatDate,
  formatMoney,
  formatMoneyMetric,
  formatNumber,
  formatPercent,
  type FormattedMetric,
} from '@/presentation/format';

import { buildMetricRow, type MetricRowModel } from './metric-row';

export function portfolioMetricRow(metric: PortfolioMetric): MetricRowModel {
  return buildMetricRow({
    key: metric.id,
    label: metric.label,
    value: metric.value,
    unit: metric.unit,
    origin: metric.origin,
    formula: metric.formula,
    notes: metric.notes,
    hint: metric.reliability === 'short_window' ? 'rövid ablak – óvatosan értelmezendő' : null,
  });
}

export interface SignedValue {
  readonly text: string;
  readonly tone: StatusTone;
  /** Szöveges irány (pl. „nyereség”), hogy ne csak a szín hordozza a jelentést. */
  readonly directionText: string | null;
}

function signedMoney(metric: Metric<Money>): SignedValue {
  const formatted = formatMoneyMetric(metric, { signed: true });
  if (metric.status !== 'OK') return { text: formatted.text, tone: 'neutral', directionText: null };
  const dir = directionOf(metric.value.amount);
  return {
    text: formatted.text,
    tone: dir === 'up' ? 'positive' : dir === 'down' ? 'negative' : 'neutral',
    directionText: dir === 'up' ? 'nyereség' : dir === 'down' ? 'veszteség' : 'nulla',
  };
}

function signedPercent(metric: Metric<number>): SignedValue {
  if (metric.status !== 'OK') return { text: 'N/A', tone: 'neutral', directionText: null };
  const dir = directionOf(metric.value);
  return {
    text: formatPercent(metric.value, { signed: true }),
    tone: dir === 'up' ? 'positive' : dir === 'down' ? 'negative' : 'neutral',
    directionText: dir === 'up' ? 'nyereség' : dir === 'down' ? 'veszteség' : 'nulla',
  };
}

/** Összeg: teljes érték, vagy részösszeg + a hiányzó pozíciók (soha nem csendes 0). */
export function totalRow(total: PortfolioTotal, signed = false): MetricRowModel {
  const value = total.value;
  const formatted: FormattedMetric =
    value.status === 'OK'
      ? formatMoneyMetric(value, { signed })
      : {
          text:
            total.components.length > 0
              ? `≥ ${formatMoney(total.availableSum.amount, total.availableSum.currency, { signed })} (részösszeg)`
              : 'N/A',
          status: value.status,
          reason: value.reason,
          accessibilityText: `részösszeg, hiányzik: ${total.missing.join(', ')}. ${value.reason}`,
        };
  return buildMetricRow({
    key: total.id,
    label: total.label,
    value:
      value.status === 'OK'
        ? { status: 'OK', value: value.value.amount, provenance: value.provenance }
        : value,
    unit: 'money',
    formatted,
    hint: total.missing.length > 0 ? `Hiányzik: ${total.missing.join(', ')}` : null,
  });
}

export interface PositionViewModel {
  readonly listingId: string;
  readonly title: string;
  readonly subtitle: string;
  readonly statusText: string;
  readonly marketValueText: string;
  readonly weightText: string;
  readonly plBase: SignedValue;
  readonly plNative: SignedValue;
  readonly returnPct: SignedValue;
  readonly fxText: string | null;
  readonly issues: readonly string[];
}

function positionViewModel(position: PositionAnalysis): PositionViewModel {
  const weight = position.weight;
  return {
    listingId: position.listingId,
    title: position.metadata?.name ?? position.listingId,
    subtitle: `${position.listingId} · ${formatNumber(position.quantity, Number.isInteger(position.quantity) ? 0 : 4)} db`,
    statusText:
      position.status === 'open'
        ? 'nyitott'
        : position.status === 'closed'
          ? 'zárt'
          : 'hibás napló',
    marketValueText: formatMoneyMetric(position.marketValueBase).text,
    weightText: weight.status === 'OK' ? formatPercent(weight.value) : 'N/A',
    plBase: signedMoney(position.unrealizedPLBase),
    plNative: signedMoney(position.unrealizedPLNative),
    returnPct: signedPercent(position.totalReturnPct),
    fxText:
      position.currentFx !== null
        ? `FX: 1 ${position.currentFx.currency} = ${formatNumber(position.currentFx.rate, 4)} (${formatDate(position.currentFx.asOf)}, ${position.currentFx.provenance.sourceName})`
        : null,
    issues: position.issues.map((i) => i.message),
  };
}

export interface PortfolioViewModel {
  readonly header: { readonly title: string; readonly baseCurrency: string };
  readonly notices: readonly DataNotice[];
  readonly summary: {
    readonly marketValue: MetricRowModel;
    readonly unrealized: SignedValue;
    readonly totalReturn: SignedValue;
    readonly totalReturnPct: SignedValue;
    readonly rows: readonly MetricRowModel[];
    readonly positionsText: string;
  };
  readonly positions: readonly PositionViewModel[];
  readonly allocation: readonly WeightItem[];
  /** Ár nélküli nyitott pozíciók (súlyuk nem számolható – nem 0). */
  readonly unpriced: readonly string[];
  readonly currencyExposure: { readonly items: readonly WeightItem[]; readonly note: string };
  readonly concentration: {
    readonly rows: readonly MetricRowModel[];
    readonly notes: readonly string[];
  };
  readonly overlap: { readonly lines: readonly string[]; readonly note: string };
  readonly risk: {
    readonly statusText: string;
    readonly rows: readonly MetricRowModel[];
    readonly notes: readonly string[];
  };
  readonly accounting: { readonly description: string; readonly taxWarning: string };
  readonly validationIssues: readonly string[];
  readonly warnings: readonly string[];
  readonly fxRates: readonly string[];
  readonly disclaimer: string;
}

function totalSigned(total: PortfolioTotal): SignedValue {
  return total.value.status === 'OK'
    ? signedMoney(total.value)
    : { text: totalRow(total, true).text, tone: 'neutral', directionText: null };
}

export function buildPortfolioViewModel(analysis: PortfolioAnalysis): PortfolioViewModel {
  const t = analysis.totals;
  const open = analysis.positions.filter((p) => p.status === 'open');

  const allocation: WeightItem[] = open
    .flatMap((p) =>
      p.weight.status === 'OK'
        ? [{ key: p.listingId, label: p.metadata?.name ?? p.listingId, weight: p.weight.value }]
        : [],
    )
    .sort((a, b) => b.weight - a.weight);
  // A hiányzó árú pozíció NEM 0 súly: nem kerül a sávdiagramba, külön, megnevezve jelenik meg.
  const unpriced = open
    .filter((p) => p.weight.status !== 'OK')
    .map((p) => `${p.listingId}: ${p.weight.status === 'OK' ? '' : p.weight.reason}`);

  const currencyExposure = analysis.exposures.find(
    (e) => e.dimension === 'tradingCurrency' && e.method === 'direct',
  );
  const currencyItems: WeightItem[] =
    currencyExposure !== undefined && currencyExposure.groups.status === 'OK'
      ? currencyExposure.groups.value.map((g) => ({ key: g.key, label: g.key, weight: g.weight }))
      : [];
  const currencyNote =
    currencyExposure === undefined
      ? 'Nincs devizakitettség-adat.'
      : currencyExposure.groups.status === 'OK'
        ? currencyExposure.methodNote
        : `${currencyExposure.groups.reason}`;

  const c = analysis.concentration;
  const largest = c.largestPosition;
  const concentrationRows: MetricRowModel[] = [
    buildMetricRow({
      key: 'largestPosition',
      label: 'Legnagyobb pozíció',
      value:
        largest.status === 'OK'
          ? { status: 'OK', value: largest.value.weight, provenance: largestProvenance(analysis) }
          : largest,
      unit: 'ratio',
      hint: largest.status === 'OK' ? largest.value.listingId : null,
    }),
    ...[c.top5Weight, c.herfindahl, c.effectivePositions].map(portfolioMetricRow),
  ];

  const overlapLines = analysis.etfOverlap.pairs.map((pair) =>
    pair.overlap.status === 'OK'
      ? `${pair.a} ↔ ${pair.b}: ${formatPercent(pair.overlap.value.overlapWeight)}`
      : `${pair.a} ↔ ${pair.b}: N/A – ${pair.overlap.reason}`,
  );
  const overlapNote =
    analysis.etfOverlap.etfsWithoutHoldings.length > 0
      ? `Holdings nélküli ETF-ek (nincs átfedés-számítás): ${analysis.etfOverlap.etfsWithoutHoldings.join(', ')}.`
      : analysis.etfOverlap.method;

  const h = analysis.history;
  const notices: DataNotice[] = [];
  if (open.some((p) => p.lastPrice.status === 'OK' && p.lastPrice.provenance.kind === 'mock')) {
    notices.push({
      id: 'mock',
      tone: 'info',
      title: 'Demóadat',
      message: 'Az árfolyamok és az FX-ráták kitaláltak.',
    });
  }
  if (
    open.some(
      (p) =>
        p.lastPrice.status === 'OK' &&
        (p.lastPrice.provenance.freshness === 'STALE' ||
          p.lastPrice.provenance.freshness === 'EXPIRED'),
    )
  ) {
    notices.push({
      id: 'stale',
      tone: 'warning',
      title: 'Elavult árfolyam',
      message: 'Legalább egy pozíció ára nem friss.',
    });
  }
  if (t.marketValue.missing.length > 0 || analysis.validation.issues.length > 0) {
    notices.push({
      id: 'partial',
      tone: 'warning',
      title: 'Részleges adat',
      message:
        t.marketValue.missing.length > 0
          ? `Érték nélküli pozíció(k): ${t.marketValue.missing.join(', ')}. Az összeg részösszeg.`
          : 'A tranzakciónapló hibát tartalmaz (lásd lent).',
    });
  }

  return {
    header: { title: analysis.portfolioName, baseCurrency: analysis.baseCurrency },
    notices,
    summary: {
      marketValue: totalRow(t.marketValue),
      unrealized: totalSigned(t.unrealizedPL),
      totalReturn: totalSigned(t.totalReturn),
      totalReturnPct: signedPercent(t.totalReturnPct.value),
      rows: [
        totalRow(t.costBasis),
        totalRow(t.unrealizedPL, true),
        totalRow(t.priceEffect, true),
        totalRow(t.fxEffect, true),
        totalRow(t.realizedPL, true),
        totalRow(t.dividends),
        totalRow(t.otherFees),
        totalRow(t.totalReturn, true),
        portfolioMetricRow(t.totalReturnPct),
      ],
      positionsText: `${t.openPositions} nyitott · ${t.closedPositions} zárt${t.invalidPositions > 0 ? ` · ${t.invalidPositions} hibás` : ''}`,
    },
    positions: analysis.positions.map(positionViewModel),
    allocation,
    unpriced,
    currencyExposure: { items: currencyItems, note: currencyNote },
    concentration: { rows: concentrationRows, notes: c.notes },
    overlap: { lines: overlapLines, note: overlapNote },
    risk: {
      statusText:
        h.status.status === 'OK'
          ? `Idősor: ${formatDate(h.status.value.start)} – ${formatDate(h.status.value.end)} (${h.observations} megfigyelés)`
          : `Historikus kockázat nem számolható: ${h.status.reason}`,
      rows: [h.cumulativeReturn, h.annualizedReturn, h.volatility, h.maxDrawdown, h.sharpe].map(
        portfolioMetricRow,
      ),
      notes: [...h.limitations, ...h.conventions],
    },
    accounting: {
      description: analysis.accountingMethod.description,
      taxWarning: analysis.accountingMethod.taxWarning,
    },
    validationIssues: analysis.validation.issues.map((i) => `${i.transactionId}: ${i.message}`),
    warnings: analysis.warnings,
    fxRates: analysis.fxRatesUsed.map(
      (r) =>
        `1 ${r.currency} = ${formatNumber(r.rate, 4)} ${analysis.baseCurrency} (${formatDate(r.asOf)}, ${r.source === 'transaction' ? 'ügyleti ráta' : r.provenance.sourceName})`,
    ),
    disclaimer: analysis.disclaimer,
  };
}

/** A koncentráció számított mutató: a provenance a motoré (`calculated`). */
function largestProvenance(analysis: PortfolioAnalysis) {
  return {
    sourceId: 'engine',
    sourceName: 'Saját számítás (portfólió-motor)',
    kind: 'calculated' as const,
    fetchedAt: analysis.generatedAt,
    asOf: analysis.generatedAt,
    freshness: 'FRESH' as const,
  };
}
