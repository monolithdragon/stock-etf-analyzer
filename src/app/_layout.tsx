import { Stack, ThemeProvider } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState, type ReactNode } from 'react';

import { createAppServices } from '@/config/container';
import { publicEnvResult } from '@/config/env';
import { AppServicesProvider } from '@/presentation/di/app-services-context';
import { SettingsProvider } from '@/presentation/state/settings-context';
import { WatchlistProvider } from '@/presentation/state/watchlist-context';
import { strings } from '@/presentation/strings/hu';
import { buildNavigationTheme, useTheme } from '@/presentation/theme';

/**
 * Gyökér layout: szolgáltatók (composition root, beállítások, figyelőlista) + téma +
 * Stack navigáció. A fő képernyők a `(tabs)` csoportban vannak (PHASE 12); az elemző-,
 * összehasonlító, screener, riasztás (PHASE 14) és „A projektről” képernyő a Stack-re kerül.
 * A route-fájlok vékonyak; a logika a presentation rétegben (view-model + screen) van.
 */
function ThemedStack(): ReactNode {
  // A téma a SettingsProvider alatt olvasható (felhasználói téma-preferencia).
  const theme = useTheme();
  return (
    <ThemeProvider value={buildNavigationTheme(theme)}>
      <StatusBar style={theme.scheme === 'dark' ? 'light' : 'dark'} />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: theme.colors.surface },
          headerTintColor: theme.colors.text,
          contentStyle: { backgroundColor: theme.colors.background },
          headerBackButtonDisplayMode: 'minimal',
        }}>
        <Stack.Screen name="(tabs)" options={{ headerShown: false, title: strings.home.title }} />
        <Stack.Screen name="stock/[listingId]" options={{ title: strings.stock.title }} />
        <Stack.Screen name="etf/[listingId]" options={{ title: strings.etf.title }} />
        <Stack.Screen name="compare" options={{ title: strings.compare.title }} />
        <Stack.Screen name="screener" options={{ title: strings.screener.title }} />
        <Stack.Screen name="alerts" options={{ title: strings.alerts.title }} />
        <Stack.Screen name="about" options={{ title: strings.about.title }} />
      </Stack>
    </ThemeProvider>
  );
}

export default function RootLayout() {
  // Egyszer jön létre az app élettartama alatt (a useState inicializáló csak az első rendernél fut).
  const [services] = useState(() => createAppServices(publicEnvResult.env));

  // PHASE 13: háttérfrissítés hálózat-visszatéréskor (ha a beállítás engedi) + cache-takarítás.
  useEffect(() => services.localData.startBackgroundRefresh(), [services]);

  return (
    <AppServicesProvider services={services}>
      <SettingsProvider>
        <WatchlistProvider>
          <ThemedStack />
        </WatchlistProvider>
      </SettingsProvider>
    </AppServicesProvider>
  );
}
