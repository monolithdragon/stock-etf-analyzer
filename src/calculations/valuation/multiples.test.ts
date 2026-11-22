import {
  createDividendEvent,
  parseCurrencyCode,
  type CurrencyCode,
  type DividendEvent,
  type IsoDate,
  type Money,
} from '@/domain';

import {
  dividendYield,
  dividendYieldFromMoney,
  enterpriseValue,
  evToEbitda,
  fcfYield,
  marginOfSafety,
  marketCap,
  pegRatio,
  priceAtMarginOfSafety,
  priceToBook,
  priceToEarnings,
  priceToFreeCashFlow,
  priceToSales,
  trailingDividendPerShare,
} from './multiples';
import { failureReason, okNotes, okValue } from '../core/testing';

const c = (code: string): CurrencyCode => {
  const parsed = parseCurrencyCode(code);
  if (!parsed.ok) throw new Error(code);
  return parsed.value;
};
const money = (amount: number, currency: string): Money => ({ amount, currency: c(currency) });
const d = (value: string) => value as IsoDate;

function dividend(
  exDate: string,
  amount: number,
  currency = 'USD',
  splitAdjustedAmount: number | null = amount,
): DividendEvent {
  const event = createDividendEvent({
    exDate,
    paymentDate: null,
    recordDate: null,
    declarationDate: null,
    amount,
    currency: c(currency),
    splitAdjustedAmount,
    frequency: 'Quarterly',
  });
  if (!event.ok) throw new Error(event.error.message);
  return event.value;
}

describe('marketCap', () => {
  it('ár × részvényszám', () => {
    expect(okValue(marketCap({ price: 50, sharesOutstanding: 1_000_000 }))).toBe(50_000_000);
  });
  it('eltérő dátumú ár és részvényszám → OK, megjegyzéssel', () => {
    const result = marketCap({
      price: 50,
      sharesOutstanding: 1_000_000,
      priceAsOf: d('2026-11-20'),
      sharesAsOf: d('2026-10-21'),
    });
    expect(okNotes(result)[0]).toContain('30 nappal');
    expect(
      okNotes(
        marketCap({
          price: 50,
          sharesOutstanding: 1,
          priceAsOf: d('2026-11-20'),
          sharesAsOf: d('2026-11-20'),
        }),
      ),
    ).toEqual([]);
  });
  it('ár vagy részvényszám ≤ 0 → INVALID_INPUT', () => {
    expect(marketCap({ price: 0, sharesOutstanding: 1 }).status).toBe('INVALID_INPUT');
    expect(marketCap({ price: 1, sharesOutstanding: -1 }).status).toBe('INVALID_INPUT');
    expect(marketCap({ price: null, sharesOutstanding: 1 }).status).toBe('MISSING');
  });
});

describe('enterpriseValue', () => {
  it('piaci érték + adósság − pénz; nettó készpénznél negatív is lehet', () => {
    expect(
      okValue(enterpriseValue({ marketCap: 5e7, totalDebt: 1e7, cashAndEquivalents: 2e7 })),
    ).toBe(4e7);
    expect(
      okValue(enterpriseValue({ marketCap: 100, totalDebt: 0, cashAndEquivalents: 150 })),
    ).toBe(-50);
  });
  it('piaci érték ≤ 0 → INVALID_INPUT', () => {
    expect(enterpriseValue({ marketCap: 0, totalDebt: 0, cashAndEquivalents: 0 }).status).toBe(
      'INVALID_INPUT',
    );
  });
});

describe('szorzók – negatív nevező soha nem ad negatív szorzót', () => {
  it('P/E = 100 / 5 = 20', () => {
    expect(okValue(priceToEarnings({ price: 100, eps: 5 }))).toBe(20);
  });
  it.each([0, -2])('P/E: EPS = %p → NOT_MEANINGFUL', (eps) => {
    const result = priceToEarnings({ price: 100, eps });
    expect(result.status).toBe('NOT_MEANINGFUL');
    expect(failureReason(result)).toContain('N/M');
  });
  it('P/E: ár ≤ 0 → INVALID_INPUT; hiányzó EPS → MISSING', () => {
    expect(priceToEarnings({ price: 0, eps: 5 }).status).toBe('INVALID_INPUT');
    expect(priceToEarnings({ price: 100, eps: null }).status).toBe('MISSING');
  });
  it('P/FCF, P/S, P/B', () => {
    expect(okValue(priceToFreeCashFlow({ marketCap: 1000, freeCashFlow: 50 }))).toBe(20);
    expect(priceToFreeCashFlow({ marketCap: 1000, freeCashFlow: -10 }).status).toBe(
      'NOT_MEANINGFUL',
    );
    expect(okValue(priceToSales({ marketCap: 1000, revenue: 500 }))).toBe(2);
    expect(priceToSales({ marketCap: 1000, revenue: 0 }).status).toBe('NOT_MEANINGFUL');
    expect(okValue(priceToBook({ marketCap: 1000, shareholdersEquity: 250 }))).toBe(4);
    expect(priceToBook({ marketCap: 1000, shareholdersEquity: -1 }).status).toBe('NOT_MEANINGFUL');
  });
  it('EV/EBITDA; EBITDA ≤ 0 vagy EV ≤ 0 → NOT_MEANINGFUL', () => {
    expect(okValue(evToEbitda({ enterpriseValue: 1200, ebitda: 100 }))).toBe(12);
    expect(evToEbitda({ enterpriseValue: 1200, ebitda: 0 }).status).toBe('NOT_MEANINGFUL');
    expect(evToEbitda({ enterpriseValue: -50, ebitda: 100 }).status).toBe('NOT_MEANINGFUL');
  });
});

