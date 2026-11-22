/**
 * Pozíciók a tranzakciókból (D-012, D-072/1–3): átlagáras könyvelés két nézetben.
 *
 * - NATÍV: az ügyletek pénznemében (pl. GBX); a más pénznemű díj az ügyleti napi FX-szel
 *   kerül át (azonos fő pénznemnél csak egységváltás, pl. GBP → GBX).
 * - BÁZIS: minden esemény az ügyleti napi rátával (rögzített vagy ECB) bázisra váltva, majd
 *   UGYANAZ az átlagáras motor fut rajta (`averageCostLedger`) → bekerülés és realizált P/L az
 *   ügyleti napi FX-szel; a piaci érték a mai rátával → FX-hatás.
 *
 * FX-felbontás (bázisban): nem realizált P/L = árhatás + FX-hatás, ahol
 *   árhatás = natív nem realizált P/L × mai ráta,  FX-hatás = natív bekerülés × mai ráta − bázis bekerülés.
 */
import {
  averageCostLedger,
  QUANTITY_EPSILON,
  type AverageCostLedger,
  type CalcResult,
  type LedgerEvent,
} from '@/calculations';
import {
  metricInvalidInput,
  metricMissing,
  metricNotApplicable,
  metricOk,
  type AppError,
  type CurrencyCode,
  type DataProvenance,
  type IsoTimestamp,
  type LedgerIssue,
  type ListingId,
  type Metric,
  type Money,
  type PortfolioAssetMetadata,
  type Quote,
  type Result,
  type Transaction,
} from '@/domain';

import {
  currentRate,
  majorOf,
  rateForTransaction,
  toBaseAmount,
  toUnitsOf,
  unitDivisor,
  type FxEntry,
  type FxLookup,
} from './fx-lookup';
import type { PositionAnalysis, PositionLedgerRow, UsedFxRate } from './types';
import { appErrorToMetric } from '../shared/app-error-metric';
import { engineProvenance } from '../shared/engine-provenance';

export interface PositionInput {
  readonly listingId: ListingId;
  /** A jegyzés tranzakciói időrendben (`orderTransactions`). */
  readonly transactions: readonly Transaction[];
  readonly issues: readonly LedgerIssue[];
  readonly invalid: boolean;
  /** `null` = nem kértük le (pl. zárt pozíció). */
  readonly quote: Result<Quote, AppError> | null;
  readonly metadata: PortfolioAssetMetadata | null;
  readonly fx: FxLookup;
  readonly fetchedAt: IsoTimestamp;
}

/** A pozíció számított mutatói a súly nélkül (azt az összesítő adja hozzá). */
export type PositionWithoutWeight = Omit<PositionAnalysis, 'weight'>;

const TRANSACTIONS_PROVENANCE_ID = 'user-transactions';

function transactionsProvenance(
  transactions: readonly Transaction[],
  fetchedAt: IsoTimestamp,
): DataProvenance {
  return {
    sourceId: TRANSACTIONS_PROVENANCE_ID,
    sourceName: 'Felhasználói tranzakciónapló',
    kind: 'user_input',
    fetchedAt,
    asOf: transactions.at(-1)?.tradeDate ?? null,
    freshness: 'FRESH',
  };
}

/** Az első nem-OK metrikát adja tovább változatlanul, különben kiszámolja az értéket. */
function combine(
  parts: readonly Metric<number>[],
  fn: (values: readonly number[]) => number,
  provenance: DataProvenance,
): Metric<number> {
  const values: number[] = [];
  for (const part of parts) {
    if (part.status !== 'OK') return part;
    values.push(part.value);
  }
  return metricOk(fn(values), provenance);
}

function asMoney(metric: Metric<number>, currency: CurrencyCode): Metric<Money> {
  return metric.status === 'OK'
    ? metricOk(
        { amount: metric.value, currency },
        { ...metric.provenance, currency, unit: 'money' },
      )
    : metric;
}

function quantityOf(transactions: readonly Transaction[]): number {
  let quantity = 0;
  for (const transaction of transactions) {
    if (transaction.type === 'BUY') quantity += transaction.quantity;
    else if (transaction.type === 'SELL') quantity -= transaction.quantity;
    else if (transaction.type === 'SPLIT') {
      quantity = (quantity * transaction.ratioTo) / transaction.ratioFrom;
    }
    if (Math.abs(quantity) < QUANTITY_EPSILON) quantity = 0;
  }
  return quantity;
}

