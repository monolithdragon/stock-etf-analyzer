/**
 * PHASE 15 – képlet-ellenőrzőlista: a `docs/DATA_DICTIONARY.md` 5. fejezetének definíciói vs az
 * implementáció (`@/calculations`). Soronként: egy KÉZZEL számolt példa a dokumentált képletre és
 * legalább egy dokumentált speciális eset (N/M, érvénytelen bemenet, hiány ≠ 0).
 *
 * Az elvárt értékek a dokumentált képletből fejben/papíron számoltak (a kommentben), NEM a
 * tesztelt függvénnyel. A részletes, határeset-szintű tesztek a modulok saját tesztjeiben vannak;
 * ez a fájl a dokumentáció ↔ kód megfelelést őrzi. Az eredmény: `docs/QA_REPORT.md` 5. fejezet.
 */
import {
  annualizeReturn,
  annualizedVolatility,
  annualTerCost,
  cagr,
  debtToEquity,
  effectiveTaxRate,
  enterpriseValue,
  evToEbitda,
  fcfConversion,
  fcfYield,
  freeCashFlow,
  futureValueOfContributions,
  grossMargin,
  growthRate,
  holdingsConcentration,
  holdingsOverlap,
  investedCapital,
  marginOfSafety,
  marketCap,
  maxDrawdown,
  netDebt,
  netMargin,
  nopat,
  pegRatio,
  priceChangeFromEpsAndMultiple,
  priceToEarnings,
  realReturn,
  requiredRecovery,
  roe,
  roic,
  runDcf,
  simpleReturn,
  weightedReturn,
  type CalcResult,
} from '@/calculations';
import { parseIsoDate, type PricePoint, type Result } from '@/domain';

function value<T>(result: CalcResult<T>): T {
  if (result.status !== 'OK') throw new Error(`${result.status}: ${result.reason}`);
  return result.value;
}
function must<T>(result: Result<T>): T {
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}

describe('5.1 Jövedelmezőség és növekedés', () => {
  it('Gross Margin = grossProfit / revenue; revenue ≤ 0 → NOT_MEANINGFUL', () => {
    expect(value(grossMargin({ grossProfit: 40, revenue: 100 }))).toBeCloseTo(0.4, 12);
    expect(grossMargin({ grossProfit: 40, revenue: 0 }).status).toBe('NOT_MEANINGFUL');
  });

  it('Net Margin = netIncome / revenue; negatív eredmény → negatív marzs (OK)', () => {
    expect(value(netMargin({ netIncome: -10, revenue: 100 }))).toBeCloseTo(-0.1, 12);
  });

  it('Növekedés = (X_t − X_{t−1}) / X_{t−1}; negatív bázis → N/M; pozitívból negatívba OK', () => {
    expect(value(growthRate({ current: 120, previous: 100 }))).toBeCloseTo(0.2, 12);
    expect(value(growthRate({ current: -50, previous: 100 }))).toBeCloseTo(-1.5, 12);
    expect(growthRate({ current: 100, previous: -50 }).status).toBe('NOT_MEANINGFUL');
    expect(growthRate({ current: 100, previous: 0 }).status).toBe('NOT_MEANINGFUL');
  });

  it('CAGR = (end / start)^(1/évek) − 1 (100 → 121, 2 év = 10%); végpont ≤ 0 → N/M', () => {
    expect(value(cagr({ startValue: 100, endValue: 121, years: 2 }))).toBeCloseTo(0.1, 12);
    expect(cagr({ startValue: 100, endValue: 0, years: 2 }).status).toBe('NOT_MEANINGFUL');
    expect(cagr({ startValue: 100, endValue: 121, years: 0 }).status).toBe('INVALID_INPUT');
  });

  it('Effektív adókulcs = adó / adózás előtti eredmény; pretax ≤ 0 → N/M', () => {
    expect(value(effectiveTaxRate({ incomeTaxExpense: 21, pretaxIncome: 100 }))).toBeCloseTo(
      0.21,
      12,
    );
    expect(effectiveTaxRate({ incomeTaxExpense: 1, pretaxIncome: -5 }).status).toBe(
      'NOT_MEANINGFUL',
    );
  });

  it('NOPAT = EBIT × (1 − t) (100, 21% → 79); t = 21 (százalék) → INVALID_INPUT', () => {
    expect(value(nopat({ operatingIncome: 100, taxRate: 0.21 }))).toBeCloseTo(79, 10);
    expect(nopat({ operatingIncome: 100, taxRate: 21 }).status).toBe('INVALID_INPUT');
  });

  it('Invested Capital = equity + debt − cash (500 + 200 − 100 = 600)', () => {
    expect(
      value(investedCapital({ shareholdersEquity: 500, totalDebt: 200, cashAndEquivalents: 100 })),
    ).toBe(600);
  });

  it('ROE = NI / avg(equity) (100 / avg(400, 600) = 20%); bármely equity ≤ 0 → N/M', () => {
    expect(value(roe({ netIncome: 100, equityStart: 400, equityEnd: 600 }))).toBeCloseTo(0.2, 12);
    expect(roe({ netIncome: 100, equityStart: -1, equityEnd: 600 }).status).toBe('NOT_MEANINGFUL');
  });

  it('ROIC = NOPAT / avg(IC) (79 / avg(500, 700)); bármely IC ≤ 0 → N/M', () => {
    expect(
      value(roic({ nopat: 79, investedCapitalStart: 500, investedCapitalEnd: 700 })),
    ).toBeCloseTo(79 / 600, 12);
    expect(roic({ nopat: 79, investedCapitalStart: 0, investedCapitalEnd: 700 }).status).toBe(
      'NOT_MEANINGFUL',
    );
  });
});

