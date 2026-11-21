import { Stack, ThemeProvider } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useState } from 'react';

import { createAppServices } from '@/config/container';
import { publicEnvResult } from '@/config/env';
import { AppServicesProvider } from '@/presentation/di/app-services-context';
import { strings } from '@/presentation/strings/hu';
import { buildNavigationTheme, useTheme } from '@/presentation/theme';

/**
 * Gyökér layout: szolgáltatások (composition root) + téma + Stack navigáció.
 * A route-fájlok (src/app) vékonyak maradnak; a logika a későbbi rétegekbe kerül (ARCHITECTURE 3.).
 * A tabos főnavigáció (dashboard, portfólió, watchlist, beállítások) a PHASE 12 feladata.
 */
export default function RootLayout() {
  const theme = useTheme();
  // Egyszer jön létre az app élettartama alatt (a useState inicializáló csak az első rendernél fut).
  const [services] = useState(() => createAppServices(publicEnvResult.env));

  return (
    <AppServicesProvider services={services}>
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
    </AppServicesProvider>
  );
}
