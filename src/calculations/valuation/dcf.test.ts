import {
  DCF_MAX_EXPLICIT_YEARS,
  constantGrowthRates,
  describeRate,
  runDcf,
  type DcfInput,
} from './dcf';
import { failureReason, okNotes, okValue } from '../core/testing';

/**
 * Golden eset (kézzel számolva):
 *   FCF: 110, 121, 133.1 → PV mindháromra 100 (10%-on) → Σ PV = 300
 *   TV = 133.1 × 1.02 / 0.08 = 1697.025;  PV_TV = 1697.025 / 1.331 = 1275
 *   EV = 1575;  Equity = 1575 − 50 + 20 = 1545;  IV/részvény = 154.5
 *   MOS = (154.5 − 80) / 154.5 = 0.48220064…;  TV-arány = 1275 / 1575 = 0.8095…
 */
const GOLDEN: DcfInput = {
  baseFcf: 100,
  growthRates: [0.1, 0.1, 0.1],
  discountRate: 0.1,
  terminalGrowth: 0.02,
  totalDebt: 50,
  cash: 20,
  sharesOutstanding: 10,
  marketPrice: 80,
};

describe('runDcf – normál eset', () => {
  it('3 éves golden: éves FCF, PV, TV, PV_TV, EV, equity, IV/részvény, MOS', () => {
    const r = okValue(runDcf(GOLDEN));
    expect(r.years.map((y) => y.fcf)).toEqual([
      expect.closeTo(110, 9),
      expect.closeTo(121, 9),
      expect.closeTo(133.1, 9),
    ]);
    for (const y of r.years) expect(y.presentValue).toBeCloseTo(100, 9);
    expect(r.years.map((y) => y.year)).toEqual([1, 2, 3]);
    expect(r.years[2]!.discountFactor).toBeCloseTo(1 / 1.331, 12);
    expect(r.sumPvExplicit).toBeCloseTo(300, 9);
    expect(r.terminalValue).toBeCloseTo(1697.025, 9);
    expect(r.pvTerminalValue).toBeCloseTo(1275, 9);
    expect(r.enterpriseValue).toBeCloseTo(1575, 9);
    expect(r.equityValue).toBeCloseTo(1545, 9);
    expect(r.intrinsicValuePerShare).toBeCloseTo(154.5, 9);
    expect(r.terminalValueShare).toBeCloseTo(1275 / 1575, 12);
    expect(okValue(r.marginOfSafety)).toBeCloseTo((154.5 - 80) / 154.5, 12);
  });

  it('a 75% fölötti TV-arányt megjegyzés jelzi', () => {
    expect(okNotes(runDcf(GOLDEN)).join(' ')).toContain('terminális érték jelenértéke');
  });

  it('azonosság: nulla növekedés és g = 0 → EV = FCF / r (örökjáradék), 5 éves alapesettel', () => {
    const r = okValue(
      runDcf({ ...GOLDEN, growthRates: constantGrowthRates(0, 5), terminalGrowth: 0 }),
    );
    expect(r.years).toHaveLength(5);
    expect(r.enterpriseValue).toBeCloseTo(1000, 9);
  });

  it(`1 és ${DCF_MAX_EXPLICIT_YEARS} év közötti időtáv támogatott; évente eltérő ráta megengedett`, () => {
    expect(okValue(runDcf({ ...GOLDEN, growthRates: [0.05] })).years).toHaveLength(1);
    expect(
      okValue(runDcf({ ...GOLDEN, growthRates: constantGrowthRates(0.03, 10) })).years,
    ).toHaveLength(10);
    const varied = okValue(runDcf({ ...GOLDEN, growthRates: [0.2, 0, -0.5] }));
    expect(varied.years.map((y) => y.fcf)).toEqual([
      expect.closeTo(120, 9),
      expect.closeTo(120, 9),
      expect.closeTo(60, 9),
    ]);
  });

  it('a nettó készpénz növeli, az adósság csökkenti az equity-t; explicit 0 adósság/pénz OK', () => {
    const noBalance = okValue(runDcf({ ...GOLDEN, totalDebt: 0, cash: 0 }));
    expect(noBalance.equityValue).toBeCloseTo(noBalance.enterpriseValue, 9);
  });

  it('determinisztikus és nem kerekít', () => {
    expect(runDcf(GOLDEN)).toEqual(runDcf(GOLDEN));
    const r = okValue(runDcf({ ...GOLDEN, sharesOutstanding: 3 }));
    expect(r.intrinsicValuePerShare).toBe(r.equityValue / 3);
  });

  it('mérsékelt feltevéseknél nincs figyelmeztető megjegyzés', () => {
    const r = runDcf({ ...GOLDEN, growthRates: constantGrowthRates(0.05, 10), discountRate: 0.12 });
    expect(okNotes(r)).toEqual([]);
  });
});

