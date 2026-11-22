/**
 * DCF (diszkontált szabad pénzáram) motor – PHASE 07, D-064 (a D-022 és D-057 konvencióira építve).
 *
 * Lépések (DATA_DICTIONARY 5.4):
 *   FCF_t   = FCF_{t−1} × (1 + g_t),            t = 1..n   (FCF_0 = baseFcf)
 *   PV_t    = FCF_t / (1 + r)^t                  (év végi diszkontálás, D-057)
 *   TV      = FCF_n × (1 + g_term) / (r − g_term) (Gordon; csak r > g_term)
 *   PV_TV   = TV / (1 + r)^n
 *   EV_dcf  = Σ PV_t + PV_TV
 *   Equity  = EV_dcf − totalDebt + cash
 *   IV/sh   = Equity / sharesOutstanding
 *   MOS     = (IV/sh − ár) / IV/sh               (csak IV/sh > 0 esetén)
 *
 * A motor tiszta: nincs óra, nincs I/O, nem kerekít. Minden ráta TIZEDES TÖRT (0.09 = 9%).
 * Az eredmény BECSLÉS: érzékeny a feltevésekre, ezért a hívó mindig a feltevésekkel együtt jeleníti meg.
 */
import {
  checkDiscountRate,
  discountFactor,
  gordonTerminalValue,
  presentValue,
} from './dcf-conventions';
import { marginOfSafety } from './multiples';
import {
  calcInvalidInput,
  calcMissing,
  calcNotMeaningful,
  calcOk,
  requireInputs,
  type CalcFailure,
  type CalcResult,
  type NumericInput,
} from '../core/calc-result';
import {
  DECIMAL_HINT,
  firstFailure,
  mustBeAboveMinusOne,
  mustBeNonNegative,
} from '../core/numeric';

/** Az explicit előrejelzési időtáv határai (év). Alapeset: 5 év (D-022, D-064); 3 év támogatott. */
export const DCF_MIN_EXPLICIT_YEARS = 1;
export const DCF_MAX_EXPLICIT_YEARS = 10;
export const DCF_DEFAULT_EXPLICIT_YEARS = 5;

/** Éves növekedési ráta józansági felső határa (1 = +100%/év; fölötte „százalék a tört helyett” gyanú). */
export const DCF_MAX_GROWTH_RATE = 1;

/** Megjegyzés-küszöbök (nem érvénytelenítenek, csak figyelmeztetnek). */
export const DCF_NOTE_THRESHOLDS = {
  /** A terminális növekedés e fölött meghaladja a hosszú távú nominális gazdasági növekedés tipikus szintjét. */
  terminalGrowthAbove: 0.04,
  /** A terminális érték jelenértéke az EV ekkora hányada fölött dominálja az eredményt. */
  terminalValueShareAbove: 0.75,
  /** r − g e szűk különbsége alatt az eredmény különösen érzékeny. */
  spreadBelow: 0.02,
} as const;

/** A forgatókönyvenként változtatható feltevések. */
export interface DcfAssumptions {
  /** Éves FCF-növekedési ráták az explicit évekre (a hossz = az explicit időtáv). */
  readonly growthRates: readonly NumericInput[];
  readonly discountRate: NumericInput;
  readonly terminalGrowth: NumericInput;
}

/** A céghez tartozó (adat-) bemenetek – minden pénzösszeg UGYANABBAN a pénznemben. */
export interface DcfCompanyInputs {
  /** Kiinduló (0. évi) szabad pénzáram. ≤ 0 → a DCF nem értelmezhető (`NOT_MEANINGFUL`). */
  readonly baseFcf: NumericInput;
  /** Teljes adósság. Hiány → `MISSING` (a hiány nem 0; tényleges 0-t explicit kell megadni). */
  readonly totalDebt: NumericInput;
  readonly cash: NumericInput;
  readonly sharesOutstanding: NumericInput;
  /** Piaci ár ugyanabban a pénznemben. Hiánya csak a MOS-t érinti, a DCF ettől lefut. */
  readonly marketPrice?: NumericInput;
}

