/**
 * Mérleg és cash flow: nettó adósság, D/E, FCF-család, EBITDA. DATA_DICTIONARY 5.2, D-056.
 *
 * Előjel-konvenció: a kiáramlás (CapEx, osztalék, törlesztés) POZITÍV nagyság; negatív érték
 * `INVALID_INPUT` (nem fordítunk előjelet csendben). Az adósság és a pénz nem lehet negatív.
 */
import {
  calcOk,
  chainCalc,
  mapCalc,
  requireInputs,
  type CalcResult,
  type NumericInput,
} from '../core/calc-result';
import { firstFailure, mustBeNonNegative, mustBePositive } from '../core/numeric';

const OUTFLOW_HINT = 'A kiáramlást pozitív nagyságként kell megadni.';

/**
 * Nettó adósság = teljes adósság − pénzeszközök (negatív érték = nettó készpénz).
 * Definíció (D-056): a `cashAndEquivalents` NEM tartalmazza a rövid távú befektetéseket; a
 * `totalDebt` operatív lízing nélkül értendő (DATA_DICTIONARY 4.2).
 */
export function netDebt(input: {
  readonly totalDebt: NumericInput;
  readonly cashAndEquivalents: NumericInput;
}): CalcResult<number> {
  return chainCalc(requireInputs(input), ({ totalDebt, cashAndEquivalents }) => {
    const bad = firstFailure(
      mustBeNonNegative('totalDebt', totalDebt),
      mustBeNonNegative('cashAndEquivalents', cashAndEquivalents),
    );
    return bad ?? calcOk(totalDebt - cashAndEquivalents);
  });
}

/** Nettó készpénz = pénzeszközök − teljes adósság (a nettó adósság ellentettje). */
export function netCash(input: {
  readonly totalDebt: NumericInput;
  readonly cashAndEquivalents: NumericInput;
}): CalcResult<number> {
  // `0 - x`: a −0 elkerülése, ha a nettó adósság pontosan 0.
  return mapCalc(netDebt(input), (value) => 0 - value);
}

/** Debt/Equity = teljes adósság / saját tőke (szorzó). Saját tőke ≤ 0 → `NOT_MEANINGFUL`. */
export function debtToEquity(input: {
  readonly totalDebt: NumericInput;
  readonly shareholdersEquity: NumericInput;
}): CalcResult<number> {
  return chainCalc(requireInputs(input), ({ totalDebt, shareholdersEquity }) => {
    const bad = firstFailure(
      mustBeNonNegative('totalDebt', totalDebt),
      mustBePositive(
        'shareholdersEquity',
        shareholdersEquity,
        'NOT_MEANINGFUL',
        'Negatív vagy nulla saját tőke mellett a D/E félrevezető.',
      ),
    );
    return bad ?? calcOk(totalDebt / shareholdersEquity);
  });
}

/**
 * Szabad cash flow (FCF) = működési cash flow − CapEx.
 * Negatív FCF megengedett (`OK`). CapEx < 0 → `INVALID_INPUT`.
 * Ismert egyszerűsítés: US GAAP szerint az OCF már levonja a kamatot → nem tiszta FCFF (D-022).
 */
export function freeCashFlow(input: {
  readonly operatingCashFlow: NumericInput;
  readonly capitalExpenditure: NumericInput;
}): CalcResult<number> {
  return chainCalc(requireInputs(input), ({ operatingCashFlow, capitalExpenditure }) => {
    const bad = mustBeNonNegative('capitalExpenditure', capitalExpenditure, OUTFLOW_HINT);
    return bad ?? calcOk(operatingCashFlow - capitalExpenditure);
  });
}

/** FCF marzs = FCF / árbevétel. Árbevétel ≤ 0 → `NOT_MEANINGFUL`. */
export function fcfMargin(input: {
  readonly freeCashFlow: NumericInput;
  readonly revenue: NumericInput;
}): CalcResult<number> {
  return chainCalc(requireInputs(input), ({ freeCashFlow: fcf, revenue }) => {
    const bad = mustBePositive('revenue', revenue, 'NOT_MEANINGFUL');
    return bad ?? calcOk(fcf / revenue);
  });
}

/**
 * FCF konverzió = FCF / nettó eredmény (tört; 1.0 = a nyereség 100%-a pénzben is megjelent).
 * Nettó eredmény ≤ 0 → `NOT_MEANINGFUL`.
 */
export function fcfConversion(input: {
  readonly freeCashFlow: NumericInput;
  readonly netIncome: NumericInput;
}): CalcResult<number> {
  return chainCalc(requireInputs(input), ({ freeCashFlow: fcf, netIncome }) => {
    const bad = mustBePositive(
      'netIncome',
      netIncome,
      'NOT_MEANINGFUL',
      'Veszteségnél a konverzió nem értelmezhető.',
    );
    return bad ?? calcOk(fcf / netIncome);
  });
}

/**
 * FCF osztalék után = FCF − fizetett osztalék.
 * A HIÁNYZÓ osztalék NEM 0: `MISSING`. Explicit (jelentett) 0 osztalék megengedett.
 */
export function fcfAfterDividend(input: {
  readonly freeCashFlow: NumericInput;
  readonly dividendsPaid: NumericInput;
}): CalcResult<number> {
  return chainCalc(requireInputs(input), ({ freeCashFlow: fcf, dividendsPaid }) => {
    const bad = mustBeNonNegative('dividendsPaid', dividendsPaid, OUTFLOW_HINT);
    return bad ?? calcOk(fcf - dividendsPaid);
  });
}

/** FCF osztalék és adósságtörlesztés után = FCF − osztalék − törlesztés. Hiány → `MISSING`. */
export function fcfAfterDividendAndDebtRepayment(input: {
  readonly freeCashFlow: NumericInput;
  readonly dividendsPaid: NumericInput;
  readonly debtRepayment: NumericInput;
}): CalcResult<number> {
  return chainCalc(requireInputs(input), ({ freeCashFlow: fcf, dividendsPaid, debtRepayment }) => {
    const bad = firstFailure(
      mustBeNonNegative('dividendsPaid', dividendsPaid, OUTFLOW_HINT),
      mustBeNonNegative('debtRepayment', debtRepayment, OUTFLOW_HINT),
    );
    return bad ?? calcOk(fcf - dividendsPaid - debtRepayment);
  });
}

/**
 * EBITDA (saját számítás) = üzemi eredmény + értékcsökkenés és amortizáció.
 * `calculated` – eltérhet a szolgáltató „adjusted EBITDA”-jától. D&A < 0 → `INVALID_INPUT`.
 */
export function ebitda(input: {
  readonly operatingIncome: NumericInput;
  readonly depreciationAmortization: NumericInput;
}): CalcResult<number> {
  return chainCalc(requireInputs(input), ({ operatingIncome, depreciationAmortization }) => {
    const bad = mustBeNonNegative('depreciationAmortization', depreciationAmortization);
    return bad ?? calcOk(operatingIncome + depreciationAmortization);
  });
}
