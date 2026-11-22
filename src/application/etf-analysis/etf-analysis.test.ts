import { ok } from '@/domain';

import { buildEtfAnalysis, ETF_NOT_APPLICABLE, type EtfAnalysisInputs } from './etf-analysis';
import { NO_METADATA_REASON } from './etf-profile-builder';
import {
  dividends,
  holdingsList,
  inputs,
  metadata,
  provenance,
  series,
  unavailable,
} from './testing';
import type { EtfAnalysis, EtfMetric } from './types';

function analyze(overrides: Partial<EtfAnalysisInputs> = {}): EtfAnalysis {
  const result = buildEtfAnalysis(inputs(overrides));
  if (!result.ok) throw new Error(`${result.error.message} ${JSON.stringify(result.error)}`);
  return result.value;
}

const value = (metric: EtfMetric): number => {
  if (metric.value.status !== 'OK') {
    throw new Error(`${metric.id}: ${metric.value.status} – ${metric.value.reason}`);
  }
  return metric.value.value;
};

describe('buildEtfAnalysis – metaadat nélkül (free csomag)', () => {
  const analysis = analyze();

  it('az ETF-mezők UNAVAILABLE / PLAN_LIMIT, a korlát látható', () => {
    expect(analysis.profile.ter).toEqual(
      expect.objectContaining({ status: 'UNAVAILABLE', unavailableReason: 'PLAN_LIMIT' }),
    );
    expect(analysis.profile.holdings.status).toBe('UNAVAILABLE');
    expect(analysis.coverage.limitations).toContain(NO_METADATA_REASON);
    expect(analysis.coverage.limitations.join(' ')).toContain('Holdings-adat nincs');
    expect(analysis.coverage.items.find((i) => i.field === 'ter')).toEqual(
      expect.objectContaining({ status: 'UNAVAILABLE', origin: 'unavailable' }),
    );
    // A jegyzési pénznem a korrigált sorból jön, így az legalább ismert.
    expect(analysis.coverage.available).toBeGreaterThanOrEqual(1);
  });

  it('a holdings-, költség- és tracking-mutatók a hiány okát hordozzák', () => {
    expect(analysis.holdings.top10Weight.value.status).toBe('UNAVAILABLE');
    expect(analysis.costs.annualCostPer10k.value.status).toBe('UNAVAILABLE');
    expect(analysis.tracking.trackingDifference.value.status).toBe('MISSING');
    expect(analysis.risk.beta.value.status).toBe('MISSING');
  });

  it('a részvény-mutatók (P/E, Forward P/E, DCF, minőség) NOT_APPLICABLE indokkal', () => {
    expect(analysis.notApplicable).toBe(ETF_NOT_APPLICABLE);
    expect(analysis.notApplicable.map((n) => n.id)).toEqual([
      'pe',
      'forwardPe',
      'dcf',
      'fundamentalQuality',
    ]);
    expect(analysis.notApplicable.every((n) => n.reason.length > 20)).toBe(true);
    expect(analysis.disclaimer).toContain('nem befektetési tanács');
  });

  it('a kockázati mutatók elkészülnek (elég idősor), a Sharpe rf nélkül MISSING', () => {
    expect(analysis.risk.volatility.value.status).toBe('OK');
    expect(analysis.risk.volatility.window?.observations).toBe(299);
    expect(analysis.risk.volatility.reliability).toBe('standard');
    expect(analysis.risk.maxDrawdown.reliability).toBe('standard');
    // A nem-OK mutató (Sharpe rf nélkül) nem kap címkét; a nem kockázati mutatók sem.
    expect(analysis.risk.sharpe.reliability).toBeNull();
    expect(analysis.returns.priceReturn.reliability).toBeNull();
    expect(analysis.risk.maxDrawdown.value.status).toBe('OK');
    expect(value(analysis.risk.maxDrawdown)).toBeLessThanOrEqual(0);
    expect(analysis.risk.sharpe.value.status).toBe('MISSING');
    expect(
      analysis.risk.sharpe.value.status !== 'OK' && analysis.risk.sharpe.value.reason,
    ).toContain('rf');
    expect(analysis.risk.downsideDeviation.notes.join(' ')).toContain('MAR = 0');
  });

  it('a feature-modell súly és pontszám nélküli, csoportonkénti lefedettséggel', () => {
    expect(analysis.features.note).toContain('PHASE 10');
    expect(JSON.stringify(analysis.features)).not.toMatch(/"(weight|score)"/);
    expect(analysis.features.groupCoverage.cost).toEqual({ available: 0, total: 1 });
    expect(analysis.features.groupCoverage.risk).toEqual({ available: 2, total: 2 });
    const liquidity = analysis.features.features.find((f) => f.id === 'averageDailyTradedValue');
    expect(liquidity?.kind === 'numeric' && liquidity.metric.value.status).toBe('MISSING');
  });
});

