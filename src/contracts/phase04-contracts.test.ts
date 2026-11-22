import { z } from 'zod';

import type { FinancialStatement, FxRateSet, SecurityListings } from '@/domain';

import { apiErrorToAppError, parseApiResponse } from './api-envelope';
import { financialStatementDtoSchema } from './financials';
import { fxRateSetDtoSchema } from './fx';
import { securityListingsDtoSchema } from './listings';
import { fiscalPeriodSchema } from './shared';

// Fordítási idejű ellenőrzés: az új sémák kimenete a domain típusa.
const outputsAreDomain: [
  z.output<typeof fxRateSetDtoSchema> extends FxRateSet ? true : false,
  z.output<typeof securityListingsDtoSchema> extends SecurityListings ? true : false,
  z.output<typeof financialStatementDtoSchema> extends FinancialStatement ? true : false,
] = [true, true, true];

it('az új sémák kimenete domain-típus (fordítási idejű ellenőrzés)', () => {
  expect(outputsAreDomain).toEqual([true, true, true]);
});

const provenance = {
  sourceId: 'sec-edgar',
  sourceName: 'SEC',
  kind: 'reported',
  fetchedAt: '2026-11-21T12:00:00Z',
  asOf: '2026-11-03',
  freshness: 'UNKNOWN',
};
const period = {
  fiscalYear: 2026,
  fiscalPeriod: 'FY',
  start: '2025-09-28',
  end: '2026-09-26',
  durationDays: 364,
};
const missing = { status: 'MISSING', reason: 'A forrás nem adta meg.' };
const incomeItems = Object.fromEntries(
  [
    'revenue',
    'costOfRevenue',
    'grossProfit',
    'operatingIncome',
    'pretaxIncome',
    'incomeTaxExpense',
    'netIncome',
    'epsBasic',
    'epsDiluted',
    'weightedSharesDiluted',
    'depreciationAmortization',
    'interestExpense',
  ].map((k) => [k, missing]),
);
const statement = {
  statementType: 'income',
  securityId: 'sec-edgar:0000320193',
  period,
  currency: 'USD',
  provenance,
  lineItems: {
    ...incomeItems,
    netIncome: { status: 'OK', value: 0, provenance: { ...provenance, currency: 'USD' } },
  },
};

describe('financialStatementDtoSchema', () => {
  it('a jelentett 0 OK marad, a hiányzó MISSING – a kettő nem keveredik', () => {
    const parsed = financialStatementDtoSchema.safeParse(statement);
    expect(parsed.success).toBe(true);
    if (!parsed.success || parsed.data.statementType !== 'income') return;
    expect(parsed.data.lineItems.netIncome).toMatchObject({ status: 'OK', value: 0 });
    expect(parsed.data.lineItems.revenue.status).toBe('MISSING');
  });

  it('hiányzó sortétel-KULCS → elutasítva (a hálózaton sem tűnhet el tétel csendben)', () => {
    const { revenue: _dropped, ...rest } = statement.lineItems as Record<string, unknown>;
    expect(financialStatementDtoSchema.safeParse({ ...statement, lineItems: rest }).success).toBe(
      false,
    );
  });

  it('érvény nélküli „MISSING” mellé csempészett érték → elutasítva', () => {
    const smuggled = {
      ...statement,
      lineItems: { ...statement.lineItems, revenue: { ...missing, value: 0 } },
    };
    const parsed = financialStatementDtoSchema.safeParse(smuggled);
    // A zod a nem várt kulcsot eldobja: a kimenetben NINCS érték.
    expect(parsed.success && parsed.data.lineItems).not.toHaveProperty('revenue.value');
  });

  it('a durationDays-t a domain számolja újra, az időszak-hossz szabályt a domain ellenőrzi', () => {
    expect(fiscalPeriodSchema.safeParse({ ...period, durationDays: 1 })).toMatchObject({
      success: true,
      data: { durationDays: 364 },
    });
    expect(fiscalPeriodSchema.safeParse({ ...period, start: '2026-06-01' }).success).toBe(false);
  });
});

describe('fxRateSetDtoSchema', () => {
  const rate = {
    base: 'EUR',
    quote: 'HUF',
    rate: 373.55,
    asOf: '2026-11-20',
    provenance: { ...provenance, sourceId: 'ecb-fx' },
  };

  it('érvényes készlet; a nem pozitív ráta és a vegyes bázis elutasítva', () => {
    expect(
      fxRateSetDtoSchema.safeParse({ base: 'EUR', rates: [rate], missing: ['AED'] }).success,
    ).toBe(true);
    expect(
      fxRateSetDtoSchema.safeParse({ base: 'EUR', rates: [{ ...rate, rate: 0 }], missing: [] })
        .success,
    ).toBe(false);
    expect(
      fxRateSetDtoSchema.safeParse({ base: 'EUR', rates: [{ ...rate, base: 'USD' }], missing: [] })
        .success,
    ).toBe(false);
  });
});

describe('securityListingsDtoSchema', () => {
  const listing = {
    securityId: 'IE00BK5BQT80',
    symbol: 'VWCE',
    mic: 'XETR',
    exchangeName: 'Xetra',
    tradingCurrency: null,
    figi: null,
    compositeFigi: null,
    kindHint: 'etf',
    sourceName: null,
  };
  const base = {
    isin: 'IE00BK5BQT80',
    omitted: { unmappedVenue: 0, composite: 0, invalidSymbol: 0 },
    provenance: { ...provenance, sourceId: 'openfigi', asOf: null },
  };

  it('idegen ISIN-ű jegyzés a listában → elutasítva', () => {
    expect(securityListingsDtoSchema.safeParse({ ...base, listings: [listing] }).success).toBe(
      true,
    );
    const foreign = { ...listing, securityId: 'US0378331005' };
    expect(securityListingsDtoSchema.safeParse({ ...base, listings: [foreign] }).success).toBe(
      false,
    );
  });
});

describe('CAPABILITY_UNAVAILABLE hibakód', () => {
  it('→ MISSING_DATA(source) a kliensen', () => {
    expect(
      apiErrorToAppError({ code: 'CAPABILITY_UNAVAILABLE', message: 'PHASE 04B' }),
    ).toMatchObject({
      kind: 'MISSING_DATA',
      missing: ['source'],
    });
    expect(
      parseApiResponse(
        { apiVersion: '1', error: { code: 'CAPABILITY_UNAVAILABLE', message: 'x' } },
        z.unknown(),
      ),
    ).toMatchObject({ ok: false, error: { kind: 'MISSING_DATA' } });
  });
});