export type DcfInput = DcfCompanyInputs & DcfAssumptions;

export interface DcfYear {
  /** 1..n */
  readonly year: number;
  readonly growthRate: number;
  readonly fcf: number;
  readonly discountFactor: number;
  readonly presentValue: number;
}

export interface DcfResult {
  readonly years: readonly DcfYear[];
  readonly sumPvExplicit: number;
  /** Az n. év végére vonatkozó terminális érték (Gordon). */
  readonly terminalValue: number;
  readonly pvTerminalValue: number;
  /** PV_TV / EV_dcf – mennyire a terminális érték hordozza az eredményt. */
  readonly terminalValueShare: number;
  readonly enterpriseValue: number;
  readonly equityValue: number;
  readonly intrinsicValuePerShare: number;
  /** Külön eredmény: a DCF lefuthat úgy is, hogy a MOS nem számítható (pl. nincs ár, IV ≤ 0). */
  readonly marginOfSafety: CalcResult<number>;
}

/** Ráta szöveges alakja indokokhoz: `0.09` → `0.09 (9.00%)`. Csak szöveg; a számot nem kerekíti. */
export function describeRate(rate: number): string {
  return `${rate} (${(rate * 100).toFixed(2)}%)`;
}

/** Konstans növekedési pálya: `constantGrowthRates(0.05, 3)` → `[0.05, 0.05, 0.05]`. */
export function constantGrowthRates(rate: number, years: number): number[] {
  return Array.from({ length: Math.max(0, Math.trunc(years)) }, () => rate);
}

/** Emberi magyarázat az `r ≤ g` esetre (a UI ezt mutatja; a szenzitivitási tábla celláiban is). */
export function terminalGrowthNotBelowDiscountRate(
  discountRate: number,
  terminalGrowth: number,
): CalcFailure {
  return calcInvalidInput(
    `A diszkontráta ${describeRate(discountRate)} nem nagyobb a terminális növekedésnél ${describeRate(terminalGrowth)}. ` +
      'A Gordon-modell csak akkor ad véges terminális értéket, ha a pénzáram tartósan lassabban nő, mint amilyen ütemben diszkontálunk. ' +
      'Csökkentsd a terminális növekedést vagy növeld a diszkontrátát.',
  );
}

const isMissing = (value: NumericInput): boolean => value === null || value === undefined;

function checkGrowthRates(growthRates: readonly number[]): CalcFailure | null {
  for (const [index, g] of growthRates.entries()) {
    const name = `growthRates[${index + 1}. év]`;
    const bad = mustBeAboveMinusOne(name, g);
    if (bad) return bad;
    if (g > DCF_MAX_GROWTH_RATE) {
      return calcInvalidInput(
        `${name} = ${g} meghaladja a ${DCF_MAX_GROWTH_RATE} (100%/év) józansági határt. ${DECIMAL_HINT}`,
      );
    }
  }
  return null;
}

/**
 * A bemenetek teljes ellenőrzése a számítás előtt. Sorrend: időtáv → hiány/nem véges →
 * ráták → `r > g` → mérlegtételek → részvényszám → kiinduló FCF.
 */