describe('runDcf – r > g feltétel (Gordon)', () => {
  it.each([
    ['r = g', 0.05, 0.05],
    ['r < g', 0.05, 0.08],
  ])('%s → INVALID_INPUT emberi magyarázattal', (_label, discountRate, terminalGrowth) => {
    const r = runDcf({ ...GOLDEN, discountRate, terminalGrowth });
    expect(r.status).toBe('INVALID_INPUT');
    const reason = failureReason(r);
    expect(reason).toContain('nem nagyobb a terminális növekedésnél');
    expect(reason).toContain('Csökkentsd a terminális növekedést');
    expect(reason).toContain('5.00%');
  });

  it('negatív terminális növekedés megengedett (csökkenő pénzáram), g ≤ −1 nem', () => {
    expect(runDcf({ ...GOLDEN, terminalGrowth: -0.02 }).status).toBe('OK');
    expect(runDcf({ ...GOLDEN, terminalGrowth: -1 }).status).toBe('INVALID_INPUT');
  });

  it('szűk r − g különbség és 4% feletti terminális növekedés megjegyzést kap', () => {
    const notes = okNotes(runDcf({ ...GOLDEN, discountRate: 0.06, terminalGrowth: 0.045 })).join(
      ' ',
    );
    expect(notes).toContain('rendkívül érzékeny');
    expect(notes).toContain('optimista feltevés');
  });
});

describe('runDcf – érvénytelen bemenetek', () => {
  it.each([
    ['0', 0],
    ['negatív', -50],
  ])('%s kiinduló FCF → NOT_MEANINGFUL (felülírási tippel)', (_label, baseFcf) => {
    const r = runDcf({ ...GOLDEN, baseFcf });
    expect(r.status).toBe('NOT_MEANINGFUL');
    expect(failureReason(r)).toContain('felülírással');
  });

  it.each([
    ['0', 0],
    ['negatív', -10],
  ])('%s részvényszám → INVALID_INPUT', (_label, sharesOutstanding) => {
    const r = runDcf({ ...GOLDEN, sharesOutstanding });
    expect(r.status).toBe('INVALID_INPUT');
    expect(failureReason(r)).toContain('részvényszám');
  });

  it.each([
    ['totalDebt', { totalDebt: null }],
    ['cash', { cash: undefined }],
  ])('hiányzó %s → MISSING (nem 0!)', (name, patch) => {
    const r = runDcf({ ...GOLDEN, ...patch });
    expect(r.status).toBe('MISSING');
    expect(failureReason(r)).toContain(name);
    expect(failureReason(r)).toContain('nem vehető 0-nak');
  });

  it('hiányzó FCF, részvényszám vagy növekedési ráta → MISSING a bemenet nevével', () => {
    expect(failureReason(runDcf({ ...GOLDEN, baseFcf: null }))).toContain('baseFcf');
    expect(failureReason(runDcf({ ...GOLDEN, sharesOutstanding: null }))).toContain(
      'sharesOutstanding',
    );
    const gap = runDcf({ ...GOLDEN, growthRates: [0.1, null, 0.1] });
    expect(gap.status).toBe('MISSING');
    expect(failureReason(gap)).toContain('growthRate_2');
  });

  it('negatív adósság vagy pénz → INVALID_INPUT', () => {
    expect(runDcf({ ...GOLDEN, totalDebt: -1 }).status).toBe('INVALID_INPUT');
    expect(runDcf({ ...GOLDEN, cash: -1 }).status).toBe('INVALID_INPUT');
  });

  it.each([
    ['baseFcf', { baseFcf: Number.NaN }],
    ['discountRate', { discountRate: Number.POSITIVE_INFINITY }],
    ['totalDebt', { totalDebt: Number.NEGATIVE_INFINITY }],
    ['growthRate_1', { growthRates: [Number.NaN, 0.1, 0.1] }],
  ])('nem véges %s → INVALID_INPUT', (name, patch) => {
    const r = runDcf({ ...GOLDEN, ...patch });
    expect(r.status).toBe('INVALID_INPUT');
    expect(failureReason(r)).toContain(name);
  });

  it('diszkontráta: 0, negatív, százalékként (9) → INVALID_INPUT', () => {
    expect(runDcf({ ...GOLDEN, discountRate: 0 }).status).toBe('INVALID_INPUT');
    expect(runDcf({ ...GOLDEN, discountRate: -0.1 }).status).toBe('INVALID_INPUT');
    expect(failureReason(runDcf({ ...GOLDEN, discountRate: 9 }))).toContain('tizedes tört');
  });

  it('növekedési ráta > 100% (százalék-gyanú) vagy ≤ −100% → INVALID_INPUT', () => {
    expect(failureReason(runDcf({ ...GOLDEN, growthRates: [5, 0.1, 0.1] }))).toContain(
      'tizedes tört',
    );
    expect(runDcf({ ...GOLDEN, growthRates: [0.1, -1, 0.1] }).status).toBe('INVALID_INPUT');
    expect(runDcf({ ...GOLDEN, growthRates: [1] }).status).toBe('OK');
  });

  it('időtáv 0 vagy 11 év → INVALID_INPUT', () => {
    expect(failureReason(runDcf({ ...GOLDEN, growthRates: [] }))).toContain('1–10 év');
    expect(runDcf({ ...GOLDEN, growthRates: constantGrowthRates(0.05, 11) }).status).toBe(
      'INVALID_INPUT',
    );
  });
});

