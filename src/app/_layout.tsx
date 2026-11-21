import { Stack, ThemeProvider } from 'expo-router';
import { StatusBar } from 'expo-status-bar';

import { strings } from '@/presentation/strings/hu';
import { buildNavigationTheme, useTheme } from '@/presentation/theme';

/**
 * Gyökér layout: téma + Stack navigáció.
 * A route-fájlok (src/app) vékonyak maradnak; a logika a későbbi rétegekbe kerül (ARCHITECTURE 3.).
 * A tabos főnavigáció (dashboard, portfólió, watchlist, beállítások) a PHASE 12 feladata.
 */
export default function RootLayout() {
  const theme = useTheme();

  return (
    <ThemeProvider value={buildNavigationTheme(theme)}>
      <StatusBar style={theme.scheme === 'dark' ? 'light' : 'dark'} />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: theme.colors.surface },
          headerTintColor: theme.colors.text,
          contentStyle: { backgroundColor: theme.colors.background },
        }}>
        <Stack.Screen name="index" options={{ title: strings.home.title }} />
        <Stack.Screen name="about" options={{ title: strings.about.title }} />
      </Stack>
    </ThemeProvider>
  );
}
