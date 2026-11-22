import type { ListingId, Metric, Money } from '@/domain';

import { buildPortfolioAnalysis } from './portfolio-analysis';
import {
  AAPL,
  baseInput,
  EUR,
  fxRate,
  GBP,
  GBX,
  holdings,
  ISF,
  lookup,
  meta,
  quote,
  quoteError,
  tx,
  USD,
  VWCE,
} from './testing';
import type { PortfolioAnalysis, PositionAnalysis, PortfolioTotal } from './types';

const amount = (metric: Metric<Money>): number => {
  if (metric.status !== 'OK') throw new Error(`OK-t vártunk: ${metric.status} ${metric.reason}`);
  return metric.value.amount;
};
const num = (metric: Metric<number>): number => {
  if (metric.status !== 'OK') throw new Error(`OK-t vártunk: ${metric.status} ${metric.reason}`);
  return metric.value;
};
const position = (analysis: PortfolioAnalysis, id: ListingId): PositionAnalysis => {
  const found = analysis.positions.find((p) => p.listingId === id);
  if (!found) throw new Error(id);
  return found;
};

/**
 * Kézzel ellenőrzött vegyes devizás portfólió (bázis: EUR).
 * AAPL (USD): 10 @ 100 + 1 díj (FX 0,90), 10 @ 120 + 1 (0,95), osztalék 5 USD (0,93),
 *   eladás 5 @ 130 − 1 (0,92); ma 150 USD, FX 0,85.
 *   Natív: bekerülés 1651,5; realizált 98,5; piaci érték 2250; nem realizált 598,5.
 *   Bázis: 900,9 + 1140,95 = 2041,85; eladás 597,08 − 510,4625 → realizált 86,6175;
 *   bekerülés 1531,3875; piaci érték 1912,5; nem realizált 381,1125 =
 *   árhatás 508,725 + FX-hatás −127,6125.
 * VWCE (EUR): 10 @ 100 + 2 → 1002; ma 110 → 1100.
 * ISF (GBX): 100 @ 800 GBX + 5 GBP díj, rögzített bróker-ráta GBP→EUR 1,15; ma 850 GBX, 1,18.
 *   Natív: 80 500 GBX bekerülés, 85 000 piaci érték; bázis: 925,75 → 1003; árhatás 53,1, FX 24,15.
 */
function mixedPortfolio(overrides: Parameters<typeof baseInput>[0] = {}) {
  return baseInput({
    transactions: [
      tx.buy(AAPL, '2026-01-02', 10, 100, USD, 1),
      tx.buy(AAPL, '2026-03-02', 10, 120, USD, 1),
      tx.dividend(AAPL, '2026-05-15', 5, USD),
      tx.sell(AAPL, '2026-06-01', 5, 130, USD, 1),
      tx.buy(VWCE, '2026-02-02', 10, 100, EUR, 2),
      tx.buy(ISF, '2026-02-02', 100, 800, GBX, 5, GBP, {
        fxRateToBase: fxRate(GBP, 1.15, '2026-02-02'),
      }),
    ],
    quotes: new Map([
      [AAPL, quote(AAPL, 150, USD)],
      [VWCE, quote(VWCE, 110, EUR)],
      [ISF, quote(ISF, 850, GBX)],
    ]),
    fx: lookup(
      { USD: 0.85, GBP: 1.18 },
      {
        'USD@2026-01-02': 0.9,
        'USD@2026-03-02': 0.95,
        'USD@2026-05-15': 0.93,
        'USD@2026-06-01': 0.92,
      },
    ),
    metadata: new Map([
      [
        AAPL,
        meta(AAPL, {
          kind: 'stock',
          isin: 'US0378331005',
          name: 'Apple',
          country: 'US',
          sector: 'Information Technology',
        }),
      ],
      [VWCE, meta(VWCE, { kind: 'etf', assetClass: 'equity', name: 'Vanguard FTSE All-World' })],
      [ISF, meta(ISF, { kind: 'etf', assetClass: 'equity', name: 'iShares Core FTSE 100' })],
    ]),
    holdings: new Map([
      [
        VWCE,
        holdings([
          {
            name: 'Apple',
            isin: 'US0378331005',
            weight: 0.045,
            country: 'US',
            sector: 'Information Technology',
            currency: 'USD',
          },
          {
            name: 'Microsoft',
            isin: 'US5949181045',
            weight: 0.04,
            country: 'US',
            sector: 'Information Technology',
            currency: 'USD',
          },
          {
            name: 'HSBC',
            isin: 'GB0005405286',
            weight: 0.01,
            country: 'GB',
            sector: 'Financials',
            currency: 'GBP',
          },
        ]),
      ],
      [
        ISF,
        holdings([
          {
            name: 'HSBC',
            isin: 'GB0005405286',
            weight: 0.08,
            country: 'GB',
            sector: 'Financials',
            currency: 'GBP',
          },
          {
            name: 'AstraZeneca',
            isin: 'GB0009895292',
            weight: 0.07,
            country: 'GB',
            sector: 'Health Care',
            currency: 'GBX',
          },
        ]),
      ],
    ]),
    ...overrides,
  });
}