describe('PEG', () => {
  it('P/E 20, növekedés 0.10 (10%) → 2.0', () => {
    expect(okValue(pegRatio({ priceToEarnings: 20, epsGrowthRate: 0.1 }))).toBeCloseTo(2, 12);
  });
  it('a növekedés tizedes tört: 10 (=1000%) → 0.02 – a hívó felelőssége a konverzió', () => {
    expect(okValue(pegRatio({ priceToEarnings: 20, epsGrowthRate: 10 }))).toBeCloseTo(0.02, 12);
  });
  it('növekedés ≤ 0 vagy P/E ≤ 0 → NOT_MEANINGFUL', () => {
    expect(pegRatio({ priceToEarnings: 20, epsGrowthRate: 0 }).status).toBe('NOT_MEANINGFUL');
    expect(pegRatio({ priceToEarnings: 20, epsGrowthRate: -0.05 }).status).toBe('NOT_MEANINGFUL');
    expect(pegRatio({ priceToEarnings: 0, epsGrowthRate: 0.1 }).status).toBe('NOT_MEANINGFUL');
  });
});

describe('FCF-hozam és osztalékhozam', () => {
  it('FCF-hozam; negatív FCF → negatív hozam (OK); piaci érték ≤ 0 → INVALID', () => {
    expect(okValue(fcfYield({ freeCashFlow: 50, marketCap: 1000 }))).toBeCloseTo(0.05, 12);
    expect(okValue(fcfYield({ freeCashFlow: -50, marketCap: 1000 }))).toBeCloseTo(-0.05, 12);
    expect(fcfYield({ freeCashFlow: 50, marketCap: 0 }).status).toBe('INVALID_INPUT');
  });
  it('osztalékhozam: hiány → MISSING, jelentett 0 → 0', () => {
    expect(okValue(dividendYield({ annualDividendPerShare: 2, price: 50 }))).toBeCloseTo(0.04, 12);
    expect(okValue(dividendYield({ annualDividendPerShare: 0, price: 50 }))).toBe(0);
    expect(dividendYield({ annualDividendPerShare: null, price: 50 }).status).toBe('MISSING');
    expect(dividendYield({ annualDividendPerShare: -1, price: 50 }).status).toBe('INVALID_INPUT');
    expect(dividendYield({ annualDividendPerShare: 1, price: 0 }).status).toBe('INVALID_INPUT');
  });
  it('pénznem-egyeztetés: GBP osztalék vs GBX ár (ISF@XLON eset)', () => {
    // 0.50 GBP / 2500 GBX (= 25 GBP) = 2%
    expect(
      okValue(
        dividendYieldFromMoney({
          annualDividendPerShare: money(0.5, 'GBP'),
          price: money(2500, 'GBX'),
        }),
      ),
    ).toBeCloseTo(0.02, 12);
    expect(
      okValue(
        dividendYieldFromMoney({
          annualDividendPerShare: money(50, 'GBX'),
          price: money(2500, 'GBX'),
        }),
      ),
    ).toBeCloseTo(0.02, 12);
  });
  it('eltérő pénznem (FX kell) → INVALID_INPUT; hiány → MISSING', () => {
    const result = dividendYieldFromMoney({
      annualDividendPerShare: money(1, 'USD'),
      price: money(50, 'EUR'),
    });
    expect(result.status).toBe('INVALID_INPUT');
    expect(failureReason(result)).toContain('FX');
    expect(
      dividendYieldFromMoney({ annualDividendPerShare: null, price: money(50, 'EUR') }).status,
    ).toBe('MISSING');
  });
});

