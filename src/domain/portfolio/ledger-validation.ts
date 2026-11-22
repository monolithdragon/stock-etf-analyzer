/**
 * Tranzakciónapló-validáció (PHASE 09 feladat 9., DATA_DICTIONARY 7.2, D-072).
 *
 * Az egyedi tranzakciót a `createTransaction` validálja; itt a NAPLÓ-szintű szabályok jönnek,
 * amelyekhez a többi tranzakció is kell (túladás, duplikátum, ellentmondó deviza), valamint egy
 * futásidejű újraellenőrzés a tárolóból érkező adatra (a tároló megkerülheti a konstruktort).
 *
 * Súlyosság:
 * - `error`: az érintett jegyzés pozíciója NEM számolható (a mutatói `INVALID_INPUT`); a
 *   `DUPLICATE_ID` és a `PORTFOLIO_MISMATCH` az egész naplót érvényteleníti (`blocking`).
 * - `warning`: számolunk, de a felhasználónak ellenőriznie kell (pl. lehetséges duplikátum).
 *
 * Sorrend: dátum szerint, azon belül a rögzítés (tárolási) sorrendje – stabil rendezés.
 */
import { toMajor } from '../fx/fx-conversion';
import {
  parseCurrencyCode,
  type CurrencyCode,
  type ListingId,
  type TransactionId,
} from '../shared';
import type { Portfolio, Transaction } from './portfolio';

export const LEDGER_ISSUE_CODES = [
  'DUPLICATE_ID',
  'PORTFOLIO_MISMATCH',
  'INVALID_VALUE',
  'MISSING_CURRENCY',
  'CURRENCY_CONFLICT',
  'FX_RATE_MISMATCH',
  'OVERSELL',
  'POSSIBLE_DUPLICATE',
  'SPLIT_WITHOUT_POSITION',
  'DIVIDEND_WITHOUT_POSITION',
] as const;
export type LedgerIssueCode = (typeof LEDGER_ISSUE_CODES)[number];

export interface LedgerIssue {
  readonly code: LedgerIssueCode;
  readonly severity: 'error' | 'warning';
  readonly transactionId: TransactionId;
  readonly listingId: ListingId;
  readonly message: string;
}

export interface LedgerValidation {
  readonly issues: readonly LedgerIssue[];
  /** Az egész napló érvénytelen (azonosító-ütközés, idegen portfólió). */
  readonly blocking: boolean;
  /** Jegyzések, amelyeknek a pozíciója hiba miatt nem számolható. */
  readonly invalidListings: ReadonlySet<ListingId>;
}

/** Ennyi relatív tűréssel számít egy eladás még nem túladásnak (lebegőpontos maradék). */
const QUANTITY_TOLERANCE = 1e-9;

/** Stabil időrend: dátum, azon belül a rögzítési sorrend. */
export function orderTransactions(transactions: readonly Transaction[]): readonly Transaction[] {
  return transactions
    .map((transaction, index) => ({ transaction, index }))
    .sort(
      (a, b) => a.transaction.tradeDate.localeCompare(b.transaction.tradeDate) || a.index - b.index,
    )
    .map(({ transaction }) => transaction);
}