describe('5.2 Mérleg és cash flow', () => {
  it('Net Debt = debt − cash (200 − 50 = 150); negatív adósság → INVALID_INPUT', () => {
    expect(value(netDebt({ totalDebt: 200, cashAndEquivalents: 50 }))).toBe(150);
    expect(netDebt({ totalDebt: -1, cashAndEquivalents: 50 }).status).toBe('INVALID_INPUT');
  });

  it('Debt/Equity = debt / equity (200 / 400 = 0.5); equity ≤ 0 → N/M', () => {
    expect(value(debtToEquity({ totalDebt: 200, shareholdersEquity: 400 }))).toBeCloseTo(0.5, 12);
    expect(debtToEquity({ totalDebt: 200, shareholdersEquity: 0 }).status).toBe('NOT_MEANINGFUL');
  });

  it('FCF = OCF − CapEx (150 − 50 = 100); negatív FCF OK; CapEx < 0 → INVALID_INPUT; hiány ≠ 0', () => {
    expect(value(freeCashFlow({ operatingCashFlow: 150, capitalExpenditure: 50 }))).toBe(100);
    expect(value(freeCashFlow({ operatingCashFlow: 50, capitalExpenditure: 80 }))).toBe(-30);
    expect(freeCashFlow({ operatingCashFlow: 150, capitalExpenditure: -50 }).status).toBe(
      'INVALID_INPUT',
    );
    expect(freeCashFlow({ operatingCashFlow: 150, capitalExpenditure: null }).status).toBe(
      'MISSING',
    );
  });

  it('FCF Conversion = FCF / NI (100 / 80 = 1.25); NI ≤ 0 → N/M', () => {
    expect(value(fcfConversion({ freeCashFlow: 100, netIncome: 80 }))).toBeCloseTo(1.25, 12);
    expect(fcfConversion({ freeCashFlow: 100, netIncome: 0 }).status).toBe('NOT_MEANINGFUL');
  });
});