describe('buildPortfolioAnalysis – vegyes deviza, két P/L-nézet (feladat 2–3.)', () => {
  const analysis = buildPortfolioAnalysis(mixedPortfolio());

  it('USD részvény: natív (FX nélkül) és bázis (ügyleti napi FX-szel) nézet', () => {
    const p = position(analysis, AAPL);
    expect(p.status).toBe('open');
    expect(p.quantity).toBe(15);
    expect(p.nativeCurrency).toBe('USD');
    expect(amount(p.costBasisNative)).toBeCloseTo(1651.5, 9);
    expect(amount(p.averageCostNative)).toBeCloseTo(110.1, 9);
    expect(amount(p.realizedPLNative)).toBeCloseTo(98.5, 9);
    expect(amount(p.marketValueNative)).toBeCloseTo(2250, 9);
    expect(amount(p.unrealizedPLNative)).toBeCloseTo(598.5, 9);
    expect(num(p.unrealizedReturnNative)).toBeCloseTo(598.5 / 1651.5, 12);
    expect(p.dividendsNative).toEqual([{ amount: 5, currency: 'USD' }]);

    expect(amount(p.costBasisBase)).toBeCloseTo(1531.3875, 9);
    expect(amount(p.realizedPLBase)).toBeCloseTo(86.6175, 9);
    expect(amount(p.marketValueBase)).toBeCloseTo(1912.5, 9);
    expect(amount(p.unrealizedPLBase)).toBeCloseTo(381.1125, 9);
    expect(amount(p.priceEffectBase)).toBeCloseTo(508.725, 9);
    expect(amount(p.fxEffectBase)).toBeCloseTo(-127.6125, 9);
    expect(amount(p.dividendsBase)).toBeCloseTo(4.65, 9);
    expect(amount(p.grossInvestedBase)).toBeCloseTo(2041.85, 9);
    expect(amount(p.totalReturnBase)).toBeCloseTo(381.1125 + 86.6175 + 4.65, 9);
    expect(num(p.totalReturnPct)).toBeCloseTo((381.1125 + 86.6175 + 4.65) / 2041.85, 12);
    // FX-felbontás: árhatás + FX-hatás = bázis nem realizált P/L
    expect(amount(p.priceEffectBase) + amount(p.fxEffectBase)).toBeCloseTo(
      amount(p.unrealizedPLBase),
      9,
    );
    expect(p.currentFx).toMatchObject({
      currency: 'USD',
      rate: 0.85,
      asOf: '2026-11-20',
      source: 'market',
    });
  });

  it('GBX ETF: penny-jegyzés, GBP díj egységváltással, rögzített bróker-ráta elsőbbsége', () => {
    const p = position(analysis, ISF);
    expect(p.nativeCurrency).toBe('GBX');
    expect(amount(p.costBasisNative)).toBeCloseTo(80500, 9);
    expect(amount(p.marketValueNative)).toBeCloseTo(85000, 9);
    expect(amount(p.costBasisBase)).toBeCloseTo(925.75, 9);
    expect(amount(p.marketValueBase)).toBeCloseTo(1003, 9);
    expect(amount(p.priceEffectBase)).toBeCloseTo(53.1, 9);
    expect(amount(p.fxEffectBase)).toBeCloseTo(24.15, 9);
    expect(p.ledger[0]?.fxRate).toMatchObject({
      currency: 'GBP',
      rate: 1.15,
      source: 'transaction',
    });
    expect(p.notes.join(' ')).toContain('÷ 100');
  });

  it('a könyvelési napló visszakövethető: lépésenként mennyiség, bekerülés, átlagár, realizált', () => {
    const rows = position(analysis, AAPL).ledger;
    expect(rows.map((r) => [r.type, r.quantityAfter])).toEqual([
      ['BUY', 10],
      ['BUY', 20],
      ['DIVIDEND', 20],
      ['SELL', 15],
    ]);
    expect(rows[1]?.averageCostNativeAfter).toBeCloseTo(110.1, 9);
    expect(rows[3]?.realizedNativeDelta).toBeCloseTo(98.5, 9);
    expect(rows[3]?.fxRate).toMatchObject({ rate: 0.92, asOf: '2026-06-01' });
  });

  it('súlyok: bázisdevizás piaci értékből, Σ = 1', () => {
    const total = 1912.5 + 1100 + 1003;
    expect(num(position(analysis, AAPL).weight)).toBeCloseTo(1912.5 / total, 12);
    expect(num(position(analysis, VWCE).weight)).toBeCloseTo(1100 / total, 12);
    expect(num(position(analysis, ISF).weight)).toBeCloseTo(1003 / total, 12);
    const sum = analysis.positions.reduce((s, p) => s + num(p.weight), 0);
    expect(sum).toBeCloseTo(1, 12);
  });

  it('minden összesítés = a pozíciók összege (visszavezethető komponensekkel)', () => {
    const totals = analysis.totals;
    const check = (t: PortfolioTotal, pick: (p: PositionAnalysis) => Metric<Money>) => {
      const expected = analysis.positions.reduce((s, p) => s + amount(pick(p)), 0);
      expect(amount(t.value)).toBeCloseTo(expected, 9);
      expect(t.components.map((c) => c.listingId).sort()).toEqual([AAPL, ISF, VWCE].sort());
      expect(t.missing).toEqual([]);
    };
    check(totals.marketValue, (p) => p.marketValueBase);
    check(totals.costBasis, (p) => p.costBasisBase);
    check(totals.unrealizedPL, (p) => p.unrealizedPLBase);
    check(totals.realizedPL, (p) => p.realizedPLBase);
    check(totals.dividends, (p) => p.dividendsBase);
    check(totals.totalReturn, (p) => p.totalReturnBase);
    expect(amount(totals.marketValue.value)).toBeCloseTo(4015.5, 9);
    expect(amount(totals.priceEffect.value) + amount(totals.fxEffect.value)).toBeCloseTo(
      amount(totals.unrealizedPL.value),
      9,
    );
    expect(num(totals.totalReturnPct.value)).toBeCloseTo(
      amount(totals.totalReturn.value) / amount(totals.grossInvested.value),
      12,
    );
    expect(analysis.totals.currency).toBe('EUR');
  });

  it('a felhasznált FX-ráták dátummal és forrással a kimenetben', () => {
    expect(analysis.fxRatesUsed.map((r) => `${r.currency}@${r.asOf}:${r.source}`)).toEqual([
      'GBP@2026-02-02:transaction',
      'GBP@2026-11-20:market',
      'USD@2026-01-02:market',
      'USD@2026-03-02:market',
      'USD@2026-05-15:market',
      'USD@2026-06-01:market',
      'USD@2026-11-20:market',
    ]);
    expect(analysis.accountingMethod.id).toBe('average_cost');
    expect(analysis.disclaimer).toContain('Nem befektetési tanács');
  });
});

