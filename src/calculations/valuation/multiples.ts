/**
 * Piaci és értékelési mutatók: piaci kapitalizáció, EV, P/E, P/FCF, P/S, P/B, EV/EBITDA, PEG,
 * FCF- és osztalékhozam, biztonsági sáv. DATA_DICTIONARY 5.3, D-056.
 *
 * Szabály (CLAUDE.md): negatív vagy nulla nevezőjű szorzó `NOT_MEANINGFUL`, SOHA nem negatív
 * szorzó. Az árfolyam-alapú mutatóknál az ár és a fundamentum UGYANABBAN a pénznemben kell
 * legyen (ADR: FX-átváltás a hívónál, DATA_DICTIONARY 4.3/8).
 */
import {
  toEpochMs,
  toMajor,
  type CurrencyCode,
  type DividendEvent,
  type IsoDate,
  type Money,
} from '@/domain';

import {
  calcInsufficientData,
  calcInvalidInput,
  calcMissing,
  calcOk,
  chainCalc,
  requireInputs,
  type CalcResult,
  type NumericInput,
} from '../core/calc-result';
import {
  decimalToPercentagePoints,
  firstFailure,
  mustBeNonNegative,
  mustBePositive,
} from '../core/numeric';

const MS_PER_DAY = 86_400_000;

// --- Méret ------------------------------------------------------------------------------------

/**
 * Piaci kapitalizáció = ár × kint lévő részvények száma.
 * Ár ≤ 0 vagy részvényszám ≤ 0 → `INVALID_INPUT`. Ha az ár és a részvényszám dátuma eltér,
 * az eredmény `OK`, de megjegyzés jelzi az eltérést (a részvényszám a címlap napjára szól).
 */
export function marketCap(input: {
  readonly price: NumericInput;
  readonly sharesOutstanding: NumericInput;
  readonly priceAsOf?: IsoDate;
  readonly sharesAsOf?: IsoDate;
}): CalcResult<number> {
  return chainCalc(
    requireInputs({ price: input.price, sharesOutstanding: input.sharesOutstanding }),
    ({ price, sharesOutstanding }) => {
      const bad = firstFailure(
        mustBePositive('price', price),
        mustBePositive('sharesOutstanding', sharesOutstanding),
      );
      if (bad) return bad;
      const notes: string[] = [];
      if (input.priceAsOf && input.sharesAsOf && input.priceAsOf !== input.sharesAsOf) {
        const days = Math.round(
          Math.abs(toEpochMs(input.priceAsOf) - toEpochMs(input.sharesAsOf)) / MS_PER_DAY,
        );
        notes.push(
          `Az ár (${input.priceAsOf}) és a részvényszám (${input.sharesAsOf}) dátuma ${days} nappal eltér.`,
        );
      }
      return calcOk(price * sharesOutstanding, notes);
    },
  );
}

/**
 * Vállalatérték (EV) = piaci kapitalizáció + teljes adósság − pénzeszközök.
 * Egyszerűsítés (D-056): kisebbségi részesedés, elsőbbségi részvény és lízing nélkül.
 * Negatív EV (nagy nettó készpénz) `OK`, de az EV/EBITDA ekkor `NOT_MEANINGFUL`.
 */
export function enterpriseValue(input: {
  readonly marketCap: NumericInput;
  readonly totalDebt: NumericInput;
  readonly cashAndEquivalents: NumericInput;
}): CalcResult<number> {
  return chainCalc(requireInputs(input), ({ marketCap: mc, totalDebt, cashAndEquivalents }) => {
    const bad = firstFailure(
      mustBePositive('marketCap', mc),
      mustBeNonNegative('totalDebt', totalDebt),
      mustBeNonNegative('cashAndEquivalents', cashAndEquivalents),
    );
    return bad ?? calcOk(mc + totalDebt - cashAndEquivalents);
  });
}

// --- Szorzók ----------------------------------------------------------------------------------