describe('költség (TER)', () => {
  it('hiányzó TER metaadattal → MISSING, a származtatott költség is', () => {
    const analysis = analyze({ options: { metadata: metadata({ issuer: 'Vanguard' }) } });
    expect(analysis.profile.ter.status).toBe('MISSING');
    expect(analysis.costs.annualCostPer10k.value.status).toBe('MISSING');
    expect(
      analysis.costs.annualCostPer10k.value.status !== 'OK' &&
        analysis.costs.annualCostPer10k.value.reason,
    ).toContain('TER');
    expect(analysis.profile.issuer.status).toBe('OK');
  });

  it('TER 0,22% → 22 / 10 000 / év; hosszú távú hatás becslés (feltevésekkel)', () => {
    const analysis = analyze({ options: { metadata: metadata({ ter: 0.0022 }) } });
    expect(value(analysis.costs.annualCostPer10k)).toBeCloseTo(22, 10);
    expect(analysis.costs.ter.origin).toBe('user_input');
    const share = analysis.costs.longTermCostShare;
    expect(share.value.status === 'OK' && share.value.provenance.kind).toBe('estimated');
    // 1 − (1.0578/1.06)^10
    expect(value(share)).toBeCloseTo(1 - (1.0578 / 1.06) ** 10, 12);
    expect(analysis.costs.assumptions).toEqual({
      years: 10,
      assumedGrossReturn: 0.06,
      source: 'default',
    });
  });

  it('felhasználói feltevés a TER-hatáshoz', () => {
    const analysis = analyze({
      options: { metadata: metadata({ ter: 0.002 }), terImpact: { years: 20 } },
    });
    expect(analysis.costs.assumptions.source).toBe('user');
    expect(analysis.costs.assumptions.years).toBe(20);
  });

  it('százalékként megadott TER (0.22 = 22%) → VALIDATION hiba a mező útvonalával', () => {
    const result = buildEtfAnalysis(inputs({ options: { metadata: metadata({ ter: 0.22 }) } }));
    expect(result.ok).toBe(false);
    if (!result.ok && result.error.kind === 'VALIDATION') {
      expect(result.error.issues.map((i) => i.path)).toContain('ter');
    }
  });

  it.each([
    ['replikáció', { replication: 'magic' }, 'replication'],
    ['osztalékkezelés', { distribution: 'both' }, 'distribution'],
    ['kategória', { classification: { region: 'MARS' } }, 'classification.region'],
    ['AUM', { aum: { amount: -5, currency: 'EUR' } }, 'aum'],
    ['ISIN', { isin: 'XX' }, 'isin'],
    ['dátum', { inceptionDate: '2026-02-30x' }, 'inceptionDate'],
    [
      'holdings',
      { holdings: { asOf: '2026-09-30', holdings: [], declaredComplete: true } },
      'holdings',
    ],
  ])('érvénytelen %s → VALIDATION', (_name, fields, path) => {
    const result = buildEtfAnalysis(inputs({ options: { metadata: metadata(fields as never) } }));
    expect(result.ok).toBe(false);
    if (!result.ok && result.error.kind === 'VALIDATION') {
      expect(
        result.error.issues.map((i) =>
          i.path.split('.').slice(0, path.split('.').length).join('.'),
        ),
      ).toContain(path);
    }
  });
});

