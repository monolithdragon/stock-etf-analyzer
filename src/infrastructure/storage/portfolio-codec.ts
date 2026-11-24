/**
 * Portfólió és tranzakció tárolt alakja + visszaolvasási validáció (PHASE 13).
 *
 * Tárolás: a domain-objektum JSON-ja. Visszaolvasás: zod-alakellenőrzés, majd a DOMAIN
 * konstruktorai (`createPortfolio`, `createTransaction`) – ugyanazok az üzleti szabályok, mint
 * rögzítéskor (pozitív mennyiség/ár, érvényes dátum, azonos oldalú split tiltva …). Nincs
 * duplikált üzleti logika. Sérült rekord → `null` (a repository `STORAGE` hibát ad belőle).
 */
import { z } from 'zod';

import { currencyCodeSchema, fxRateDtoSchema } from '@/contracts';
import {
  createPortfolio,
  createTransaction,
  parseListingId,
  type IsoDate,
  type Portfolio,
  type Transaction,
  type TransactionInput,
} from '@/domain';

const moneySchema = z.object({ amount: z.number(), currency: currencyCodeSchema });

const baseSchema = {
  id: z.string(),
  portfolioId: z.string(),
  listingId: z.string(),
  tradeDate: z.string(),
  note: z.string().nullable(),
  fxRateToBase: fxRateDtoSchema.nullable(),
};

const storedTransactionSchema = z.discriminatedUnion('type', [
  z.object({
    ...baseSchema,
    type: z.enum(['BUY', 'SELL']),
    quantity: z.number(),
    price: moneySchema,
    fees: moneySchema,
  }),
  z.object({ ...baseSchema, type: z.enum(['DIVIDEND', 'FEE']), amount: moneySchema }),
  z.object({ ...baseSchema, type: z.literal('SPLIT'), ratioFrom: z.number(), ratioTo: z.number() }),
]);

const storedPortfolioSchema = z.object({
  id: z.string(),
  name: z.string(),
  baseCurrency: currencyCodeSchema,
  createdAt: z.string(),
});

/**
 * A tárolt tranzakcióknál a „jövőbeli dátum” szabályt nem alkalmazzuk újra (rögzítéskor már
 * ellenőrizve volt; az eszköz órája azóta akár vissza is állhatott).
 */
const READ_CONTEXT = { today: '9999-12-31' as IsoDate };

export function encodeTransaction(transaction: Transaction): string {
  return JSON.stringify(transaction);
}

export function decodeTransaction(json: string): Transaction | null {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return null;
  }
  const parsed = storedTransactionSchema.safeParse(raw);
  if (!parsed.success) return null;
  const t = parsed.data;
  const listingId = parseListingId(t.listingId);
  if (!listingId.ok) return null;
  const base = {
    id: t.id,
    portfolioId: t.portfolioId,
    listingId: listingId.value,
    tradeDate: t.tradeDate,
    note: t.note,
    fxRateToBase: t.fxRateToBase,
  };
  let input: TransactionInput;
  switch (t.type) {
    case 'BUY':
    case 'SELL':
      input = {
        ...base,
        type: t.type,
        quantity: t.quantity,
        price: t.price.amount,
        priceCurrency: t.price.currency,
        fees: t.fees.amount,
        feesCurrency: t.fees.currency,
      };
      break;
    case 'DIVIDEND':
    case 'FEE':
      input = { ...base, type: t.type, amount: t.amount.amount, currency: t.amount.currency };
      break;
    case 'SPLIT':
      input = { ...base, type: 'SPLIT', ratioFrom: t.ratioFrom, ratioTo: t.ratioTo };
      break;
  }
  const created = createTransaction(input, READ_CONTEXT);
  return created.ok ? created.value : null;
}

export function encodePortfolio(portfolio: Portfolio): string {
  return JSON.stringify(portfolio);
}

export function decodePortfolio(json: string): Portfolio | null {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return null;
  }
  const parsed = storedPortfolioSchema.safeParse(raw);
  if (!parsed.success) return null;
  const created = createPortfolio(parsed.data);
  return created.ok ? created.value : null;
}