/**
 * Közös szorzó: `price / denominator`. A számláló (ár, piaci érték) ≤ 0 → `INVALID_INPUT`;
 * a nevező ≤ 0 → `NOT_MEANINGFUL` (nem adunk negatív szorzót).
 */
function multiple(
  numeratorName: string,
  numerator: NumericInput,
  denominatorName: string,
  denominator: NumericInput,
  denominatorHint: string,
): CalcResult<number> {
  return chainCalc(
    requireInputs({ [numeratorName]: numerator, [denominatorName]: denominator }),
    (values) => {
      const num = values[numeratorName] as number;
      const den = values[denominatorName] as number;
      const bad = firstFailure(
        mustBePositive(numeratorName, num),
        mustBePositive(denominatorName, den, 'NOT_MEANINGFUL', denominatorHint),
      );
      return bad ?? calcOk(num / den);
    },
  );
}

/** P/E = ár / EPS (TTM vagy utolsó FY – a hívó címkézi). EPS ≤ 0 → `NOT_MEANINGFUL`. */
export function priceToEarnings(input: {
  readonly price: NumericInput;
  readonly eps: NumericInput;
}): CalcResult<number> {
  return multiple('price', input.price, 'eps', input.eps, 'Negatív/nulla EPS mellett a P/E N/M.');
}

/** P/FCF = piaci kapitalizáció / FCF. FCF ≤ 0 → `NOT_MEANINGFUL`. */
export function priceToFreeCashFlow(input: {
  readonly marketCap: NumericInput;
  readonly freeCashFlow: NumericInput;
}): CalcResult<number> {
  return multiple(
    'marketCap',
    input.marketCap,
    'freeCashFlow',
    input.freeCashFlow,
    'Negatív/nulla FCF mellett a P/FCF N/M.',
  );
}

/** P/S = piaci kapitalizáció / árbevétel. Árbevétel ≤ 0 → `NOT_MEANINGFUL`. */
export function priceToSales(input: {
  readonly marketCap: NumericInput;
  readonly revenue: NumericInput;
}): CalcResult<number> {
  return multiple('marketCap', input.marketCap, 'revenue', input.revenue, 'Árbevétel nélkül N/M.');
}

/** P/B = piaci kapitalizáció / saját tőke. Saját tőke ≤ 0 → `NOT_MEANINGFUL`. */
export function priceToBook(input: {
  readonly marketCap: NumericInput;
  readonly shareholdersEquity: NumericInput;
}): CalcResult<number> {
  return multiple(
    'marketCap',
    input.marketCap,
    'shareholdersEquity',
    input.shareholdersEquity,
    'Negatív/nulla saját tőke mellett a P/B N/M.',
  );
}

/** EV/EBITDA. EBITDA ≤ 0 → `NOT_MEANINGFUL`; EV ≤ 0 → szintén `NOT_MEANINGFUL` (nem hiba). */
export function evToEbitda(input: {
  readonly enterpriseValue: NumericInput;
  readonly ebitda: NumericInput;
}): CalcResult<number> {
  return chainCalc(requireInputs(input), ({ enterpriseValue: ev, ebitda }) => {
    const bad = firstFailure(
      mustBePositive('ebitda', ebitda, 'NOT_MEANINGFUL', 'Negatív/nulla EBITDA mellett N/M.'),
      mustBePositive(
        'enterpriseValue',
        ev,
        'NOT_MEANINGFUL',
        'Negatív/nulla EV (nagy nettó készpénz) mellett N/M.',
      ),
    );
    return bad ?? calcOk(ev / ebitda);
  });
}

/**
 * PEG = P/E / (EPS-növekedés százalékpontban). Pl. P/E 20, növekedés 0.10 (10%) → 2.0.
 * A növekedés TIZEDES TÖRT bemenet (a ×100-at a képlet végzi).
 * - P/E ≤ 0 → `NOT_MEANINGFUL` (a hívó a nem-OK P/E-t eleve nem adja át);
 * - növekedés ≤ 0 → `NOT_MEANINGFUL`.
 */
