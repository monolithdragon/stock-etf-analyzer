/**
 * Azonosítók (D-025): Security (értékpapír) ↔ Listing (tőzsdei jegyzés).
 */
import type { Brand } from './brand';
import { ok, type Result } from './result';
import { invalid, requireNonEmpty } from './validation';

/** ISO 6166 értékpapír-azonosító, ellenőrző számjeggyel validálva (pl. `US0378331005`). */
export type Isin = Brand<string, 'Isin'>;
/** ISO 10383 tőzsdekód, pl. `XNAS`, `XETR`. */
export type Mic = Brand<string, 'Mic'>;
/** Tőzsdei ticker a MI formátumunkban (pl. `AAPL`, `BRK.B`). A szolgáltatói formátum csak az adapterben él. */
export type TickerSymbol = Brand<string, 'TickerSymbol'>;
/** Listing-azonosító: `{symbol}@{MIC}`, pl. `AAPL@XNAS`, `VWCE@XETR`. */
export type ListingId = Brand<string, 'ListingId'>;
/** Security-azonosító: ISIN, ha van; egyébként `forrás:kód` (pl. `sec-edgar:0000320193`). */
export type SecurityId = Brand<string, 'SecurityId'>;
export type PortfolioId = Brand<string, 'PortfolioId'>;
export type TransactionId = Brand<string, 'TransactionId'>;
/** SEC Central Index Key: 10 számjegy, vezető nullákkal (pl. `0000320193`). */
export type Cik = Brand<string, 'Cik'>;

const ISIN_PATTERN = /^[A-Z]{2}[A-Z0-9]{9}\d$/;
const MIC_PATTERN = /^[A-Z0-9]{4}$/;
const SYMBOL_PATTERN = /^[A-Z0-9][A-Z0-9.\-]{0,19}$/;
const SOURCE_SCOPED_ID_PATTERN = /^[a-z0-9-]+:[A-Za-z0-9._-]+$/;
const CIK_PATTERN = /^\d{10}$/;
const LOCAL_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * ISIN ellenőrző számjegy (Luhn-algoritmus a betűk számmá alakítása után: A=10 … Z=35).
 * Az utolsó számjeggyel együtt számolva az összeg 10-zel osztható, ha az ISIN érvényes.
 */
function hasValidIsinCheckDigit(isin: string): boolean {
  const digits = [...isin].map((ch) => parseInt(ch, 36).toString()).join('');
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i -= 1) {
    let n = Number(digits[i]);
    if (double) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
    double = !double;
  }
  return sum % 10 === 0;
}

export function parseIsin(input: string): Result<Isin> {
  const normalized = input.trim().toUpperCase();
  if (!ISIN_PATTERN.test(normalized)) {
    return invalid(`Érvénytelen ISIN-formátum: "${input}" (2 betű + 9 karakter + 1 számjegy).`);
  }
  return hasValidIsinCheckDigit(normalized)
    ? ok(normalized as Isin)
    : invalid(`Hibás ISIN ellenőrző számjegy: "${input}".`);
}

export function parseMic(input: string): Result<Mic> {
  const normalized = input.trim().toUpperCase();
  return MIC_PATTERN.test(normalized)
    ? ok(normalized as Mic)
    : invalid(`Érvénytelen tőzsdekód (MIC): "${input}" (4 karakter, pl. XNAS).`);
}

export function parseTickerSymbol(input: string): Result<TickerSymbol> {
  const normalized = input.trim().toUpperCase();
  return SYMBOL_PATTERN.test(normalized)
    ? ok(normalized as TickerSymbol)
    : invalid(`Érvénytelen ticker: "${input}".`);
}

export function createListingId(symbol: TickerSymbol, mic: Mic): ListingId {
  return `${symbol}@${mic}` as ListingId;
}

export function parseListingId(input: string): Result<ListingId> {
  const parts = input.trim().split('@');
  if (parts.length !== 2) {
    return invalid(
      `Érvénytelen listing-azonosító: "${input}". Formátum: TICKER@MIC, pl. AAPL@XNAS.`,
    );
  }
  const symbol = parseTickerSymbol(parts[0] ?? '');
  const mic = parseMic(parts[1] ?? '');
  if (!symbol.ok) return symbol;
  if (!mic.ok) return mic;
  return ok(createListingId(symbol.value, mic.value));
}

/** A listing-azonosító részei (pl. megjelenítéshez). */
export function splitListingId(id: ListingId): {
  readonly symbol: TickerSymbol;
  readonly mic: Mic;
} {
  const [symbol = '', mic = ''] = id.split('@');
  return { symbol: symbol as TickerSymbol, mic: mic as Mic };
}

/** ISIN vagy `forrás:kód` alakú azonosító. */
export function parseSecurityId(input: string): Result<SecurityId> {
  const trimmed = input.trim();
  const isin = parseIsin(trimmed);
  if (isin.ok) return ok(isin.value as string as SecurityId);
  return SOURCE_SCOPED_ID_PATTERN.test(trimmed)
    ? ok(trimmed as SecurityId)
    : invalid(`Érvénytelen security-azonosító: "${input}". ISIN vagy "forrás:kód" kell.`);
}

export function securityIdFromIsin(isin: Isin): SecurityId {
  return isin as string as SecurityId;
}

export function parseCik(input: string): Result<Cik> {
  const trimmed = input.trim();
  return CIK_PATTERN.test(trimmed)
    ? ok(trimmed as Cik)
    : invalid(`Érvénytelen CIK: "${input}" (10 számjegy, vezető nullákkal).`);
}

function parseLocalId(input: string): Result<string> {
  const nonEmpty = requireNonEmpty(input, 64);
  if (!nonEmpty.ok) return nonEmpty;
  return LOCAL_ID_PATTERN.test(nonEmpty.value)
    ? nonEmpty
    : invalid('Csak betű, szám, "-" és "_" engedélyezett (max. 64 karakter).');
}

export function parsePortfolioId(input: string): Result<PortfolioId> {
  const id = parseLocalId(input);
  return id.ok ? ok(id.value as PortfolioId) : id;
}

export function parseTransactionId(input: string): Result<TransactionId> {
  const id = parseLocalId(input);
  return id.ok ? ok(id.value as TransactionId) : id;
}
