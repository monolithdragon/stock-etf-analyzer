/**
 * PHASE 04A use case-ek kézzel írt fake portokkal (a rétegszabály miatt nincs infrastructure-import).
 */
import {
  AppErrors,
  createFxRate,
  err,
  ok,
  parseCurrencyCode,
  parseSecurityId,
  type CurrencyCode,
  type FxRateSet,
  type IsoDate,
  type IsoTimestamp,
  type Result,
} from '@/domain';

import type { FxGateway, MarketDataGateway } from '../ports';
import { createConvertMoney } from './convert-money';
import {
  createGetFinancialStatements,
  createGetSecurityListings,
} from './get-market-reference-data';

const c = (code: string): CurrencyCode => {
  const parsed = parseCurrencyCode(code);
  if (!parsed.ok) throw new Error(code);
  return parsed.value;
};
const clockAt = (iso: string) => ({ now: () => new Date(iso) });

function ratesAsOf(asOf: string): FxRateSet {
  const provenance = {
    sourceId: 'ecb-fx',
    sourceName: 'ECB',
    kind: 'reported' as const,
    fetchedAt: '2026-11-21T12:00:00Z' as IsoTimestamp,
    asOf: asOf as IsoDate,
    freshness: 'UNKNOWN' as const,
  };
  const make = (quote: string, rate: number) => {
    const r = createFxRate({ base: c('EUR'), quote: c(quote), rate, asOf, provenance });
    if (!r.ok) throw new Error('setup');
    return r.value;
  };
  return { base: c('EUR'), rates: [make('USD', 1.1), make('HUF', 400)], missing: [] };
}

function fxGateway(result: Result<FxRateSet>): FxGateway & { requests: unknown[] } {
  const requests: unknown[] = [];
  return {
    requests,
    async getReferenceRates(request) {
      requests.push(request);
      return result;
    },
  };
}

const usd100 = { amount: 100, currency: c('USD') };

/** A blokkban nem használt (PHASE 04B) gateway-képességek: hívásuk tesztelési hiba. */
const unusedPhase04bMethods = {
  getPriceHistory: async () => {
    throw new Error('nem várt hívás');
  },
  getInstrumentProfile: async () => {
    throw new Error('nem várt hívás');
  },
  getDividends: async () => {
    throw new Error('nem várt hívás');
  },
  searchInstruments: async () => {
    throw new Error('nem várt hívás');
  },
};

describe('convertMoney (FxService)', () => {
  it('friss rátával átvált; a natív összeg megmarad; a ráta FRESH jelölést kap', async () => {
    const gateway = fxGateway(ok(ratesAsOf('2026-11-20')));
    const convert = createConvertMoney({
      fxGateway: gateway,
      clock: clockAt('2026-11-21T12:00:00Z'),
    });

    const result = await convert({ money: usd100, target: c('HUF') });

    expect(gateway.requests).toEqual([{ quotes: ['USD', 'HUF'], date: null }]);
    expect(result.ok && result.value.original).toEqual(usd100);
    expect(result.ok && result.value.converted.amount).toBeCloseTo(36363.636, 2);
    expect(result.ok && result.value.rate?.provenance.freshness).toBe('FRESH');
  });

  it('kissé régi (STALE) ráta: átvált, de a jelölés látható – nem csendes', async () => {
    const convert = createConvertMoney({
      fxGateway: fxGateway(ok(ratesAsOf('2026-11-14'))),
      clock: clockAt('2026-11-21T12:00:00Z'),
    });
    const result = await convert({ money: usd100, target: c('HUF') });
    expect(result.ok && result.value.rate?.provenance.freshness).toBe('STALE');
  });

  it('elavult (EXPIRED) ráta → MISSING_DATA, nincs csendes becslés', async () => {
    const convert = createConvertMoney({
      fxGateway: fxGateway(ok(ratesAsOf('2026-10-01'))),
      clock: clockAt('2026-11-21T12:00:00Z'),
    });
    expect(await convert({ money: usd100, target: c('HUF') })).toMatchObject({
      ok: false,
      error: { kind: 'MISSING_DATA', missing: ['fx:USD/HUF'] },
    });
  });

  it('történeti átváltás: a kért naphoz méri a frissességet (hétvégi nap → pénteki ráta FRESH)', async () => {
    const gateway = fxGateway(ok(ratesAsOf('2026-03-13')));
    const convert = createConvertMoney({
      fxGateway: gateway,
      clock: clockAt('2026-11-21T12:00:00Z'),
    });
    const result = await convert({
      money: usd100,
      target: c('HUF'),
      date: '2026-03-15' as IsoDate,
    });
    expect(gateway.requests).toEqual([{ quotes: ['USD', 'HUF'], date: '2026-03-15' }]);
    expect(result.ok && result.value.rate?.provenance.freshness).toBe('FRESH');
  });

  it('azonos fő pénznem (GBX → GBP): hálózati hívás nélkül, /100', async () => {
    const gateway = fxGateway(err(AppErrors.network('nem szabadna hívni')));
    const convert = createConvertMoney({
      fxGateway: gateway,
      clock: clockAt('2026-11-21T12:00:00Z'),
    });
    const result = await convert({ money: { amount: 250, currency: c('GBX') }, target: c('GBP') });
    expect(result).toMatchObject({
      ok: true,
      value: { converted: { amount: 2.5, currency: 'GBP' } },
    });
    expect(gateway.requests).toHaveLength(0);
  });

  it('a gateway hibája (pl. offline) változatlanul továbbmegy', async () => {
    const convert = createConvertMoney({
      fxGateway: fxGateway(err(AppErrors.network('offline'))),
      clock: clockAt('2026-11-21T12:00:00Z'),
    });
    expect(await convert({ money: usd100, target: c('HUF') })).toMatchObject({
      ok: false,
      error: { kind: 'NETWORK' },
    });
  });
});

