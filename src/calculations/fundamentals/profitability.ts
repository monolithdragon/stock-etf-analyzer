/**
 * Jövedelmezőség: bruttó/üzemi/nettó eredmény és marzs, EPS, adókulcs, NOPAT, ROE/ROA/ROIC.
 * Definíciók: DATA_DICTIONARY 5.1 (PHASE 05-ben véglegesítve, D-056).
 *
 * Konvenciók: minden pénzösszeg UGYANABBAN a (beszámolási) pénznemben és egységben érkezik –
 * ezt a hívó (PHASE 06) biztosítja; a `Metric`-adapter a provenance pénznemét ellenőrzi.
 * Kiáramlás/költség pozitív nagyság (DATA_DICTIONARY 1.).
 */
import {
  calcInvalidInput,
  calcMissing,
  calcNotMeaningful,
  calcOk,
  chainCalc,
  requireInputs,
  type CalcResult,
  type NumericInput,
} from '../core/calc-result';
import { firstFailure, mustBeInRange, mustBeNonNegative, mustBePositive } from '../core/numeric';

// --- Eredmény és marzsok ----------------------------------------------------------------------

/**
 * Bruttó eredmény = árbevétel − közvetlen költség (COGS).
 * Ha a forrás jelentett `grossProfit`-ot, azt kell előnyben részesíteni (`preferReported`).
 * Érvénytelen: COGS < 0 (előjel-konvenció sérül) → `INVALID_INPUT`.
 */
export function grossProfit(input: {
  readonly revenue: NumericInput;
  readonly costOfRevenue: NumericInput;
}): CalcResult<number> {
  return chainCalc(requireInputs(input), ({ revenue, costOfRevenue }) => {
    const bad = mustBeNonNegative(
      'costOfRevenue',
      costOfRevenue,
      'A költséget pozitív nagyságként kell megadni.',
    );
    return bad ?? calcOk(revenue - costOfRevenue);
  });
}

/**
 * Üzemi eredmény (saját számítás) = bruttó eredmény − működési költségek (SG&A, K+F, D&A…).
 * Definíció (D-056): US GAAP `OperatingIncomeLoss` értelemben; NEM tartalmazza a kamatot,
 * az adót és a nem működési tételeket – ezért nem azonos a „NI + kamat + adó” EBIT-tel.
 * A jelentett `operatingIncome` mindig elsőbbséget élvez.
 */
export function operatingIncome(input: {
  readonly grossProfit: NumericInput;
  readonly operatingExpenses: NumericInput;
}): CalcResult<number> {
  return chainCalc(requireInputs(input), ({ grossProfit: gp, operatingExpenses }) => {
    const bad = mustBeNonNegative(
      'operatingExpenses',
      operatingExpenses,
      'A költséget pozitív nagyságként kell megadni.',
    );
    return bad ?? calcOk(gp - operatingExpenses);
  });
}

function marginOf(
  numeratorName: string,
  numerator: NumericInput,
  revenue: NumericInput,
): CalcResult<number> {
  return chainCalc(
    requireInputs({ [numeratorName]: numerator, revenue }),
    (values): CalcResult<number> => {
      const rev = values.revenue as number;
      const bad = mustBePositive(
        'revenue',
        rev,
        'NOT_MEANINGFUL',
        'Nulla vagy negatív árbevételre a marzs nem értelmezhető.',
      );
      return bad ?? calcOk((values[numeratorName] as number) / rev);
    },
  );
}

/** Bruttó marzs = bruttó eredmény / árbevétel (tört). Árbevétel ≤ 0 → `NOT_MEANINGFUL`. */
export function grossMargin(input: {
  readonly grossProfit: NumericInput;
  readonly revenue: NumericInput;
}): CalcResult<number> {
  return marginOf('grossProfit', input.grossProfit, input.revenue);
}