describe('kitettség: közvetlen és look-through külön (feladat 4.)', () => {
  const analysis = buildPortfolioAnalysis(mixedPortfolio());
  const exposure = (dimension: string, method: string) => {
    const found = analysis.exposures.find((e) => e.dimension === dimension && e.method === method);
    if (!found) throw new Error(`${dimension}/${method}`);
    return found;
  };
  const total = 4015.5;
  const wA = 1912.5 / total;
  const wV = 1100 / total;
  const wI = 1003 / total;

  it('instrumentumfajta és jegyzési deviza (közvetlen)', () => {
    const kinds = exposure('instrumentKind', 'direct').groups;
    expect(kinds.status === 'OK' && kinds.value.map((g) => g.key)).toEqual(['etf', 'stock']);
    const ccy = exposure('tradingCurrency', 'direct').groups;
    expect(
      ccy.status === 'OK' && Object.fromEntries(ccy.value.map((g) => [g.key, g.weight])),
    ).toEqual({
      USD: wA,
      EUR: wV,
      GBP: wI, // GBX → GBP
    });
  });

  it('közvetlen ország: csak a részvény; az ETF-ek besorolatlanok (domicil ≠ kitettség)', () => {
    const e = exposure('country', 'direct');
    expect(e.groups.status === 'OK' && e.groups.value).toEqual([{ key: 'US', weight: wA }]);
    expect(e.unclassifiedWeight).toBeCloseTo(wV + wI, 12);
    expect(e.notes.join(' ')).toContain('look-through');
  });

  it('look-through ország: részvény + ETF-súly × holdings-súly; a holdings-hiány „le nem fedett”', () => {
    const e = exposure('country', 'look_through');
    const groups =
      e.groups.status === 'OK'
        ? Object.fromEntries(e.groups.value.map((g) => [g.key, g.weight]))
        : {};
    expect(groups.US).toBeCloseTo(wA + wV * (0.045 + 0.04), 12);
    expect(groups.GB).toBeCloseTo(wV * 0.01 + wI * (0.08 + 0.07), 12);
    expect(e.uncoveredWeight).toBeCloseTo(1 - (wA + wV * 0.095 + wI * 0.15), 12);
    expect(e.methodNote).toContain('összeadódik');
  });

  it('look-through mögöttes deviza: GBX holdings → GBP; részvénynél a jegyzési deviza közelítés', () => {
    const e = exposure('underlyingCurrency', 'look_through');
    const groups =
      e.groups.status === 'OK'
        ? Object.fromEntries(e.groups.value.map((g) => [g.key, g.weight]))
        : {};
    expect(groups.GBP).toBeCloseTo(wV * 0.01 + wI * 0.15, 12);
    expect(e.notes.join(' ')).toContain('jegyzési deviza');
  });

  it('fedezett ETF: a teljes súly a fedezési devizába kerül', () => {
    const hedged = buildPortfolioAnalysis(
      mixedPortfolio({
        metadata: new Map([
          [VWCE, meta(VWCE, { kind: 'etf', assetClass: 'equity', hedgeCurrency: 'EUR' })],
        ]),
      }),
    );
    const e = hedged.exposures.find(
      (x) => x.dimension === 'underlyingCurrency' && x.method === 'look_through',
    );
    const groups =
      e?.groups.status === 'OK'
        ? Object.fromEntries(e.groups.value.map((g) => [g.key, g.weight]))
        : {};
    expect(groups.EUR).toBeCloseTo(wV, 12);
  });
});

