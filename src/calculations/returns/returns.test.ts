import type { IsoDate, PricePoint } from '@/domain';

import {
  annualizedMultipleChange,
  annualizeReturn,
  decomposePriceReturn,
  expectedReturnBreakdown,
  priceChangeFromEpsAndMultiple,
  realReturn,
  seriesReturn,
  simpleReturn,
  totalReturnFromPrices,
  yearsBetween,
} from './returns';
import { okNotes, okValue } from '../core/testing';

const d = (value: string) => value as IsoDate;
const points = (...closes: number[]): PricePoint[] =>
  closes.map((close, index) => ({
    date: d(`2026-01-${String(index + 1).padStart(2, '0')}`),
    close,
  }));

describe('simpleReturn', () => {
  it('110 / 100 − 1 = 0.1; nulla záróár = −100%', () => {
    expect(okValue(simpleReturn({ startValue: 100, endValue: 110 }))).toBeCloseTo(0.1, 12);
    expect(okValue(simpleReturn({ startValue: 100, endValue: 0 }))).toBe(-1);
  });
  it('nyitó ≤ 0 vagy negatív záró → INVALID_INPUT', () => {
    expect(simpleReturn({ startValue: 0, endValue: 110 }).status).toBe('INVALID_INPUT');
    expect(simpleReturn({ startValue: 100, endValue: -1 }).status).toBe('INVALID_INPUT');
  });
});

describe('total return', () => {
  it('(105 + 3) / 100 − 1 = 8%, újrabefektetés nélkül (megjegyzés)', () => {
    const result = totalReturnFromPrices({ startPrice: 100, endPrice: 105, dividendsPerShare: 3 });
    expect(okValue(result)).toBeCloseTo(0.08, 12);
    expect(okNotes(result)[0]).toContain('újrabefektetés');
  });
  it('hiányzó osztalék → MISSING (nem árhozam csendben)', () => {
    expect(
      totalReturnFromPrices({ startPrice: 100, endPrice: 105, dividendsPerShare: null }).status,
    ).toBe('MISSING');
  });

  it('ártörténetből a korrekció szerint címkézve', () => {
    const total = seriesReturn({ adjustment: 'SPLIT_DIVIDEND', points: points(100, 90, 120) });
    expect(okValue(total)).toEqual({
      value: expect.closeTo(0.2, 12),
      basis: 'total_return',
      startDate: '2026-01-01',
      endDate: '2026-01-03',
    });
    expect(okNotes(total)).toEqual([]);
    const price = seriesReturn({ adjustment: 'SPLIT', points: points(100, 120) });
    expect(okValue(price).basis).toBe('price_return');
    expect(okNotes(price)[0]).toContain('osztalék nélkül');
    const raw = seriesReturn({ adjustment: 'NONE', points: points(100, 120) });
    expect(okValue(raw).basis).toBe('raw_price_return');
    expect(okNotes(raw)[0]).toContain('felosztás');
  });
  it('kevesebb mint 2 pont → INSUFFICIENT_DATA', () => {
    expect(seriesReturn({ adjustment: 'SPLIT', points: points(100) }).status).toBe(
      'INSUFFICIENT_DATA',
    );
    expect(seriesReturn({ adjustment: 'SPLIT', points: [] }).status).toBe('INSUFFICIENT_DATA');
  });
});

describe('évesítés', () => {
  it('évek két dátum között: 2192 nap / 365.25', () => {
    expect(okValue(yearsBetween(d('2020-01-01'), d('2026-01-01')))).toBeCloseTo(2192 / 365.25, 12);
    expect(yearsBetween(d('2026-01-01'), d('2026-01-01')).status).toBe('INVALID_INPUT');
  });
  it('(1 + 0.21)^(1/2) − 1 = 10%', () => {
    expect(okValue(annualizeReturn({ periodReturn: 0.21, years: 2 }))).toBeCloseTo(0.1, 12);
  });
  it('1 évnél rövidebb időszak → OK, figyelmeztetéssel', () => {
    expect(okNotes(annualizeReturn({ periodReturn: 0.05, years: 0.5 }))[0]).toContain('rövidebb');
  });
  it('teljes veszteség −100% marad; −100% alatt vagy évek ≤ 0 → INVALID_INPUT', () => {
    expect(okValue(annualizeReturn({ periodReturn: -1, years: 2 }))).toBe(-1);
    expect(annualizeReturn({ periodReturn: -1.5, years: 2 }).status).toBe('INVALID_INPUT');
    expect(annualizeReturn({ periodReturn: 0.1, years: 0 }).status).toBe('INVALID_INPUT');
  });
});

