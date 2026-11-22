import {
  debtToEquity,
  ebitda,
  fcfAfterDividend,
  fcfAfterDividendAndDebtRepayment,
  fcfConversion,
  fcfMargin,
  freeCashFlow,
  netCash,
  netDebt,
  netDebtToEbitda,
} from './balance-cashflow';
import { failureReason, okValue } from '../core/testing';

describe('nettó adósság / nettó készpénz', () => {
  it('adósság − pénz (negatív = nettó készpénz)', () => {
    expect(okValue(netDebt({ totalDebt: 300, cashAndEquivalents: 100 }))).toBe(200);
    expect(okValue(netDebt({ totalDebt: 100, cashAndEquivalents: 300 }))).toBe(-200);
  });
  it('nettó készpénz az ellentett; egyenlőségnél +0 (nem −0)', () => {
    expect(okValue(netCash({ totalDebt: 300, cashAndEquivalents: 100 }))).toBe(-200);
    expect(Object.is(okValue(netCash({ totalDebt: 100, cashAndEquivalents: 100 })), 0)).toBe(true);
  });
  it('negatív adósság → INVALID_INPUT; hiány → MISSING', () => {
    expect(netDebt({ totalDebt: -1, cashAndEquivalents: 0 }).status).toBe('INVALID_INPUT');
    expect(netCash({ totalDebt: null, cashAndEquivalents: 0 }).status).toBe('MISSING');
  });
});

describe('debtToEquity', () => {
  it('200 / 400 = 0.5', () => {
    expect(okValue(debtToEquity({ totalDebt: 200, shareholdersEquity: 400 }))).toBe(0.5);
  });
  it.each([0, -100])('saját tőke = %p → NOT_MEANINGFUL (negatív equity)', (equity) => {
    expect(debtToEquity({ totalDebt: 200, shareholdersEquity: equity }).status).toBe(
      'NOT_MEANINGFUL',
    );
  });
  it('negatív adósság → INVALID_INPUT', () => {
    expect(debtToEquity({ totalDebt: -1, shareholdersEquity: 1 }).status).toBe('INVALID_INPUT');
  });
});

describe('FCF család', () => {
  it('FCF = OCF − CapEx; negatív FCF is OK', () => {
    expect(okValue(freeCashFlow({ operatingCashFlow: 500, capitalExpenditure: 200 }))).toBe(300);
    expect(okValue(freeCashFlow({ operatingCashFlow: 100, capitalExpenditure: 300 }))).toBe(-200);
  });
  it('FCF: negatív CapEx (előjelhiba) → INVALID_INPUT; hiányzó CapEx → MISSING', () => {
    const invalid = freeCashFlow({ operatingCashFlow: 500, capitalExpenditure: -50 });
    expect(invalid.status).toBe('INVALID_INPUT');
    expect(failureReason(invalid)).toContain('pozitív nagyság');
    expect(freeCashFlow({ operatingCashFlow: 500, capitalExpenditure: null }).status).toBe(
      'MISSING',
    );
  });
  it('FCF marzs; árbevétel ≤ 0 → NOT_MEANINGFUL', () => {
    expect(okValue(fcfMargin({ freeCashFlow: 300, revenue: 1000 }))).toBeCloseTo(0.3, 12);
    expect(fcfMargin({ freeCashFlow: 300, revenue: 0 }).status).toBe('NOT_MEANINGFUL');
  });
  it('FCF konverzió; nettó eredmény ≤ 0 → NOT_MEANINGFUL', () => {
    expect(okValue(fcfConversion({ freeCashFlow: 300, netIncome: 250 }))).toBeCloseTo(1.2, 12);
    expect(fcfConversion({ freeCashFlow: 300, netIncome: 0 }).status).toBe('NOT_MEANINGFUL');
    expect(fcfConversion({ freeCashFlow: 300, netIncome: -10 }).status).toBe('NOT_MEANINGFUL');
  });
  it('FCF osztalék után: hiányzó osztalék → MISSING, jelentett 0 → OK', () => {
    expect(okValue(fcfAfterDividend({ freeCashFlow: 300, dividendsPaid: 100 }))).toBe(200);
    expect(okValue(fcfAfterDividend({ freeCashFlow: 300, dividendsPaid: 0 }))).toBe(300);
    expect(fcfAfterDividend({ freeCashFlow: 300, dividendsPaid: null }).status).toBe('MISSING');
    expect(fcfAfterDividend({ freeCashFlow: 300, dividendsPaid: -1 }).status).toBe('INVALID_INPUT');
  });
  it('FCF osztalék és törlesztés után', () => {
    expect(
      okValue(
        fcfAfterDividendAndDebtRepayment({
          freeCashFlow: 300,
          dividendsPaid: 100,
          debtRepayment: 50,
        }),
      ),
    ).toBe(150);
    expect(
      fcfAfterDividendAndDebtRepayment({
        freeCashFlow: 300,
        dividendsPaid: 100,
        debtRepayment: null,
      }).status,
    ).toBe('MISSING');
    expect(
      fcfAfterDividendAndDebtRepayment({ freeCashFlow: 300, dividendsPaid: 100, debtRepayment: -5 })
        .status,
    ).toBe('INVALID_INPUT');
  });
});

describe('EBITDA', () => {
  it('üzemi eredmény + D&A; negatív üzemi eredmény is OK', () => {
    expect(okValue(ebitda({ operatingIncome: 250, depreciationAmortization: 50 }))).toBe(300);
    expect(okValue(ebitda({ operatingIncome: -80, depreciationAmortization: 50 }))).toBe(-30);
  });
  it('negatív D&A → INVALID_INPUT', () => {
    expect(ebitda({ operatingIncome: 250, depreciationAmortization: -1 }).status).toBe(
      'INVALID_INPUT',
    );
  });
});

describe('nettó adósság / EBITDA (PHASE 10, D-073)', () => {
  it('hányados; nettó készpénznél negatív', () => {
    expect(okValue(netDebtToEbitda({ netDebt: 300, ebitda: 100 }))).toBe(3);
    expect(okValue(netDebtToEbitda({ netDebt: -50, ebitda: 100 }))).toBe(-0.5);
  });
  it('EBITDA ≤ 0 → NOT_MEANINGFUL; hiányzó bemenet → MISSING (nem 0)', () => {
    const zero = netDebtToEbitda({ netDebt: 100, ebitda: 0 });
    expect(zero.status).toBe('NOT_MEANINGFUL');
    expect(failureReason(netDebtToEbitda({ netDebt: 100, ebitda: -5 }))).toContain('EBITDA');
    expect(netDebtToEbitda({ netDebt: null, ebitda: 100 }).status).toBe('MISSING');
  });
});