describe('koncentráció és ETF-átfedés (feladat 5., 8.)', () => {
  const analysis = buildPortfolioAnalysis(mixedPortfolio());
  const total = 4015.5;

  it('legnagyobb pozíció, top 5 (teljes lista: 3 pozíció = 100%), HHI', () => {
    const c = analysis.concentration;
    expect(c.largestPosition.status === 'OK' && c.largestPosition.value.listingId).toBe(AAPL);
    expect(num(c.top5Weight.value)).toBeCloseTo(1, 12);
    const w = [1912.5, 1100, 1003].map((v) => v / total);
    expect(num(c.herfindahl.value)).toBeCloseTo(
      w.reduce((s, x) => s + x * x, 0),
      12,
    );
    expect(num(c.effectivePositions.value)).toBeCloseTo(1 / w.reduce((s, x) => s + x * x, 0), 9);
  });

  it('egyedi részvénykitettség ISIN szerint: Apple = közvetlen + VWCE-n át', () => {
    const names = analysis.concentration.singleNames;
    if (names.status !== 'OK') throw new Error(names.reason);
    const apple = names.value[0];
    expect(apple).toMatchObject({ key: 'US0378331005', viaEtfs: [VWCE] });
    expect(apple?.directWeight).toBeCloseTo(1912.5 / total, 12);
    expect(apple?.viaEtfWeight).toBeCloseTo((1100 / total) * 0.045, 12);
    const hsbc = names.value.find((n) => n.key === 'GB0005405286');
    expect([...(hsbc?.viaEtfs ?? [])].sort()).toEqual([ISF, VWCE].sort());
  });

  it('szektor- és földrajzi koncentráció mindkét nézetben', () => {
    const sector = analysis.concentration.sector.find((s) => s.method === 'look_through');
    expect(sector?.largest.status === 'OK' && sector.largest.value.key).toBe(
      'Information Technology',
    );
    expect(analysis.concentration.country.map((c) => c.method)).toEqual(['direct', 'look_through']);
  });

  it('ETF-átfedés adatmodell: Σ min súly a közös ISIN-ekre, részleges listán alsó becslés', () => {
    const [pair] = analysis.etfOverlap.pairs;
    expect(pair).toMatchObject({ a: VWCE, b: ISF });
    if (pair?.overlap.status !== 'OK') throw new Error('overlap');
    expect(pair.overlap.value.overlapWeight).toBeCloseTo(0.01, 12);
    expect(pair.overlap.value.common.map((c) => c.key)).toEqual(['GB0005405286']);
  });
});

