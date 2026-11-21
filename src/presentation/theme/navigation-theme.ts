import { DarkTheme, DefaultTheme, type Theme } from 'expo-router';

import type { AppTheme } from './use-theme';

/** Az Expo Router (React Navigation) fejléc- és háttérszíneit a saját témánkhoz igazítja. */
export function buildNavigationTheme(theme: AppTheme): Theme {
  const base = theme.scheme === 'dark' ? DarkTheme : DefaultTheme;
  return {
    ...base,
    colors: {
      ...base.colors,
      primary: theme.colors.primary,
      background: theme.colors.background,
      card: theme.colors.surface,
      text: theme.colors.text,
      border: theme.colors.border,
      notification: theme.colors.negative,
    },
  };
}