function validateDcfInput(input: DcfInput): CalcResult<{
  readonly baseFcf: number;
  readonly growthRates: readonly number[];
  readonly discountRate: number;
  readonly terminalGrowth: number;
  readonly totalDebt: number;
  readonly cash: number;
  readonly sharesOutstanding: number;
}> {
  const years = input.growthRates.length;
  if (years < DCF_MIN_EXPLICIT_YEARS || years > DCF_MAX_EXPLICIT_YEARS) {
    return calcInvalidInput(
      `Az explicit előrejelzési időtáv ${years} év; a megengedett tartomány ${DCF_MIN_EXPLICIT_YEARS}–${DCF_MAX_EXPLICIT_YEARS} év (alapeset: ${DCF_DEFAULT_EXPLICIT_YEARS}).`,
    );
  }
  const growthEntries: Record<string, NumericInput> = Object.fromEntries(
    input.growthRates.map((g, i) => [`growthRate_${i + 1}`, g] as const),
  );
  const scalars = requireInputs<string>({
    baseFcf: input.baseFcf,
    discountRate: input.discountRate,
    terminalGrowth: input.terminalGrowth,
    totalDebt: input.totalDebt,
    cash: input.cash,
    sharesOutstanding: input.sharesOutstanding,
    ...growthEntries,
  });
  if (scalars.status !== 'OK') {
    if (scalars.status === 'MISSING' && (isMissing(input.totalDebt) || isMissing(input.cash))) {
      return calcMissing(
        `${scalars.reason} A hiányzó adósság vagy pénzeszköz nem vehető 0-nak; ha valóban 0, add meg explicit módon.`,
      );
    }
    return scalars;
  }
  // A `requireInputs` OK ága garantálja, hogy minden kulcs véges szám.
  const v = scalars.value as Readonly<Record<string, number>>;
  const at = (key: string): number => v[key] as number;
  const growthRates = input.growthRates.map((_, i) => at(`growthRate_${i + 1}`));
  const baseFcf = at('baseFcf');
  const discountRate = at('discountRate');
  const terminalGrowth = at('terminalGrowth');
  const totalDebt = at('totalDebt');
  const cash = at('cash');
  const sharesOutstanding = at('sharesOutstanding');

  const rateFailure = firstFailure(
    checkDiscountRate(discountRate),
    mustBeAboveMinusOne('terminalGrowth', terminalGrowth),
    checkGrowthRates(growthRates),
  );
  if (rateFailure) return rateFailure;
  if (discountRate <= terminalGrowth) {
    return terminalGrowthNotBelowDiscountRate(discountRate, terminalGrowth);
  }
  const balanceFailure = firstFailure(
    mustBeNonNegative('totalDebt', totalDebt),
    mustBeNonNegative('cash', cash),
  );
  if (balanceFailure) return balanceFailure;
  if (sharesOutstanding <= 0) {
    return calcInvalidInput(
      `A részvényszám nem pozitív (${sharesOutstanding}) – a részvényenkénti belső érték nem számítható.`,
    );
  }
  if (baseFcf <= 0) {
    return calcNotMeaningful(
      `A kiinduló szabad pénzáram nem pozitív (${baseFcf}). Növekedési rátát negatív vagy nulla bázisra alkalmazva a DCF félrevezető ` +
        '(a „növekedés” a veszteséget növelné). Ilyenkor a DCF csak felhasználói, normalizált FCF-felülírással futtatható.',
    );
  }
  return calcOk({
    baseFcf,
    growthRates,
    discountRate,
    terminalGrowth,
    totalDebt,
    cash,
    sharesOutstanding,
  });
}

function dcfMarginOfSafety(
  intrinsicValuePerShare: number,
  marketPrice: NumericInput,
): CalcResult<number> {
  if (marketPrice === null || marketPrice === undefined) {
    return calcMissing(
      'Nincs azonos pénznemű piaci ár – a biztonsági sáv nem számítható (a DCF ettől még érvényes).',
    );
  }
  if (!Number.isFinite(marketPrice)) {
    return calcInvalidInput(`Nem véges piaci ár: ${String(marketPrice)}.`);
  }
  if (intrinsicValuePerShare <= 0) {
    return calcNotMeaningful(
      `A belső érték/részvény nem pozitív (${intrinsicValuePerShare}) – a biztonsági sáv (nevezője a belső érték) nem számítható.`,
    );
  }
  return marginOfSafety({ intrinsicValue: intrinsicValuePerShare, price: marketPrice });
}

