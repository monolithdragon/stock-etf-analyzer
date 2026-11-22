/**
 * Portfólió, tranzakció és (származtatott) pozíció – DATA_DICTIONARY 7., D-012.
 *
 * Az egyetlen igazságforrás a tranzakciólista; a `Position` számított vetület (PHASE 09).
 */
import type { FxRate } from '../fx/fx-rate';
import {
  createMoney,
  invalid,
  invalidField,
  ok,
  parseIsoDate,
  parseIsoTimestamp,
  parseNullable,
  parsePortfolioId,
  parseTransactionId,
  requireNonEmpty,
  requireNonNegative,
  requirePositive,
  validateFields,
  type CurrencyCode,
  type IsoDate,
  type IsoTimestamp,
  type ListingId,
  type Money,
  type PortfolioId,
  type Result,
  type TransactionId,
} from '../shared';

// ---------------------------------------------------------------------------
// Portfolio
// ---------------------------------------------------------------------------

export interface Portfolio {
  readonly id: PortfolioId;
  readonly name: string;
  /** Kijelzési (bázis) pénznem, pl. HUF vagy EUR. */
  readonly baseCurrency: CurrencyCode;
  readonly createdAt: IsoTimestamp;
}

export interface PortfolioInput {
  readonly id: string;
  readonly name: string;
  readonly baseCurrency: CurrencyCode;
  readonly createdAt: string;
}

export function createPortfolio(input: PortfolioInput): Result<Portfolio> {
  const fields = validateFields(
    {
      id: parsePortfolioId(input.id),
      name: requireNonEmpty(input.name, 80),
      createdAt: parseIsoTimestamp(input.createdAt),
    },
    'Érvénytelen portfólió.',
  );
  if (!fields.ok) return fields;
  return ok({ ...fields.value, baseCurrency: input.baseCurrency });
}

// ---------------------------------------------------------------------------
// Transaction – diszkriminált unió a `type` szerint
// ---------------------------------------------------------------------------

export const TRANSACTION_TYPES = ['BUY', 'SELL', 'DIVIDEND', 'FEE', 'SPLIT'] as const;
export type TransactionType = (typeof TRANSACTION_TYPES)[number];

interface TransactionBase {
  readonly id: TransactionId;
  readonly portfolioId: PortfolioId;
  /** A konkrét tőzsdei jegyzés, ahol a tranzakció történt (D-025). */
  readonly listingId: ListingId;
  readonly tradeDate: IsoDate;
  readonly note: string | null;
  /** Árfolyam a tranzakció napján a portfólió bázispénznemére; `null`, ha nincs rögzítve. */
  readonly fxRateToBase: FxRate | null;
}

export interface TradeTransaction extends TransactionBase {
  readonly type: 'BUY' | 'SELL';
  /** Darabszám (> 0; tört darab megengedett). */
  readonly quantity: number;
  /** Egységár a jegyzés pénznemében (> 0). */
  readonly price: Money;
  /** Díjak (≥ 0); pénzneme eltérhet az árétól (pl. EUR-ban számolt díj USD-s ügyletnél). */
  readonly fees: Money;
}

export interface CashTransaction extends TransactionBase {
  /** DIVIDEND: kapott bruttó osztalék; FEE: külön felszámított díj (pl. számlavezetés). */
  readonly type: 'DIVIDEND' | 'FEE';
  readonly amount: Money;
}

export interface SplitTransaction extends TransactionBase {
  readonly type: 'SPLIT';
  /** Pl. 1 → 4 felosztásnál `ratioFrom = 1`, `ratioTo = 4`. */
  readonly ratioFrom: number;
  readonly ratioTo: number;
}

export type Transaction = TradeTransaction | CashTransaction | SplitTransaction;

interface TransactionBaseInput {
  readonly id: string;
  readonly portfolioId: string;
  readonly listingId: ListingId;
  readonly tradeDate: string;
  readonly note?: string | null;
  readonly fxRateToBase?: FxRate | null;
}