/** Üzemi marzs = üzemi eredmény / árbevétel (tört). Árbevétel ≤ 0 → `NOT_MEANINGFUL`. */
export function operatingMargin(input: {
  readonly operatingIncome: NumericInput;
  readonly revenue: NumericInput;
}): CalcResult<number> {
  return marginOf('operatingIncome', input.operatingIncome, input.revenue);
}

/** Nettó marzs = nettó eredmény / árbevétel (tört). Árbevétel ≤ 0 → `NOT_MEANINGFUL`. */
export function netMargin(input: {
  readonly netIncome: NumericInput;
  readonly revenue: NumericInput;
}): CalcResult<number> {
  return marginOf('netIncome', input.netIncome, input.revenue);
}

// --- EPS --------------------------------------------------------------------------------------

/**
 * Saját EPS = nettó eredmény / hígított súlyozott átlagos részvényszám.
 * Ismert korlát: a `netIncome` (US GAAP `NetIncomeLoss`) az elsőbbségi osztalék levonása ELŐTTI
 * érték, ezért elsőbbségi részvényes cégnél felülbecsülhet – ezért a jelentett EPS az elsődleges.
 * Részvényszám ≤ 0 → `INVALID_INPUT`. Negatív EPS megengedett (veszteség), `OK`.
 */
export function calculateEps(input: {
  readonly netIncome: NumericInput;
  readonly weightedSharesDiluted: NumericInput;
}): CalcResult<number> {
  return chainCalc(requireInputs(input), ({ netIncome, weightedSharesDiluted }) => {
    const bad = mustBePositive('weightedSharesDiluted', weightedSharesDiluted);
    return bad ?? calcOk(netIncome / weightedSharesDiluted);
  });
}

export type EpsBasis = 'reported_diluted' | 'reported_basic' | 'calculated_diluted';

export interface EpsSelection {
  readonly eps: number;
  readonly basis: EpsBasis;
}

/**
 * EPS kiválasztása (D-056) ebben a sorrendben:
 * 1. jelentett hígított (`epsDiluted`);
 * 2. jelentett alap (`epsBasic`) – megjegyzéssel, mert a hígítás hiányzik;
 * 3. saját számítás (`calculateEps`) – csak ha mindkét bemenete megvan.
 * Ha egyik sem áll elő: `MISSING` (vagy a saját számítás hibája, ha bemenete érvénytelen).
 */
export function selectEps(input: {
  readonly reportedDiluted: NumericInput;
  readonly reportedBasic: NumericInput;
  readonly netIncome: NumericInput;
  readonly weightedSharesDiluted: NumericInput;
}): CalcResult<EpsSelection> {
  for (const [name, value] of [
    ['reportedDiluted', input.reportedDiluted],
    ['reportedBasic', input.reportedBasic],
  ] as const) {
    if (typeof value === 'number' && !Number.isFinite(value)) {
      return calcInvalidInput(`Nem véges szám a bemenetben: ${name}=${String(value)}.`);
    }
  }
  if (typeof input.reportedDiluted === 'number') {
    return calcOk({ eps: input.reportedDiluted, basis: 'reported_diluted' });
  }
  if (typeof input.reportedBasic === 'number') {
    return calcOk({ eps: input.reportedBasic, basis: 'reported_basic' }, [
      'Jelentett hígított EPS hiányában az alap (basic) EPS szerepel.',
    ]);
  }
  const own = calculateEps({
    netIncome: input.netIncome,
    weightedSharesDiluted: input.weightedSharesDiluted,
  });
  if (own.status === 'MISSING') {
    return calcMissing(
      'Nincs jelentett EPS, és a saját számításhoz is hiányzik bemenet (netIncome, weightedSharesDiluted).',
    );
  }
  return chainCalc(own, (eps) =>
    calcOk({ eps, basis: 'calculated_diluted' as const }, [
      'Saját számítás: netIncome / weightedSharesDiluted (elsőbbségi osztalék levonása nélkül).',
    ]),
  );
}

// --- Adókulcs és NOPAT ------------------------------------------------------------------------