describe('getFinancialStatements / getSecurityListings', () => {
  const securityId = parseSecurityId('sec-edgar:0000320193');
  if (!securityId.ok) throw new Error('setup');

  function gatewayWithFiling(asOf: string | null): MarketDataGateway & { calls: number } {
    const gateway = {
      calls: 0,
      ...unusedPhase04bMethods,
      async getQuote() {
        return err(AppErrors.notFound('x', 'x'));
      },
      async getSecurityListings() {
        gateway.calls += 1;
        return err(AppErrors.notFound('értékpapír (ISIN)', 'x'));
      },
      async getFinancialStatements() {
        gateway.calls += 1;
        return ok({
          securityId: securityId.ok ? securityId.value : (undefined as never),
          cik: null,
          entityName: 'Apple Inc.',
          frequency: 'quarterly' as const,
          statements: [],
          notes: [],
          provenance: {
            sourceId: 'sec-edgar',
            sourceName: 'SEC',
            kind: 'reported' as const,
            fetchedAt: '2026-11-21T12:00:00Z' as IsoTimestamp,
            asOf: asOf as IsoDate | null,
            freshness: 'FRESH' as const, // a forrás állítása – felülbíráljuk
          },
        });
      },
    };
    return gateway;
  }

  it('a frissességet a legutolsó filing dátumából, a saját óránkkal számolja', async () => {
    const clock = clockAt('2026-11-21T12:00:00Z');
    const fresh = await createGetFinancialStatements({
      marketData: gatewayWithFiling('2026-10-30'),
      clock,
    })('AAPL@XNAS', 'quarterly');
    const stale = await createGetFinancialStatements({
      marketData: gatewayWithFiling('2026-05-01'),
      clock,
    })('AAPL@XNAS', 'quarterly');
    const unknown = await createGetFinancialStatements({
      marketData: gatewayWithFiling(null),
      clock,
    })('AAPL@XNAS', 'quarterly');
    expect(fresh.ok && fresh.value.provenance.freshness).toBe('FRESH');
    expect(stale.ok && stale.value.provenance.freshness).toBe('STALE');
    expect(unknown.ok && unknown.value.provenance.freshness).toBe('UNKNOWN');
  });

  it('érvénytelen bemenetnél a gatewayt meg sem hívja', async () => {
    const gateway = gatewayWithFiling(null);
    const clock = clockAt('2026-11-21T12:00:00Z');
    expect(
      await createGetFinancialStatements({ marketData: gateway, clock })('AAPL', 'annual'),
    ).toMatchObject({
      ok: false,
      error: { kind: 'VALIDATION' },
    });
    expect(
      await createGetSecurityListings({ marketData: gateway, clock })('IE00BK5BQT81'),
    ).toMatchObject({
      ok: false,
      error: { kind: 'VALIDATION' },
    });
    expect(gateway.calls).toBe(0);
  });
});
