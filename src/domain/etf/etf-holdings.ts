/**
 * ETF-összetétel (holdings) pillanatkép (PHASE 08, DATA_DICTIONARY 15.3, D-067).
 *
 * Forrásfüggetlen: kézi bevitel (`user_input`), SEC N-PORT (US-regisztrált alapok, negyedéves,
 * ~60 napos késleltetéssel – élő próbával igazolva 2026-11-22) vagy egy fizetős szolgáltató
 * töltheti. A free FMP/EODHD csomag NEM ad holdings-adatot (PLAN_LIMIT).
 *
 * Szabályok:
 * - A súly tizedes tört az alap nettó eszközértékéhez képest (0.05 = 5%); NEM normalizáljuk.
 * - Negatív súly megengedett (short, derivatíva), −1 … 1 között.
 * - Hiányzó ország/szektor/deviza explicit `null` – nem találjuk ki.
 * - Üres lista nem pillanatkép: hiány esetén a `Metric` hordozza az okot.
 */
import { parseCountryCode } from '../instrument/instrument';
import {
  invalid,
  ok,
  parseCurrencyCode,
  parseIsin,
  parseIsoDate,
  parseNullable,
  requireNonEmpty,
  validateFields,
  type CurrencyCode,
  type DataProvenance,
  type IsoDate,
  type Isin,
  type Result,
} from '../shared';

export interface EtfHolding {
  readonly name: string;
  readonly isin: Isin | null;
  /** Tizedes tört a nettó eszközértékhez képest; negatív = short/derivatíva. */
  readonly weight: number;
  /** ISO 3166-1 alpha-2 (a forrás szerinti kockázati ország). */
  readonly country: string | null;
  /** A forrás szektor-besorolása szó szerint (pl. GICS szektor); a N-PORT nem ad ilyet. */
  readonly sector: string | null;
  /** A pozíció devizája (a mögöttes devizakitettséghez). */
  readonly currency: CurrencyCode | null;
}

export type HoldingsCompleteness = 'complete' | 'partial';

export interface EtfHoldingsSnapshot {
  /** A pillanatkép dátuma (N-PORT: a jelentési időszak vége). */
  readonly asOf: IsoDate;
  /** Súly szerint csökkenő sorrendben. */
  readonly holdings: readonly EtfHolding[];
  /** A forrás szerint a teljes összetétel-e (pl. N-PORT: igen; „top 10” kivonat: nem). */
  readonly declaredComplete: boolean;
  /** Az alap teljes pozíciószáma, ha a forrás közli (részleges listánál ez a valós szám). */
  readonly reportedHoldingsCount: number | null;
  /** A felsorolt súlyok összege (negatívakkal együtt). */
  readonly listedWeight: number;
  /** `complete`: a forrás teljesnek mondja ÉS a súlyok összege ≥ 95%. */
  readonly completeness: HoldingsCompleteness;
  readonly notes: readonly string[];
  readonly provenance: DataProvenance;
}

/** Ennyi felsorolt súly alatt a lista akkor is részleges, ha a forrás teljesnek mondja. */
export const HOLDINGS_COMPLETE_MIN_WEIGHT = 0.95;
/**
 * A pozitív súlyok összegének felső határa. Az N-PORT „nettó eszközérték arányában” ad súlyt,
 * ami biztosítéki/kölcsönzési tételekkel 100% fölé mehet; 150% fölött szinte biztos a
 * „százalék a tört helyett” hiba.
 */
export const HOLDINGS_MAX_POSITIVE_WEIGHT = 1.5;
export const HOLDINGS_MAX_COUNT = 20_000;

export interface EtfHoldingInput {
  readonly name: string;
  readonly isin?: string | null;
  readonly weight: number;
  readonly country?: string | null;
  readonly sector?: string | null;
  readonly currency?: string | null;
}

