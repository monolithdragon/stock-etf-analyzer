import {
  calculateEps,
  effectiveTaxRate,
  grossMargin,
  grossProfit,
  investedCapital,
  netMargin,
  nopat,
  operatingIncome,
  operatingMargin,
  resolveNopatTaxRate,
  roa,
  roe,
  roic,
  selectEps,
} from './profitability';
import { failureReason, okNotes, okValue } from '../core/testing';

describe('grossProfit', () => {
  it('árbevétel − COGS', () => {
    expect(okValue(grossProfit({ revenue: 100, costOfRevenue: 60 }))).toBe(40);
  });
  it('a 0 tényleges érték, nem hiány', () => {
    expect(okValue(grossProfit({ revenue: 0, costOfRevenue: 0 }))).toBe(0);
  });
  it('hiányzó COGS → MISSING (nem 0-val számol)', () => {
    const result = grossProfit({ revenue: 100, costOfRevenue: null });
    expect(result.status).toBe('MISSING');
    expect(failureReason(result)).toContain('costOfRevenue');
  });
  it('negatív COGS → INVALID_INPUT; NaN → INVALID_INPUT', () => {
    expect(grossProfit({ revenue: 100, costOfRevenue: -5 }).status).toBe('INVALID_INPUT');
    expect(grossProfit({ revenue: Number.NaN, costOfRevenue: 5 }).status).toBe('INVALID_INPUT');
  });
});

describe('operatingIncome (saját)', () => {
  it('bruttó eredmény − működési költség', () => {
    expect(okValue(operatingIncome({ grossProfit: 40, operatingExpenses: 15 }))).toBe(25);
  });
  it('negatív költség → INVALID_INPUT', () => {
    expect(operatingIncome({ grossProfit: 40, operatingExpenses: -1 }).status).toBe(
      'INVALID_INPUT',
    );
  });
});

describe('marzsok', () => {
  it('bruttó, üzemi, nettó marzs tört formában', () => {
    expect(okValue(grossMargin({ grossProfit: 40, revenue: 100 }))).toBeCloseTo(0.4, 12);
    expect(okValue(operatingMargin({ operatingIncome: 25, revenue: 100 }))).toBeCloseTo(0.25, 12);
    expect(okValue(netMargin({ netIncome: 21, revenue: 100 }))).toBeCloseTo(0.21, 12);
  });
  it('negatív eredmény → negatív marzs (OK)', () => {
    expect(okValue(operatingMargin({ operatingIncome: -10, revenue: 100 }))).toBeCloseTo(-0.1, 12);
  });
  it.each([0, -10])('árbevétel = %p → NOT_MEANINGFUL (nullával osztás)', (revenue) => {
    expect(grossMargin({ grossProfit: 40, revenue }).status).toBe('NOT_MEANINGFUL');
    expect(netMargin({ netIncome: 1, revenue }).status).toBe('NOT_MEANINGFUL');
  });
  it('hiányzó / nem véges bemenet', () => {
    expect(netMargin({ netIncome: null, revenue: 100 }).status).toBe('MISSING');
    expect(netMargin({ netIncome: Infinity, revenue: 100 }).status).toBe('INVALID_INPUT');
  });
});