describe('holdings', () => {
  it('részleges lista (top 12 a 3700-ból): top 5/10 OK, top 20 és HHI INSUFFICIENT_DATA', () => {
    const analysis = analyze({
      options: {
        metadata: metadata({
          holdings: {
            asOf: '2026-10-31',
            holdings: holdingsList(12, 0.02, { country: 'US', currency: 'USD' }),
            declaredComplete: false,
            reportedHoldingsCount: 3700,
          },
        }),
      },
    });
    const h = analysis.holdings;
    expect(h.completeness).toBe('partial');
    expect(value(h.holdingsCount)).toBe(3700);
    expect(value(h.top5Weight)).toBeCloseTo(0.1, 12);
    expect(value(h.top10Weight)).toBeCloseTo(0.2, 12);
    expect(h.top10Weight.notes.join(' ')).toContain('legnagyobb pozíciókat');
    expect(h.top20Weight.value.status).toBe('INSUFFICIENT_DATA');
    expect(h.herfindahl.value.status).toBe('INSUFFICIENT_DATA');
    expect(h.effectiveHoldings.value.status).toBe('INSUFFICIENT_DATA');
    expect(value(h.coveredWeight)).toBeCloseTo(0.24, 12);
    expect(h.largestCountryWeight.notes.join(' ')).toContain('alsó becslések');
    expect(h.sectorWeights.status).toBe('MISSING');
    expect(h.notes.join(' ')).toContain('12 tétel a(z) 3700-ból');
  });

  it('részleges lista jelentett szám nélkül → a pozíciószám INSUFFICIENT_DATA', () => {
    const analysis = analyze({
      options: {
        metadata: metadata({
          holdings: { asOf: '2026-10-31', holdings: holdingsList(3, 0.1), declaredComplete: false },
        }),
      },
    });
    expect(analysis.holdings.holdingsCount.value.status).toBe('INSUFFICIENT_DATA');
  });

  it('teljes lista: HHI, effektív N, ország- és szektorsúly; régió levezetve (calculated)', () => {
    const analysis = analyze({
      options: {
        metadata: metadata({
          holdings: {
            asOf: '2026-10-31',
            holdings: [
              ...holdingsList(8, 0.1, { country: 'US', currency: 'USD', sector: 'Tech' }),
              ...holdingsList(2, 0.1, { country: 'JP', currency: 'JPY', sector: 'Industrials' }),
            ],
            declaredComplete: true,
          },
        }),
      },
    });
    const h = analysis.holdings;
    expect(value(h.holdingsCount)).toBe(10);
    expect(value(h.herfindahl)).toBeCloseTo(0.1, 12);
    expect(value(h.effectiveHoldings)).toBeCloseTo(10, 10);
    expect(h.countryWeights.status === 'OK' && h.countryWeights.value[0]).toEqual({
      key: 'US',
      weight: expect.closeTo(0.8, 12),
    });
    expect(value(h.largestSectorWeight)).toBeCloseTo(0.8, 12);
    const region = analysis.profile.classification.region;
    expect(region.status === 'OK' && region.value).toBe('US');
    expect(region.status === 'OK' && region.provenance.kind).toBe('calculated');
  });

  it('megadott régió elsőbbsége; eltérés → figyelmeztetés', () => {
    const analysis = analyze({
      options: {
        metadata: metadata({
          classification: { region: 'GLOBAL' },
          holdings: {
            asOf: '2026-10-31',
            holdings: holdingsList(10, 0.1, { country: 'US' }),
            declaredComplete: true,
          },
        }),
      },
    });
    const region = analysis.profile.classification.region;
    expect(region.status === 'OK' && region.value).toBe('GLOBAL');
    expect(analysis.warnings.join(' ')).toContain('levezetettől (US)');
  });

  it('régi holdings-pillanatkép → stale eredet és megjegyzés', () => {
    const analysis = analyze({
      options: {
        metadata: metadata({
          holdings: { asOf: '2025-06-30', holdings: holdingsList(10, 0.1), declaredComplete: true },
        }),
      },
    });
    expect(analysis.holdings.notes.join(' ')).toContain('régi');
    expect(analysis.coverage.items.find((i) => i.field === 'holdings')?.origin).toBe('stale');
  });
});

