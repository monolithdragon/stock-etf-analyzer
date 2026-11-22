/**
 * Kitettség, koncentráció és ETF-átfedés (PHASE 09 feladat 4–5. és 8., D-072/5–7).
 *
 * Két külön nézet, soha nem keverve csendben:
 * - `direct`: minden pozíció egy tétel a saját metaadatával. ETF-nél NINCS ország/szektor (a
 *   domicil, pl. IE, nem gazdasági kitettség) → ott csak a look-through ad értéket.
 * - `look_through`: közvetlen részvény (saját metaadat) + ETF-súly × holdings-súly. Ugyanaz a
 *   kulcs (ország, szektor, deviza) a közvetlen és az ETF-en keresztüli részből ÖSSZEADÓDIK –
 *   ez a módszer, és a kimenet `methodNote` mezője kimondja. Holdings nélküli ETF súlya a
 *   „le nem fedett” részbe kerül (nem becsüljük).
 * Az egyedi részvénykitettség ISIN szerint vonja össze a közvetlen és az ETF-en át tartott részt.
 */
import {
  exposureBreakdown,
  holdingsConcentration,
  holdingsOverlap,
  topNWeight,
  type CalcResult,
  type Concentration,
  type ExposureBreakdown,
} from '@/calculations';
import {
  metricInsufficientData,
  metricOk,
  type DataProvenance,
  type EtfHoldingsSnapshot,
  type ListingId,
  type Metric,
} from '@/domain';

import { majorOf } from './fx-lookup';
import { metricFromCalc } from './portfolio-metric';
import type {
  EtfOverlapModel,
  ExposureDimension,
  ExposureGroupWeight,
  ExposureMethod,
  GroupConcentration,
  PortfolioConcentration,
  PortfolioExposure,
  PositionAnalysis,
  SingleNameExposure,
} from './types';
import { engineProvenance } from '../shared/engine-provenance';

export interface WeightedPosition {
  readonly position: PositionAnalysis;
  readonly weight: number;
}

export interface ExposureInput {
  readonly weighted: readonly WeightedPosition[];
  readonly unpriced: readonly ListingId[];
  readonly holdings: ReadonlyMap<ListingId, EtfHoldingsSnapshot>;
  readonly provenance: DataProvenance;
}

type Item = { readonly key: string | null; readonly weight: number };

const DIRECT_NOTE =
  'Közvetlen nézet: minden pozíció egy tétel a saját metaadatával; az ETF-ek ország- és szektorkitettsége itt nem szerepel (a domicil nem kitettség).';
const LOOK_THROUGH_NOTE =
  'Look-through nézet: közvetlen részvény + ETF-súly × holdings-súly; azonos kulcsnál a közvetlen és az ETF-en át tartott rész összeadódik. Holdings nélküli ETF súlya „le nem fedett”.';

const kindOf = (p: PositionAnalysis) => p.metadata?.kind ?? null;

function directKey(dimension: ExposureDimension, p: PositionAnalysis): string | null {
  const meta = p.metadata;
  switch (dimension) {
    case 'instrumentKind':
      return kindOf(p);
    case 'assetClass':
      return meta?.assetClass ?? null;
    case 'tradingCurrency':
    case 'underlyingCurrency':
      return p.nativeCurrency === null ? null : majorOf(p.nativeCurrency);
    case 'country':
      return kindOf(p) === 'stock' ? (meta?.country ?? null) : null;
    case 'sector':
      return kindOf(p) === 'stock' ? (meta?.sector ?? null) : null;
  }
}