export interface EtfHoldingsSnapshotInput {
  readonly asOf: string;
  readonly holdings: readonly EtfHoldingInput[];
  readonly declaredComplete: boolean;
  readonly reportedHoldingsCount?: number | null;
  readonly provenance: DataProvenance;
}

function blankToNull(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? '';
  return trimmed === '' ? null : trimmed;
}

function parseHolding(input: EtfHoldingInput, index: number): Result<EtfHolding> {
  if (!Number.isFinite(input.weight) || input.weight < -1 || input.weight > 1) {
    return invalid(
      `Érvénytelen súly (#${index}: ${input.weight}); tizedes tört kell −1 és 1 között (0.05 = 5%).`,
    );
  }
  const fields = validateFields(
    {
      name: requireNonEmpty(input.name, 200),
      isin: parseNullable(blankToNull(input.isin), parseIsin),
      country: parseNullable(blankToNull(input.country), parseCountryCode),
      sector: parseNullable(blankToNull(input.sector), (v) => requireNonEmpty(v, 100)),
      currency: parseNullable(blankToNull(input.currency), parseCurrencyCode),
    },
    `Érvénytelen holdings-tétel (#${index}).`,
  );
  if (!fields.ok) return fields;
  return ok({ ...fields.value, weight: input.weight });
}

export function createEtfHoldingsSnapshot(
  input: EtfHoldingsSnapshotInput,
): Result<EtfHoldingsSnapshot> {
  const asOf = parseIsoDate(input.asOf);
  if (!asOf.ok) return invalid(`Érvénytelen holdings-dátum: ${input.asOf}.`);
  if (input.holdings.length === 0) {
    return invalid('Üres holdings-lista: hiányzó összetételt ne pillanatképként add meg.');
  }
  if (input.holdings.length > HOLDINGS_MAX_COUNT) {
    return invalid(`Túl sok holdings-tétel (${input.holdings.length} > ${HOLDINGS_MAX_COUNT}).`);
  }
  const holdings: EtfHolding[] = [];
  for (const [index, raw] of input.holdings.entries()) {
    const holding = parseHolding(raw, index);
    if (!holding.ok) return holding;
    holdings.push(holding.value);
  }
  const positive = holdings.reduce((sum, h) => sum + Math.max(0, h.weight), 0);
  if (positive > HOLDINGS_MAX_POSITIVE_WEIGHT) {
    return invalid(
      `A pozitív súlyok összege ${positive.toFixed(2)} (> ${HOLDINGS_MAX_POSITIVE_WEIGHT}). Tizedes tört kell (0.05 = 5%), nem százalék.`,
    );
  }
  const reported = input.reportedHoldingsCount ?? null;
  if (reported !== null && (!Number.isInteger(reported) || reported < holdings.length)) {
    return invalid(
      `A jelentett pozíciószám (${reported}) egész és legalább a felsorolt tételek száma (${holdings.length}) kell legyen.`,
    );
  }
  const listedWeight = holdings.reduce((sum, h) => sum + h.weight, 0);
  const completeness: HoldingsCompleteness =
    input.declaredComplete && listedWeight >= HOLDINGS_COMPLETE_MIN_WEIGHT ? 'complete' : 'partial';
  const notes: string[] = [];
  if (input.declaredComplete && completeness === 'partial') {
    notes.push(
      `A forrás teljesnek jelölte, de a súlyok összege csak ${(listedWeight * 100).toFixed(1)}% – részlegesként kezelve.`,
    );
  }
  if (!input.declaredComplete) {
    notes.push(
      reported === null
        ? `Részleges lista (${holdings.length} tétel); az alap teljes pozíciószáma ismeretlen.`
        : `Részleges lista: ${holdings.length} tétel a(z) ${reported}-ból.`,
    );
  }
  return ok({
    asOf: asOf.value,
    holdings: [...holdings].sort((a, b) => b.weight - a.weight),
    declaredComplete: input.declaredComplete,
    reportedHoldingsCount: reported,
    listedWeight,
    completeness,
    notes,
    provenance: input.provenance,
  });
}
