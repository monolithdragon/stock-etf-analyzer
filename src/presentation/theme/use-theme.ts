import { createContext, useContext } from 'react';
import { useColorScheme } from 'react-native';

import { palette, type ColorScheme, type ColorTokens } from './colors';
import {
  maxContentWidth,
  maxFontSizeMultiplier,
  minTouchTarget,
  radius,
  spacing,
  typography,
} from './tokens';

export interface AppTheme {
  readonly scheme: ColorScheme;
  readonly colors: ColorTokens;
  readonly spacing: typeof spacing;
  readonly radius: typeof radius;
  readonly typography: typeof typography;
  readonly maxContentWidth: number;
  readonly minTouchTarget: number;
  readonly maxFontSizeMultiplier: number;
}

/** Tiszta függvény: a színsémából felépíti a teljes témát (tesztelhető hook nélkül is). */
export function getTheme(scheme: ColorScheme): AppTheme {
  return {
    scheme,
    colors: palette[scheme],
    spacing,
    radius,
    typography,
    maxContentWidth,
    minTouchTarget,
    maxFontSizeMultiplier,
  };
}

/** A felhasználó választása: a rendszert követi, vagy fix világos/sötét (Beállítások). */
export type ThemePreference = 'system' | ColorScheme;

/**
 * A téma-preferencia a komponensfán. A Beállítások (SettingsProvider) adja; ha nincs
 * szolgáltató (pl. izolált komponensteszt), a rendszer sémája érvényes.
 */
export const ThemePreferenceContext = createContext<ThemePreference>('system');

export function resolveScheme(
  preference: ThemePreference,
  system: string | null | undefined,
): ColorScheme {
  if (preference !== 'system') return preference;
  return system === 'dark' ? 'dark' : 'light';
}

/** Az aktuális téma: a felhasználói preferencia, ennek hiányában a rendszer sémája. */
export function useTheme(): AppTheme {
  const systemScheme = useColorScheme();
  const preference = useContext(ThemePreferenceContext);
  return getTheme(resolveScheme(preference, systemScheme));
}
