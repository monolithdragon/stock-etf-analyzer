import { useColorScheme } from 'react-native';

import { palette, type ColorScheme, type ColorTokens } from './colors';
import { maxContentWidth, radius, spacing, typography } from './tokens';

export interface AppTheme {
  readonly scheme: ColorScheme;
  readonly colors: ColorTokens;
  readonly spacing: typeof spacing;
  readonly radius: typeof radius;
  readonly typography: typeof typography;
  readonly maxContentWidth: number;
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
  };
}

/** Az aktuális (rendszer szerinti) világos/sötét téma. */
export function useTheme(): AppTheme {
  const systemScheme = useColorScheme();
  return getTheme(systemScheme === 'dark' ? 'dark' : 'light');
}