describe('5.3 Piaci és értékelési mutatók', () => {
  it('Market Cap = ár × részvényszám (10 × 1000); ár ≤ 0 → INVALID_INPUT', () => {
    expect(value(marketCap({ price: 10, sharesOutstanding: 1000 }))).toBe(10_000);
    expect(marketCap({ price: 0, sharesOutstanding: 1000 }).status).toBe('INVALID_INPUT');
  });

  it('EV = market cap + debt − cash (10000 + 2000 − 500 = 11500)', () => {
    expect(
      value(enterpriseValue({ marketCap: 10_000, totalDebt: 2000, cashAndEquivalents: 500 })),
    ).toBe(11_500);
  });

  it('P/E = ár / EPS (100 / 5 = 20); EPS ≤ 0 → NOT_MEANINGFUL (nem negatív P/E)', () => {
    expect(value(priceToEarnings({ price: 100, eps: 5 }))).toBeCloseTo(20, 12);
    expect(priceToEarnings({ price: 100, eps: -1 }).status).toBe('NOT_MEANINGFUL');
    expect(priceToEarnings({ price: 100, eps: 0 }).status).toBe('NOT_MEANINGFUL');
  });

  it('EV/EBITDA = EV / EBITDA (11500 / 1150 = 10); EBITDA ≤ 0 → N/M', () => {
    expect(value(evToEbitda({ enterpriseValue: 11_500, ebitda: 1150 }))).toBeCloseTo(10, 12);
    expect(evToEbitda({ enterpriseValue: 11_500, ebitda: 0 }).status).toBe('NOT_MEANINGFUL');
  });

  it('PEG = P/E / (növekedés × 100) (20, 0.10 → 2.0); növekedés ≤ 0 → N/M', () => {
    expect(value(pegRatio({ priceToEarnings: 20, epsGrowthRate: 0.1 }))).toBeCloseTo(2, 12);
    expect(pegRatio({ priceToEarnings: 20, epsGrowthRate: 0 }).status).toBe('NOT_MEANINGFUL');
  });

  it('FCF Yield = FCF / market cap; negatív FCF → negatív hozam (OK)', () => {
    expect(value(fcfYield({ freeCashFlow: -100, marketCap: 10_000 }))).toBeCloseTo(-0.01, 12);
  });

  it('MOS = (IV − ár) / IV (125, 100 → 20%); IV ≤ 0 → INVALID_INPUT', () => {
    expect(value(marginOfSafety({ intrinsicValue: 125, price: 100 }))).toBeCloseTo(0.2, 12);
    expect(marginOfSafety({ intrinsicValue: 0, price: 100 }).status).toBe('INVALID_INPUT');
  });

  it('Reálhozam = (1 + n) / (1 + i) − 1 (pontos Fisher: 10%, 5% → 4,7619%)', () => {
    expect(value(realReturn({ nominalReturn: 0.1, inflation: 0.05 }))).toBeCloseTo(
      1.1 / 1.05 - 1,
      12,
    );
  });

  it('Árváltozás EPS × P/E = (1 + g)(1 + Δ) − 1 (+10%, −10% → −1%)', () => {
    expect(
      value(priceChangeFromEpsAndMultiple({ epsGrowth: 0.1, multipleChange: -0.1 })),
    ).toBeCloseTo(-0.01, 12);
  });
});