export function pegRatio(input: {
  readonly priceToEarnings: NumericInput;
  readonly epsGrowthRate: NumericInput;
}): CalcResult<number> {
  return chainCalc(requireInputs(input), ({ priceToEarnings: pe, epsGrowthRate }) => {
    const bad = firstFailure(
      mustBePositive('priceToEarnings', pe, 'NOT_MEANINGFUL'),
      mustBePositive(
        'epsGrowthRate',
        epsGrowthRate,
        'NOT_MEANINGFUL',
        'Nulla vagy negatív növekedés mellett a PEG N/M.',
      ),
    );
    return bad ?? calcOk(pe / decimalToPercentagePoints(epsGrowthRate));
  });
}

// --- Hozamok ----------------------------------------------------------------------------------

/**
 * FCF-hozam = FCF / piaci kapitalizáció (tört). Negatív FCF → negatív hozam, `OK`
 * (nem szorzó, így nem félrevezető). Piaci kapitalizáció ≤ 0 → `INVALID_INPUT`.
 */
export function fcfYield(input: {
  readonly freeCashFlow: NumericInput;
  readonly marketCap: NumericInput;
}): CalcResult<number> {
  return chainCalc(requireInputs(input), ({ freeCashFlow, marketCap: mc }) => {
    const bad = mustBePositive('marketCap', mc);
    return bad ?? calcOk(freeCashFlow / mc);
  });
}

/**
 * Osztalékhozam = éves (TTM) részvényenkénti osztalék / ár.
 * HIÁNYZÓ osztalékadat → `MISSING` (NEM 0). Explicit 0 osztalék → `OK` 0.
 * Az osztalék és az ár azonos pénznemű kell legyen – lásd `dividendYieldFromMoney`.
 */
export function dividendYield(input: {
  readonly annualDividendPerShare: NumericInput;
  readonly price: NumericInput;
}): CalcResult<number> {
  return chainCalc(requireInputs(input), ({ annualDividendPerShare, price }) => {
    const bad = firstFailure(
      mustBeNonNegative('annualDividendPerShare', annualDividendPerShare),
      mustBePositive('price', price),
    );
    return bad ?? calcOk(annualDividendPerShare / price);
  });
}

function normalizeToMajor(money: Money): Money {
  const { major, divisor } = toMajor(money.currency);
  return divisor === null ? money : { amount: money.amount / divisor, currency: major };
}

/**
 * Osztalékhozam pénznem-egyeztetéssel. A penny-jegyzést (GBX) fő egységre váltja (GBP = GBX/100),
 * így pl. ISF@XLON GBX ár + GBP osztalék helyesen összevethető. Más eltérő pénznem →
 * `INVALID_INPUT` (FX-átváltás kell, azt a hívó végzi a `convertMoney`-val).
 */
export function dividendYieldFromMoney(input: {
  readonly annualDividendPerShare: Money | null;
  readonly price: Money;
}): CalcResult<number> {
  if (input.annualDividendPerShare === null) {
    return calcMissing('Nincs osztalékadat (a hiány nem 0 osztalék).');
  }
  const dividend = normalizeToMajor(input.annualDividendPerShare);
  const price = normalizeToMajor(input.price);
  if (dividend.currency !== price.currency) {
    return calcInvalidInput(
      `Az osztalék (${dividend.currency}) és az ár (${price.currency}) pénzneme eltér – FX-átváltás szükséges.`,
    );
  }
  return dividendYield({ annualDividendPerShare: dividend.amount, price: price.amount });
}

/** A TTM osztalék ablaka: (asOf − 365 nap, asOf]. */
export const TTM_DIVIDEND_WINDOW_DAYS = 365;