describe('hozamok: akkumuláló vs. disztribúciós', () => {
  const priceOnly = { totalSeries: unavailable<never>('nincs korrigált sor') };

  it('akkumuláló, korrigált sor nélkül → total return = árhozam (accumulating_price)', () => {
    const analysis = analyze({
      ...priceOnly,
      options: { metadata: metadata({ distribution: 'accumulating' }) },
    });
    expect(analysis.returns.totalReturnMethod).toBe('accumulating_price');
    expect(value(analysis.returns.totalReturn)).toBeCloseTo(
      value(analysis.returns.priceReturn),
      12,
    );
    expect(analysis.returns.comparisonBasis).toBe('total_return');
    expect(analysis.returns.distributionYieldTtm.value.status).toBe('NOT_APPLICABLE');
  });

  it('disztribúciós, korrigált sor nélkül → árhozam + kifizetések (újrabefektetés nélkül)', () => {
    const price = series({ count: 300, adjustment: 'SPLIT' });
    const first = price.points[0]!;
    const last = price.points[price.points.length - 1]!;
    const analysis = analyze({
      ...priceOnly,
      priceSeries: ok(price),
      dividends: ok(
        dividends([
          { exDate: first.date, amount: 9 }, // a kezdőnapi ex-dátum NEM tartozik az időszakhoz
          { exDate: '2026-06-15', amount: 0.5 },
          { exDate: '2026-09-15', amount: 0.6 },
        ]),
      ),
      options: { metadata: metadata({ distribution: 'distributing' }) },
    });
    expect(analysis.returns.totalReturnMethod).toBe('price_plus_distributions');
    expect(value(analysis.returns.totalReturn)).toBeCloseTo(
      (last.close + 1.1) / first.close - 1,
      12,
    );
    expect(analysis.returns.totalReturn.notes.join(' ')).toContain('újrabefektetés nélkül');
    // TTM osztalékhozam: (0.5 + 0.6) / utolsó záróár
    expect(value(analysis.returns.distributionYieldTtm)).toBeCloseTo(1.1 / last.close, 12);
  });

  it('disztribúciós, eltérő pénznemű kifizetés → INVALID_INPUT (nincs csendes FX)', () => {
    const analysis = analyze({
      ...priceOnly,
      dividends: ok(dividends([{ exDate: '2026-06-15', amount: 0.5, currency: 'USD' }])),
      options: { metadata: metadata({ distribution: 'distributing' }) },
    });
    expect(analysis.returns.totalReturn.value.status).toBe('INVALID_INPUT');
  });

  it('ismeretlen osztalékkezelés, csak árfolyamsor → price_return_only figyelmeztetéssel', () => {
    const analysis = analyze(priceOnly);
    expect(analysis.returns.totalReturn.value.status).toBe('MISSING');
    expect(
      analysis.returns.totalReturn.value.status !== 'OK' &&
        analysis.returns.totalReturn.value.reason,
    ).toContain('acc/dist');
    expect(analysis.returns.comparisonBasis).toBe('price_return_only');
    expect(analysis.returns.notes.join(' ')).toContain('NEM hasonlítható össze');
    expect(analysis.warnings.join(' ')).toContain('Csak árfolyamhozam');
    expect(analysis.returns.annualizedTotalReturn.value.status).toBe('MISSING');
  });

  it('korrigált sor → adjusted_series; évesítés csak ≥ 1 éves ablakra', () => {
    const long = analyze({ totalSeries: ok(series({ count: 300 })) }); // ~ 1,15 év
    expect(long.returns.totalReturnMethod).toBe('adjusted_series');
    expect(long.returns.annualizedTotalReturn.value.status).toBe('OK');
    const short = analyze({ totalSeries: ok(series({ count: 100 })) });
    expect(short.returns.annualizedTotalReturn.value.status).toBe('INSUFFICIENT_DATA');
  });

  it('akkumulálóként megadva, de van kifizetés → figyelmeztetés', () => {
    const analysis = analyze({
      dividends: ok(dividends([{ exDate: '2026-06-15', amount: 0.5 }])),
      options: { metadata: metadata({ distribution: 'accumulating' }) },
    });
    expect(analysis.returns.notes.join(' ')).toContain('ellenőrizd az osztálykezelést');
  });

  it('ismeretlen osztalékkezelés + kifizetések → „valószínűleg disztribúciós” megjegyzés', () => {
    const analysis = analyze({ dividends: ok(dividends([{ exDate: '2026-06-15', amount: 0.5 }])) });
    expect(analysis.returns.notes.join(' ')).toContain('valószínűleg disztribúciós');
    expect(analysis.returns.distributionYieldTtm.value.status).toBe('OK');
  });

  it('eltérő ablakú ár- és total return sor → megjegyzés', () => {
    const analysis = analyze({ priceSeries: ok(series({ count: 250, adjustment: 'SPLIT' })) });
    expect(analysis.returns.notes.join(' ')).toContain('ablaka eltér');
  });

  it('nincs ártörténet → az összes hozam- és kockázati mutató a hiány okával', () => {
    const analysis = analyze({ totalSeries: unavailable(), priceSeries: unavailable() });
    expect(analysis.returns.priceReturn.value.status).toBe('UNAVAILABLE');
    expect(analysis.returns.comparisonBasis).toBe('none');
    expect(analysis.risk.volatility.value.status).toBe('UNAVAILABLE');
    expect(analysis.profile.tradingCurrency.status).toBe('MISSING');
  });
});

