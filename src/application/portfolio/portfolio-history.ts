/**
 * Historikus portfólióhozam és kockázat (PHASE 09 feladat 6–7., D-072/4).
 *
 * Módszer: a napi portfólióértéket a TÉNYLEGES (tranzakciókból visszaépített) mennyiségekből,
 * a jegyzések ártörténetéből és a napi FX-ből számoljuk – SOHA nem a mai súlyokból visszafelé.
 * A hozam időarányos (TWR, `timeWeightedReturn`): a vétel/eladás nem hozam, az osztalék igen.
 *
 * Konvenciók:
 * - Ár: split-korrigált (`SPLIT`) záróár, a mennyiség ugyanígy split-korrigálva (× a későbbi
 *   splitek szorzója); nyers (`NONE`) sornál nyers mennyiség. Osztalék-korrigált sor TILOS
 *   (az osztalék kétszer számolódna).
 * - Naptár: a jegyzések kereskedési napjainak UNIÓJA; ünnepnapon az utolsó ár/ráta érvényes
 *   legfeljebb `MAX_FORWARD_FILL_DAYS` naptári napig.
 * - Ha az ártörténet nem fedi a portfólió elejét (free EODHD: 1 év), az ablak később indul –
 *   ezt a `limitations` kimondja.
 * - Kockázat: a meglévő `risk.ts` / `drawdown.ts` függvényei (√252, minta szórás, D-066),
 *   minimum 126 napi hozam, megbízhatósági címke (D-070).
 */
import {
  alignByDate,
  annualizeReturn,
  annualizedVolatility,
  beta,
  chainCalc,
  downsideDeviation,
  maxDrawdown,
  periodicReturns,
  riskReliability,
  sharpeRatio,
  sortinoRatio,
  timeWeightedReturn,
  TRADING_DAYS_PER_YEAR,
  yearsBetween,
  type CalcResult,
  type PortfolioDayValue,
} from '@/calculations';
import {
  metricInsufficientData,
  metricInvalidInput,
  metricMissing,
  metricNotApplicable,
  metricOk,
  toEpochMs,
  transactionCurrency,
  type AppError,
  type CurrencyCode,
  type DataProvenance,
  type IsoDate,
  type IsoTimestamp,
  type ListingId,
  type Metric,
  type PriceSeries,
  type Result,
  type Transaction,
} from '@/domain';

import { majorOf, unitDivisor } from './fx-lookup';
import { failedMetric, metricFromCalc, type PortfolioMetricSpec } from './portfolio-metric';
import type { CorrelationPair, PortfolioHistoryAnalysis } from './types';
import { appErrorToMetric } from '../shared/app-error-metric';
import { engineProvenance } from '../shared/engine-provenance';

/** Ennyi naptári napig érvényes az utolsó ár/ráta (hétvége + hosszú ünnep). */
export const MAX_FORWARD_FILL_DAYS = 7;
/** A korrelációs mátrix legfeljebb ennyi (a legnagyobb súlyú) pozícióra készül. */
export const MAX_CORRELATION_POSITIONS = 10;
const DAY_MS = 86_400_000;

export interface FxDailyPoint {
  readonly date: IsoDate;
  readonly rate: number;
}

export interface HistoryInput {
  readonly enabled: boolean;
  readonly from: IsoDate | null;
  readonly base: CurrencyCode;
  /** Az összes tranzakció időrendben. */
  readonly transactions: readonly Transaction[];
  readonly invalidListings: ReadonlySet<ListingId>;
  readonly priceSeries: ReadonlyMap<ListingId, Result<PriceSeries, AppError>>;
  /** Napi FX fő pénznemenként (1 deviza = rate bázis), dátum szerint növekvő. */
  readonly fxSeries: ReadonlyMap<CurrencyCode, readonly FxDailyPoint[]>;
  /** Nyitott pozíciók súly szerint csökkenő sorrendben (korrelációhoz). */
  readonly openListingsByWeight: readonly ListingId[];
  readonly riskFreeRate: number | null;
  readonly minObservations: number;
  readonly fetchedAt: IsoTimestamp;
}