function lookThroughItems(
  dimension: 'country' | 'sector' | 'underlyingCurrency',
  input: ExposureInput,
): { items: Item[]; notes: string[]; inputs: [string, DataProvenance][] } {
  const items: Item[] = [];
  const noHoldings: string[] = [];
  const inputs: [string, DataProvenance][] = [];
  let stockCurrencyProxy = false;
  for (const { position, weight } of input.weighted) {
    const kind = kindOf(position);
    if (kind === 'etf') {
      const hedge = position.metadata?.hedgeCurrency ?? null;
      if (dimension === 'underlyingCurrency' && hedge !== null) {
        items.push({ key: majorOf(hedge), weight });
        continue;
      }
      const snapshot = input.holdings.get(position.listingId);
      if (snapshot === undefined) {
        noHoldings.push(position.listingId);
        continue;
      }
      inputs.push([`holdings:${position.listingId}`, snapshot.provenance]);
      for (const holding of snapshot.holdings) {
        const key =
          dimension === 'country'
            ? holding.country
            : dimension === 'sector'
              ? holding.sector
              : holding.currency === null
                ? null
                : majorOf(holding.currency);
        items.push({ key, weight: weight * holding.weight });
      }
    } else {
      if (dimension === 'underlyingCurrency' && kind === 'stock') stockCurrencyProxy = true;
      items.push({ key: directKey(dimension, position), weight });
    }
  }
  const notes: string[] = [];
  if (noHoldings.length > 0) {
    notes.push(`Holdings nélküli ETF (le nem fedett súly): ${noHoldings.join(', ')}.`);
  }
  if (stockCurrencyProxy) {
    notes.push(
      'Részvénynél a mögöttes deviza közelítése a jegyzési deviza (a cég bevételi devizái nem ismertek).',
    );
  }
  return { items, notes, inputs };
}

function toExposure(
  dimension: ExposureDimension,
  method: ExposureMethod,
  calc: CalcResult<ExposureBreakdown>,
  provenance: DataProvenance,
  extraNotes: readonly string[],
): PortfolioExposure {
  const methodNote = method === 'direct' ? DIRECT_NOTE : LOOK_THROUGH_NOTE;
  if (calc.status !== 'OK') {
    return {
      dimension,
      method,
      groups: { status: calc.status, reason: calc.reason },
      unclassifiedWeight: null,
      uncoveredWeight: null,
      methodNote,
      notes: extraNotes,
    };
  }
  return {
    dimension,
    method,
    groups: metricOk(calc.value.groups, { ...provenance, unit: 'ratio' }),
    unclassifiedWeight: calc.value.unclassifiedWeight,
    uncoveredWeight: calc.value.uncoveredWeight,
    methodNote,
    notes: [...calc.notes, ...extraNotes],
  };
}

const DIRECT_DIMENSIONS: readonly ExposureDimension[] = [
  'instrumentKind',
  'assetClass',
  'tradingCurrency',
  'country',
  'sector',
];

export function buildExposures(input: ExposureInput): readonly PortfolioExposure[] {
  const common =
    input.unpriced.length > 0
      ? [
          `Ár/FX nélküli pozíciók kimaradtak (a súlyok csak az árazott részre vonatkoznak): ${input.unpriced.join(', ')}.`,
        ]
      : [];
  const direct = DIRECT_DIMENSIONS.map((dimension) => {
    const items = input.weighted.map(({ position, weight }) => ({
      key: directKey(dimension, position),
      weight,
    }));
    const etfNote =
      (dimension === 'country' || dimension === 'sector') &&
      input.weighted.some((w) => kindOf(w.position) === 'etf')
        ? ['Az ETF-ek súlya itt „besorolatlan”: ország/szektor csak a look-through nézetben.']
        : [];
    return toExposure(
      dimension,
      'direct',
      items.length === 0 ? emptyCalc() : exposureBreakdown(items),
      input.provenance,
      [...etfNote, ...common],
    );
  });
  const lookThrough = (['country', 'sector', 'underlyingCurrency'] as const).map((dimension) => {
    const { items, notes, inputs } = lookThroughItems(dimension, input);
    const provenance = engineProvenance({
      fetchedAt: input.provenance.fetchedAt,
      inputs: [['weights', input.provenance], ...inputs],
      unit: 'ratio',
    });
    return toExposure(
      dimension,
      'look_through',
      items.length === 0 ? emptyCalc() : exposureBreakdown(items),
      provenance,
      [...notes, ...common],
    );
  });
  return [...direct, ...lookThrough];
}

function emptyCalc<T>(): CalcResult<T> {
  return { status: 'INSUFFICIENT_DATA', reason: 'Nincs súlyozható (árazott, nyitott) pozíció.' };
}

// --- Koncentráció --------------------------------------------------------------------------

