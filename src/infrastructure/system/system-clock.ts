import type { Clock, IdGenerator } from '@/application';

export const systemClock: Clock = {
  now: () => new Date(),
};

/**
 * Egyszerű lokális azonosító: `prefix_<időbélyeg36>_<számláló36>_<véletlen36>`.
 * Egy eszközön belül egyedi; nem kriptográfiai, nem globális UUID.
 * A tartós tárolásnál (PHASE 13) felülvizsgálandó (pl. `expo-crypto` `randomUUID`).
 */
export function createLocalIdGenerator(clock: Clock = systemClock): IdGenerator {
  let counter = 0;
  return {
    next(prefix) {
      counter += 1;
      const random = Math.floor(Math.random() * 36 ** 4).toString(36);
      return `${prefix}_${clock.now().getTime().toString(36)}_${counter.toString(36)}_${random}`;
    },
  };
}