describe('deviza: hedged / unhedged, jegyzési vs. mögöttes', () => {
  const usdHoldings = {
    asOf: '2026-10-31',
    holdings: [
      ...holdingsList(6, 0.1, { currency: 'USD', country: 'US' }),
      ...holdingsList(4, 0.1, { currency: 'EUR', country: 'DE' }),
    ],
    declaredComplete: true,
  };

  it('fedezetlen: EUR-ban jegyzett, főleg USD mögöttes → 60% idegen kitettség EUR befektetőnek', () => {
    const analysis = analyze({
      options: {
        displayCurrency: 'EUR',
        metadata: metadata({ currencyHedged: false, holdings: usdHoldings }),
      },
    });
    expect(value(analysis.currency.unhedgedForeignShare)).toBeCloseTo(0.6, 12);
    expect(analysis.currency.hedgeCurrency.status).toBe('NOT_APPLICABLE');
    expect(analysis.currency.notes.join(' ')).toContain('nem azonos a fő mögöttes kitettséggel');
    expect(
      analysis.currency.underlyingExposure.status === 'OK' &&
        analysis.currency.underlyingExposure.value[0],
    ).toEqual({ currency: 'USD', weight: expect.closeTo(0.6, 12) });
  });

  it('EUR-ra fedezett osztály EUR befektetőnek → 0; HUF befektetőnek → 1', () => {
    const hedged = metadata({ currencyHedged: true, hedgeCurrency: 'EUR', holdings: usdHoldings });
    const eur = analyze({ options: { displayCurrency: 'EUR', metadata: hedged } });
    expect(value(eur.currency.unhedgedForeignShare)).toBe(0);
    const huf = analyze({ options: { displayCurrency: 'HUF', metadata: hedged } });
    expect(value(huf.currency.unhedgedForeignShare)).toBe(1);
    expect(huf.currency.notes.join(' ')).toContain('csak megjelenítés');
  });

  it('fedezett, de fedezési deviza nélkül → MISSING', () => {
    const analysis = analyze({
      options: { displayCurrency: 'EUR', metadata: metadata({ currencyHedged: true }) },
    });
    expect(analysis.currency.hedgeCurrency.status).toBe('MISSING');
    expect(analysis.currency.unhedgedForeignShare.value.status).toBe('MISSING');
  });

  it('fedezetlen, de fedezési deviza megadva → figyelmeztetés, NOT_APPLICABLE', () => {
    const analysis = analyze({
      options: { metadata: metadata({ currencyHedged: false, hedgeCurrency: 'EUR' }) },
    });
    expect(analysis.warnings.join(' ')).toContain('fedezetlen');
    expect(analysis.profile.hedgeCurrency.status).toBe('NOT_APPLICABLE');
  });

  it('kijelzési deviza nélkül → MISSING; holdings-deviza nélkül → MISSING', () => {
    expect(analyze().currency.unhedgedForeignShare.value.status).toBe('MISSING');
    const noCurrency = analyze({
      options: {
        displayCurrency: 'EUR',
        metadata: metadata({
          currencyHedged: false,
          holdings: { asOf: '2026-10-31', holdings: holdingsList(10, 0.1), declaredComplete: true },
        }),
      },
    });
    expect(noCurrency.currency.underlyingExposure.status).toBe('MISSING');
    expect(noCurrency.currency.unhedgedForeignShare.value.status).toBe('MISSING');
  });

  it('AUM átváltása a kijelzési pénznemre (calculated), illetve a hiba oka', () => {
    const aum = { amount: 1_000_000, currency: 'USD' };
    const converted = analyze({
      options: { displayCurrency: 'EUR', metadata: metadata({ aum }) },
      aumConversion: ok({
        original: { amount: 1_000_000, currency: 'USD' as never },
        converted: { amount: 900_000, currency: 'EUR' as never },
        rate: {
          base: 'USD' as never,
          quote: 'EUR' as never,
          rate: 0.9,
          asOf: '2026-11-20' as never,
          provenance: provenance(),
        },
        minorUnitDivisor: null,
      }),
    });
    const display = converted.currency.aumInDisplayCurrency;
    expect(display.status === 'OK' && display.value.amount).toBe(900_000);
    expect(display.status === 'OK' && display.provenance.kind).toBe('calculated');
    const aumFeature = converted.features.features.find((f) => f.id === 'aum');
    expect(aumFeature?.kind === 'numeric' && aumFeature.metric.value.status).toBe('OK');

    const failed = analyze({
      options: { displayCurrency: 'EUR', metadata: metadata({ aum }) },
      aumConversion: unavailable('nincs ráta'),
    });
    expect(failed.currency.aumInDisplayCurrency.status).toBe('UNAVAILABLE');
    expect(
      analyze({ options: { metadata: metadata({ aum }) } }).currency.aumInDisplayCurrency.status,
    ).toBe('NOT_APPLICABLE');
  });
});

