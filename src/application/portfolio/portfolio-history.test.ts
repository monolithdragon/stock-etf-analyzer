import { annualizedVolatility, periodicReturns, type CalcResult } from '@/calculations';
import {
  AppErrors,
  err,
  type AppError,
  type CurrencyCode,
  type IsoDate,
  type ListingId,
  type Metric,
  type PriceSeries,
  type Result,
  type Transaction,
} from '@/domain';

import { buildPortfolioAnalysis } from './portfolio-analysis';
import {
  AAPL,
  baseInput,
  EUR,
  lookup,
  priceSeries,
  quote,
  tx,
  USD,
  VWCE,
  weekdays,
} from './testing';

const num = (metric: Metric<number>): number => {
  if (metric.status !== 'OK') throw new Error(`OK-t vártunk: ${metric.status} ${metric.reason}`);
  return metric.value;
};
const calcValue = <T>(result: CalcResult<T>): T => {
  if (result.status !== 'OK') throw new Error(result.reason);
  return result.value;
};

const DATES = weekdays('2026-01-05', 200);
const r = (i: number) => 0.01 * Math.sin(i * 0.7) + 0.0003;
function prices(count = DATES.length, start = 100, ret = r): number[] {
  const out = [start];
  for (let i = 1; i < count; i += 1) out.push((out[i - 1] as number) * (1 + ret(i)));
  return out;
}
const at = (i: number) => DATES[i] as IsoDate;
const points = (values: readonly number[], dates: readonly IsoDate[] = DATES) =>
  values.map((close, i) => ({ date: dates[i] as string, close }));

function history(
  transactions: readonly Transaction[],
  series: ReadonlyMap<ListingId, Result<PriceSeries, AppError>>,
  extra: {
    fxSeries?: ReadonlyMap<CurrencyCode, readonly { date: IsoDate; rate: number }[]>;
    riskFreeRate?: number | null;
    from?: IsoDate | null;
  } = {},
) {
  return buildPortfolioAnalysis(
    baseInput({
      transactions,
      // az árfolyam pénzneme az ügyletekéhez igazodik (különben CURRENCY_CONFLICT)
      quotes: new Map(
        transactions.flatMap((t) =>
          t.type === 'BUY'
            ? [[t.listingId, quote(t.listingId, 100, t.price.currency)] as const]
            : [],
        ),
      ),
      fx: lookup(
        { USD: 0.9 },
        Object.fromEntries(transactions.map((t) => [`USD@${t.tradeDate}`, 0.9])),
      ),
      history: {
        enabled: true,
        from: extra.from ?? null,
        priceSeries: series,
        fxSeries: extra.fxSeries ?? new Map(),
      },
      riskFreeRate: extra.riskFreeRate ?? null,
    }),
  ).history;
}