interface BuiltEvents {
  readonly events: readonly LedgerEvent[];
  /** Az esemény melyik tranzakció-indexből jött. */
  readonly sourceIndex: readonly number[];
  readonly failures: readonly string[];
}

function buildEvents(
  transactions: readonly Transaction[],
  toAmount: (transaction: Transaction, amount: number, currency: CurrencyCode) => number | null,
  describe: string,
): BuiltEvents {
  const events: LedgerEvent[] = [];
  const sourceIndex: number[] = [];
  const failures: string[] = [];
  transactions.forEach((transaction, index) => {
    if (transaction.type === 'SPLIT') {
      events.push({ kind: 'split', factor: transaction.ratioTo / transaction.ratioFrom });
      sourceIndex.push(index);
      return;
    }
    if (transaction.type !== 'BUY' && transaction.type !== 'SELL') return;
    const price = toAmount(transaction, transaction.price.amount, transaction.price.currency);
    const fees = toAmount(transaction, transaction.fees.amount, transaction.fees.currency);
    if (price === null || fees === null) {
      failures.push(
        `${describe}: a(z) ${transaction.id} (${transaction.tradeDate}) nem váltható át.`,
      );
      return;
    }
    events.push({
      kind: transaction.type === 'BUY' ? 'buy' : 'sell',
      quantity: transaction.quantity,
      price,
      fees,
    });
    sourceIndex.push(index);
  });
  return { events, sourceIndex, failures };
}

function invalidPosition(input: PositionInput, nativeCurrency: CurrencyCode | null) {
  const reason = `Hibás tranzakciónapló: ${input.issues
    .filter((issue) => issue.severity === 'error')
    .map((issue) => issue.message)
    .join(' ')}`;
  const bad = <T>() => metricInvalidInput<T>(reason);
  const position: PositionWithoutWeight = {
    listingId: input.listingId,
    metadata: input.metadata,
    status: 'invalid',
    issues: input.issues,
    transactionIds: input.transactions.map((t) => t.id),
    firstTradeDate: input.transactions[0]?.tradeDate ?? null,
    quantity: 0,
    nativeCurrency,
    averageCostNative: bad(),
    costBasisNative: bad(),
    lastPrice: bad(),
    marketValueNative: bad(),
    unrealizedPLNative: bad(),
    unrealizedReturnNative: bad(),
    realizedPLNative: bad(),
    dividendsNative: [],
    costBasisBase: bad(),
    marketValueBase: bad(),
    unrealizedPLBase: bad(),
    priceEffectBase: bad(),
    fxEffectBase: bad(),
    realizedPLBase: bad(),
    dividendsBase: bad(),
    otherFeesBase: bad(),
    grossInvestedBase: bad(),
    totalReturnBase: bad(),
    totalReturnPct: bad(),
    currentFx: null,
    ledger: [],
    notes: [],
  };
  return position;
}

function sumCash(
  transactions: readonly Transaction[],
  type: 'DIVIDEND' | 'FEE',
  fx: FxLookup,
  provenance: DataProvenance,
  label: string,
): Metric<number> {
  let sum = 0;
  const missing: string[] = [];
  for (const transaction of transactions) {
    if (transaction.type !== type) continue;
    const entry = rateForTransaction(fx, transaction, transaction.amount.currency);
    const amount = toBaseAmount(transaction.amount.amount, transaction.amount.currency, entry);
    if (amount === null) missing.push(entry.ok ? transaction.id : entry.reason);
    else sum += amount;
  }
  return missing.length > 0
    ? metricMissing(`${label}: hiányzó árfolyam – ${missing.join(' ')}`)
    : metricOk(sum, provenance);
}

function nativeDividends(transactions: readonly Transaction[]): readonly Money[] {
  const byCurrency = new Map<CurrencyCode, number>();
  for (const transaction of transactions) {
    if (transaction.type !== 'DIVIDEND') continue;
    const { amount, currency } = transaction.amount;
    byCurrency.set(currency, (byCurrency.get(currency) ?? 0) + amount);
  }
  return [...byCurrency.entries()].map(([currency, amount]) => ({ amount, currency }));
}

function usedRate(entry: FxEntry): UsedFxRate | null {
  return entry.ok ? entry.rate : null;
}