describe('tracking és béta – eltérő időszakok, indexalap', () => {
  const fund = series({ count: 300 });
  /** Index = ETF + napi 0,0008% (≈ 0,2%/év) előny → negatív TD. */
  const index = (count: number, endOffsetDays = 0, currency = 'EUR') =>
    series({
      count,
      endOffsetDays,
      currency,
      start: 200,
      returnAt: (i) => (1 + dailyReturnOf(i)) * 1.000008 - 1,
    });
  const dailyReturnOf = (i: number) => 0.01 * Math.sin(i * 0.7) + 0.0003;

  it('azonos ablak: TD < 0, TE kicsi, béta ≈ 1', () => {
    const analysis = analyze({
      totalSeries: ok(fund),
      options: {
        benchmark: {
          name: 'FTSE All-World NTR',
          returnBasis: 'net_total_return',
          series: index(300),
        },
      },
    });
    const td = value(analysis.tracking.trackingDifference);
    const first = fund.points[0]!.close;
    const last = fund.points[fund.points.length - 1]!.close;
    const indexSeries = index(300);
    const expected =
      last / first - 1 - (indexSeries.points[299]!.close / indexSeries.points[0]!.close - 1);
    expect(td).toBeCloseTo(expected, 12);
    expect(td).toBeLessThan(0);
    expect(value(analysis.tracking.trackingError)).toBeLessThan(0.001);
    expect(value(analysis.tracking.annualizedTrackingDifference)).toBeLessThan(0);
    expect(value(analysis.risk.beta)).toBeCloseTo(1, 3);
    expect(analysis.tracking.definitions.join(' ')).toContain('NETTÓ total return');
  });

  it('eltérő időszakok: a közös ablakra számol, és ezt jelzi', () => {
    // Az index sora 60 munkanappal korábban ér véget és csak 200 pontos.
    const analysis = analyze({
      totalSeries: ok(fund),
      options: {
        benchmark: { name: 'Index', returnBasis: 'net_total_return', series: index(200, 84) },
      },
    });
    const td = analysis.tracking.trackingDifference;
    expect(td.value.status).toBe('OK');
    expect(td.notes.join(' ')).toContain('Eltérő időszakok');
    expect(td.window?.end).not.toBe(fund.points[fund.points.length - 1]!.date);
  });

  it('rövid közös ablak: TD OK, évesített TD és TE INSUFFICIENT_DATA', () => {
    const analysis = analyze({
      totalSeries: ok(fund),
      options: {
        benchmark: { name: 'Index', returnBasis: 'gross_total_return', series: index(60) },
      },
    });
    expect(analysis.tracking.trackingDifference.value.status).toBe('OK');
    expect(analysis.tracking.annualizedTrackingDifference.value.status).toBe('INSUFFICIENT_DATA');
    expect(analysis.tracking.trackingError.value.status).toBe('INSUFFICIENT_DATA');
    expect(analysis.risk.beta.value.status).toBe('INSUFFICIENT_DATA');
  });

  it('nincs közös dátum → INSUFFICIENT_DATA', () => {
    const analysis = analyze({
      totalSeries: ok(series({ count: 50 })),
      options: {
        benchmark: { name: 'Index', returnBasis: 'net_total_return', series: index(50, 200) },
      },
    });
    expect(analysis.tracking.trackingDifference.value.status).toBe('INSUFFICIENT_DATA');
  });

  it('árindex → NOT_MEANINGFUL; eltérő pénznem → INVALID_INPUT', () => {
    const price = analyze({
      options: { benchmark: { name: 'S&P 500 (ár)', returnBasis: 'price', series: index(300) } },
    });
    expect(price.tracking.trackingDifference.value.status).toBe('NOT_MEANINGFUL');
    expect(price.tracking.trackingError.value.status).toBe('NOT_MEANINGFUL');
    const fx = analyze({
      options: {
        benchmark: {
          name: 'Index USD',
          returnBasis: 'net_total_return',
          series: index(300, 0, 'USD'),
        },
      },
    });
    expect(fx.tracking.trackingDifference.value.status).toBe('INVALID_INPUT');
    expect(fx.risk.beta.value.status).toBe('INVALID_INPUT');
  });

  it('akkumuláló ETF korrigált sor nélkül: az árfolyamsor a követés alapja', () => {
    const analysis = analyze({
      totalSeries: unavailable(),
      options: {
        metadata: metadata({ distribution: 'accumulating' }),
        benchmark: { name: 'Index', returnBasis: 'net_total_return', series: index(300) },
      },
    });
    expect(analysis.tracking.trackingDifference.value.status).toBe('OK');
    expect(analysis.tracking.trackingDifference.notes.join(' ')).toContain('Akkumuláló');
  });

  it('disztribúciós ETF korrigált sor nélkül → TD MISSING', () => {
    const analysis = analyze({
      totalSeries: unavailable(),
      options: {
        metadata: metadata({ distribution: 'distributing' }),
        benchmark: { name: 'Index', returnBasis: 'net_total_return', series: index(300) },
      },
    });
    expect(analysis.tracking.trackingDifference.value.status).toBe('MISSING');
  });
});

