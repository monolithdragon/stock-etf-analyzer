/**
 * Napi kvóta-költségvetés szolgáltatónként (PHASE 04B, DATA_SOURCES 5.3/3).
 *
 * - A szolgáltató felé menő MINDEN hívás előtt az adapter `consume`-ot hív; ha a keret
 *   elfogyna, NEM indít hívást, hanem `UNAVAILABLE / QUOTA_EXHAUSTED` hibát ad (a router
 *   ilyenkor a következő forrásra vált).
 * - Prioritás: a `low` (keresés) csak a keret `lowPriorityShare` részéig fogyaszthat, így a
 *   maradék az árfolyam-/ártörténet-lekéréseké marad (portfólió > keresés). A portfólió vs.
 *   watchlist megkülönböztetés a kliens cache-ével jön (PHASE 13).
 * - A nap UTC szerint vált (az EODHD keret GMT éjfélkor nullázódik – dokumentált).
 * - Konzervatív: minden elindított hívást számolunk (a sikertelent is), még ha a szolgáltató
 *   egy részét nem is terheli (EODHD: a 402 ingyenes, a 404 nem).
 *
 * Korlát (U-03, KI-23): a számláló a proxy-példány MEMÓRIÁJÁBAN él. Újraindításkor nullázódik,
 * és nem látja a más példányok felhasználását. Tartós számláló: PHASE 13/15.
 */
import { AppErrors, err, ok, toIsoTimestamp, toUtcIsoDate, type Result } from '@/domain';

export type QuotaPriority = 'normal' | 'low';

export interface QuotaSnapshot {
  readonly dailyLimit: number;
  readonly usedToday: number;
  readonly remainingToday: number;
  readonly resetsAt: string;
}

export interface QuotaGuard {
  /** Lefoglal `cost` hívást; ha nem fér bele, hibát ad és NEM foglal. */
  consume(cost: number, priority?: QuotaPriority): Result<void>;
  /** `null`, ha nincs ismert napi keret (ilyenkor a guard mindent enged). */
  snapshot(): QuotaSnapshot | null;
}

export interface DailyQuotaOptions {
  readonly providerId: string;
  readonly dailyLimit: number | null;
  readonly now: () => Date;
  /** A keret hányad részét használhatja az alacsony prioritású (keresési) forgalom. */
  readonly lowPriorityShare?: number;
}

export const DEFAULT_LOW_PRIORITY_SHARE = 0.75;

function nextUtcMidnight(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
}

export function createDailyQuota(options: DailyQuotaOptions): QuotaGuard {
  const { providerId, dailyLimit } = options;
  const lowShare = options.lowPriorityShare ?? DEFAULT_LOW_PRIORITY_SHARE;
  let day = '';
  let used = 0;

  function rollover(): void {
    const today = toUtcIsoDate(options.now());
    if (today !== day) {
      day = today;
      used = 0;
    }
  }

  return {
    consume(cost, priority = 'normal') {
      if (dailyLimit === null) return ok(undefined);
      rollover();
      const ceiling = priority === 'low' ? Math.floor(dailyLimit * lowShare) : dailyLimit;
      if (used + cost > ceiling) {
        const why =
          priority === 'low' && used + cost <= dailyLimit
            ? `a keresésre szánt rész (${ceiling}/${dailyLimit}) elfogyott, a maradék az árfolyam-lekéréseké`
            : `a napi keret (${dailyLimit} hívás) elfogyott`;
        return err(
          AppErrors.unavailable(
            'QUOTA_EXHAUSTED',
            `A(z) ${providerId} mai kerete: ${why}. Nullázódás: UTC éjfél.`,
          ),
        );
      }
      used += cost;
      return ok(undefined);
    },
    snapshot() {
      if (dailyLimit === null) return null;
      rollover();
      return {
        dailyLimit,
        usedToday: used,
        remainingToday: Math.max(0, dailyLimit - used),
        resetsAt: toIsoTimestamp(nextUtcMidnight(options.now())),
      };
    },
  };
}

/** Kvóta nélküli forrásokhoz (SEC, ECB, OpenFIGI, mock): mindig enged. */
export const unlimitedQuota: QuotaGuard = {
  consume: () => ok(undefined),
  snapshot: () => null,
};
