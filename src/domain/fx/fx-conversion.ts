/**
 * Devizaátváltás (D-017, DATA_DICTIONARY 8.) – tiszta függvények, hálózat és óra nélkül.
 *
 * Definíciók (1 `base` = `rate` `quote`):
 * - közvetlen:  van `from → to` ráta → azt használjuk (`reported` marad);
 * - inverz:     van `to → from` ráta → `1 / rate` (`calculated`);
 * - kereszt:    a pivot (ECB-nél EUR) felől mindkettő megvan →
 *               `from → to = rate(pivot → to) / rate(pivot → from)` (`calculated`).
 *   Példa: HUF → USD = (EUR→USD) / (EUR→HUF) = 1,10 / 400 = 0,00275.
 * - Penny-jegyzés (GBX): explicit `GBP = GBX / 100` lépés, a konverzió rögzíti (D-018).
 *
 * Amit SOHA nem csinálunk: hiányzó rátát nem becsülünk, nem helyettesítünk régebbivel csendben,
 * és nem kerekítünk (kerekítés csak megjelenítéskor, D-009).
 */
import {
  AppErrors,
  createMoney,
  err,
  invalid,
  ok,
  type CurrencyCode,
  type DataProvenance,
  type IsoDate,
  type IsoTimestamp,
  type Money,
  type Result,
} from '../shared';
import type { FxRate } from './fx-rate';

/** A projekt által kijelzési pénznemként támogatott devizák (PHASE 04 feladat 6.). */
export const DISPLAY_CURRENCIES = ['HUF', 'EUR', 'USD', 'GBP', 'CHF', 'JPY'] as const;
export type DisplayCurrency = (typeof DISPLAY_CURRENCIES)[number];

/** Nem szabványos „alegység” jegyzési kódok → fő pénznem és osztó. */
export const MINOR_UNIT_CURRENCIES: Readonly<Record<string, { major: string; divisor: number }>> = {
  GBX: { major: 'GBP', divisor: 100 },
};

/** Egy lekérés rátái: mind ugyanabból a pivot-pénznemből (ECB: EUR). */
export interface FxRateSet {
  readonly base: CurrencyCode;
  readonly rates: readonly FxRate[];
  /** Kért, de a forrásban nem szereplő devizák – ezekre NINCS ráta (nem 0, nem becslés). */
  readonly missing: readonly CurrencyCode[];
}

export function createFxRateSet(input: FxRateSet): Result<FxRateSet> {
  const seen = new Set<string>();
  for (const rate of input.rates) {
    if (rate.base !== input.base) {
      return invalid(`A rátakészlet vegyes bázisú (${input.base} és ${rate.base}).`);
    }
    if (seen.has(rate.quote)) return invalid(`Ismétlődő ráta: ${rate.base}/${rate.quote}.`);
    seen.add(rate.quote);
  }
  return ok(input);
}

export interface FxConversion {
  /** Az eredeti (natív) összeg, változatlanul. */
  readonly original: Money;
  /** Az átváltott (kijelzési) összeg. */
  readonly converted: Money;
  /** Az alkalmazott ráta (fő pénznemek között); `null`, ha nem kellett átváltani. */
  readonly rate: FxRate | null;
  /** Penny-jegyzésnél az osztó (GBX → 100), egyébként `null`. */
  readonly minorUnitDivisor: number | null;
}

/** Fő pénznem és osztó (GBX → GBP, 100); szabványos kódnál maga a kód, osztó nélkül. */
export function toMajor(currency: CurrencyCode): { major: CurrencyCode; divisor: number | null } {
  const minor = MINOR_UNIT_CURRENCIES[currency];
  // A táblázat kódjai érvényes 3 betűs kódok, így a cast biztonságos.
  return minor === undefined
    ? { major: currency, divisor: null }
    : { major: minor.major as CurrencyCode, divisor: minor.divisor };
}

function olderDate(a: IsoDate, b: IsoDate): IsoDate {
  return a <= b ? a : b;
}