export function buildPosition(input: PositionInput): PositionWithoutWeight {
  const { transactions, fx, fetchedAt } = input;
  const firstTrade = transactions.find((t) => t.type === 'BUY' || t.type === 'SELL');
  const nativeCurrency =
    firstTrade !== undefined && (firstTrade.type === 'BUY' || firstTrade.type === 'SELL')
      ? firstTrade.price.currency
      : null;
  if (input.invalid) return invalidPosition(input, nativeCurrency);

  const base = fx.base;
  const quantity = quantityOf(transactions);
  const status: PositionAnalysis['status'] = quantity > 0 ? 'open' : 'closed';
  const notes: string[] = [];
  const txProv = transactionsProvenance(transactions, fetchedAt);
  const provMap = new Map<string, DataProvenance>([['transactions', txProv]]);

  // --- Natív könyvelés -----------------------------------------------------------------------
  const toNative = (transaction: Transaction, amount: number, currency: CurrencyCode) => {
    if (nativeCurrency === null) return null;
    if (majorOf(currency) === majorOf(nativeCurrency)) {
      return toUnitsOf(amount, currency, nativeCurrency);
    }
    const inBase = toBaseAmount(amount, currency, rateForTransaction(fx, transaction, currency));
    const nativeRate = rateForTransaction(fx, transaction, nativeCurrency);
    if (inBase === null || !nativeRate.ok) return null;
    return (inBase / (nativeRate.rate?.rate ?? 1)) * unitDivisor(nativeCurrency);
  };
  const nativeEvents = buildEvents(transactions, toNative, 'Natív könyvelés');
  const nativeLedger =
    nativeEvents.failures.length > 0 || nativeEvents.events.length === 0
      ? null
      : averageCostLedger(nativeEvents.events);

  // --- Bázis könyvelés -----------------------------------------------------------------------
  const toBase = (transaction: Transaction, amount: number, currency: CurrencyCode) =>
    toBaseAmount(amount, currency, rateForTransaction(fx, transaction, currency));
  const baseEvents = buildEvents(transactions, toBase, 'Bázis könyvelés');
  const baseLedger =
    baseEvents.failures.length > 0 || baseEvents.events.length === 0
      ? null
      : averageCostLedger(baseEvents.events);

  // --- Piaci ár és mai FX --------------------------------------------------------------------
  let lastPrice: Metric<Money>;
  let priceNative: Metric<number>;
  if (status === 'closed') {
    lastPrice = metricNotApplicable('Zárt pozíció: nincs szükség árfolyamra.');
    priceNative = metricOk(
      0,
      engineProvenance({ fetchedAt, inputs: [['transactions', txProv]], unit: 'money' }),
    );
  } else if (input.quote === null || !input.quote.ok || nativeCurrency === null) {
    const failure: Metric<never> =
      input.quote === null
        ? metricMissing('Az árfolyam nincs lekérve.')
        : !input.quote.ok
          ? appErrorToMetric(input.quote.error, 'Árfolyam')
          : metricMissing('Nincs adásvételi tranzakció: a pozíció pénzneme ismeretlen.');
    lastPrice = failure;
    priceNative = failure;
  } else {
    const quote = input.quote.value;
    provMap.set('quote', quote.provenance);
    lastPrice = metricOk(quote.price, quote.provenance);
    priceNative =
      majorOf(quote.price.currency) === majorOf(nativeCurrency)
        ? metricOk(
            toUnitsOf(quote.price.amount, quote.price.currency, nativeCurrency),
            quote.provenance,
          )
        : metricInvalidInput(
            `Az árfolyam pénzneme (${quote.price.currency}) eltér az ügyletekétől (${nativeCurrency}).`,
          );
  }
  const fxNow =
    status === 'open' && nativeCurrency !== null ? currentRate(fx, nativeCurrency) : null;
  const fxNowRate = fxNow === null ? null : usedRate(fxNow);
  if (fxNowRate !== null) provMap.set(`fx:${fxNowRate.currency}`, fxNowRate.provenance);
  for (const transaction of transactions) {
    for (const currency of currenciesOf(transaction)) {
      const rate = usedRate(rateForTransaction(fx, transaction, currency));
      if (rate !== null) provMap.set(`fx:${rate.currency}@${rate.asOf}`, rate.provenance);
    }
  }

  const nativeCode = nativeCurrency ?? base;
  const provInputs = [...provMap.entries()];
  const provNative = engineProvenance({
    fetchedAt,
    inputs: provInputs,
    unit: 'money',
    currency: nativeCode,
  });
  const provBase = engineProvenance({
    fetchedAt,
    inputs: provInputs,
    unit: 'money',
    currency: base,
  });
  const provRatio = engineProvenance({ fetchedAt, inputs: provInputs, unit: 'ratio' });

  const fromLedger = (
    ledger: CalcResult<AverageCostLedger> | null,
    events: BuiltEvents,
    pick: (value: AverageCostLedger) => number | null,
    provenance: DataProvenance,
    label: string,
  ): Metric<number> => {
    if (events.failures.length > 0) return metricMissing(events.failures.join(' '));
    if (ledger === null) return metricMissing(`${label}: nincs adásvételi tranzakció.`);
    if (ledger.status !== 'OK') return { status: ledger.status, reason: ledger.reason };
    const value = pick(ledger.value);
    return value === null
      ? metricNotApplicable(`${label}: zárt pozíció.`)
      : metricOk(value, provenance);
  };

  const costBasisNative = fromLedger(
    nativeLedger,
    nativeEvents,
    (l) => l.costBasis,
    provNative,
    'Natív bekerülés',
  );
  const averageCostNative = fromLedger(
    nativeLedger,
    nativeEvents,
    (l) => l.averageCost,
    provNative,
    'Átlagár',
  );
  const realizedNative = fromLedger(
    nativeLedger,
    nativeEvents,
    (l) => l.realizedPL,
    provNative,
    'Realizált P/L',
  );
  const costBasisBase = fromLedger(
    baseLedger,
    baseEvents,
    (l) => l.costBasis,
    provBase,
    'Bázis bekerülés',
  );
  const realizedBase = fromLedger(
    baseLedger,
    baseEvents,
    (l) => l.realizedPL,
    provBase,
    'Realizált P/L',
  );
  const grossInvestedBase = fromLedger(
    baseLedger,
    baseEvents,
    (l) => l.grossInvested,
    provBase,
    'Bruttó befektetés',
  );

  const marketValueNative = combine([priceNative], ([p]) => quantity * (p as number), provNative);
  const unrealizedNative = combine(
    [marketValueNative, costBasisNative],
    ([mv, cb]) => (mv as number) - (cb as number),
    provNative,
  );
  const unrealizedReturnNative =
    status === 'closed'
      ? metricNotApplicable<number>('Zárt pozíció: nincs nem realizált hozam.')
      : costBasisNative.status === 'OK' && costBasisNative.value <= 0
        ? metricNotApplicable<number>('A bekerülési érték 0: a %-os hozam nem értelmezett.')
        : combine(
            [unrealizedNative, costBasisNative],
            ([u, cb]) => (u as number) / (cb as number),
            provRatio,
          );

  const rateNow: Metric<number> =
    status === 'closed'
      ? metricOk(0, provBase)
      : fxNow === null
        ? metricMissing('A pozíció pénzneme ismeretlen.')
        : fxNow.ok
          ? metricOk(fxNow.rate?.rate ?? 1, provBase)
          : metricMissing(fxNow.reason);
  const divisor = unitDivisor(nativeCode);
  const marketValueBase =
    status === 'closed'
      ? metricOk(0, provBase)
      : combine(
          [marketValueNative, rateNow],
          ([mv, r]) => ((mv as number) / divisor) * (r as number),
          provBase,
        );
  const unrealizedBase = combine(
    [marketValueBase, costBasisBase],
    ([mv, cb]) => (mv as number) - (cb as number),
    provBase,
  );
  const priceEffect =
    status === 'closed'
      ? metricOk(0, provBase)
      : combine(
          [unrealizedNative, rateNow],
          ([u, r]) => ((u as number) / divisor) * (r as number),
          provBase,
        );
  const fxEffect =
    status === 'closed'
      ? metricOk(0, provBase)
      : combine(
          [costBasisNative, rateNow, costBasisBase],
          ([cbn, r, cbb]) => ((cbn as number) / divisor) * (r as number) - (cbb as number),
          provBase,
        );
  const dividendsBase = sumCash(transactions, 'DIVIDEND', fx, provBase, 'Osztalék');
  const otherFeesBase = sumCash(transactions, 'FEE', fx, provBase, 'Külön díj');
  const totalReturnBase = combine(
    [unrealizedBase, realizedBase, dividendsBase, otherFeesBase],
    ([u, r, d, f]) => (u as number) + (r as number) + (d as number) - (f as number),
    provBase,
  );
  const totalReturnPct =
    grossInvestedBase.status === 'OK' && grossInvestedBase.value <= 0
      ? metricNotApplicable<number>('Nincs vétel: a %-os összhozam nem értelmezett.')
      : combine(
          [totalReturnBase, grossInvestedBase],
          ([t, g]) => (t as number) / (g as number),
          provRatio,
        );

  if (nativeLedger !== null && nativeLedger.status === 'OK') notes.push(...nativeLedger.notes);
  if (nativeCurrency !== null && unitDivisor(nativeCurrency) !== 1) {
    notes.push(
      `A jegyzés alegységben (${nativeCurrency}) áraz: bázisra váltáskor ÷ ${unitDivisor(nativeCurrency)}.`,
    );
  }

  return {
    listingId: input.listingId,
    metadata: input.metadata,
    status,
    issues: input.issues,
    transactionIds: transactions.map((t) => t.id),
    firstTradeDate: transactions[0]?.tradeDate ?? null,
    quantity,
    nativeCurrency,
    averageCostNative: asMoney(averageCostNative, nativeCode),
    costBasisNative: asMoney(costBasisNative, nativeCode),
    lastPrice,
    marketValueNative: asMoney(marketValueNative, nativeCode),
    unrealizedPLNative: asMoney(unrealizedNative, nativeCode),
    unrealizedReturnNative,
    realizedPLNative: asMoney(realizedNative, nativeCode),
    dividendsNative: nativeDividends(transactions),
    costBasisBase: asMoney(costBasisBase, base),
    marketValueBase: asMoney(marketValueBase, base),
    unrealizedPLBase: asMoney(unrealizedBase, base),
    priceEffectBase: asMoney(priceEffect, base),
    fxEffectBase: asMoney(fxEffect, base),
    realizedPLBase: asMoney(realizedBase, base),
    dividendsBase: asMoney(dividendsBase, base),
    otherFeesBase: asMoney(otherFeesBase, base),
    grossInvestedBase: asMoney(grossInvestedBase, base),
    totalReturnBase: asMoney(totalReturnBase, base),
    totalReturnPct,
    currentFx: fxNowRate,
    ledger: ledgerRows(input, nativeLedger, nativeEvents),
    notes,
  };
}