/**
 * Effektív adókulcs = társasági adó / adózás előtti eredmény.
 * - adózás előtti eredmény ≤ 0 → `NOT_MEANINGFUL`;
 * - az eredmény a [0, 1] tartományon kívül (adó-visszatérítés, egyszeri tétel) → `NOT_MEANINGFUL`.
 */
export function effectiveTaxRate(input: {
  readonly incomeTaxExpense: NumericInput;
  readonly pretaxIncome: NumericInput;
}): CalcResult<number> {
  return chainCalc(requireInputs(input), ({ incomeTaxExpense, pretaxIncome }) => {
    const bad = mustBePositive(
      'pretaxIncome',
      pretaxIncome,
      'NOT_MEANINGFUL',
      'Veszteségnél az effektív adókulcs nem értelmezhető.',
    );
    if (bad) return bad;
    const rate = incomeTaxExpense / pretaxIncome;
    return rate < 0 || rate > 1
      ? calcNotMeaningful(
          `Az effektív adókulcs (${rate}) a [0, 1] tartományon kívül esik (egyszeri adótétel?).`,
        )
      : calcOk(rate);
  });
}

export interface NopatTaxRate {
  readonly taxRate: number;
  /** `effective`: a kimutatásból számolt; `fallback`: a hívó által adott (becslés!). */
  readonly basis: 'effective' | 'fallback';
}

/**
 * NOPAT-hoz használt adókulcs (D-056): az effektív kulcs, ha `OK`; különben a hívó által
 * EXPLICIT megadott tartalék kulcs (pl. felhasználói beállítás). A motor nem talál ki
 * alapértelmezett kulcsot. Tartalék kulcs esetén az eredmény `estimated` (a megjegyzés jelzi).
 */
export function resolveNopatTaxRate(input: {
  readonly incomeTaxExpense: NumericInput;
  readonly pretaxIncome: NumericInput;
  readonly fallbackTaxRate?: NumericInput;
}): CalcResult<NopatTaxRate> {
  const effective = effectiveTaxRate(input);
  if (effective.status === 'OK') return calcOk({ taxRate: effective.value, basis: 'effective' });
  const fallback = input.fallbackTaxRate;
  if (fallback === null || fallback === undefined) return effective;
  const bad = firstFailure(
    Number.isFinite(fallback) ? null : calcInvalidInput('A tartalék adókulcs nem véges szám.'),
    mustBeInRange('fallbackTaxRate', fallback, 0, 1, 'Tizedes tört kell (0.21 = 21%).'),
  );
  return (
    bad ??
    calcOk({ taxRate: fallback, basis: 'fallback' as const }, [
      `Az effektív adókulcs nem használható (${effective.reason}); tartalék kulcs: ${fallback} (becslés).`,
    ])
  );
}

/**
 * NOPAT = üzemi eredmény × (1 − adókulcs). Negatív üzemi eredménynél negatív NOPAT, `OK`
 * (egyszerűsítés: nem modellezzük az elhatárolt adóvisszatérítést).
 */
export function nopat(input: {
  readonly operatingIncome: NumericInput;
  readonly taxRate: NumericInput;
}): CalcResult<number> {
  return chainCalc(requireInputs(input), ({ operatingIncome: ebit, taxRate }) => {
    const bad = mustBeInRange('taxRate', taxRate, 0, 1, 'Tizedes tört kell (0.21 = 21%).');
    return bad ?? calcOk(ebit * (1 - taxRate));
  });
}

/**
 * Befektetett tőke (D-056) = saját tőke + teljes adósság − pénzeszközök.
 * (Finanszírozási oldali definíció; operatív lízing és kisebbségi részesedés nélkül.)
 * Adósság vagy pénz < 0 → `INVALID_INPUT`. Az eredmény lehet ≤ 0 (a ROIC ekkor N/M).
 */