describe('kockázat – csak megfelelő idősorral', () => {
  it('kevés adat (60 nap) → INSUFFICIENT_DATA a free-csomag okával', () => {
    const analysis = analyze({ totalSeries: ok(series({ count: 60 })) });
    expect(analysis.risk.volatility.value.status).toBe('INSUFFICIENT_DATA');
    expect(analysis.risk.maxDrawdown.value.status).toBe('INSUFFICIENT_DATA');
    expect(analysis.risk.sharpe.value.status).toBe('MISSING');
  });

  it('rf megadva → Sharpe és Sortino OK; fél–egy év közötti ablak → megjegyzés', () => {
    const analysis = analyze({
      totalSeries: ok(series({ count: 200 })),
      options: { riskFreeRate: 0.02 },
    });
    expect(analysis.risk.sharpe.value.status).toBe('OK');
    expect(analysis.risk.sortino.value.status).toBe('OK');
    expect(analysis.risk.volatility.notes.join(' ')).toContain('1 évnél rövidebb');
    expect(analysis.risk.volatility.reliability).toBe('short_window');
    expect(analysis.risk.sharpe.reliability).toBe('short_window');
    expect(analysis.risk.maxDrawdown.notes.join(' ')).toContain('korábbi válságidőszakot');
  });

  it('megbízhatóság (D-070): 240 napi hozamtól standard, 239-nél rövid ablak', () => {
    const at240 = analyze({ totalSeries: ok(series({ count: 241 })) });
    expect(at240.risk.volatility.window?.observations).toBe(240);
    expect(at240.risk.volatility.reliability).toBe('standard');
    expect(at240.risk.volatility.notes.join(' ')).not.toContain('1 évnél rövidebb');
    const at239 = analyze({ totalSeries: ok(series({ count: 240 })) });
    expect(at239.risk.volatility.reliability).toBe('short_window');
  });

  it('a minimum alatt nincs címke, csak INSUFFICIENT_DATA', () => {
    const analysis = analyze({ totalSeries: ok(series({ count: 60 })) });
    expect(analysis.risk.volatility.reliability).toBeNull();
  });

  it('egyedi minimum: minRiskObservations = 30', () => {
    const analysis = analyze({
      totalSeries: ok(series({ count: 60 })),
      options: { minRiskObservations: 30 },
    });
    expect(analysis.risk.volatility.value.status).toBe('OK');
  });

  it('total return sor nélkül az árfolyamsorból, megjegyzéssel (nyers árnál split-figyelmeztetés)', () => {
    const analysis = analyze({
      totalSeries: unavailable(),
      priceSeries: ok(series({ count: 300, adjustment: 'NONE' })),
    });
    expect(analysis.risk.volatility.value.status).toBe('OK');
    expect(analysis.risk.volatility.notes.join(' ')).toContain('árfolyamsorból');
    expect(analysis.risk.volatility.notes.join(' ')).toContain('split');
  });

  it('1 pontos sor → MISSING_DATA alapú hiány', () => {
    const analysis = analyze({ totalSeries: ok(series({ count: 1 })), priceSeries: unavailable() });
    expect(analysis.risk.volatility.value.status).toBe('MISSING');
  });
});