describe('hiányzó ár / FX: egyértelmű állapot, nem 0 (elfogadási feltétel)', () => {
  it('hiányzó árfolyam: a pozíció piaci értéke UNAVAILABLE okkal, kimarad a súlyozásból; az összeg nem OK, a részösszeg látszik', () => {
    const analysis = buildPortfolioAnalysis(
      mixedPortfolio({
        quotes: new Map([
          [AAPL, quote(AAPL, 150, USD)],
          [VWCE, quoteError()],
          [ISF, quote(ISF, 850, GBX)],
        ]),
      }),
    );
    const v = position(analysis, VWCE);
    expect(v.marketValueBase).toMatchObject({
      status: 'UNAVAILABLE',
      unavailableReason: 'QUOTA_EXHAUSTED',
    });
    expect(v.weight.status).toBe('MISSING');
    expect(amount(v.costBasisBase)).toBeCloseTo(1002, 9); // a bekerülés ettől még ismert
    const mv = analysis.totals.marketValue;
    expect(mv.value.status).toBe('MISSING');
    expect(mv.missing).toEqual([VWCE]);
    expect(mv.availableSum.amount).toBeCloseTo(1912.5 + 1003, 9);
    expect(num(position(analysis, AAPL).weight)).toBeCloseTo(1912.5 / (1912.5 + 1003), 12);
    expect(analysis.warnings.join(' ')).toContain(VWCE);
    expect(analysis.concentration.notes.join(' ')).toContain('árazott');
  });

  it('hiányzó mai FX: a natív nézet OK, a bázis piaci érték MISSING okkal', () => {
    const analysis = buildPortfolioAnalysis(
      mixedPortfolio({
        fx: lookup(
          { GBP: 1.18 },
          {
            'USD@2026-01-02': 0.9,
            'USD@2026-03-02': 0.95,
            'USD@2026-05-15': 0.93,
            'USD@2026-06-01': 0.92,
          },
        ),
      }),
    );
    const p = position(analysis, AAPL);
    expect(amount(p.marketValueNative)).toBeCloseTo(2250, 9);
    expect(p.marketValueBase.status).toBe('MISSING');
    expect(p.marketValueBase.status !== 'OK' && p.marketValueBase.reason).toContain('USD');
    expect(amount(p.costBasisBase)).toBeCloseTo(1531.3875, 9);
  });

  it('hiányzó ügyleti napi FX: a bázis könyvelés MISSING, a natív OK (nem a mai rátával pótoljuk)', () => {
    const analysis = buildPortfolioAnalysis(
      mixedPortfolio({ fx: lookup({ USD: 0.85, GBP: 1.18 }, { 'USD@2026-01-02': 0.9 }) }),
    );
    const p = position(analysis, AAPL);
    expect(amount(p.costBasisNative)).toBeCloseTo(1651.5, 9);
    expect(p.costBasisBase.status).toBe('MISSING');
    expect(p.dividendsBase.status).toBe('MISSING');
    expect(analysis.totals.costBasis.missing).toEqual([AAPL]);
  });

  it('a pénznem-ellentmondó árfolyam INVALID_INPUT, nem csendes átváltás', () => {
    const analysis = buildPortfolioAnalysis(
      mixedPortfolio({
        quotes: new Map([
          [AAPL, quote(AAPL, 150, USD)],
          [VWCE, quote(VWCE, 110, USD)],
          [ISF, quote(ISF, 850, GBX)],
        ]),
      }),
    );
    // az árfolyam pénzneme alapján a validáció CURRENCY_CONFLICT-ot jelez → érvénytelen pozíció
    const v = position(analysis, VWCE);
    expect(v.status).toBe('invalid');
    expect(v.issues.map((i) => i.code)).toEqual(['CURRENCY_CONFLICT']);
    expect(v.marketValueBase.status).toBe('INVALID_INPUT');
  });
});