describe('EPS', () => {
  it('saját EPS = nettó eredmény / hígított részvényszám; veszteségnél negatív', () => {
    expect(okValue(calculateEps({ netIncome: 1000, weightedSharesDiluted: 400 }))).toBe(2.5);
    expect(okValue(calculateEps({ netIncome: -100, weightedSharesDiluted: 400 }))).toBe(-0.25);
  });
  it('részvényszám ≤ 0 → INVALID_INPUT', () => {
    expect(calculateEps({ netIncome: 1000, weightedSharesDiluted: 0 }).status).toBe(
      'INVALID_INPUT',
    );
  });

  const none = {
    reportedDiluted: null,
    reportedBasic: null,
    netIncome: null,
    weightedSharesDiluted: null,
  };

  it('1. jelentett hígított EPS (a 0 és a negatív is érvényes)', () => {
    expect(okValue(selectEps({ ...none, reportedDiluted: 2.4, reportedBasic: 2.5 }))).toEqual({
      eps: 2.4,
      basis: 'reported_diluted',
    });
    expect(okValue(selectEps({ ...none, reportedDiluted: 0 })).eps).toBe(0);
    expect(okValue(selectEps({ ...none, reportedDiluted: -1.2 })).eps).toBe(-1.2);
  });
  it('2. jelentett alap EPS megjegyzéssel', () => {
    const result = selectEps({
      ...none,
      reportedBasic: 2.5,
      netIncome: 1000,
      weightedSharesDiluted: 400,
    });
    expect(okValue(result)).toEqual({ eps: 2.5, basis: 'reported_basic' });
    expect(okNotes(result)[0]).toContain('alap');
  });
  it('3. saját számítás, csak ha minden bemenete megvan', () => {
    const result = selectEps({ ...none, netIncome: 1000, weightedSharesDiluted: 400 });
    expect(okValue(result)).toEqual({ eps: 2.5, basis: 'calculated_diluted' });
    expect(okNotes(result)[0]).toContain('Saját számítás');
  });
  it('semmi sincs → MISSING; hibás bemenet → INVALID_INPUT', () => {
    expect(selectEps(none).status).toBe('MISSING');
    expect(selectEps({ ...none, netIncome: 1000 }).status).toBe('MISSING');
    expect(selectEps({ ...none, reportedDiluted: Number.NaN }).status).toBe('INVALID_INPUT');
    expect(selectEps({ ...none, reportedBasic: Infinity }).status).toBe('INVALID_INPUT');
    expect(selectEps({ ...none, netIncome: 1, weightedSharesDiluted: 0 }).status).toBe(
      'INVALID_INPUT',
    );
  });
});

describe('effektív adókulcs és NOPAT', () => {
  it('adó / adózás előtti eredmény', () => {
    expect(okValue(effectiveTaxRate({ incomeTaxExpense: 21, pretaxIncome: 100 }))).toBeCloseTo(
      0.21,
      12,
    );
  });
  it.each([
    [21, 0],
    [-5, -50],
    [-5, 100],
    [120, 100],
  ])('adó=%p, adózás előtti=%p → NOT_MEANINGFUL', (tax, pretax) => {
    expect(effectiveTaxRate({ incomeTaxExpense: tax, pretaxIncome: pretax }).status).toBe(
      'NOT_MEANINGFUL',
    );
  });
  it('hiányzó adó → MISSING', () => {
    expect(effectiveTaxRate({ incomeTaxExpense: null, pretaxIncome: 100 }).status).toBe('MISSING');
  });

  it('NOPAT-kulcs: effektív, ha OK', () => {
    expect(
      okValue(
        resolveNopatTaxRate({ incomeTaxExpense: 25, pretaxIncome: 100, fallbackTaxRate: 0.21 }),
      ),
    ).toEqual({ taxRate: 0.25, basis: 'effective' });
  });
  it('NOPAT-kulcs: explicit tartalék kulcs (becslés), ha az effektív N/M', () => {
    const result = resolveNopatTaxRate({
      incomeTaxExpense: 5,
      pretaxIncome: -50,
      fallbackTaxRate: 0.21,
    });
    expect(okValue(result)).toEqual({ taxRate: 0.21, basis: 'fallback' });
    expect(okNotes(result)[0]).toContain('becslés');
  });
  it('NOPAT-kulcs: tartalék nélkül az effektív hiba megy tovább; hibás tartalék → INVALID', () => {
    expect(resolveNopatTaxRate({ incomeTaxExpense: 5, pretaxIncome: -50 }).status).toBe(
      'NOT_MEANINGFUL',
    );
    expect(
      resolveNopatTaxRate({ incomeTaxExpense: 5, pretaxIncome: -50, fallbackTaxRate: 21 }).status,
    ).toBe('INVALID_INPUT');
    expect(
      resolveNopatTaxRate({ incomeTaxExpense: 5, pretaxIncome: -50, fallbackTaxRate: Number.NaN })
        .status,
    ).toBe('INVALID_INPUT');
  });

  it('NOPAT = EBIT × (1 − t); negatív EBIT → negatív NOPAT', () => {
    expect(okValue(nopat({ operatingIncome: 100, taxRate: 0.21 }))).toBeCloseTo(79, 10);
    expect(okValue(nopat({ operatingIncome: -100, taxRate: 0.21 }))).toBeCloseTo(-79, 10);
  });
  it('NOPAT: százalékban megadott kulcs (21) → INVALID_INPUT', () => {
    expect(nopat({ operatingIncome: 100, taxRate: 21 }).status).toBe('INVALID_INPUT');
  });
});