function unwrap(result: CalcResult<number>): number | CalcFailure {
  return result.status === 'OK' ? result.value : result;
}

/**
 * Teljes DCF egy feltevés-készlettel. Ugyanezt a függvényt hívja minden forgatókönyv és a
 * szenzitivitási tábla minden cellája (DATA_DICTIONARY 5.4).
 *
 * @example
 * runDcf({ baseFcf: 100, growthRates: [0.05, 0.05, 0.05], discountRate: 0.1, terminalGrowth: 0.02,
 *          totalDebt: 50, cash: 20, sharesOutstanding: 10, marketPrice: 120 })
 */
export function runDcf(input: DcfInput): CalcResult<DcfResult> {
  const validated = validateDcfInput(input);
  if (validated.status !== 'OK') return validated;
  const { baseFcf, growthRates, discountRate, terminalGrowth, totalDebt, cash, sharesOutstanding } =
    validated.value;

  const years: DcfYear[] = [];
  let fcf = baseFcf;
  for (const [index, growthRate] of growthRates.entries()) {
    const year = index + 1;
    fcf = fcf * (1 + growthRate);
    const factor = unwrap(discountFactor({ discountRate, period: year }));
    if (typeof factor !== 'number') return factor;
    years.push({ year, growthRate, fcf, discountFactor: factor, presentValue: fcf * factor });
  }
  const n = years.length;
  const terminalValue = unwrap(
    gordonTerminalValue({ finalYearCashFlow: fcf, discountRate, terminalGrowth }),
  );
  if (typeof terminalValue !== 'number') return terminalValue;
  const pvTerminalValue = unwrap(
    presentValue({ cashFlow: terminalValue, discountRate, period: n }),
  );
  if (typeof pvTerminalValue !== 'number') return pvTerminalValue;

  const sumPvExplicit = years.reduce((sum, y) => sum + y.presentValue, 0);
  const enterpriseValue = sumPvExplicit + pvTerminalValue;
  const equityValue = enterpriseValue - totalDebt + cash;
  const intrinsicValuePerShare = equityValue / sharesOutstanding;
  const terminalValueShare = pvTerminalValue / enterpriseValue;

  const notes: string[] = [];
  if (terminalValueShare > DCF_NOTE_THRESHOLDS.terminalValueShareAbove) {
    notes.push(
      `A terminális érték jelenértéke a DCF vállalatérték ${(terminalValueShare * 100).toFixed(1)}%-a – az eredményt főként a hosszú távú feltevések (r, g) határozzák meg.`,
    );
  }
  if (terminalGrowth > DCF_NOTE_THRESHOLDS.terminalGrowthAbove) {
    notes.push(
      `A terminális növekedés ${describeRate(terminalGrowth)} meghaladja a hosszú távú nominális gazdasági növekedés tipikus szintjét (~${DCF_NOTE_THRESHOLDS.terminalGrowthAbove * 100}%) – optimista feltevés.`,
    );
  }
  if (discountRate - terminalGrowth < DCF_NOTE_THRESHOLDS.spreadBelow) {
    notes.push(
      `A diszkontráta és a terminális növekedés különbsége kisebb ${DCF_NOTE_THRESHOLDS.spreadBelow * 100} százalékpontnál – a terminális érték rendkívül érzékeny.`,
    );
  }
  if (equityValue <= 0) {
    notes.push(
      'A DCF vállalatérték nem fedezi a nettó adósságot: a saját tőke értéke nem pozitív, a biztonsági sáv nem számítható.',
    );
  }

  return calcOk(
    {
      years,
      sumPvExplicit,
      terminalValue,
      pvTerminalValue,
      terminalValueShare,
      enterpriseValue,
      equityValue,
      intrinsicValuePerShare,
      marginOfSafety: dcfMarginOfSafety(intrinsicValuePerShare, input.marketPrice),
    },
    notes,
  );
}