function isPositiveFinite(value: unknown): boolean {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function validCurrency(value: unknown): CurrencyCode | null {
  if (typeof value !== 'string') return null;
  const parsed = parseCurrencyCode(value);
  return parsed.ok && parsed.value === value ? parsed.value : null;
}

/** A tranzakció „fő” pénzneme: ár (adásvétel) vagy összeg (osztalék, díj); split: nincs. */
export function transactionCurrency(transaction: Transaction): CurrencyCode | null {
  switch (transaction.type) {
    case 'BUY':
    case 'SELL':
      return validCurrency(transaction.price?.currency);
    case 'DIVIDEND':
    case 'FEE':
      return validCurrency(transaction.amount?.currency);
    case 'SPLIT':
      return null;
  }
}

function valueIssues(transaction: Transaction): string[] {
  const problems: string[] = [];
  switch (transaction.type) {
    case 'BUY':
    case 'SELL':
      if (!isPositiveFinite(transaction.quantity)) problems.push('a mennyiség > 0 kell');
      if (!isPositiveFinite(transaction.price?.amount)) problems.push('az ár > 0 kell');
      if (
        typeof transaction.fees?.amount !== 'number' ||
        !Number.isFinite(transaction.fees.amount) ||
        transaction.fees.amount < 0
      ) {
        problems.push('a díj ≥ 0 kell');
      }
      break;
    case 'DIVIDEND':
    case 'FEE':
      if (!isPositiveFinite(transaction.amount?.amount)) problems.push('az összeg > 0 kell');
      break;
    case 'SPLIT':
      if (!isPositiveFinite(transaction.ratioFrom) || !isPositiveFinite(transaction.ratioTo)) {
        problems.push('a felosztási arány két oldala > 0 kell');
      }
      break;
  }
  return problems;
}

function missingCurrencies(transaction: Transaction): string[] {
  switch (transaction.type) {
    case 'SPLIT':
      return [];
    case 'BUY':
    case 'SELL':
      return [
        ...(validCurrency(transaction.price?.currency) === null ? ['ár'] : []),
        ...(validCurrency(transaction.fees?.currency) === null ? ['díj'] : []),
      ];
    case 'DIVIDEND':
    case 'FEE':
      return validCurrency(transaction.amount?.currency) === null ? ['összeg'] : [];
  }
}

/** Lehetséges duplikátum kulcsa: azonos jegyzés, típus, nap és tartalom. */
function contentKey(transaction: Transaction): string {
  const head = `${transaction.listingId}|${transaction.type}|${transaction.tradeDate}`;
  switch (transaction.type) {
    case 'BUY':
    case 'SELL':
      return `${head}|${transaction.quantity}|${transaction.price.amount}|${transaction.price.currency}`;
    case 'DIVIDEND':
    case 'FEE':
      return `${head}|${transaction.amount.amount}|${transaction.amount.currency}`;
    case 'SPLIT':
      return `${head}|${transaction.ratioFrom}|${transaction.ratioTo}`;
  }
}

export interface LedgerValidationOptions {
  /** Ismert jegyzési pénznemek (pl. az árfolyamból) – az ellentmondó ügyleti deviza kiszűrésére. */
  readonly listingCurrencies?: ReadonlyMap<ListingId, CurrencyCode>;
}

/** A napló validálása. Nem dob; minden problémát `LedgerIssue`-ként ad vissza. */
export function validateTransactionLedger(
  portfolio: Portfolio,
  transactions: readonly Transaction[],
  options: LedgerValidationOptions = {},
): LedgerValidation {
  const issues: LedgerIssue[] = [];
  const add = (
    transaction: Transaction,
    code: LedgerIssueCode,
    severity: LedgerIssue['severity'],
    message: string,
  ) =>
    issues.push({
      code,
      severity,
      transactionId: transaction.id,
      listingId: transaction.listingId,
      message,
    });

  const seenIds = new Set<string>();
  const seenContent = new Map<string, TransactionId>();
  const quantities = new Map<ListingId, number>();
  const tradeCurrency = new Map<ListingId, CurrencyCode>();

  for (const transaction of orderTransactions(transactions)) {
    if (seenIds.has(transaction.id)) {
      add(
        transaction,
        'DUPLICATE_ID',
        'error',
        `Ismétlődő tranzakció-azonosító: ${transaction.id}.`,
      );
      continue;
    }
    seenIds.add(transaction.id);
    if (transaction.portfolioId !== portfolio.id) {
      add(
        transaction,
        'PORTFOLIO_MISMATCH',
        'error',
        `A tranzakció másik portfólióhoz tartozik (${transaction.portfolioId}).`,
      );
      continue;
    }
    const problems = valueIssues(transaction);
    if (problems.length > 0) {
      add(transaction, 'INVALID_VALUE', 'error', `Érvénytelen érték: ${problems.join('; ')}.`);
      continue;
    }
    const missing = missingCurrencies(transaction);
    if (missing.length > 0) {
      add(
        transaction,
        'MISSING_CURRENCY',
        'error',
        `Hiányzó vagy érvénytelen pénznem: ${missing.join(', ')}.`,
      );
      continue;
    }

    const key = contentKey(transaction);
    const twin = seenContent.get(key);
    if (twin !== undefined) {
      add(
        transaction,
        'POSSIBLE_DUPLICATE',
        'warning',
        `Lehetséges duplikátum: ugyanaz a nap, jegyzés és tartalom, mint a(z) ${twin} tranzakcióé.`,
      );
    } else {
      seenContent.set(key, transaction.id);
    }

    const currency = transactionCurrency(transaction);
    if (transaction.type === 'BUY' || transaction.type === 'SELL') {
      const major = toMajor(currency as CurrencyCode).major;
      const known = options.listingCurrencies?.get(transaction.listingId);
      const previous = tradeCurrency.get(transaction.listingId);
      if (known !== undefined && toMajor(known).major !== major) {
        add(
          transaction,
          'CURRENCY_CONFLICT',
          'error',
          `Az ügylet pénzneme (${currency}) eltér a jegyzés pénznemétől (${known}).`,
        );
      } else if (previous !== undefined && toMajor(previous).major !== major) {
        add(
          transaction,
          'CURRENCY_CONFLICT',
          'error',
          `Ugyanazon jegyzés ügyletei eltérő pénznemben (${previous} és ${currency}) – egy jegyzésnek egy kereskedési pénzneme van.`,
        );
      } else if (previous === undefined) {
        tradeCurrency.set(transaction.listingId, currency as CurrencyCode);
      }
    }

    const fx = transaction.fxRateToBase;
    if (fx !== null && fx !== undefined && currency !== null) {
      const major = toMajor(currency).major;
      if (fx.base !== major || fx.quote !== portfolio.baseCurrency) {
        add(
          transaction,
          'FX_RATE_MISMATCH',
          'error',
          `A rögzített árfolyam (${fx.base}/${fx.quote}) nem ${major}/${portfolio.baseCurrency} irányú.`,
        );
      } else if (!isPositiveFinite(fx.rate)) {
        add(transaction, 'FX_RATE_MISMATCH', 'error', 'A rögzített árfolyam > 0 kell.');
      }
    }

    const held = quantities.get(transaction.listingId) ?? 0;
    switch (transaction.type) {
      case 'BUY':
        quantities.set(transaction.listingId, held + transaction.quantity);
        break;
      case 'SELL':
        if (transaction.quantity > held + QUANTITY_TOLERANCE * Math.max(1, held)) {
          add(
            transaction,
            'OVERSELL',
            'error',
            `Eladás (${transaction.quantity}) több, mint a(z) ${transaction.tradeDate} napon birtokolt mennyiség (${held}).`,
          );
        } else {
          const rest = held - transaction.quantity;
          quantities.set(transaction.listingId, Math.abs(rest) < QUANTITY_TOLERANCE ? 0 : rest);
        }
        break;
      case 'SPLIT':
        if (held <= 0) {
          add(
            transaction,
            'SPLIT_WITHOUT_POSITION',
            'warning',
            'Split nyitott pozíció nélkül – hatástalan.',
          );
        } else {
          quantities.set(
            transaction.listingId,
            (held * transaction.ratioTo) / transaction.ratioFrom,
          );
        }
        break;
      case 'DIVIDEND':
        if (held <= 0) {
          add(
            transaction,
            'DIVIDEND_WITHOUT_POSITION',
            'warning',
            'Osztalék nyitott pozíció nélkül (lehet jogos: eladás az ex-nap után) – ellenőrizd.',
          );
        }
        break;
      case 'FEE':
        break;
    }
  }

  const blocking = issues.some(
    (issue) => issue.code === 'DUPLICATE_ID' || issue.code === 'PORTFOLIO_MISMATCH',
  );
  const invalidListings = new Set(
    issues.filter((issue) => issue.severity === 'error').map((issue) => issue.listingId),
  );
  return { issues, blocking, invalidListings };
}
