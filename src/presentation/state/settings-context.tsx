/**
 * Felhasználói beállítások (PHASE 12 → PHASE 13: tartós).
 *
 * A hook-interfész (`useSettings`) nem változott. PHASE 13 (D-083): induláskor a mentett
 * beállítások betöltődnek (`services.preferences.load`), minden módosítás azonnal mentődik.
 * Betöltés előtt az alapértékek látszanak; ha a felhasználó a betöltés befejezése ELŐTT
 * módosít, az ő választása marad (a késve érkező mentett érték nem írja felül).
 */
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import {
  BASE_CURRENCIES,
  DEFAULT_PREFERENCES,
  type BaseCurrency,
  type UserPreferences,
} from '@/application';
import { useAppServices } from '@/presentation/di/app-services-context';
import { ThemePreferenceContext } from '@/presentation/theme';

export { BASE_CURRENCIES, type BaseCurrency };

/** A UI beállítás-modellje = az alkalmazási réteg `UserPreferences`-e (egy igazságforrás). */
export type AppSettings = UserPreferences;

export const DEFAULT_SETTINGS: AppSettings = DEFAULT_PREFERENCES;

export type SettingsPersistence =
  | { readonly status: 'loading' }
  | { readonly status: 'ready' }
  | { readonly status: 'error'; readonly message: string };

interface SettingsContextValue {
  readonly settings: AppSettings;
  readonly updateSettings: (patch: Partial<AppSettings>) => void;
  /** A tárolás állapota (pl. mentési hiba jelzéséhez a Beállításokban). */
  readonly persistence: SettingsPersistence;
  /** Teljes törlés után: alapértékek MENTÉS NÉLKÜL (a tároló üres marad). */
  readonly resetToDefaults: () => void;
}

const SettingsContext = createContext<SettingsContextValue | null>(null);

export function SettingsProvider({
  initial = DEFAULT_SETTINGS,
  children,
}: {
  readonly initial?: AppSettings;
  readonly children: ReactNode;
}) {
  const services = useAppServices();
  const [settings, setSettings] = useState<AppSettings>(initial);
  const [persistence, setPersistence] = useState<SettingsPersistence>({ status: 'loading' });
  const touched = useRef(false);

  useEffect(() => {
    let active = true;
    services.preferences
      .load()
      .then((loaded) => {
        if (!active) return;
        if (loaded.ok) {
          if (!touched.current) setSettings(loaded.value);
          setPersistence({ status: 'ready' });
        } else {
          setPersistence({ status: 'error', message: loaded.error.message });
        }
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [services]);

  const value = useMemo<SettingsContextValue>(
    () => ({
      settings,
      persistence,
      resetToDefaults: () => {
        touched.current = true;
        setSettings(DEFAULT_SETTINGS);
      },
      updateSettings: (patch) => {
        touched.current = true;
        // A `settings` a memo függősége, így itt mindig a legutóbbi render értéke.
        const next = { ...settings, ...patch };
        setSettings(next);
        services.preferences
          .save(next)
          .then((saved) =>
            setPersistence(
              saved.ok ? { status: 'ready' } : { status: 'error', message: saved.error.message },
            ),
          )
          .catch(() => undefined);
      },
    }),
    [settings, persistence, services],
  );
  return (
    <SettingsContext.Provider value={value}>
      <ThemePreferenceContext.Provider value={settings.themePreference}>
        {children}
      </ThemePreferenceContext.Provider>
    </SettingsContext.Provider>
  );
}

export function useSettings(): SettingsContextValue {
  const value = useContext(SettingsContext);
  if (value === null) {
    throw new Error('useSettings: hiányzó <SettingsProvider> a komponensfa tetején.');
  }
  return value;
}