describe('5.4 DCF', () => {
  // 1 év, g_1 = 10%, r = 10%, g_TV = 0, adósság = pénz = 0, 10 részvény, ár 88:
  // fcf_1 = 110; PV_1 = 100; TV = 110 × 1 / 0,1 = 1100; PV_TV = 1000; EV = 1100;
  // IV/részvény = 110; MOS = (110 − 88) / 110 = 20%; TV-arány = 1000 / 1100.
  const BASE = {
    baseFcf: 100,
    growthRates: [0.1],
    discountRate: 0.1,
    terminalGrowth: 0,
    totalDebt: 0,
    cash: 0,
    sharesOutstanding: 10,
    marketPrice: 88,
  };

  it('a dokumentált képletek kézzel számolt példán', () => {
    const dcf = value(runDcf(BASE));
    expect(dcf.years[0]?.fcf).toBeCloseTo(110, 10);
    expect(dcf.years[0]?.presentValue).toBeCloseTo(100, 10);
    expect(dcf.terminalValue).toBeCloseTo(1100, 8);
    expect(dcf.pvTerminalValue).toBeCloseTo(1000, 8);
    expect(dcf.enterpriseValue).toBeCloseTo(1100, 8);
    expect(dcf.terminalValueShare).toBeCloseTo(1000 / 1100, 12);
    expect(dcf.intrinsicValuePerShare).toBeCloseTo(110, 8);
    expect(value(dcf.marginOfSafety)).toBeCloseTo(0.2, 10);
  });

  it('equity = EV − adósság + pénz', () => {
    const dcf = value(runDcf({ ...BASE, totalDebt: 300, cash: 100 }));
    expect(dcf.equityValue).toBeCloseTo(1100 - 300 + 100, 8);
  });

  it('r ≤ g → INVALID_INPUT; hiányzó adósság → MISSING (nem 0); kiinduló FCF ≤ 0 → N/M', () => {
    expect(runDcf({ ...BASE, terminalGrowth: 0.1 }).status).toBe('INVALID_INPUT');
    expect(runDcf({ ...BASE, totalDebt: null }).status).toBe('MISSING');
    expect(runDcf({ ...BASE, baseFcf: 0 }).status).toBe('NOT_MEANINGFUL');
    expect(runDcf({ ...BASE, discountRate: 9 }).status).toBe('INVALID_INPUT');
  });

  it('ár nélkül a DCF lefut, csak a MOS MISSING', () => {
    const dcf = value(runDcf({ ...BASE, marketPrice: null }));
    expect(dcf.marginOfSafety.status).toBe('MISSING');
  });
});

