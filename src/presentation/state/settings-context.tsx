/**
 * Felhasználói beállítások (PHASE 12).
 *
 * MVP: memóriában (az app újraindításakor visszaáll az alapértékre). A tartós tárolás
 * (kv-store) a PHASE 13 feladata – a hook-interfész ettől nem változik (KI-97).
 */
import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';

import { ThemePreferenceContext, type ThemePreference } from '@/presentation/theme';

/** A választható bázispénznemek (az ECB-referenciaárfolyamok közül, D-017). */
export const BASE_CURRENCIES = ['HUF', 'EUR', 'USD'] as const;
export type BaseCurrency = (typeof BASE_CURRENCIES)[number];

export interface AppSettings {
  /** Portfólió és átváltott összegek pénzneme. */
  readonly baseCurrency: BaseCurrency;
  readonly themePreference: ThemePreference;
  /**
   * Megjelenjen-e az „AI-magyarázat kérése” gomb. Alapból KI: az LLM-hívás költséges és
   * adatot küld külső szolgáltatónak (D-078). A szerveren külön is kikapcsolható (kill switch).
   */
  readonly llmEnabled: boolean;
}

export const DEFAULT_SETTINGS: AppSettings = {
  baseCurrency: 'HUF',
  themePreference: 'system',
  llmEnabled: false,
};

interface SettingsContextValue {
  readonly settings: AppSettings;
  readonly updateSettings: (patch: Partial<AppSettings>) => void;
}

const SettingsContext = createContext<SettingsContextValue | null>(null);

export function SettingsProvider({
  initial = DEFAULT_SETTINGS,
  children,
}: {
  readonly initial?: AppSettings;
  readonly children: ReactNode;
}) {
  const [settings, setSettings] = useState<AppSettings>(initial);
  const value = useMemo<SettingsContextValue>(
    () => ({
      settings,
      updateSettings: (patch) => setSettings((current) => ({ ...current, ...patch })),
    }),
    [settings],
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