function calculatedProvenance(
  inputs: readonly FxRate[],
  asOf: IsoDate,
  fetchedAt: IsoTimestamp,
  formula: string,
): DataProvenance {
  const sources = [...new Set(inputs.map((r) => r.provenance.sourceName))].join(', ');
  const anyMock = inputs.some((r) => r.provenance.kind === 'mock');
  return {
    sourceId: anyMock ? 'mock' : 'engine',
    sourceName: anyMock ? 'Demóadatból számolva' : `Saját számítás (${sources} alapján)`,
    // A demóból számolt érték is demó marad – nem „mosódhat tisztára” számítással.
    kind: anyMock ? 'mock' : 'calculated',
    fetchedAt,
    asOf,
    freshness: 'UNKNOWN',
    reference: formula,
    inputs: inputs.map((r) => `${r.base}/${r.quote}@${r.asOf}`),
  };
}

/**
 * Ráta előállítása `from → to` irányban a készletből (fő pénznemekre).
 * Hiány esetén `MISSING_DATA` hiba, a hiányzó pár megnevezésével.
 */
export function deriveFxRate(
  from: CurrencyCode,
  to: CurrencyCode,
  set: FxRateSet,
  fetchedAt: IsoTimestamp,
): Result<FxRate> {
  if (from === to) return invalid(`Azonos pénznemek között nincs ráta (${from}).`);

  const direct = set.rates.find((r) => r.base === from && r.quote === to);
  if (direct !== undefined) return ok(direct);

  const inverse = set.rates.find((r) => r.base === to && r.quote === from);
  if (inverse !== undefined) {
    return ok({
      base: from,
      quote: to,
      rate: 1 / inverse.rate,
      asOf: inverse.asOf,
      provenance: calculatedProvenance([inverse], inverse.asOf, fetchedAt, `1 / (${to}→${from})`),
    });
  }

  const pivotToFrom = set.rates.find((r) => r.base === set.base && r.quote === from);
  const pivotToTo = set.rates.find((r) => r.base === set.base && r.quote === to);
  if (pivotToFrom !== undefined && pivotToTo !== undefined) {
    const asOf = olderDate(pivotToFrom.asOf, pivotToTo.asOf);
    const formula = `(${set.base}→${to}) / (${set.base}→${from})`;
    return ok({
      base: from,
      quote: to,
      rate: pivotToTo.rate / pivotToFrom.rate,
      asOf,
      provenance: calculatedProvenance([pivotToTo, pivotToFrom], asOf, fetchedAt, formula),
    });
  }

  return err(
    AppErrors.missingData(
      [`fx:${from}/${to}`],
      `Nincs elérhető árfolyam: ${from} → ${to} (a forrás nem közli, becslést nem használunk).`,
    ),
  );
}

/**
 * Összeg átváltása a kijelzési pénznemre. Az eredeti összeg és pénznem megmarad (`original`).
 * A ráta frissességének megítélése NEM itt történik (óra kell hozzá) – lásd az FxService-t.
 */
export function convertMoney(
  money: Money,
  target: CurrencyCode,
  set: FxRateSet,
  fetchedAt: IsoTimestamp,
): Result<FxConversion> {
  const { major: sourceMajor, divisor } = toMajor(money.currency);
  const { major: targetMajor, divisor: targetDivisor } = toMajor(target);
  if (targetDivisor !== null) {
    return invalid(`Alegység (${target}) nem lehet kijelzési pénznem; használd: ${targetMajor}.`);
  }
  const majorAmount = divisor === null ? money.amount : money.amount / divisor;

  if (sourceMajor === targetMajor) {
    const converted = createMoney(majorAmount, targetMajor);
    if (!converted.ok) return converted;
    return ok({
      original: money,
      converted: converted.value,
      rate: null,
      minorUnitDivisor: divisor,
    });
  }

  const rate = deriveFxRate(sourceMajor, targetMajor, set, fetchedAt);
  if (!rate.ok) return rate;
  const converted = createMoney(majorAmount * rate.value.rate, targetMajor);
  if (!converted.ok) return converted;
  return ok({
    original: money,
    converted: converted.value,
    rate: rate.value,
    minorUnitDivisor: divisor,
  });
}