describe('runDcf – biztonsági sáv (MOS)', () => {
  it('ár a belső érték felett → negatív MOS', () => {
    const r = okValue(runDcf({ ...GOLDEN, marketPrice: 200 }));
    expect(okValue(r.marginOfSafety)).toBeCloseTo((154.5 - 200) / 154.5, 12);
  });

  it('nincs ár → a DCF OK, a MOS MISSING', () => {
    const { marketPrice: _omit, ...withoutPrice } = GOLDEN;
    const r = okValue(runDcf(withoutPrice));
    expect(r.intrinsicValuePerShare).toBeCloseTo(154.5, 9);
    expect(r.marginOfSafety.status).toBe('MISSING');
    expect(okValue(runDcf({ ...GOLDEN, marketPrice: null })).marginOfSafety.status).toBe('MISSING');
  });

  it('nem pozitív belső érték (adósság > EV) → MOS NOT_MEANINGFUL + megjegyzés', () => {
    const result = runDcf({ ...GOLDEN, totalDebt: 5000 });
    const r = okValue(result);
    expect(r.equityValue).toBeCloseTo(1575 - 5000 + 20, 9);
    expect(r.intrinsicValuePerShare).toBeLessThan(0);
    expect(r.marginOfSafety.status).toBe('NOT_MEANINGFUL');
    expect(okNotes(result).join(' ')).toContain('nem fedezi a nettó adósságot');
  });

  it('nem pozitív vagy nem véges ár → MOS INVALID_INPUT', () => {
    expect(okValue(runDcf({ ...GOLDEN, marketPrice: 0 })).marginOfSafety.status).toBe(
      'INVALID_INPUT',
    );
    expect(okValue(runDcf({ ...GOLDEN, marketPrice: Number.NaN })).marginOfSafety.status).toBe(
      'INVALID_INPUT',
    );
  });
});

describe('segédek', () => {
  it('describeRate: nyers érték + százalék', () => {
    expect(describeRate(0.09)).toBe('0.09 (9.00%)');
  });
  it('constantGrowthRates: n azonos ráta; nem pozitív n → üres', () => {
    expect(constantGrowthRates(0.05, 3)).toEqual([0.05, 0.05, 0.05]);
    expect(constantGrowthRates(0.05, 0)).toEqual([]);
    expect(constantGrowthRates(0.05, -2)).toEqual([]);
  });
});