function groupConcentration(exposure: PortfolioExposure): GroupConcentration {
  const groups = exposure.groups;
  if (groups.status !== 'OK') {
    return { method: exposure.method, largest: groups, top3Weight: groups };
  }
  const first = groups.value[0];
  if (first === undefined) {
    const empty = metricInsufficientData<never>('Nincs besorolt csoport.');
    return { method: exposure.method, largest: empty, top3Weight: empty };
  }
  const top3 = groups.value.slice(0, 3).reduce((sum, g) => sum + g.weight, 0);
  return {
    method: exposure.method,
    largest: metricOk<ExposureGroupWeight>(first, groups.provenance),
    top3Weight: metricOk(top3, groups.provenance),
  };
}

function singleNames(input: ExposureInput): {
  metric: Metric<readonly SingleNameExposure[]>;
  notes: string[];
} {
  if (input.weighted.length === 0) {
    return { metric: metricInsufficientData('Nincs súlyozható pozíció.'), notes: [] };
  }
  const map = new Map<
    string,
    { name: string | null; direct: number; via: number; etfs: Set<ListingId> }
  >();
  const entry = (key: string, name: string | null) => {
    const existing = map.get(key);
    if (existing !== undefined) {
      if (existing.name === null) existing.name = name;
      return existing;
    }
    const created = { name, direct: 0, via: 0, etfs: new Set<ListingId>() };
    map.set(key, created);
    return created;
  };
  let unmatched = 0;
  const etfsWithoutHoldings: string[] = [];
  for (const { position, weight } of input.weighted) {
    const kind = kindOf(position);
    if (kind === 'stock') {
      const key = position.metadata?.isin ?? `listing:${position.listingId}`;
      entry(key, position.metadata?.name ?? null).direct += weight;
    } else if (kind === 'etf') {
      const snapshot = input.holdings.get(position.listingId);
      if (snapshot === undefined) {
        etfsWithoutHoldings.push(position.listingId);
        continue;
      }
      for (const holding of snapshot.holdings) {
        if (holding.weight <= 0) continue;
        if (holding.isin === null) {
          unmatched += weight * holding.weight;
          continue;
        }
        const target = entry(holding.isin, holding.name);
        target.via += weight * holding.weight;
        target.etfs.add(position.listingId);
      }
    }
  }
  const list = [...map.entries()]
    .map(([key, v]) => ({
      key,
      name: v.name,
      directWeight: v.direct,
      viaEtfWeight: v.via,
      totalWeight: v.direct + v.via,
      viaEtfs: [...v.etfs],
    }))
    .sort((a, b) => b.totalWeight - a.totalWeight || a.key.localeCompare(b.key))
    .slice(0, 10);
  const notes: string[] = [];
  if (etfsWithoutHoldings.length > 0) {
    notes.push(
      `ETF holdings nélkül (az ETF-en át tartott rész nem ismert → alsó becslés): ${etfsWithoutHoldings.join(', ')}.`,
    );
  }
  if (unmatched > 0) {
    notes.push(
      `ISIN nélküli holdings-tételek (${(unmatched * 100).toFixed(2)}% súly) nem vonhatók össze.`,
    );
  }
  if (input.weighted.some((w) => kindOf(w.position) === null)) {
    notes.push('Metaadat nélküli pozíció (részvény vagy ETF?) kimaradt az egyedi kitettségből.');
  }
  return {
    metric:
      list.length === 0
        ? metricInsufficientData('Nincs egyedi részvény (közvetlen vagy ISIN-es holdings).')
        : metricOk(list, { ...input.provenance, unit: 'ratio' }),
    notes,
  };
}