const SPECS = {
  cumulativeReturn: {
    id: 'cumulativeReturn',
    label: 'Kumulált hozam (TWR)',
    unit: 'ratio',
    formula: 'Π(1 + r_t) − 1, r_t = (V_t − F_t + I_t) / V_{t−1} − 1 (időarányos)',
  },
  annualizedReturn: {
    id: 'annualizedReturn',
    label: 'Évesített hozam (TWR)',
    unit: 'ratio',
    formula: '(1 + kumulált TWR)^(1/évek) − 1, évek = napok / 365,25; csak ≥ 1 éves ablakon',
  },
  volatility: {
    id: 'volatility',
    label: 'Évesített volatilitás',
    unit: 'ratio',
    formula: 'stdev_minta(r_napi) × √252',
  },
  maxDrawdown: {
    id: 'maxDrawdown',
    label: 'Max drawdown',
    unit: 'ratio',
    formula: 'min_t(Index_t / max(Index_0..t) − 1) a TWR-indexen',
  },
  downsideDeviation: {
    id: 'downsideDeviation',
    label: 'Downside deviation',
    unit: 'ratio',
    formula: '√(Σ min(0, r_t − MAR_napi)² / N) × √252; MAR = rf vagy 0',
  },
  sharpe: {
    id: 'sharpe',
    label: 'Sharpe-mutató',
    unit: 'multiple',
    formula: '(évesített TWR − rf) / volatilitás',
  },
  sortino: {
    id: 'sortino',
    label: 'Sortino-mutató',
    unit: 'multiple',
    formula: '(évesített TWR − rf) / downside deviation',
  },
} as const satisfies Record<string, PortfolioMetricSpec>;

const CONVENTIONS: readonly string[] = [
  'Időarányos hozam (TWR): a vétel/eladás napvégi áron értékelt pénzmozgás, nem hozam; az osztalék a kifizetés napján hozam (nincs újrabefektetés, nincs készpénzszámla).',
  'Napi egyszerű hozamok; évesítés √252 (D-066). A naptár a jegyzések kereskedési napjainak uniója, így egy évben 252-nél több megfigyelés is lehet.',
  'Árak: split-korrigált záróár split-korrigált mennyiséggel (osztalék-korrigált sor nem használható, mert az osztalék kétszer számolódna).',
  `Ünnepnapon az utolsó ár és FX-ráta érvényes, legfeljebb ${MAX_FORWARD_FILL_DAYS} naptári napig.`,
  'A Sharpe/Sortino kockázatmentes hozama (rf) felhasználói beállítás; nélküle nem számolunk.',
  'A korreláció a pozíciók NATÍV (helyi pénznemű) napi hozamaiból készül, közös dátumokon.',
];

function emptyAnalysis(
  failure: Metric<never>,
  limitations: readonly string[] = [],
): PortfolioHistoryAnalysis {
  return {
    status: failure,
    observations: 0,
    cumulativeReturn: failedMetric(SPECS.cumulativeReturn, failure),
    annualizedReturn: failedMetric(SPECS.annualizedReturn, failure),
    volatility: failedMetric(SPECS.volatility, failure),
    maxDrawdown: failedMetric(SPECS.maxDrawdown, failure),
    downsideDeviation: failedMetric(SPECS.downsideDeviation, failure),
    sharpe: failedMetric(SPECS.sharpe, failure),
    sortino: failedMetric(SPECS.sortino, failure),
    index: [],
    correlations: [],
    conventions: CONVENTIONS,
    limitations,
  };
}

/** Forward-fill kereső egy dátum szerint növekvő sorra (növekvő lekérdezési dátumokkal). */
function forwardFill(points: readonly { readonly date: IsoDate; readonly value: number }[]) {
  let index = -1;
  return (date: IsoDate): number | null => {
    while (index + 1 < points.length && (points[index + 1] as { date: IsoDate }).date <= date) {
      index += 1;
    }
    const point = points[index];
    if (point === undefined) return null;
    return (toEpochMs(date) - toEpochMs(point.date)) / DAY_MS <= MAX_FORWARD_FILL_DAYS
      ? point.value
      : null;
  };
}

interface ListingTrack {
  readonly listingId: ListingId;
  readonly series: PriceSeries;
  readonly priceAt: (date: IsoDate) => number | null;
  readonly transactions: readonly Transaction[];
  readonly splitAdjusted: boolean;
}

/** A `date` UTÁNI splitek szorzata (split-korrigált ársorhoz igazított mennyiséghez). */
function laterSplitFactor(transactions: readonly Transaction[], date: IsoDate): number {
  let factor = 1;
  for (const t of transactions) {
    if (t.type === 'SPLIT' && t.tradeDate > date) factor *= t.ratioTo / t.ratioFrom;
  }
  return factor;
}

