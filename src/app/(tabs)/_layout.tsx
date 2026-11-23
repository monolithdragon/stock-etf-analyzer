import { Tabs } from 'expo-router/js-tabs';
import type { ColorValue } from 'react-native';

import { AppText } from '@/presentation/components';
import { strings } from '@/presentation/strings/hu';
import { useTheme } from '@/presentation/theme';

/**
 * Fő (alsó) tabnavigáció – PHASE 12 (D-034 váltja: Stack helyett tabok).
 * Az ikon dekoratív Unicode-jel (nincs ikonbetűtípus-függőség, D-079); a felirat mindig látszik,
 * a képernyőolvasó a feliratot olvassa fel.
 */
function TabIcon({ glyph, color }: { readonly glyph: string; readonly color: ColorValue }) {
  return (
    <AppText importantForAccessibility="no" style={{ color, fontSize: 20, lineHeight: 24 }}>
      {glyph}
    </AppText>
  );
}

export default function TabsLayout() {
  const theme = useTheme();
  return (
    <Tabs
      screenOptions={{
        headerStyle: { backgroundColor: theme.colors.surface },
        headerTintColor: theme.colors.text,
        tabBarStyle: { backgroundColor: theme.colors.surface, borderTopColor: theme.colors.border },
        tabBarActiveTintColor: theme.colors.primary,
        tabBarInactiveTintColor: theme.colors.textSecondary,
        tabBarLabelStyle: { fontSize: 12 },
        sceneStyle: { backgroundColor: theme.colors.background },
      }}>
      <Tabs.Screen
        name="index"
        options={{
          title: strings.tabs.home,
          tabBarIcon: ({ color }) => <TabIcon glyph="⌂" color={color} />,
        }}
      />
      <Tabs.Screen
        name="search"
        options={{
          title: strings.tabs.search,
          tabBarIcon: ({ color }) => <TabIcon glyph="⌕" color={color} />,
        }}
      />
      <Tabs.Screen
        name="portfolio"
        options={{
          title: strings.tabs.portfolio,
          tabBarIcon: ({ color }) => <TabIcon glyph="◔" color={color} />,
        }}
      />
      <Tabs.Screen
        name="watchlist"
        options={{
          title: strings.tabs.watchlist,
          tabBarIcon: ({ color }) => <TabIcon glyph="☆" color={color} />,
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: strings.tabs.settings,
          tabBarIcon: ({ color }) => <TabIcon glyph="⚙" color={color} />,
        }}
      />
    </Tabs>
  );
}
