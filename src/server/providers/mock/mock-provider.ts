/**
 * `mock` szolgáltató a proxyn: determinisztikus DEMÓ adat (D-005, PHASE 04 feladat 9.).
 *
 * Nem keverhető éles adattal:
 * - minden provenance `kind: 'mock'`, a név „Demóadat (nem valós …)”;
 * - csak `PROXY_DATA_MODE=mock` mellett regisztrálható (`createProviderRegistry` ellenőrzi);
 * - kitalált `DEMO*` tickerek és kerek számok – nem valós instrumentum, nem valós árfolyam.
 */
import {
  AppErrors,
  createFinancialStatement,
  createFinancialStatementSet,
  createFiscalPeriod,
  createFxRate,
  createFxRateSet,
  createQuote,
  err,
  metricOk,
  ok,
  parseCurrencyCode,
  parseIsoDate,
  parseSecurityId,
  toIsoTimestamp,
  toUtcIsoDate,
  type CurrencyCode,
  type DataProvenance,
  type FxRate,
  type Metric,
} from '@/domain';

import type { MarketDataProvider } from '../market-data-provider';

export const MOCK_PROVIDER_SOURCE = {
  sourceId: 'mock',
  sourceName: 'Demóadat (nem valós piaci adat)',
} as const;

const DEMO_QUOTES: Readonly<
  Record<string, { price: number; currency: string; ageMinutes: number }>
> = {
  'DEMO@XNAS': { price: 100, currency: 'USD', ageMinutes: 5 },
  'DEMOETF@XETR': { price: 50, currency: 'EUR', ageMinutes: 5 },
};

/** Kerek, nyilvánvalóan kitalált demó ráták (1 EUR = …). */
export const DEMO_EUR_RATES: Readonly<Record<string, number>> = {
  USD: 1.1,
  HUF: 400,
  GBP: 0.85,
  CHF: 0.95,
  JPY: 160,
};

function mockProvenance(now: Date, extra: Partial<DataProvenance> = {}): DataProvenance {
  return {
    ...MOCK_PROVIDER_SOURCE,
    kind: 'mock',
    fetchedAt: toIsoTimestamp(now),
    asOf: null,
    freshness: 'UNKNOWN',
    ...extra,
  };
}

export function createMockProvider(deps: { readonly now: () => Date }): MarketDataProvider {
  return {
    info: {
      id: MOCK_PROVIDER_SOURCE.sourceId,
      name: MOCK_PROVIDER_SOURCE.sourceName,
      kind: 'mock',
      configured: true,
      note: 'DEMÓ mód: minden adat kitalált és „mock” jelölésű.',
    },

    async getQuote(listingId) {
      const fixture = DEMO_QUOTES[listingId];
      if (fixture === undefined) return err(AppErrors.notFound('demó árfolyam', listingId));
      const currency = parseCurrencyCode(fixture.currency);
      if (!currency.ok) return currency;
      const now = deps.now();
      const asOf = toIsoTimestamp(new Date(now.getTime() - fixture.ageMinutes * 60_000));
      return createQuote({
        listingId,
        price: fixture.price,
        currency: currency.value,
        asOf,
        delayMinutes: null,
        provenance: mockProvenance(now, { asOf, currency: currency.value }),
      });
    },

    async getFxRates(request) {
      const now = deps.now();
      const asOf = request.date ?? toUtcIsoDate(now);
      const rates: FxRate[] = [];
      const missing: CurrencyCode[] = [];
      for (const quote of request.quotes) {
        const value = request.base === 'EUR' ? DEMO_EUR_RATES[quote] : undefined;
        if (value === undefined) {
          if (quote !== request.base) missing.push(quote);
          continue;
        }
        const rate = createFxRate({
          base: request.base,
          quote,
          rate: value,
          asOf,
          provenance: mockProvenance(now, { reference: 'demó ráta' }),
        });
        if (!rate.ok) return rate;
        rates.push({
          ...rate.value,
          provenance: { ...rate.value.provenance, asOf: rate.value.asOf },
        });
      }
      return createFxRateSet({ base: request.base, rates, missing });
    },

    async getFinancialStatements(listingId, frequency) {
      if (listingId !== 'DEMO@XNAS') return err(AppErrors.notFound('demó kimutatás', listingId));
      const now = deps.now();
      const securityId = parseSecurityId('mock:DEMO');
      const usd = parseCurrencyCode('USD');
      const period = createFiscalPeriod({
        fiscalYear: 2025,
        fiscalPeriod: 'FY',
        start: '2025-01-01',
        end: '2025-12-31',
      });
      const filed = parseIsoDate('2026-02-15');
      if (!securityId.ok || !usd.ok || !period.ok || !filed.ok) {
        return err(AppErrors.validation('Hibás demó-konfiguráció.'));
      }
      const base = mockProvenance(now, { asOf: filed.value, period: period.value });
      const money = (value: number): Metric<number> =>
        metricOk(value, { ...base, unit: 'money', currency: usd.value });

      if (frequency === 'quarterly') {
        return createFinancialStatementSet({
          securityId: securityId.value,
          cik: null,
          entityName: 'Demo Corp (kitalált)',
          frequency,
          statements: [],
          notes: ['Demó módban nincs negyedéves adat.'],
          provenance: base,
        });
      }
      // Szándékosan hiányos: a `costOfRevenue` NINCS megadva → MISSING (nem 0);
      // a `netIncome` 0 – ez JELENTETT nulla, tehát OK státuszú (a kettő nem keverhető).
      const income = createFinancialStatement({
        statementType: 'income',
        securityId: securityId.value,
        period: period.value,
        currency: usd.value,
        provenance: base,
        lineItems: { revenue: money(1_000_000_000), netIncome: money(0) },
      });
      if (!income.ok) return income;
      return ok({
        securityId: securityId.value,
        cik: null,
        entityName: 'Demo Corp (kitalált)',
        frequency,
        statements: [income.value],
        notes: [
          'Demó adat: a costOfRevenue szándékosan hiányzik (MISSING), a nettó eredmény jelentett 0.',
        ],
        provenance: base,
      });
    },
  };
}
