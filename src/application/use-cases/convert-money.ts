/**
 * FxService / use case: összeg átváltása kijelzési pénznemre (D-017, PHASE 04 feladat 6–7.).
 *
 * Garanciák:
 * - az eredeti (natív) összeg és pénznem változatlanul megmarad (`FxConversion.original`);
 * - az alkalmazott ráta, a dátuma és a forrása mindig a kimenetben van (`rate.provenance`);
 * - elavult (EXPIRED) vagy hiányzó ráta → hiba (`MISSING_DATA`), NINCS csendes becslés;
 * - kissé régebbi (STALE) ráta átmegy, de a `rate.provenance.freshness` jelzi – a UI-nak
 *   kötelező kiírnia (észrevehető, nem csendes).
 */
import {
  AppErrors,
  assessFreshness,
  capFreshnessForCache,
  convertMoney,
  err,
  ok,
  toIsoTimestamp,
  toMajor,
  type AppError,
  type CurrencyCode,
  type FreshnessPolicy,
  type FxConversion,
  type IsoDate,
  type Money,
  type Result,
} from '@/domain';

import type { Clock, FxGateway } from '../ports';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * ECB-ráta frissessége `[FELTÉTELEZÉS – PHASE 13 véglegesíti]` (ARCHITECTURE 11.):
 * hétvége + ünnep miatt 4 napig FRESH, 10 napig STALE, utána EXPIRED (nem használjuk).
 */
export const FX_FRESHNESS_POLICY: FreshnessPolicy = {
  freshForMs: 4 * DAY_MS,
  expiresAfterMs: 10 * DAY_MS,
};

export interface ConvertMoneyRequest {
  readonly money: Money;
  readonly target: CurrencyCode;
  /** Történeti átváltás (pl. tranzakció napja); `null`/hiányzik = legutóbbi ráta. */
  readonly date?: IsoDate | null;
}

export type ConvertMoney = (
  request: ConvertMoneyRequest,
) => Promise<Result<FxConversion, AppError>>;

export interface ConvertMoneyDeps {
  readonly fxGateway: FxGateway;
  readonly clock: Clock;
  readonly freshnessPolicy?: FreshnessPolicy;
}

export function createConvertMoney(deps: ConvertMoneyDeps): ConvertMoney {
  const policy = deps.freshnessPolicy ?? FX_FRESHNESS_POLICY;

  return async ({ money, target, date = null }) => {
    const now = deps.clock.now();
    const fetchedAt = toIsoTimestamp(now);
    const from = toMajor(money.currency).major;
    const to = toMajor(target).major;

    if (from === to) {
      return convertMoney(money, target, { base: from, rates: [], missing: [] }, fetchedAt);
    }

    const rates = await deps.fxGateway.getReferenceRates({ quotes: [from, to], date });
    if (!rates.ok) return rates;

    const conversion = convertMoney(money, target, rates.value, fetchedAt);
    if (!conversion.ok || conversion.value.rate === null) return conversion;

    // Frissesség: legutóbbi rátánál a mostani időhöz, történetinél a kért naphoz mérjük.
    const reference = date === null ? now : new Date(`${date}T23:59:59Z`);
    const rate = conversion.value.rate;
    const freshness = capFreshnessForCache(
      assessFreshness(rate.asOf, reference, policy),
      rate.provenance.cache,
    );
    if (freshness === 'EXPIRED' || freshness === 'UNKNOWN') {
      return err(
        AppErrors.missingData(
          [`fx:${from}/${to}`],
          `Nincs használható árfolyam ${from} → ${to}: a legközelebbi ráta ${rate.asOf}-i (${freshness}). Becslést nem használunk.`,
        ),
      );
    }
    return ok({
      ...conversion.value,
      rate: { ...rate, provenance: { ...rate.provenance, freshness } },
    });
  };
}