/**
 * TTM (utolsó 12 havi) részvényenkénti osztalék az ex-dátumok alapján, fő pénznemben.
 * Az ablak: `(asOf − 365 nap, asOf]`. Eseményenként a split-korrigált összeg az elsődleges
 * (az aktuális árral így azonos részvény-bázison van), hiányában a nyers összeg + megjegyzés.
 *
 * - `coverageStart`: honnan kezdve teljes a lekért osztaléktörténet. Ha később kezdődik, mint
 *   az ablak → `INSUFFICIENT_DATA`. Ha `null` (ismeretlen): esemény nélkül → `MISSING`
 *   (nem tudjuk, hogy 0 vagy hiány), eseménnyel → `OK` + megjegyzés.
 * - Ismert lefedettség és nulla esemény → `OK` 0 a `listingCurrency` fő pénznemében.
 * - Eltérő pénznemű események (GBX/GBP normalizálás után) → `INVALID_INPUT`.
 */
export function trailingDividendPerShare(input: {
  readonly events: readonly DividendEvent[];
  readonly asOf: IsoDate;
  readonly coverageStart: IsoDate | null;
  /** A jegyzés pénzneme – csak a „nulla osztalék” eredmény pénznemét adja (fő egységben). */
  readonly listingCurrency: CurrencyCode;
}): CalcResult<Money> {
  const asOfMs = toEpochMs(input.asOf);
  const windowStartMs = asOfMs - TTM_DIVIDEND_WINDOW_DAYS * MS_PER_DAY;
  if (input.coverageStart !== null && toEpochMs(input.coverageStart) > windowStartMs + MS_PER_DAY) {
    return calcInsufficientData(
      `Az osztaléktörténet csak ${input.coverageStart}-tól teljes; a 12 havi ablakhoz kevés.`,
    );
  }
  const inWindow = input.events.filter((event) => {
    const ms = toEpochMs(event.exDate);
    return ms > windowStartMs && ms <= asOfMs;
  });
  if (inWindow.length === 0) {
    if (input.coverageStart === null) {
      return calcMissing(
        'Nincs osztalékesemény az utolsó 12 hónapban, és a történet lefedettsége ismeretlen.',
      );
    }
    return calcOk({ amount: 0, currency: toMajor(input.listingCurrency).major }, [
      'Az ismert lefedettségű időszakban nem volt osztalékesemény (0, nem hiány).',
    ]);
  }
  const notes: string[] = [];
  let currency: CurrencyCode | null = null;
  let total = 0;
  let usedRaw = 0;
  for (const event of inWindow) {
    const raw = event.splitAdjustedAmount ?? event.amount.amount;
    if (event.splitAdjustedAmount === null) usedRaw += 1;
    const normalized = normalizeToMajor({ amount: raw, currency: event.amount.currency });
    if (currency !== null && normalized.currency !== currency) {
      return calcInvalidInput(
        `Eltérő pénznemű osztalékok az ablakban (${currency} és ${normalized.currency}).`,
      );
    }
    currency = normalized.currency;
    total += normalized.amount;
  }
  if (usedRaw > 0) {
    notes.push(`${usedRaw} eseménynél nincs split-korrigált összeg; a nyers összeg szerepel.`);
  }
  if (input.coverageStart === null) {
    notes.push('A történet lefedettsége ismeretlen; az összeg hiányos lehet.');
  }
  return calcOk({ amount: total, currency: currency as CurrencyCode }, notes);
}

// --- Biztonsági sáv ---------------------------------------------------------------------------

/**
 * Biztonsági sáv (MOS) = (belső érték − ár) / belső érték. Negatív = az ár a belső érték felett.
 * Belső érték ≤ 0 → `INVALID_INPUT`; ár ≤ 0 → `INVALID_INPUT`. A belső érték becslés (PHASE 07).
 */
export function marginOfSafety(input: {
  readonly intrinsicValue: NumericInput;
  readonly price: NumericInput;
}): CalcResult<number> {
  return chainCalc(requireInputs(input), ({ intrinsicValue, price }) => {
    const bad = firstFailure(
      mustBePositive('intrinsicValue', intrinsicValue),
      mustBePositive('price', price),
    );
    return bad ?? calcOk((intrinsicValue - price) / intrinsicValue);
  });
}
