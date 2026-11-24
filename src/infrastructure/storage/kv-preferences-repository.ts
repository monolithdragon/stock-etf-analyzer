/**
 * Beállítások tárolása kulcs-érték tárolóban (PHASE 13, D-013/D-083): natívon az
 * `expo-sqlite/kv-store`, weben/tesztben memória. NEM titoktároló: titok (API-kulcs, token)
 * ide nem kerülhet – a kliensnek ma nincs is titka (D-004: a kulcsok a proxyn vannak).
 *
 * Sérült érték: az alapértékek érvényesek (`ok(null)`), a nyers szöveg biztonsági kulcsra kerül
 * (hibakereséshez), és a következő mentés felülírja. Újabb sémaverzió: nem írjuk felül.
 */
import { decodePreferences, encodePreferences, type PreferencesRepository } from '@/application';
import { AppErrors, err, ok } from '@/domain';

/** Az `expo-sqlite/kv-store` `SQLiteStorage` aszinkron részhalmaza. */
export interface KeyValueStore {
  getItemAsync(key: string): Promise<string | null>;
  setItemAsync(key: string, value: string): Promise<void>;
  removeItemAsync(key: string): Promise<boolean>;
}

export const PREFERENCES_KEY = 'app.preferences';
export const PREFERENCES_CORRUPT_BACKUP_KEY = 'app.preferences.corrupt-backup';

function describe(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

export function createKvPreferencesRepository(store: KeyValueStore): PreferencesRepository {
  /** Újabb verziójú tárolt érték mellett nem mentünk (adatvesztés-védelem). */
  let readOnlyBecauseNewer = false;

  return {
    async load() {
      let raw: string | null;
      try {
        raw = await store.getItemAsync(PREFERENCES_KEY);
      } catch (cause) {
        return err(AppErrors.storage(`A beállítások nem olvashatók: ${describe(cause)}`));
      }
      if (raw === null) return ok(null);
      let json: unknown;
      try {
        json = JSON.parse(raw);
      } catch {
        json = undefined;
      }
      const decoded = decodePreferences(json);
      if (decoded.status === 'ok') {
        if (decoded.migratedFrom !== null) {
          // Migráció: azonnal a jelenlegi alakban mentjük vissza (egyszeri).
          await store
            .setItemAsync(PREFERENCES_KEY, JSON.stringify(encodePreferences(decoded.preferences)))
            .catch(() => undefined);
        }
        return ok(decoded.preferences);
      }
      if (decoded.status === 'newer_version') {
        readOnlyBecauseNewer = true;
        return ok(null);
      }
      await store.setItemAsync(PREFERENCES_CORRUPT_BACKUP_KEY, raw).catch(() => undefined);
      await store.removeItemAsync(PREFERENCES_KEY).catch(() => false);
      return ok(null);
    },
    async save(preferences) {
      if (readOnlyBecauseNewer) {
        return err(
          AppErrors.storage(
            'A beállításokat egy újabb app-verzió mentette; felülírás helyett nem mentünk. Frissítsd az alkalmazást.',
          ),
        );
      }
      try {
        await store.setItemAsync(PREFERENCES_KEY, JSON.stringify(encodePreferences(preferences)));
        return ok(undefined);
      } catch (cause) {
        return err(AppErrors.storage(`A beállítások nem menthetők: ${describe(cause)}`));
      }
    },
    async clear() {
      try {
        await store.removeItemAsync(PREFERENCES_KEY);
        await store.removeItemAsync(PREFERENCES_CORRUPT_BACKUP_KEY);
        readOnlyBecauseNewer = false;
        return ok(undefined);
      } catch (cause) {
        return err(AppErrors.storage(`A beállítások nem törölhetők: ${describe(cause)}`));
      }
    },
  };
}

/** Memóriabeli kulcs-érték tároló (web, tesztek). */
export function createMemoryKeyValueStore(initial: Record<string, string> = {}): KeyValueStore & {
  readonly snapshot: () => Record<string, string>;
} {
  const data = new Map(Object.entries(initial));
  return {
    getItemAsync: async (key) => data.get(key) ?? null,
    setItemAsync: async (key, value) => {
      data.set(key, value);
    },
    removeItemAsync: async (key) => data.delete(key),
    snapshot: () => Object.fromEntries(data),
  };
}