export function buildConcentration(
  input: ExposureInput,
  exposures: readonly PortfolioExposure[],
): PortfolioConcentration {
  const weights = input.weighted.map((w) => w.weight);
  const isComplete = input.unpriced.length === 0;
  const notes: string[] = [];
  if (!isComplete) {
    notes.push('Ár nélküli pozíció van: a koncentráció csak az árazott részre vonatkozik.');
  }
  const top = (n: number) =>
    metricFromCalc(
      {
        id: `top${n}Weight`,
        label: `Top ${n} pozíció súlya`,
        unit: 'ratio',
        formula: `a ${n} legnagyobb pozíció súlyának összege`,
      },
      weights.length === 0 ? emptyCalc() : topNWeight({ weights, n, isComplete }),
      input.provenance,
    );
  const hhi: CalcResult<Concentration> =
    weights.length === 0 ? emptyCalc() : holdingsConcentration({ weights, isComplete });
  const largest = [...input.weighted].sort((a, b) => b.weight - a.weight)[0];
  const names = singleNames(input);
  const pick = (dimension: ExposureDimension) =>
    exposures.filter((e) => e.dimension === dimension).map(groupConcentration);
  return {
    largestPosition:
      largest === undefined
        ? metricInsufficientData('Nincs súlyozható pozíció.')
        : metricOk(
            { listingId: largest.position.listingId, weight: largest.weight },
            { ...input.provenance, unit: 'ratio' },
          ),
    top5Weight: top(5),
    top10Weight: top(10),
    herfindahl: metricFromCalc(
      {
        id: 'herfindahl',
        label: 'Herfindahl-index (pozíciók)',
        unit: 'ratio',
        formula: 'Σ wᵢ² a pozíciósúlyokra (1/N … 1)',
      },
      hhi.status === 'OK' ? { ...hhi, value: hhi.value.herfindahl } : hhi,
      input.provenance,
    ),
    effectivePositions: metricFromCalc(
      {
        id: 'effectivePositions',
        label: 'Effektív pozíciószám',
        unit: 'count',
        formula: '1 / HHI',
      },
      hhi.status === 'OK' ? { ...hhi, value: hhi.value.effectiveHoldings } : hhi,
      input.provenance,
    ),
    singleNames: names.metric,
    sector: pick('sector'),
    country: pick('country'),
    notes: [...notes, ...names.notes],
  };
}

// --- ETF-átfedés (adatmodell) --------------------------------------------------------------

export function buildEtfOverlap(
  input: ExposureInput,
  positions: readonly PositionAnalysis[],
): EtfOverlapModel {
  const etfs = positions.filter((p) => p.status === 'open' && kindOf(p) === 'etf');
  const withHoldings = etfs.filter((p) => input.holdings.has(p.listingId));
  const pairs: EtfOverlapModel['pairs'][number][] = [];
  for (let i = 0; i < withHoldings.length; i += 1) {
    for (let j = i + 1; j < withHoldings.length; j += 1) {
      const a = withHoldings[i] as PositionAnalysis;
      const b = withHoldings[j] as PositionAnalysis;
      const sa = input.holdings.get(a.listingId) as EtfHoldingsSnapshot;
      const sb = input.holdings.get(b.listingId) as EtfHoldingsSnapshot;
      const calc = holdingsOverlap({
        a: sa.holdings.map((h) => ({ key: h.isin, weight: h.weight })),
        b: sb.holdings.map((h) => ({ key: h.isin, weight: h.weight })),
        bothComplete: sa.completeness === 'complete' && sb.completeness === 'complete',
      });
      const provenance = engineProvenance({
        fetchedAt: input.provenance.fetchedAt,
        inputs: [
          [`holdings:${a.listingId}`, sa.provenance],
          [`holdings:${b.listingId}`, sb.provenance],
        ],
        unit: 'ratio',
      });
      pairs.push({
        a: a.listingId,
        b: b.listingId,
        holdingsAsOf: { a: sa.asOf, b: sb.asOf },
        overlap:
          calc.status === 'OK'
            ? metricOk({ ...calc.value, common: calc.value.common.slice(0, 10) }, provenance)
            : { status: calc.status, reason: calc.reason },
      });
    }
  }
  return {
    pairs,
    etfsWithoutHoldings: etfs
      .filter((p) => !input.holdings.has(p.listingId))
      .map((p) => p.listingId),
    method:
      'Átfedés = Σ min(w_A, w_B) a közös ISIN-ekre (0 = nincs közös, 1 = azonos); ISIN nélkül nincs párosítás; részleges listán alsó becslés. A teljes összehasonlítás és a képernyő: PHASE 14.',
  };
}