export function buildHistory(input: HistoryInput): PortfolioHistoryAnalysis {
  if (!input.enabled) {
    return emptyAnalysis(
      metricNotApplicable(
        'A historikus elemzést nem kérték (jegyzésenként 1 ártörténet-hívás; `history.enabled`).',
      ),
    );
  }
  const trades = input.transactions.filter((t) => t.type === 'BUY' || t.type === 'SELL');
  const first = input.transactions[0];
  if (first === undefined || trades.length === 0) {
    return emptyAnalysis(metricInsufficientData('Nincs adásvételi tranzakció.'));
  }
  if (input.invalidListings.size > 0) {
    return emptyAnalysis(
      metricInvalidInput(
        `Hibás tranzakciónapló (${[...input.invalidListings].join(', ')}): a historikus érték nem rekonstruálható.`,
      ),
    );
  }

  // --- Ártörténetek és FX-ek ellenőrzése ------------------------------------------------------
  const listings = [...new Set(trades.map((t) => t.listingId))];
  const tracks: ListingTrack[] = [];
  const failures: Metric<never>[] = [];
  const provenances: [string, DataProvenance][] = [];
  const limitations: string[] = [];
  for (const listingId of listings) {
    const result = input.priceSeries.get(listingId);
    if (result === undefined) {
      failures.push(metricMissing(`${listingId}: az ártörténet nincs lekérve.`));
      continue;
    }
    if (!result.ok) {
      failures.push(appErrorToMetric(result.error, `${listingId} ártörténet`));
      continue;
    }
    const series = result.value;
    if (series.adjustment === 'SPLIT_DIVIDEND') {
      failures.push(
        metricInvalidInput(
          `${listingId}: osztalék-korrigált sor nem használható (dupla osztalék).`,
        ),
      );
      continue;
    }
    const listingTx = input.transactions.filter((t) => t.listingId === listingId);
    const nativeTrade = listingTx.find((t) => t.type === 'BUY' || t.type === 'SELL');
    if (
      nativeTrade !== undefined &&
      (nativeTrade.type === 'BUY' || nativeTrade.type === 'SELL') &&
      majorOf(nativeTrade.price.currency) !== majorOf(series.currency)
    ) {
      failures.push(
        metricInvalidInput(
          `${listingId}: az ártörténet pénzneme (${series.currency}) eltér az ügyletekétől.`,
        ),
      );
      continue;
    }
    provenances.push([`prices:${listingId}`, series.provenance]);
    limitations.push(...series.notes.map((note) => `${listingId}: ${note}`));
    if (series.adjustment === 'NONE') {
      limitations.push(
        `${listingId}: nyers (nem split-korrigált) ársor – split körül hamis ugrás lehet.`,
      );
    }
    tracks.push({
      listingId,
      series,
      priceAt: forwardFill(series.points.map((p) => ({ date: p.date, value: p.close }))),
      transactions: listingTx,
      splitAdjusted: series.adjustment === 'SPLIT',
    });
  }
  const firstFailure = failures[0];
  if (firstFailure !== undefined && firstFailure.status !== 'OK') {
    const reason = failures.map((f) => (f.status === 'OK' ? '' : f.reason)).join(' | ');
    return emptyAnalysis({ ...firstFailure, reason }, limitations);
  }

  const baseMajor = majorOf(input.base);
  const neededFx = new Set<CurrencyCode>();
  for (const t of input.transactions) {
    const currency = transactionCurrency(t);
    if (currency !== null && majorOf(currency) !== baseMajor) neededFx.add(majorOf(currency));
  }
  const missingFx = [...neededFx].filter((c) => !input.fxSeries.has(c));
  if (missingFx.length > 0) {
    return emptyAnalysis(
      metricMissing(
        `Nincs napi FX-idősor (${missingFx.map((c) => `${c}→${input.base}`).join(', ')}): többdevizás portfólió historikus értéke nem számolható (KI-77). A mai rátával visszaszámolni félrevezető lenne.`,
      ),
      limitations,
    );
  }
  const fxAt = new Map(
    [...neededFx].map((c) => [
      c,
      forwardFill((input.fxSeries.get(c) ?? []).map((p) => ({ date: p.date, value: p.rate }))),
    ]),
  );
  const rate = (currency: CurrencyCode, date: IsoDate): number | null => {
    const major = majorOf(currency);
    if (major === baseMajor) return 1;
    const lookup = fxAt.get(major);
    return lookup === undefined ? null : lookup(date);
  };

  // --- Napi értéksor -----------------------------------------------------------------------
  const requestedStart =
    input.from !== null && input.from > first.tradeDate ? input.from : first.tradeDate;
  const calendar = [
    ...new Set(
      tracks.flatMap((t) => t.series.points.map((p) => p.date)).filter((d) => d >= requestedStart),
    ),
  ].sort();
  const days: PortfolioDayValue[] = [];
  let lastInvalid = -1;
  const quantities = new Map<ListingId, number>();
  let txIndex = 0;
  const ordered = input.transactions;
  for (const [dayIndex, date] of calendar.entries()) {
    let netFlow = 0;
    let income = 0;
    let valid = true;
    // a nap tranzakciói (a nyitó nap előttieké is: azokból indul a mennyiség)
    while (txIndex < ordered.length && (ordered[txIndex] as Transaction).tradeDate <= date) {
      const t = ordered[txIndex] as Transaction;
      txIndex += 1;
      const track = tracks.find((tr) => tr.listingId === t.listingId);
      const held = quantities.get(t.listingId) ?? 0;
      // A nyitó nap előtti tranzakciókból indul a mennyiség (nem pénzmozgás); később minden
      // feldolgozott tranzakció az adott (vagy az azt követő első kereskedési) nap mozgása.
      const onThisDay = dayIndex > 0;
      if (t.type === 'BUY' || t.type === 'SELL') {
        const signed = t.type === 'BUY' ? t.quantity : -t.quantity;
        quantities.set(t.listingId, held + signed);
        if (onThisDay && track !== undefined) {
          const factor = track.splitAdjusted ? laterSplitFactor(track.transactions, date) : 1;
          const price = track.priceAt(date);
          const fx = rate(track.series.currency, date);
          if (price === null || fx === null) valid = false;
          else netFlow += ((signed * factor * price) / unitDivisor(track.series.currency)) * fx;
        }
      } else if (t.type === 'SPLIT') {
        quantities.set(t.listingId, (held * t.ratioTo) / t.ratioFrom);
      } else if (t.type === 'DIVIDEND' && onThisDay) {
        const fx = rate(t.amount.currency, date);
        if (fx === null) valid = false;
        else income += (t.amount.amount / unitDivisor(t.amount.currency)) * fx;
      }
    }
    let value = 0;
    for (const track of tracks) {
      const quantity = quantities.get(track.listingId) ?? 0;
      if (quantity <= 1e-9) continue;
      const factor = track.splitAdjusted ? laterSplitFactor(track.transactions, date) : 1;
      const price = track.priceAt(date);
      const fx = rate(track.series.currency, date);
      if (price === null || fx === null) {
        valid = false;
        continue;
      }
      value += ((quantity * factor * price) / unitDivisor(track.series.currency)) * fx;
    }
    if (!valid) lastInvalid = dayIndex;
    days.push({ date, value, netFlow, income });
  }
  const window = days.slice(lastInvalid + 1);
  const windowStart = window[0];
  if (
    windowStart !== undefined &&
    (toEpochMs(windowStart.date) - toEpochMs(requestedStart)) / DAY_MS > MAX_FORWARD_FILL_DAYS
  ) {
    const reason =
      lastInvalid >= 0
        ? `a(z) ${(days[lastInvalid] as PortfolioDayValue).date} napig nincs teljes ár/FX-adat`
        : 'az ártörténet később kezdődik';
    limitations.push(
      `Az elemzés ${windowStart.date}-tól indul (kért kezdet: ${requestedStart}), mert ${reason}; a korábbi teljesítmény nem ismert, nem becsüljük.`,
    );
  }
  const start = window[0];
  const end = window.at(-1);
  if (start === undefined || end === undefined || window.length < 2) {
    return emptyAnalysis(
      metricInsufficientData('Nincs legalább 2 egymást követő nap teljes ár- és FX-adattal.'),
      limitations,
    );
  }

  // --- TWR és kockázat ---------------------------------------------------------------------
  const twr = timeWeightedReturn(window);
  const provenance = engineProvenance({
    fetchedAt: input.fetchedAt,
    inputs: provenances,
    unit: 'ratio',
  });
  if (twr.status !== 'OK') {
    return emptyAnalysis({ status: twr.status, reason: twr.reason }, limitations);
  }
  const returns = twr.value.returns.map((r) => r.value);
  const observations = returns.length;
  const reliability = riskReliability(observations);
  const enough = observations >= input.minObservations;
  const tooFew: CalcResult<never> = {
    status: 'INSUFFICIENT_DATA',
    reason: `A kockázati mutatókhoz legalább ${input.minObservations} napi hozam kell; csak ${observations} van.`,
  };
  const years = yearsBetween(start.date, end.date);
  const annualized = chainCalc(years, (y) =>
    annualizeReturn({ periodReturn: twr.value.cumulativeReturn, years: y }),
  );
  const annualizedForDisplay: CalcResult<number> =
    years.status === 'OK' && years.value < 1 - MAX_FORWARD_FILL_DAYS / 365.25
      ? {
          status: 'INSUFFICIENT_DATA',
          reason: 'Az évesített hozam csak legalább 1 éves ablakon jelenik meg.',
        }
      : annualized;
  const volatility = enough
    ? annualizedVolatility({
        returns,
        periodsPerYear: TRADING_DAYS_PER_YEAR,
        minObservations: input.minObservations,
      })
    : tooFew;
  const mar = input.riskFreeRate ?? 0;
  const downside = enough
    ? downsideDeviation({
        returns,
        periodsPerYear: TRADING_DAYS_PER_YEAR,
        minimumAcceptableReturn: mar,
        minObservations: input.minObservations,
      })
    : tooFew;
  const drawdown = enough
    ? chainCalc(maxDrawdown(twr.value.index), (d) => ({
        status: 'OK' as const,
        value: d.maxDrawdown,
        notes: [],
      }))
    : tooFew;
  const rfMissing: CalcResult<never> = {
    status: 'MISSING',
    reason: 'Kockázatmentes hozam (rf) nincs megadva – felhasználói beállítás, alapérték nincs.',
  };
  const sharpe =
    input.riskFreeRate === null
      ? rfMissing
      : chainCalc(annualized, (r) =>
          chainCalc(volatility, (v) =>
            sharpeRatio({ annualReturn: r, riskFreeRate: input.riskFreeRate, annualVolatility: v }),
          ),
        );
  const sortino =
    input.riskFreeRate === null
      ? rfMissing
      : chainCalc(annualized, (r) =>
          chainCalc(downside, (d) =>
            sortinoRatio({
              annualReturn: r,
              riskFreeRate: input.riskFreeRate,
              downsideDeviation: d,
            }),
          ),
        );
  const riskNotes: string[] =
    reliability === 'short_window'
      ? [
          'Rövid ablak (< ~1 év napi adat): a mutató zajosabb; a max drawdown nem tartalmaz korábbi válságidőszakot.',
        ]
      : [];
  if (input.riskFreeRate === null) {
    // a downside deviation MAR-ja ekkor 0 – jelezzük
    riskNotes.push('rf nélkül a downside deviation küszöbe 0.');
  }
  const risk = (
    spec: PortfolioMetricSpec,
    calc: CalcResult<number>,
    notes: readonly string[] = riskNotes,
  ) => metricFromCalc(spec, calc, provenance, notes, reliability);

  return {
    status: metricOk({ start: start.date, end: end.date }, provenance),
    observations,
    cumulativeReturn: metricFromCalc(
      SPECS.cumulativeReturn,
      { status: 'OK', value: twr.value.cumulativeReturn, notes: twr.notes },
      provenance,
    ),
    annualizedReturn: metricFromCalc(SPECS.annualizedReturn, annualizedForDisplay, provenance),
    volatility: risk(SPECS.volatility, volatility),
    maxDrawdown: risk(SPECS.maxDrawdown, drawdown),
    downsideDeviation: risk(SPECS.downsideDeviation, downside),
    sharpe: risk(SPECS.sharpe, sharpe),
    sortino: risk(SPECS.sortino, sortino),
    index: twr.value.index.map((p) => ({ date: p.date, value: p.close })),
    correlations: correlations(input, tracks, provenance),
    conventions: CONVENTIONS,
    limitations,
  };
}