describe('historikus elemzés – TWR a tényleges mennyiségekből (feladat 6–7.)', () => {
  const p = prices();

  it('egy eszköz: a TWR = az eszköz árhozama, a közbeni vétel/eladás nem hozam', () => {
    const h = history(
      [
        tx.buy(VWCE, at(0), 10, 100, EUR),
        tx.buy(VWCE, at(100), 5, 100, EUR),
        tx.sell(VWCE, at(150), 3, 100, EUR),
      ],
      new Map([[VWCE, priceSeries(VWCE, EUR, points(p))]]),
    );
    expect(h.status).toMatchObject({ status: 'OK', value: { start: at(0), end: at(199) } });
    expect(h.observations).toBe(199);
    expect(num(h.cumulativeReturn.value)).toBeCloseTo(
      (p[199] as number) / (p[0] as number) - 1,
      10,
    );
    const expectedVol = calcValue(
      annualizedVolatility({
        returns: calcValue(periodicReturns(p)),
        periodsPerYear: 252,
        minObservations: 126,
      }),
    );
    expect(num(h.volatility.value)).toBeCloseTo(expectedVol, 10);
    expect(h.volatility.reliability).toBe('short_window'); // 199 < 240 (D-070)
    expect(h.index[0]).toEqual({ date: at(0), value: 1 });
    expect(h.maxDrawdown.value.status).toBe('OK');
    expect(h.annualizedReturn.value.status).toBe('INSUFFICIENT_DATA'); // < 1 év
    expect(h.sharpe.value).toMatchObject({ status: 'MISSING' }); // rf nélkül
  });

  it('két eszköz: a napi hozam az ELŐZŐ napi tényleges súlyokkal súlyozott (nem a mai súlyokkal)', () => {
    const q = prices(DATES.length, 50, (i) => 0.02 * Math.cos(i * 0.3));
    const h = history(
      [tx.buy(VWCE, at(0), 10, 100, EUR), tx.buy(AAPL, at(60), 20, 50, EUR)],
      new Map([
        [VWCE, priceSeries(VWCE, EUR, points(p))],
        [AAPL, priceSeries(AAPL, EUR, points(q))],
      ]),
    );
    let level = 1;
    for (let i = 1; i < DATES.length; i += 1) {
      const qtyB = i > 60 ? 20 : 0;
      const prev = 10 * (p[i - 1] as number) + qtyB * (q[i - 1] as number);
      const now = 10 * (p[i] as number) + qtyB * (q[i] as number);
      level *= now / prev;
    }
    expect(num(h.cumulativeReturn.value)).toBeCloseTo(level - 1, 10);
  });

  it('osztalék: a kifizetés napján hozam (I_t / V_{t−1})', () => {
    const h = history(
      [tx.buy(VWCE, at(0), 10, 100, EUR), tx.dividend(VWCE, at(50), 20, EUR)],
      new Map([[VWCE, priceSeries(VWCE, EUR, points(p))]]),
    );
    const day50 = (p[50] as number) / (p[49] as number) - 1 + 20 / (10 * (p[49] as number));
    const expected =
      ((p[199] as number) / (p[0] as number)) *
        ((1 + day50) / ((p[50] as number) / (p[49] as number))) -
      1;
    expect(num(h.cumulativeReturn.value)).toBeCloseTo(expected, 10);
  });

  it('split: split-korrigált sor + split-korrigált mennyiség = nincs hamis ugrás; nyers sorral ugyanaz', () => {
    const transactions = [tx.buy(VWCE, at(0), 10, 200, EUR), tx.split(VWCE, at(80), 1, 2)];
    const adjusted = history(
      transactions,
      new Map([[VWCE, priceSeries(VWCE, EUR, points(p), 'SPLIT')]]),
    );
    const raw = p.map((v, i) => (i < 80 ? v * 2 : v));
    const unadjusted = history(
      transactions,
      new Map([[VWCE, priceSeries(VWCE, EUR, points(raw), 'NONE')]]),
    );
    const expected = (p[199] as number) / (p[0] as number) - 1;
    expect(num(adjusted.cumulativeReturn.value)).toBeCloseTo(expected, 10);
    expect(num(unadjusted.cumulativeReturn.value)).toBeCloseTo(expected, 10);
    expect(unadjusted.limitations.join(' ')).toContain('nyers');
  });

  it('többdevizás portfólió FX-idősor nélkül → MISSING (a mai rátával nem számolunk vissza)', () => {
    const h = history(
      [tx.buy(AAPL, at(0), 10, 100, USD)],
      new Map([[AAPL, priceSeries(AAPL, USD, points(p))]]),
    );
    expect(h.status.status).toBe('MISSING');
    expect(h.status.status !== 'OK' && h.status.reason).toContain('KI-77');
    expect(h.volatility.value.status).toBe('MISSING');
  });

  it('FX-idősorral: a bázisdevizás TWR = (P_vég × FX_vég) / (P_kezdő × FX_kezdő) − 1', () => {
    const fx = DATES.map((date, i) => ({ date, rate: 0.9 + 0.0005 * i }));
    const h = history(
      [tx.buy(AAPL, at(0), 10, 100, USD)],
      new Map([[AAPL, priceSeries(AAPL, USD, points(p))]]),
      {
        fxSeries: new Map([[USD, fx]]),
      },
    );
    const expected =
      ((p[199] as number) * (fx[199]?.rate as number)) /
        ((p[0] as number) * (fx[0]?.rate as number)) -
      1;
    expect(num(h.cumulativeReturn.value)).toBeCloseTo(expected, 10);
  });

  it('az ártörténet később kezdődik, mint a portfólió → az ablak később indul, korlátként jelölve', () => {
    const h = history(
      [tx.buy(VWCE, '2025-06-02', 10, 100, EUR)],
      new Map([[VWCE, priceSeries(VWCE, EUR, points(p))]]),
    );
    expect(h.status).toMatchObject({ status: 'OK', value: { start: at(0) } });
    expect(h.limitations.join(' ')).toContain('később kezdődik');
  });

  it('ártörténet-hézag (> 7 nap) egy nyitott pozíciónál, miközben a másik jegyzés kereskedik → az ablak a hézag után indul', () => {
    const dates = DATES.filter((_, i) => i < 40 || i > 50);
    const values = p.filter((_, i) => i < 40 || i > 50);
    const h = history(
      [tx.buy(VWCE, at(0), 10, 100, EUR), tx.buy(AAPL, at(0), 10, 100, EUR)],
      new Map([
        [VWCE, priceSeries(VWCE, EUR, points(values, dates))],
        [AAPL, priceSeries(AAPL, EUR, points(p))],
      ]),
    );
    expect(h.status).toMatchObject({ status: 'OK', value: { start: at(51) } });
    expect(h.limitations.join(' ')).toContain('nincs teljes');
  });

  it('kevés megfigyelés: kumulált hozam OK, kockázati mutatók INSUFFICIENT_DATA', () => {
    const h = history(
      [tx.buy(VWCE, at(0), 10, 100, EUR)],
      new Map([[VWCE, priceSeries(VWCE, EUR, points(p.slice(0, 60), DATES.slice(0, 60)))]]),
      { riskFreeRate: 0.02 },
    );
    expect(h.cumulativeReturn.value.status).toBe('OK');
    expect(h.volatility.value.status).toBe('INSUFFICIENT_DATA');
    expect(h.sharpe.value.status).toBe('INSUFFICIENT_DATA');
  });

  it('rf megadva + ≥ 126 megfigyelés → Sharpe és Sortino számolva, címkével', () => {
    const h = history(
      [tx.buy(VWCE, at(0), 10, 100, EUR)],
      new Map([[VWCE, priceSeries(VWCE, EUR, points(p))]]),
      {
        riskFreeRate: 0.02,
      },
    );
    expect(h.sharpe.value.status).toBe('OK');
    expect(h.sortino.value.status).toBe('OK');
    expect(h.sharpe.reliability).toBe('short_window');
    expect(h.sharpe.notes.join(' ')).toContain('1 évnél rövidebb');
  });

  it('korreláció a nyitott pozíciók között: azonos hozam → 1', () => {
    const h = history(
      [tx.buy(VWCE, at(0), 10, 100, EUR), tx.buy(AAPL, at(0), 10, 100, EUR)],
      new Map([
        [VWCE, priceSeries(VWCE, EUR, points(p))],
        [AAPL, priceSeries(AAPL, EUR, points(p.map((v) => v * 3)))],
      ]),
    );
    expect(h.correlations).toHaveLength(1);
    expect(num(h.correlations[0]?.correlation as Metric<number>)).toBeCloseTo(1, 10);
  });

  it('hibás/elérhetetlen bemenet: kikapcsolva N/A, ártörténet-hiba továbbadva, osztalék-korrigált sor tiltva', () => {
    const disabled = buildPortfolioAnalysis(
      baseInput({ transactions: [tx.buy(VWCE, at(0), 1, 100, EUR)] }),
    ).history;
    expect(disabled.status.status).toBe('NOT_APPLICABLE');
    const unavailable = history(
      [tx.buy(VWCE, at(0), 1, 100, EUR)],
      new Map([[VWCE, err(AppErrors.unavailable('QUOTA_EXHAUSTED', 'Elfogyott.'))]]),
    );
    expect(unavailable.status).toMatchObject({
      status: 'UNAVAILABLE',
      unavailableReason: 'QUOTA_EXHAUSTED',
    });
    const dividendAdjusted = history(
      [tx.buy(VWCE, at(0), 1, 100, EUR)],
      new Map([[VWCE, priceSeries(VWCE, EUR, points(p), 'SPLIT_DIVIDEND')]]),
    );
    expect(dividendAdjusted.status.status).toBe('INVALID_INPUT');
    const oversold = history(
      [tx.buy(VWCE, at(0), 1, 100, EUR), tx.sell(VWCE, at(1), 2, 100, EUR)],
      new Map([[VWCE, priceSeries(VWCE, EUR, points(p))]]),
    );
    expect(oversold.status.status).toBe('INVALID_INPUT');
  });
});
