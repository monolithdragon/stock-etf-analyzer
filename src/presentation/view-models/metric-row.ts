/**
 * Mutató → megjeleníthető sor (PHASE 12). Tiszta függvények, React nélkül tesztelhetők.
 *
 * A sor mindig tartalmazza, ami a CLAUDE.md 4. pontja szerint kérésre megtekinthető:
 * forrás, adat típusa (jelentett / számított / becslés / demó), lekérés ideje, adatnap,
 * frissesség, időszak, pénznem, képlet és megjegyzések. A hiány oka soha nem vész el.
 */
import type {
  DataProvenance,
  FiscalPeriod,
  MeasurementUnit,
  Metric,
  MetricOrigin,
  MetricStatus,
} from '@/domain';
import {
  formatDate,
  formatDateTime,
  formatMetric,
  FRESHNESS_LABEL,
  METRIC_STATUS_LABEL,
  ORIGIN_LABEL,
  PROVENANCE_KIND_LABEL,
  type FormattedMetric,
} from '@/presentation/format';

export interface DetailLine {
  readonly label: string;
  readonly value: string;
}

export interface MetricRowModel {
  readonly key: string;
  readonly label: string;
  readonly text: string;
  readonly status: MetricStatus;
  /** Rövid kiegészítő (pl. időszak: „FY2025”, sáv: „magas”). */
  readonly hint: string | null;
  readonly accessibilityLabel: string;
  /** Kinyitható részletek (provenance, képlet, ok). */
  readonly details: readonly DetailLine[];
}

export function periodLabel(period: FiscalPeriod | null | undefined): string | null {
  if (period === null || period === undefined) return null;
  const base =
    period.fiscalPeriod === 'FY'
      ? `FY${period.fiscalYear}`
      : `${period.fiscalYear} ${period.fiscalPeriod}`;
  return `${base} (${formatDate(period.start)} – ${formatDate(period.end)})`;
}

/** Provenance → részletsorok. */
export function provenanceLines(provenance: DataProvenance | undefined): DetailLine[] {
  if (provenance === undefined) return [];
  const lines: DetailLine[] = [
    { label: 'Forrás', value: provenance.sourceName },
    { label: 'Adat típusa', value: PROVENANCE_KIND_LABEL[provenance.kind] },
    { label: 'Lekérve', value: formatDateTime(provenance.fetchedAt) },
    {
      label: 'Adatnap',
      value: provenance.asOf === null ? 'a forrás nem közölte' : formatDateTime(provenance.asOf),
    },
    { label: 'Frissesség', value: FRESHNESS_LABEL[provenance.freshness] },
  ];
  const period = periodLabel(provenance.period);
  if (period !== null) lines.push({ label: 'Időszak', value: period });
  if (provenance.currency !== undefined) {
    lines.push({ label: 'Pénznem', value: provenance.currency });
  }
  if (provenance.reference !== undefined) {
    lines.push({ label: 'Hivatkozás', value: provenance.reference });
  }
  return lines;
}

export interface MetricRowInput {
  readonly key: string;
  readonly label: string;
  readonly value: Metric<number>;
  readonly unit: MeasurementUnit | null;
  readonly origin?: MetricOrigin;
  readonly formula?: string;
  readonly period?: FiscalPeriod | null;
  readonly notes?: readonly string[];
  readonly hint?: string | null;
  /** Pénznem felülírása (ha a provenance nem hordozza). */
  readonly currency?: string | null;
  /** Előre formázott érték (pl. előjeles százalék); különben a mértékegység szerint. */
  readonly formatted?: FormattedMetric;
}

export function buildMetricRow(input: MetricRowInput): MetricRowModel {
  const formatted = input.formatted ?? formatMetric(input.value, input.unit, input.currency);
  const details: DetailLine[] = [
    { label: 'Állapot', value: METRIC_STATUS_LABEL[formatted.status] },
  ];
  if (formatted.reason !== null) details.push({ label: 'Ok', value: formatted.reason });
  if (input.origin !== undefined) {
    details.push({ label: 'Eredet', value: ORIGIN_LABEL[input.origin] });
  }
  const period = periodLabel(input.period);
  const provenance = input.value.provenance;
  if (period !== null && provenance?.period === undefined) {
    details.push({ label: 'Időszak', value: period });
  }
  details.push(...provenanceLines(provenance));
  if (input.formula !== undefined && input.formula !== '') {
    details.push({ label: 'Képlet / definíció', value: input.formula });
  }
  for (const note of input.notes ?? []) details.push({ label: 'Megjegyzés', value: note });

  const hint = input.hint ?? null;
  return {
    key: input.key,
    label: input.label,
    text: formatted.text,
    status: formatted.status,
    hint,
    accessibilityLabel: [input.label, formatted.accessibilityText, hint]
      .filter((part): part is string => part !== null && part !== '')
      .join(', '),
    details,
  };
}

/** Szöveges (nem numerikus) mezők sora, pl. ETF ISIN vagy kategória. */
export function buildTextRow(input: {
  readonly key: string;
  readonly label: string;
  readonly value: Metric<string | boolean>;
  readonly display?: (value: string | boolean) => string;
}): MetricRowModel {
  if (input.value.status === 'OK') {
    const raw = input.value.value;
    const text =
      input.display !== undefined
        ? input.display(raw)
        : typeof raw === 'boolean'
          ? raw
            ? 'igen'
            : 'nem'
          : raw;
    return {
      key: input.key,
      label: input.label,
      text,
      status: 'OK',
      hint: null,
      accessibilityLabel: `${input.label}, ${text}`,
      details: [
        { label: 'Állapot', value: METRIC_STATUS_LABEL.OK },
        ...provenanceLines(input.value.provenance),
      ],
    };
  }
  // Nem-OK ágon nincs érték, így a státusz és az ok változatlanul továbbadható.
  const missing = input.value;
  return buildMetricRow({ key: input.key, label: input.label, value: missing, unit: null });
}
