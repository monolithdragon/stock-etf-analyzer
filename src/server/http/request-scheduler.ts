/**
 * Egyszerű, memóriabeli kérés-ütemező: két felfelé irányuló kérés között legalább
 * `minIntervalMs` telik el (pl. SEC: ≤ 10 kérés/mp → 110 ms).
 *
 * Korlát (U-03, D-004): az EAS Hosting / Cloudflare Workers példányai nem osztanak memóriát,
 * ezért ez példányonkénti védelem, nem globális. Személyes használatnál (D-008) ez elég;
 * a tartós, globális limiter a PHASE 13/15 kérdése.
 */
export type Sleep = (ms: number) => Promise<void>;

export const realSleep: Sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export interface RequestScheduler {
  schedule<T>(task: () => Promise<T>): Promise<T>;
}

export function createRequestScheduler(
  minIntervalMs: number,
  options: { readonly now?: () => number; readonly sleep?: Sleep } = {},
): RequestScheduler {
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? realSleep;
  let nextSlot = 0;
  let queue: Promise<unknown> = Promise.resolve();

  return {
    schedule<T>(task: () => Promise<T>): Promise<T> {
      const run = queue.then(async () => {
        const wait = nextSlot - now();
        if (wait > 0) await sleep(wait);
        nextSlot = now() + minIntervalMs;
        return task();
      });
      // A sor akkor is haladjon tovább, ha egy feladat hibát dobott.
      queue = run.catch(() => undefined);
      return run;
    },
  };
}

/** Memóriabeli, időkorlátos memo egyetlen értékre (pl. SEC ticker-lista, 24 óra). */
export function createTtlMemo<T>(ttlMs: number, now: () => number = Date.now) {
  let entry: { readonly value: T; readonly expiresAt: number } | null = null;
  return {
    get(): T | null {
      return entry !== null && entry.expiresAt > now() ? entry.value : null;
    },
    set(value: T): void {
      entry = { value, expiresAt: now() + ttlMs };
    },
  };
}
