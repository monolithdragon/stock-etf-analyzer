/**
 * Determinisztikus DEMÓ devizaárfolyam-forrás (`kind: 'mock'`).
 * Kerek, nyilvánvalóan kitalált ráták (1 EUR = …) – nem valós árfolyam.
 */
import type { Clock, FxGateway } from '@/application';
import {
  createFxRate,
  createFxRateSet,
  parseCurrencyCode,
  toIsoTimestamp,
  toLocalIsoDate,
  type CurrencyCode,
  type FxRate,
} from '@/domain';

import { MOCK_SOURCE } from './mock-market-data-gateway';
import { systemClock } from '../system/system-clock';

export const MOCK_EUR_RATES: Readonly<Record<string, number>> = {
  USD: 1.1,
  HUF: 400,
  GBP: 0.85,
  CHF: 0.95,
  JPY: 160,
};

export function createMockFxGateway(clock: Clock = systemClock): FxGateway {
  return {
    async getReferenceRates({ quotes, date }) {
      const eur = parseCurrencyCode('EUR');
      if (!eur.ok) return eur;
      const now = clock.now();
      const asOf = date ?? toLocalIsoDate(now);
      const rates: FxRate[] = [];
      const missing: CurrencyCode[] = [];
      for (const quote of quotes) {
        if (quote === eur.value) continue;
        const value = MOCK_EUR_RATES[quote];
        if (value === undefined) {
          missing.push(quote);
          continue;
        }
        const rate = createFxRate({
          base: eur.value,
          quote,
          rate: value,
          asOf,
          provenance: {
            ...MOCK_SOURCE,
            kind: 'mock',
            fetchedAt: toIsoTimestamp(now),
            asOf: null,
            freshness: 'UNKNOWN',
          },
        });
        if (!rate.ok) return rate;
        rates.push({
          ...rate.value,
          provenance: { ...rate.value.provenance, asOf: rate.value.asOf },
        });
      }
      return createFxRateSet({ base: eur.value, rates, missing });
    },
  };
}