describe('trailingDividendPerShare (TTM)', () => {
  const quarterly = [
    dividend('2025-09-10', 0.25), // ablakon kívül
    dividend('2025-11-20', 0.25), // pontosan az ablak eleje: kizárva (asOf − 365 nap)
    dividend('2025-12-10', 0.25),
    dividend('2026-03-10', 0.25),
    dividend('2026-06-10', 0.25),
    dividend('2026-11-20', 0.25), // pontosan asOf: beleszámít
  ];
  const usd = c('USD');

  it('az ablak (asOf − 365 nap, asOf] eseményeit összegzi', () => {
    const result = trailingDividendPerShare({
      events: quarterly,
      asOf: d('2026-11-20'),
      coverageStart: d('2021-11-20'),
      listingCurrency: usd,
    });
    expect(okValue(result)).toEqual({ amount: 1, currency: usd });
    expect(okNotes(result)).toEqual([]);
  });

  it('split-korrigált összeg az elsődleges; hiányában nyers összeg + megjegyzés', () => {
    const result = trailingDividendPerShare({
      events: [dividend('2026-05-01', 0.8, 'USD', 0.2), dividend('2026-08-01', 0.2, 'USD', null)],
      asOf: d('2026-11-20'),
      coverageStart: d('2020-01-01'),
      listingCurrency: usd,
    });
    expect(okValue(result).amount).toBeCloseTo(0.4, 12);
    expect(okNotes(result)[0]).toContain('nyers');
  });

  it('a lefedettség az ablaknál később kezdődik → INSUFFICIENT_DATA; az első napon OK', () => {
    const base = { events: quarterly, asOf: d('2026-11-20'), listingCurrency: usd };
    expect(trailingDividendPerShare({ ...base, coverageStart: d('2026-01-01') }).status).toBe(
      'INSUFFICIENT_DATA',
    );
    expect(trailingDividendPerShare({ ...base, coverageStart: d('2025-11-21') }).status).toBe('OK');
  });

  it('nincs esemény: ismeretlen lefedettség → MISSING; ismert → 0 (fő pénznemben)', () => {
    expect(
      trailingDividendPerShare({
        events: [],
        asOf: d('2026-11-20'),
        coverageStart: null,
        listingCurrency: usd,
      }).status,
    ).toBe('MISSING');
    const zero = trailingDividendPerShare({
      events: [],
      asOf: d('2026-11-20'),
      coverageStart: d('2020-01-01'),
      listingCurrency: c('GBX'),
    });
    expect(okValue(zero)).toEqual({ amount: 0, currency: c('GBP') });
  });

  it('ismeretlen lefedettség, de van esemény → OK + figyelmeztetés', () => {
    const result = trailingDividendPerShare({
      events: quarterly,
      asOf: d('2026-11-20'),
      coverageStart: null,
      listingCurrency: usd,
    });
    expect(okNotes(result).join(' ')).toContain('ismeretlen');
  });

  it('GBX és GBP vegyesen → GBP-ben összegez; más eltérő pénznem → INVALID_INPUT', () => {
    const mixedPenny = trailingDividendPerShare({
      events: [dividend('2026-03-01', 50, 'GBX'), dividend('2026-09-01', 0.5, 'GBP')],
      asOf: d('2026-11-20'),
      coverageStart: d('2020-01-01'),
      listingCurrency: c('GBX'),
    });
    expect(okValue(mixedPenny).amount).toBeCloseTo(1, 12);
    expect(okValue(mixedPenny).currency).toBe('GBP');
    expect(
      trailingDividendPerShare({
        events: [dividend('2026-03-01', 1, 'USD'), dividend('2026-09-01', 1, 'EUR')],
        asOf: d('2026-11-20'),
        coverageStart: d('2020-01-01'),
        listingCurrency: usd,
      }).status,
    ).toBe('INVALID_INPUT');
  });
});

describe('marginOfSafety', () => {
  it('(100 − 80) / 100 = 0.2; ár a belső érték felett → negatív', () => {
    expect(okValue(marginOfSafety({ intrinsicValue: 100, price: 80 }))).toBeCloseTo(0.2, 12);
    expect(okValue(marginOfSafety({ intrinsicValue: 100, price: 120 }))).toBeCloseTo(-0.2, 12);
  });
  it.each([0, -5])('belső érték = %p → INVALID_INPUT', (intrinsicValue) => {
    expect(marginOfSafety({ intrinsicValue, price: 80 }).status).toBe('INVALID_INPUT');
  });
});

describe('ár adott biztonsági sávnál (PHASE 10, D-073)', () => {
  it('a MOS-definíció inverze: P = IV × (1 − MOS)', () => {
    expect(okValue(priceAtMarginOfSafety({ intrinsicValue: 200, marginOfSafety: 0.25 }))).toBe(150);
    expect(
      okValue(priceAtMarginOfSafety({ intrinsicValue: 200, marginOfSafety: -0.1 })),
    ).toBeCloseTo(220, 10);
    const price = okValue(priceAtMarginOfSafety({ intrinsicValue: 137.5, marginOfSafety: 0.3 }));
    expect(okValue(marginOfSafety({ intrinsicValue: 137.5, price }))).toBeCloseTo(0.3, 12);
  });
  it('IV ≤ 0 vagy MOS ≥ 1 → INVALID_INPUT; hiány → MISSING', () => {
    expect(priceAtMarginOfSafety({ intrinsicValue: 0, marginOfSafety: 0.2 }).status).toBe(
      'INVALID_INPUT',
    );
    expect(
      failureReason(priceAtMarginOfSafety({ intrinsicValue: 10, marginOfSafety: 1 })),
    ).toContain('1 alatti');
    expect(priceAtMarginOfSafety({ intrinsicValue: null, marginOfSafety: 0.2 }).status).toBe(
      'MISSING',
    );
  });
});