describe('5.5 Hozam, kockázat, ETF, portfólió', () => {
  const d = (iso: string) => must(parseIsoDate(iso));

  it('Egyszerű hozam = P_t / P_{t−1} − 1 (100 → 110 = 10%); nyitó ≤ 0 → INVALID_INPUT', () => {
    expect(value(simpleReturn({ startValue: 100, endValue: 110 }))).toBeCloseTo(0.1, 12);
    expect(simpleReturn({ startValue: 0, endValue: 110 }).status).toBe('INVALID_INPUT');
  });

  it('Évesített hozam = (1 + R)^(1/évek) − 1 (21%, 2 év → 10%)', () => {
    expect(value(annualizeReturn({ periodReturn: 0.21, years: 2 }))).toBeCloseTo(0.1, 12);
  });

  it('Max drawdown = min(P_t / max(P_0..P_t) − 1) + csúcs/mélypont/helyreállás dátuma', () => {
    const points: PricePoint[] = [
      { date: d('2026-01-01'), close: 100 },
      { date: d('2026-01-02'), close: 120 },
      { date: d('2026-01-03'), close: 60 },
      { date: d('2026-01-04'), close: 130 },
    ];
    const dd = value(maxDrawdown(points));
    expect(dd.maxDrawdown).toBeCloseTo(-0.5, 12);
    expect(dd.peakDate).toBe('2026-01-02');
    expect(dd.troughDate).toBe('2026-01-03');
    expect(dd.recoveryDate).toBe('2026-01-04');
  });

  it('Szükséges recovery = 1 / (1 + DD) − 1 (−50% → +100%); DD > 0 → INVALID_INPUT', () => {
    expect(value(requiredRecovery({ drawdown: -0.5 }))).toBeCloseTo(1, 12);
    expect(requiredRecovery({ drawdown: 0.1 }).status).toBe('INVALID_INPUT');
  });

  it('Volatilitás = minta-szórás × √252 (±1% váltakozva: √(0,0004/3) × √252)', () => {
    const vol = value(
      annualizedVolatility({
        returns: [0.01, -0.01, 0.01, -0.01],
        periodsPerYear: 252,
        minObservations: 4,
      }),
    );
    expect(vol).toBeCloseTo(Math.sqrt(0.0004 / 3) * Math.sqrt(252), 12);
    expect(
      annualizedVolatility({ returns: [0.01], periodsPerYear: 252, minObservations: 4 }).status,
    ).toBe('INSUFFICIENT_DATA');
  });

  it('HHI = Σ (w/Σw)²; effektív N = 1 / HHI (két 50%-os tétel → 0,5 és 2)', () => {
    const c = value(holdingsConcentration({ weights: [0.5, 0.5], isComplete: true }));
    expect(c.herfindahl).toBeCloseTo(0.5, 12);
    expect(c.effectiveHoldings).toBeCloseTo(2, 12);
  });

  it('ETF-átfedés = Σ min(w_A, w_B) a közös kulcsokra (A: 60/40, B: 30/70 → 30%)', () => {
    const o = value(
      holdingsOverlap({
        a: [
          { key: 'A', weight: 0.6 },
          { key: 'B', weight: 0.4 },
        ],
        b: [
          { key: 'A', weight: 0.3 },
          { key: 'C', weight: 0.7 },
        ],
        bothComplete: true,
      }),
    );
    expect(o.overlapWeight).toBeCloseTo(0.3, 12);
    expect(o.commonCount).toBe(1);
  });

  it('Súlyozott hozam = Σ w·r (0,6·10% + 0,4·(−5%) = 4%); Σw ≠ 1 → INVALID_INPUT; hiány → MISSING', () => {
    expect(
      value(
        weightedReturn([
          { id: 'a', weight: 0.6, return: 0.1 },
          { id: 'b', weight: 0.4, return: -0.05 },
        ]),
      ),
    ).toBeCloseTo(0.04, 12);
    expect(
      weightedReturn([
        { id: 'a', weight: 60, return: 0.1 },
        { id: 'b', weight: 40, return: -0.05 },
      ]).status,
    ).toBe('INVALID_INPUT');
    expect(
      weightedReturn([
        { id: 'a', weight: 0.6, return: 0.1 },
        { id: 'b', weight: 0.4, return: null },
      ]).status,
    ).toBe('MISSING');
  });

  it('FV: időszak végén PMT × ((1+i)^n − 1) / i; elején × (1 + i); i = 0 → PMT × n', () => {
    // évi 1 befizetés, 10%, 2 év: vég = 100 × (1,21 − 1) / 0,1 = 210; eleje = 231.
    const end = value(
      futureValueOfContributions({
        periodicPayment: 100,
        annualRate: 0.1,
        years: 2,
        timing: 'end',
        periodsPerYear: 1,
      }),
    );
    const begin = value(
      futureValueOfContributions({
        periodicPayment: 100,
        annualRate: 0.1,
        years: 2,
        timing: 'begin',
        periodsPerYear: 1,
      }),
    );
    const zero = value(
      futureValueOfContributions({ periodicPayment: 100, annualRate: 0, years: 1, timing: 'end' }),
    );
    expect(end.futureValue).toBeCloseTo(210, 10);
    expect(begin.futureValue).toBeCloseTo(231, 10);
    expect(zero.futureValue).toBeCloseTo(1200, 10);
  });

  it('TER költség = összeg × TER (10000 × 0,22% = 22); TER = 0,22 (22%!) → INVALID_INPUT', () => {
    expect(value(annualTerCost({ investedAmount: 10_000, ter: 0.0022 }))).toBeCloseTo(22, 10);
    expect(annualTerCost({ investedAmount: 10_000, ter: 0.22 }).status).toBe('INVALID_INPUT');
  });
});
