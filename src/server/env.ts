/**
 * Szerveroldali (proxy) konfiguráció. CSAK a `src/server` és a `+api.ts` route-ok olvassák.
 *
 * - Itt lehetnek titkok (API-kulcsok): ezek soha nem kerülhetnek kliens kódba (ARCHITECTURE 3.).
 * - A `SEC_USER_AGENT` nem titok, de személyes adat (kapcsolattartó e-mail): nem naplózzuk,
 *   és a health végpont csak azt jelzi, hogy be van-e állítva.
 */
import type { ServerDataMode } from '@/contracts';

import {
  DEFAULT_PLAN_ID,
  PLAN_TABLES,
  type PlanSpec,
  type PlannedProviderId,
} from './routing/plans';

export interface ServerEnv {
  /** `live` = valós szolgáltatók; `mock` = KIZÁRÓLAG demó szolgáltató (nincs keverés). */
  readonly dataMode: ServerDataMode;
  readonly secUserAgent: string | null;
  readonly openFigiApiKey: string | null;
  /** TITOK (PHASE 04B). Soha nem kerül naplóba, health- vagy status-válaszba. */
  readonly fmpApiKey: string | null;
  readonly fmpPlan: PlanSpec;
  /** TITOK (PHASE 04B). */
  readonly eodhdApiKey: string | null;
  readonly eodhdPlan: PlanSpec;
}

export interface ServerEnvIssue {
  readonly variable: string;
  readonly message: string;
}

export interface RawServerEnv {
  readonly PROXY_DATA_MODE?: string | undefined;
  readonly SEC_USER_AGENT?: string | undefined;
  readonly OPENFIGI_API_KEY?: string | undefined;
  readonly FMP_API_KEY?: string | undefined;
  readonly FMP_PLAN?: string | undefined;
  readonly EODHD_API_KEY?: string | undefined;
  readonly EODHD_PLAN?: string | undefined;
}

function parsePlan(
  provider: PlannedProviderId,
  variable: string,
  raw: string | undefined,
  issues: ServerEnvIssue[],
): PlanSpec {
  const table = PLAN_TABLES[provider];
  const fallback = table[DEFAULT_PLAN_ID];
  if (fallback === undefined) throw new Error(`Programozási hiba: nincs ${provider} free csomag.`);
  const id = normalize(raw)?.toLowerCase() ?? DEFAULT_PLAN_ID;
  const plan = table[id];
  if (plan === undefined) {
    issues.push({
      variable,
      message: `Ismeretlen csomag: "${id}". Engedélyezett: ${Object.keys(table).join(' | ')}. A legszűkebb (${DEFAULT_PLAN_ID}) csomaggal indulunk.`,
    });
    return fallback;
  }
  if (!plan.verified) {
    issues.push({
      variable,
      message: `A(z) "${id}" csomag paraméterei NINCSENEK élő próbával igazolva (DATA_SOURCES 11.). Ellenőrizd a /api/v1/providers/status kimenetét.`,
    });
  }
  return plan;
}

function normalize(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed === undefined || trimmed === '' ? null : trimmed;
}

/** A SEC formátuma: „Cégnév kapcsolat@domain” – legalább egy e-mail-szerű rész kell. */
const SEC_USER_AGENT_PATTERN = /^\S.{0,150}\s\S+@\S+\.\S+$/;

export function parseServerEnv(raw: RawServerEnv): {
  readonly env: ServerEnv;
  readonly issues: readonly ServerEnvIssue[];
} {
  const issues: ServerEnvIssue[] = [];

  let dataMode: ServerDataMode = 'live';
  const rawMode = normalize(raw.PROXY_DATA_MODE)?.toLowerCase() ?? null;
  if (rawMode === 'mock' || rawMode === 'live') {
    dataMode = rawMode;
  } else if (rawMode !== null) {
    issues.push({
      variable: 'PROXY_DATA_MODE',
      message: `Ismeretlen érték: "${rawMode}". Engedélyezett: live | mock. Alapértelmezés: live.`,
    });
  }

  let secUserAgent = normalize(raw.SEC_USER_AGENT);
  if (secUserAgent !== null && !SEC_USER_AGENT_PATTERN.test(secUserAgent)) {
    // Az értéket NEM írjuk bele az üzenetbe (személyes adat).
    issues.push({
      variable: 'SEC_USER_AGENT',
      message: 'Formátum: "AppNév kapcsolattartó@email" – a SEC enélkül 403-at ad.',
    });
    secUserAgent = null;
  }

  return {
    env: {
      dataMode,
      secUserAgent,
      openFigiApiKey: normalize(raw.OPENFIGI_API_KEY),
      fmpApiKey: normalize(raw.FMP_API_KEY),
      fmpPlan: parsePlan('fmp', 'FMP_PLAN', raw.FMP_PLAN, issues),
      eodhdApiKey: normalize(raw.EODHD_API_KEY),
      eodhdPlan: parsePlan('eodhd', 'EODHD_PLAN', raw.EODHD_PLAN, issues),
    },
    issues,
  };
}