describe('profil: forrás-elsőbbség, UCITS, lefedettség', () => {
  const instrumentProfile = ok({
    listingId: 'VWCE@XETR' as never,
    name: 'Vanguard FTSE All-World UCITS ETF',
    kindHint: 'etf' as const,
    isin: 'IE00BK5BQT80' as never,
    cik: null,
    country: 'IE',
    sector: null,
    industry: null,
    exchangeName: 'XETRA',
    tradingCurrency: 'EUR' as never,
    website: null,
    description: null,
    beta: null,
    provenance: provenance({ sourceName: 'FMP' }),
  });

  it('a szolgáltatói név az elsődleges; eltérő kézi érték → figyelmeztetés', () => {
    const analysis = analyze({
      instrumentProfile,
      options: { metadata: metadata({ name: 'Más név', isin: 'IE00BK5BQT80' }) },
    });
    expect(analysis.profile.name.status === 'OK' && analysis.profile.name.value).toBe(
      'Vanguard FTSE All-World UCITS ETF',
    );
    expect(analysis.warnings.join(' ')).toContain('Név');
    expect(analysis.warnings.join(' ')).not.toContain('ISIN');
    expect(analysis.profile.ticker).toBe('VWCE');
    expect(analysis.profile.exchange).toBe('XETR');
  });

  it('US domicil: UCITS NOT_APPLICABLE; „UCITS = igen” + US → figyelmeztetés', () => {
    const us = analyze({ options: { metadata: metadata({ domicile: 'US' }) } });
    expect(us.profile.ucits.status).toBe('NOT_APPLICABLE');
    expect(
      us.coverage.items.filter((i) => i.status === 'NOT_APPLICABLE').map((i) => i.field),
    ).toContain('ucits');
    const conflict = analyze({ options: { metadata: metadata({ domicile: 'US', ucits: true }) } });
    expect(conflict.warnings.join(' ')).toContain('UCITS');
  });

  it('jegyzési pénznem forrás-sorrend: árfolyam → ártörténet → profil', () => {
    const fromProfile = analyze({
      totalSeries: unavailable(),
      priceSeries: unavailable(),
      instrumentProfile,
    });
    expect(
      fromProfile.profile.tradingCurrency.status === 'OK' &&
        fromProfile.profile.tradingCurrency.value,
    ).toBe('EUR');
  });

  it('teljes metaadat → a lefedettség nő, a struktúra-feature-ök értéket kapnak', () => {
    const analysis = analyze({
      instrumentProfile,
      options: {
        metadata: metadata({
          issuer: 'Vanguard',
          fundBaseCurrency: 'USD',
          aum: { amount: 30e9, currency: 'USD', asOf: '2026-10-31' },
          inceptionDate: '2019-07-23',
          ter: 0.0019,
          replication: 'physical_sampling',
          benchmark: 'FTSE All-World',
          distribution: 'accumulating',
          ucits: true,
          currencyHedged: false,
          classification: {
            region: 'GLOBAL',
            assetClass: 'equity',
            sizeSegment: 'large_mid',
            style: 'blend',
            dividendFocus: 'none',
            weighting: 'market_cap',
          },
        }),
        liquidity: {
          averageDailyTradedValue: 25e6,
          currency: 'EUR',
          asOf: '2026-11-20',
          sourceName: 'Xetra (kézi)',
        },
      },
    });
    expect(analysis.coverage.available).toBe(analysis.coverage.total - 1); // csak a holdings hiányzik
    expect(analysis.features.groupCoverage.structure).toEqual({ available: 5, total: 5 });
    expect(analysis.features.groupCoverage.liquidity).toEqual({ available: 1, total: 1 });
    const age = analysis.features.features.find((f) => f.id === 'fundAgeYears');
    expect(age?.kind === 'numeric' && value(age.metric)).toBeCloseTo(7.33, 1);
    const synthetic = analysis.features.features.find((f) => f.id === 'synthetic');
    expect(
      synthetic?.kind === 'categorical' && synthetic.value.status === 'OK' && synthetic.value.value,
    ).toBe('nem');
  });

  it('érvénytelen forgalmi adat és jövőbeli indulás → INVALID_INPUT feature', () => {
    const analysis = analyze({
      options: {
        metadata: metadata({ inceptionDate: '2030-01-01' }),
        liquidity: {
          averageDailyTradedValue: -1,
          currency: 'EUR',
          asOf: '2026-11-20',
          sourceName: 'x',
        },
      },
    });
    const find = (id: string) => analysis.features.features.find((f) => f.id === id);
    const liquidity = find('averageDailyTradedValue');
    const age = find('fundAgeYears');
    expect(liquidity?.kind === 'numeric' && liquidity.metric.value.status).toBe('INVALID_INPUT');
    expect(age?.kind === 'numeric' && age.metric.value.status).toBe('INVALID_INPUT');
  });
});