export function investedCapital(input: {
  readonly shareholdersEquity: NumericInput;
  readonly totalDebt: NumericInput;
  readonly cashAndEquivalents: NumericInput;
}): CalcResult<number> {
  return chainCalc(
    requireInputs(input),
    ({ shareholdersEquity, totalDebt, cashAndEquivalents }) => {
      const bad = firstFailure(
        mustBeNonNegative('totalDebt', totalDebt),
        mustBeNonNegative('cashAndEquivalents', cashAndEquivalents),
      );
      return bad ?? calcOk(shareholdersEquity + totalDebt - cashAndEquivalents);
    },
  );
}

// --- Megtérülési mutatók (átlagos nevezővel) ------------------------------------------------

/**
 * `numerator / avg(start, end)`; ha a nyitó érték hiányzik, a záró értékkel számol és ezt
 * megjegyzésben jelzi (DATA_DICTIONARY 5. bevezető). HA BÁRMELYIK felhasznált nevező ≤ 0, az
 * eredmény a megadott státuszt kapja – egy negatívból pozitívba forduló átlag is félrevezető.
 */
function returnOnAverage(
  numeratorName: string,
  numerator: NumericInput,
  denominatorName: string,
  start: NumericInput,
  end: NumericInput,
  nonPositiveStatus: 'NOT_MEANINGFUL' | 'INVALID_INPUT',
): CalcResult<number> {
  return chainCalc(
    requireInputs({ [numeratorName]: numerator, [`${denominatorName}End`]: end }),
    (required) => {
      if (typeof start === 'number' && !Number.isFinite(start)) {
        return calcInvalidInput(`Nem véges szám a bemenetben: ${denominatorName}Start.`);
      }
      const num = required[numeratorName] as number;
      const endValue = required[`${denominatorName}End`] as number;
      const used = typeof start === 'number' ? [start, endValue] : [endValue];
      const bad = firstFailure(
        ...used.map((value) =>
          mustBePositive(
            denominatorName,
            value,
            nonPositiveStatus,
            'Nulla vagy negatív nevezőre a mutató nem értelmezhető.',
          ),
        ),
      );
      if (bad) return bad;
      if (used.length === 1) {
        return calcOk(num / endValue, [
          `Nyitó ${denominatorName} hiányában a záró értékkel számolva (nem átlag).`,
        ]);
      }
      const average = ((used[0] as number) + endValue) / 2;
      return calcOk(num / average);
    },
  );
}

/**
 * ROE = nettó eredmény / átlagos saját tőke (nyitó és záró átlaga).
 * Bármelyik saját tőke ≤ 0 → `NOT_MEANINGFUL` (negatív equity mellett a ROE félrevezető).
 */
export function roe(input: {
  readonly netIncome: NumericInput;
  readonly equityStart?: NumericInput;
  readonly equityEnd: NumericInput;
}): CalcResult<number> {
  return returnOnAverage(
    'netIncome',
    input.netIncome,
    'shareholdersEquity',
    input.equityStart,
    input.equityEnd,
    'NOT_MEANINGFUL',
  );
}

/** ROA = nettó eredmény / átlagos összes eszköz. Eszköz ≤ 0 → `INVALID_INPUT` (adathiba). */
export function roa(input: {
  readonly netIncome: NumericInput;
  readonly totalAssetsStart?: NumericInput;
  readonly totalAssetsEnd: NumericInput;
}): CalcResult<number> {
  return returnOnAverage(
    'netIncome',
    input.netIncome,
    'totalAssets',
    input.totalAssetsStart,
    input.totalAssetsEnd,
    'INVALID_INPUT',
  );
}

/** ROIC = NOPAT / átlagos befektetett tőke. Bármelyik befektetett tőke ≤ 0 → `NOT_MEANINGFUL`. */
export function roic(input: {
  readonly nopat: NumericInput;
  readonly investedCapitalStart?: NumericInput;
  readonly investedCapitalEnd: NumericInput;
}): CalcResult<number> {
  return returnOnAverage(
    'nopat',
    input.nopat,
    'investedCapital',
    input.investedCapitalStart,
    input.investedCapitalEnd,
    'NOT_MEANINGFUL',
  );
}