export type TransactionInput =
  | (TransactionBaseInput & {
      readonly type: 'BUY' | 'SELL';
      readonly quantity: number;
      readonly price: number;
      readonly priceCurrency: CurrencyCode;
      readonly fees: number;
      readonly feesCurrency: CurrencyCode;
    })
  | (TransactionBaseInput & {
      readonly type: 'DIVIDEND' | 'FEE';
      readonly amount: number;
      readonly currency: CurrencyCode;
    })
  | (TransactionBaseInput & {
      readonly type: 'SPLIT';
      readonly ratioFrom: number;
      readonly ratioTo: number;
    });

export interface TransactionContext {
  /** A felhasználó „mai” napja (helyi idő): jövőbeli tranzakció nem rögzíthető. */
  readonly today: IsoDate;
}

export const TRANSACTION_NOTE_MAX_LENGTH = 500;

function validateTransactionBase(
  input: TransactionBaseInput,
  context: TransactionContext,
): Result<TransactionBase> {
  const fields = validateFields(
    {
      id: parseTransactionId(input.id),
      portfolioId: parsePortfolioId(input.portfolioId),
      tradeDate: parseIsoDate(input.tradeDate),
      note: parseNullable(input.note, (v) => requireNonEmpty(v, TRANSACTION_NOTE_MAX_LENGTH)),
    },
    'Érvénytelen tranzakció.',
  );
  if (!fields.ok) return fields;
  if (fields.value.tradeDate > context.today) {
    return invalidField(
      'tradeDate',
      `Jövőbeli dátum (${fields.value.tradeDate}) nem rögzíthető.`,
      'Érvénytelen tranzakció.',
    );
  }
  return ok({
    ...fields.value,
    listingId: input.listingId,
    fxRateToBase: input.fxRateToBase ?? null,
  });
}

/**
 * Validált tranzakció létrehozása.
 * Ami itt NEM ellenőrizhető (pozíció kell hozzá): eladás ≤ birtokolt mennyiség → PHASE 09.
 */
export function createTransaction(
  input: TransactionInput,
  context: TransactionContext,
): Result<Transaction> {
  const base = validateTransactionBase(input, context);
  if (!base.ok) return base;

  switch (input.type) {
    case 'BUY':
    case 'SELL': {
      const fields = validateFields(
        {
          quantity: requirePositive(input.quantity),
          price: requirePositive(input.price),
          fees: requireNonNegative(input.fees),
        },
        'Érvénytelen adásvételi tranzakció.',
      );
      if (!fields.ok) return fields;
      const price = createMoney(fields.value.price, input.priceCurrency);
      const fees = createMoney(fields.value.fees, input.feesCurrency);
      if (!price.ok) return price;
      if (!fees.ok) return fees;
      return ok({
        ...base.value,
        type: input.type,
        quantity: fields.value.quantity,
        price: price.value,
        fees: fees.value,
      });
    }
    case 'DIVIDEND':
    case 'FEE': {
      const amount = validateFields(
        { amount: requirePositive(input.amount) },
        'Érvénytelen összeg.',
      );
      if (!amount.ok) return amount;
      const money = createMoney(amount.value.amount, input.currency);
      if (!money.ok) return money;
      return ok({ ...base.value, type: input.type, amount: money.value });
    }
    case 'SPLIT': {
      const ratio = validateFields(
        { ratioFrom: requirePositive(input.ratioFrom), ratioTo: requirePositive(input.ratioTo) },
        'Érvénytelen felosztási arány.',
      );
      if (!ratio.ok) return ratio;
      if (ratio.value.ratioFrom === ratio.value.ratioTo) {
        return invalid('A felosztási arány két oldala nem lehet azonos.');
      }
      return ok({ ...base.value, type: 'SPLIT', ...ratio.value });
    }
  }
}

// ---------------------------------------------------------------------------
// Position – SZÁRMAZTATOTT vetület. PHASE 09 (D-072): NEM domain-entitás, hanem az alkalmazási
// réteg számított kimenete (`PositionAnalysis`, `src/application/portfolio/types.ts`): a
// tranzakciókból átlagár-módszerrel (D-012), két P/L-nézetben (natív és alapdeviza).
// ---------------------------------------------------------------------------