function correlations(
  input: HistoryInput,
  tracks: readonly ListingTrack[],
  provenance: DataProvenance,
): readonly CorrelationPair[] {
  const selected = input.openListingsByWeight
    .slice(0, MAX_CORRELATION_POSITIONS)
    .map((id) => tracks.find((t) => t.listingId === id))
    .filter((t): t is ListingTrack => t !== undefined);
  const pairs: CorrelationPair[] = [];
  for (let i = 0; i < selected.length; i += 1) {
    for (let j = i + 1; j < selected.length; j += 1) {
      const a = selected[i] as ListingTrack;
      const b = selected[j] as ListingTrack;
      const aligned = alignByDate(a.series.points, b.series.points);
      const calc = chainCalc(periodicReturns(aligned.first), (ra) =>
        chainCalc(periodicReturns(aligned.second), (rb) =>
          beta({ assetReturns: ra, benchmarkReturns: rb, minObservations: input.minObservations }),
        ),
      );
      pairs.push({
        a: a.listingId,
        b: b.listingId,
        correlation:
          calc.status === 'OK'
            ? metricOk(calc.value.correlation, { ...provenance, unit: 'ratio' })
            : { status: calc.status, reason: calc.reason },
        observations: Math.max(0, aligned.dates.length - 1),
      });
    }
  }
  return pairs;
}