describe('életciklus és validáció a pozíciókon', () => {
  it('zárt pozíció: piaci érték 0, súly N/A, realizált P/L megmarad; nincs árfolyamigény', () => {
    const analysis = buildPortfolioAnalysis(
      baseInput({
        transactions: [
          tx.buy(VWCE, '2026-01-02', 10, 100, EUR),
          tx.sell(VWCE, '2026-03-02', 10, 120, EUR, 3),
        ],
      }),
    );
    const p = position(analysis, VWCE);
    expect(p.status).toBe('closed');
    expect(amount(p.marketValueBase)).toBe(0);
    expect(amount(p.realizedPLBase)).toBeCloseTo(197, 9);
    expect(p.weight.status).toBe('NOT_APPLICABLE');
    expect(p.lastPrice.status).toBe('NOT_APPLICABLE');
    expect(amount(analysis.totals.realizedPL.value)).toBeCloseTo(197, 9);
    expect(analysis.totals.closedPositions).toBe(1);
  });

  it('túladás: a pozíció érvénytelen (INVALID_INPUT), a többi számolódik', () => {
    const analysis = buildPortfolioAnalysis(
      baseInput({
        transactions: [
          tx.buy(VWCE, '2026-01-02', 1, 100, EUR),
          tx.sell(VWCE, '2026-01-03', 2, 100, EUR),
          tx.buy(AAPL, '2026-01-02', 1, 100, EUR),
        ],
        quotes: new Map([
          [VWCE, quote(VWCE, 100, EUR)],
          [AAPL, quote(AAPL, 100, EUR)],
        ]),
      }),
    );
    expect(position(analysis, VWCE).status).toBe('invalid');
    expect(position(analysis, VWCE).totalReturnBase.status).toBe('INVALID_INPUT');
    expect(num(position(analysis, AAPL).weight)).toBe(1);
    expect(analysis.totals.invalidPositions).toBe(1);
    expect(analysis.warnings[0]).toContain('hibás');
  });

  it('split: darabszám × 4, átlagár ÷ 4, bekerülés változatlan; külön díj (FEE) csökkenti az összhozamot', () => {
    const analysis = buildPortfolioAnalysis(
      baseInput({
        transactions: [
          tx.buy(VWCE, '2026-01-02', 10, 100, EUR),
          tx.split(VWCE, '2026-02-02', 1, 4),
          tx.fee(VWCE, '2026-03-01', 5, EUR),
        ],
        quotes: new Map([[VWCE, quote(VWCE, 30, EUR)]]),
      }),
    );
    const p = position(analysis, VWCE);
    expect(p.quantity).toBe(40);
    expect(amount(p.averageCostNative)).toBeCloseTo(25, 12);
    expect(amount(p.costBasisBase)).toBe(1000);
    expect(amount(p.otherFeesBase)).toBe(5);
    expect(amount(p.totalReturnBase)).toBeCloseTo(1200 - 1000 - 5, 9);
  });

  it('üres portfólió: összesítés INSUFFICIENT_DATA, nincs pozíció', () => {
    const analysis = buildPortfolioAnalysis(baseInput());
    expect(analysis.positions).toEqual([]);
    expect(analysis.totals.marketValue.value.status).toBe('INSUFFICIENT_DATA');
    expect(analysis.history.status.status).toBe('NOT_APPLICABLE');
  });

  it('metaadat nélküli pozíció: kitettségben besorolatlan, figyelmeztetéssel; demó árfolyam jelölve', () => {
    const analysis = buildPortfolioAnalysis(
      baseInput({
        transactions: [tx.buy(VWCE, '2026-01-02', 1, 100, EUR)],
        quotes: new Map([[VWCE, quote(VWCE, 100, EUR, { kind: 'mock', freshness: 'STALE' })]]),
      }),
    );
    const kind = analysis.exposures.find((e) => e.dimension === 'instrumentKind');
    expect(kind?.unclassifiedWeight).toBe(1);
    expect(analysis.warnings.join(' ')).toMatch(/DEMO.*|metaadata/);
    expect(analysis.warnings.join(' ')).toContain('STALE');
    const mv = position(analysis, VWCE).marketValueBase;
    expect(mv.status === 'OK' ? mv.provenance.kind : null).toBe('mock');
  });
});
