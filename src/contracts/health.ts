import { z } from 'zod';

import { isoTimestampSchema } from './shared';

/** A proxy által ismert képességek (DATA_SOURCES 2., PHASE 04 feladat 4.). */
export const PROVIDER_CAPABILITIES = [
  'quote',
  'priceHistory',
  'profile',
  'financialStatements',
  'dividends',
  'etfMetadata',
  'etfHoldings',
  'listings',
  'fxRates',
] as const;
export type ProviderCapability = (typeof PROVIDER_CAPABILITIES)[number];

export const SERVER_DATA_MODES = ['live', 'mock'] as const;
export type ServerDataMode = (typeof SERVER_DATA_MODES)[number];

/**
 * `GET /api/v1/health` – állapot és képességek. KULCSOT, e-mail-címet vagy más
 * személyes adatot SOHA nem tartalmaz; csak azt, hogy egy szolgáltató konfigurálva van-e.
 */
export const healthDtoSchema = z.object({
  status: z.literal('ok'),
  serverTime: isoTimestampSchema,
  dataMode: z.enum(SERVER_DATA_MODES),
  providers: z
    .array(
      z.object({
        id: z.string().min(1).max(64),
        name: z.string().min(1).max(200),
        kind: z.enum(['live', 'mock']),
        capabilities: z.array(z.enum(PROVIDER_CAPABILITIES)),
        configured: z.boolean(),
        note: z.string().max(500).nullable(),
      }),
    )
    .max(20),
  /** Képességek, amelyekhez jelenleg NINCS bekötött forrás (pl. árfolyam a PHASE 04B-ig). */
  unavailableCapabilities: z.array(z.enum(PROVIDER_CAPABILITIES)),
});

export type HealthDto = z.input<typeof healthDtoSchema>;
