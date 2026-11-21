import { z } from 'zod';

import type { DataProvenance, Metric } from '@/domain';

import { parseApiResponse } from './api-envelope';
import { quoteDtoSchema, quoteFromDto, type QuoteDto } from './quote';
import { dataProvenanceSchema, metricSchema } from './shared';

// Fordítási idejű ellenőrzés: a séma kimenete a domain típusába illeszkedik.
// Ha nem, a `true` érték nem adható a `false` típusú elemnek → a typecheck elbukik.
const numberMetric = metricSchema(z.number());
const schemaOutputsFitDomain: [
  z.output<typeof dataProvenanceSchema> extends DataProvenance ? true : false,
  z.output<typeof numberMetric> extends Metric<number> ? true : false,
] = [true, true];

it('a zod sémák kimenete a domain típusaiba illeszkedik (fordítási idejű ellenőrzés)', () => {
  expect(schemaOutputsFitDomain).toEqual([true, true]);
});

const VALID_QUOTE: QuoteDto = {
  listingId: 'DEMO@XNAS',
  price: 100,
  currency: 'USD',
  asOf: '2026-11-21T11:55:00Z',
  delayMinutes: 15,
  provenance: {
    sourceId: 'mock',
    sourceName: 'Demóadat',
    kind: 'mock',
    fetchedAt: '2026-11-21T12:00:00Z',
    asOf: '2026-11-21T11:55:00Z',
    freshness: 'UNKNOWN',
    currency: 'USD',
  },
};

describe('parseApiResponse (bizalmi határ)', () => {
  it('érvényes siker-borítékból típusos adatot ad, amely domain-modellé alakítható', () => {
    const parsed = parseApiResponse({ apiVersion: '1', data: VALID_QUOTE }, quoteDtoSchema);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(quoteFromDto(parsed.value)).toMatchObject({
      ok: true,
      value: { listingId: 'DEMO@XNAS', price: { amount: 100, currency: 'USD' } },
    });
  });

  it('séma-eltérés → UPSTREAM / CONTRACT_MISMATCH, útvonallal', () => {
    const broken = { apiVersion: '1', data: { ...VALID_QUOTE, price: '100' } };
    const parsed = parseApiResponse(broken, quoteDtoSchema);
    expect(parsed).toMatchObject({
      ok: false,
      error: { kind: 'UPSTREAM', failure: 'CONTRACT_MISMATCH' },
    });
    if (!parsed.ok) expect(parsed.error.message).toContain('data.price');
  });

  it('a domain szabályait a séma hívja (pl. érvénytelen pénznem), nem másolja', () => {
    const parsed = parseApiResponse(
      { apiVersion: '1', data: { ...VALID_QUOTE, currency: 'US Dollar' } },
      quoteDtoSchema,
    );
    expect(parsed.ok).toBe(false);
  });

  it('az üzleti invariánst (pozitív ár) a domain mapper ellenőrzi', () => {
    const parsed = parseApiResponse(
      { apiVersion: '1', data: { ...VALID_QUOTE, price: 0 } },
      quoteDtoSchema,
    );
    expect(parsed.ok).toBe(true);
    if (parsed.ok)
      expect(quoteFromDto(parsed.value)).toMatchObject({
        ok: false,
        error: { kind: 'VALIDATION' },
      });
  });

  it.each([
    ['RATE_LIMITED', { kind: 'RATE_LIMITED', retryAfterSec: 60 }],
    ['TIMEOUT', { kind: 'TIMEOUT' }],
    ['VALIDATION_FAILED', { kind: 'VALIDATION' }],
    ['NOT_FOUND', { kind: 'NOT_FOUND' }],
    ['UNSUPPORTED_MARKET', { kind: 'MISSING_DATA' }],
    ['UPSTREAM_INVALID', { kind: 'UPSTREAM', failure: 'INVALID_RESPONSE' }],
    ['INTERNAL', { kind: 'UPSTREAM', failure: 'HTTP_ERROR' }],
    ['AI_DISABLED', { kind: 'AI', failure: 'AI_DISABLED' }],
  ])('hiba-boríték %s → megfelelő AppError', (code, expected) => {
    const json = { apiVersion: '1', error: { code, message: 'x', retryAfterSec: 60 } };
    expect(parseApiResponse(json, quoteDtoSchema)).toMatchObject({ ok: false, error: expected });
  });

  it('ismeretlen API-verzió vagy nem-objektum → CONTRACT_MISMATCH', () => {
    for (const json of [null, 'html hibaoldal', { apiVersion: '2', data: VALID_QUOTE }]) {
      expect(parseApiResponse(json, quoteDtoSchema)).toMatchObject({
        ok: false,
        error: { failure: 'CONTRACT_MISMATCH' },
      });
    }
  });
});

describe('metricSchema', () => {
  it('OK státusz érték nélkül, illetve nem-OK státusz értékkel nem érvényes', () => {
    expect(numberMetric.safeParse({ status: 'OK', reason: 'x' }).success).toBe(false);
    expect(numberMetric.safeParse({ status: 'MISSING', reason: 'Nincs adat' }).success).toBe(true);
    expect(numberMetric.safeParse({ status: 'MISSING' }).success).toBe(false);
    expect(numberMetric.safeParse({ status: 'UNAVAILABLE', reason: 'x' }).success).toBe(false);
    expect(
      numberMetric.safeParse({
        status: 'UNAVAILABLE',
        unavailableReason: 'PLAN_LIMIT',
        reason: 'x',
      }).success,
    ).toBe(true);
  });

  it('JSON-ban a null nem válik 0-vá', () => {
    expect(
      numberMetric.safeParse({ status: 'OK', value: null, provenance: VALID_QUOTE.provenance })
        .success,
    ).toBe(false);
  });
});
