/**
 * CSAK TESZTEKHEZ (jest `moduleNameMapper`): az `expo-sqlite/kv-store` memóriabeli megfelelője.
 * A `jest-setup.ts` minden teszt után üríti (a tesztek között nem szivárog beállítás).
 */
const data = new Map<string, string>();

export const Storage = {
  getItemAsync: async (key: string) => data.get(key) ?? null,
  setItemAsync: async (key: string, value: string) => {
    data.set(key, value);
  },
  removeItemAsync: async (key: string) => data.delete(key),
};

export const AsyncStorage = Storage;
export default Storage;

export function __resetKvStore(): void {
  data.clear();
}