describe('realReturn', () => {
  it('(1.08 / 1.03) − 1 ≈ 4.854% (nem 5%)', () => {
    expect(okValue(realReturn({ nominalReturn: 0.08, inflation: 0.03 }))).toBeCloseTo(
      1.08 / 1.03 - 1,
      12,
    );
  });
  it('defláció mellett a reálhozam nagyobb a nominálisnál', () => {
    expect(okValue(realReturn({ nominalReturn: 0, inflation: -0.02 }))).toBeCloseTo(
      1 / 0.98 - 1,
      12,
    );
  });
  it('infláció ≤ −1 vagy nominális < −1 → INVALID_INPUT; hiány → MISSING', () => {
    expect(realReturn({ nominalReturn: 0.05, inflation: -1 }).status).toBe('INVALID_INPUT');
    expect(realReturn({ nominalReturn: -2, inflation: 0.03 }).status).toBe('INVALID_INPUT');
    expect(realReturn({ nominalReturn: 0.05, inflation: null }).status).toBe('MISSING');
  });
});

describe('árfolyam = EPS × P/E felbontás', () => {
  it('+10% EPS és −10% P/E → −1% ár (nem 0%)', () => {
    expect(
      okValue(priceChangeFromEpsAndMultiple({ epsGrowth: 0.1, multipleChange: -0.1 })),
    ).toBeCloseTo(-0.01, 12);
    expect(priceChangeFromEpsAndMultiple({ epsGrowth: -1, multipleChange: 0 }).status).toBe(
      'INVALID_INPUT',
    );
  });
  it('múltbeli felbontás: 100 → 132, EPS 5 → 6 (P/E 20 → 22)', () => {
    const result = okValue(
      decomposePriceReturn({ priceStart: 100, priceEnd: 132, epsStart: 5, epsEnd: 6 }),
    );
    expect(result.priceReturn).toBeCloseTo(0.32, 12);
    expect(result.epsGrowth).toBeCloseTo(0.2, 12);
    expect(result.multipleChange).toBeCloseTo(0.1, 12);
    expect(result.interaction).toBeCloseTo(0.02, 12);
    expect(result.epsGrowth + result.multipleChange + result.interaction).toBeCloseTo(
      result.priceReturn,
      12,
    );
  });
  it('negatív EPS → NOT_MEANINGFUL; nulla ár → INVALID_INPUT', () => {
    expect(
      decomposePriceReturn({ priceStart: 100, priceEnd: 132, epsStart: -1, epsEnd: 6 }).status,
    ).toBe('NOT_MEANINGFUL');
    expect(
      decomposePriceReturn({ priceStart: 0, priceEnd: 132, epsStart: 5, epsEnd: 6 }).status,
    ).toBe('INVALID_INPUT');
  });
  it('évesített P/E-változás: 20 → 16.2 két év alatt = −10%/év; negatív P/E → N/M', () => {
    expect(okValue(annualizedMultipleChange({ peStart: 20, peEnd: 16.2, years: 2 }))).toBeCloseTo(
      -0.1,
      12,
    );
    expect(annualizedMultipleChange({ peStart: -5, peEnd: 16, years: 2 }).status).toBe(
      'NOT_MEANINGFUL',
    );
  });
});

describe('elvárt hozam – mentális modell', () => {
  it('2% osztalék + (1.05 × 0.99 − 1) = 5.95%, „nem előrejelzés” megjegyzéssel', () => {
    const result = expectedReturnBreakdown({
      dividendYield: 0.02,
      earningsGrowth: 0.05,
      annualMultipleChange: -0.01,
    });
    expect(okValue(result).total).toBeCloseTo(0.0595, 12);
    expect(okValue(result).dividendYield).toBe(0.02);
    expect(okNotes(result)[0]).toContain('nem előrejelzés');
  });
  it('negatív osztalékhozam vagy ≤ −100% növekedés → INVALID_INPUT', () => {
    expect(
      expectedReturnBreakdown({
        dividendYield: -0.01,
        earningsGrowth: 0.05,
        annualMultipleChange: 0,
      }).status,
    ).toBe('INVALID_INPUT');
    expect(
      expectedReturnBreakdown({ dividendYield: 0.02, earningsGrowth: -1, annualMultipleChange: 0 })
        .status,
    ).toBe('INVALID_INPUT');
  });
});
