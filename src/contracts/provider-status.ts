import { z } from 'zod';

import { UNAVAILABLE_REASONS } from '@/domain';

import { PROVIDER_CAPABILITIES, SERVER_DATA_MODES } from './health';
import { isoTimestampSchema } from './shared';

/** A routing piaci szegmensei (DATA_SOURCES 5.2). `ANY` = nem jegyzéshez kötött képesség. */
export const ROUTING_MARKETS = ['US', 'EU', 'GLOBAL', 'ANY'] as const;
export type RoutingMarket = (typeof ROUTING_MARKETS)[number];

const quotaSchema = z.object({
  dailyLimit: z.number().int().positive(),
  usedToday: z.number().int().nonnegative(),
  remainingToday: z.number().int().nonnegative(),
  /** A keret nullázódása (UTC éjfél). */
  resetsAt: isoTimestampSchema,
  /**
   * `instance` = a számláló a proxy-példány memóriájában él (U-03, KI-23): újraindításkor
   * nullázódik, és nem látja a más példányok / más eszközök felhasználását.
   */
  scope: z.literal('instance'),
});

/**
 * `GET /api/v1/providers/status` (PHASE 04B): csomagszint, képességek, kvóta, routing.
 * KULCSOT, e-mail-címet vagy más személyes adatot SOHA nem tartalmaz.
 */
export const providerStatusDtoSchema = z.object({
  serverTime: isoTimestampSchema,
  dataMode: z.enum(SERVER_DATA_MODES),
  providers: z
    .array(
      z.object({
        id: z.string().min(1).max(64),
        name: z.string().min(1).max(200),
        kind: z.enum(SERVER_DATA_MODES),
        configured: z.boolean(),
        /** Csomagszint az env-ből (pl. `free`); `null`, ha a forrásnak nincs csomagja. */
        plan: z.string().max(40).nullable(),
        capabilities: z.array(z.enum(PROVIDER_CAPABILITIES)),
        /** Emberi leírás a lefedettségről (pl. „csak US jegyzések”). */
        coverage: z.string().max(300),
        quota: quotaSchema.nullable(),
        note: z.string().max(500).nullable(),
      }),
    )
    .max(20),
  routing: z
    .array(
      z.object({
        capability: z.enum(PROVIDER_CAPABILITIES),
        market: z.enum(ROUTING_MARKETS),
        /** Próbálási sorrend (csak a konfigurált szolgáltatók). Üres = nem elérhető. */
        chain: z.array(z.string().max(64)).max(10),
        /** Ha a lánc üres: miért nem elérhető. */
        unavailableReason: z.enum(UNAVAILABLE_REASONS).nullable(),
      }),
    )
    .max(100),
});

export type ProviderStatusDto = z.input<typeof providerStatusDtoSchema>;