function currenciesOf(transaction: Transaction): readonly CurrencyCode[] {
  switch (transaction.type) {
    case 'BUY':
    case 'SELL':
      return [transaction.price.currency, transaction.fees.currency];
    case 'DIVIDEND':
    case 'FEE':
      return [transaction.amount.currency];
    case 'SPLIT':
      return [];
  }
}

function ledgerRows(
  input: PositionInput,
  nativeLedger: CalcResult<AverageCostLedger> | null,
  nativeEvents: BuiltEvents,
): readonly PositionLedgerRow[] {
  const steps =
    nativeLedger !== null && nativeLedger.status === 'OK' ? nativeLedger.value.steps : null;
  const stepByTx = new Map<number, number>();
  nativeEvents.sourceIndex.forEach((txIndex, eventIndex) => stepByTx.set(txIndex, eventIndex));
  let quantity = 0;
  let costBasis: number | null = steps === null ? null : 0;
  let averageCost: number | null = null;
  return input.transactions.map((transaction, index) => {
    if (transaction.type === 'BUY') quantity += transaction.quantity;
    else if (transaction.type === 'SELL') quantity -= transaction.quantity;
    else if (transaction.type === 'SPLIT') {
      quantity = (quantity * transaction.ratioTo) / transaction.ratioFrom;
    }
    if (Math.abs(quantity) < QUANTITY_EPSILON) quantity = 0;
    const stepIndex = stepByTx.get(index);
    const step = steps !== null && stepIndex !== undefined ? steps[stepIndex] : undefined;
    let realized: number | null = steps === null ? null : 0;
    if (step !== undefined) {
      costBasis = step.costBasis;
      averageCost = step.averageCost;
      realized = step.realizedDelta;
    }
    const mainCurrency = currenciesOf(transaction)[0];
    const rate =
      mainCurrency === undefined
        ? null
        : usedRate(rateForTransaction(input.fx, transaction, mainCurrency));
    return {
      transactionId: transaction.id,
      type: transaction.type,
      tradeDate: transaction.tradeDate,
      quantityAfter: quantity,
      costBasisNativeAfter: costBasis,
      averageCostNativeAfter: steps === null ? null : averageCost,
      realizedNativeDelta: realized,
      fxRate: rate,
    };
  });
}