describe('befektetett tőke', () => {
  it('saját tőke + adósság − pénz; lehet negatív', () => {
    expect(
      okValue(
        investedCapital({ shareholdersEquity: 500, totalDebt: 200, cashAndEquivalents: 100 }),
      ),
    ).toBe(600);
    expect(
      okValue(
        investedCapital({ shareholdersEquity: -300, totalDebt: 100, cashAndEquivalents: 50 }),
      ),
    ).toBe(-250);
  });
  it('negatív adósság vagy pénz → INVALID_INPUT', () => {
    expect(
      investedCapital({ shareholdersEquity: 1, totalDebt: -1, cashAndEquivalents: 0 }).status,
    ).toBe('INVALID_INPUT');
    expect(
      investedCapital({ shareholdersEquity: 1, totalDebt: 0, cashAndEquivalents: -1 }).status,
    ).toBe('INVALID_INPUT');
  });
});

describe('ROE / ROA / ROIC', () => {
  it('ROE átlagos saját tőkével: 100 / avg(400, 600) = 0.2', () => {
    const result = roe({ netIncome: 100, equityStart: 400, equityEnd: 600 });
    expect(okValue(result)).toBeCloseTo(0.2, 12);
    expect(okNotes(result)).toEqual([]);
  });
  it('ROE csak záró értékkel – megjegyzéssel', () => {
    const result = roe({ netIncome: 100, equityEnd: 500 });
    expect(okValue(result)).toBeCloseTo(0.2, 12);
    expect(okNotes(result)[0]).toContain('záró');
  });
  it('ROE: negatív vagy nulla saját tőke (akár csak a nyitó) → NOT_MEANINGFUL', () => {
    expect(roe({ netIncome: 100, equityStart: -100, equityEnd: 600 }).status).toBe(
      'NOT_MEANINGFUL',
    );
    expect(roe({ netIncome: 100, equityEnd: 0 }).status).toBe('NOT_MEANINGFUL');
  });
  it('ROE: hiányzó eredmény → MISSING; nem véges nyitó → INVALID_INPUT', () => {
    expect(roe({ netIncome: null, equityEnd: 600 }).status).toBe('MISSING');
    expect(roe({ netIncome: 1, equityStart: Number.NaN, equityEnd: 600 }).status).toBe(
      'INVALID_INPUT',
    );
  });
  it('ROA: 100 / avg(900, 1100) = 0.1; eszköz ≤ 0 → INVALID_INPUT (adathiba)', () => {
    expect(
      okValue(roa({ netIncome: 100, totalAssetsStart: 900, totalAssetsEnd: 1100 })),
    ).toBeCloseTo(0.1, 12);
    expect(roa({ netIncome: 100, totalAssetsEnd: 0 }).status).toBe('INVALID_INPUT');
  });
  it('ROIC: 79 / avg(500, 700); befektetett tőke ≤ 0 → NOT_MEANINGFUL', () => {
    expect(
      okValue(roic({ nopat: 79, investedCapitalStart: 500, investedCapitalEnd: 700 })),
    ).toBeCloseTo(79 / 600, 12);
    expect(roic({ nopat: 79, investedCapitalStart: 500, investedCapitalEnd: -1 }).status).toBe(
      'NOT_MEANINGFUL',
    );
  });
});
