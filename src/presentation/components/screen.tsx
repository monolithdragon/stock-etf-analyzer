import type { ReactNode } from 'react';
import { RefreshControl, ScrollView, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useTheme } from '@/presentation/theme';

export interface ScreenProps {
  readonly children: ReactNode;
  /** Lehúzásos frissítés (pull-to-refresh). Csak akkor aktív, ha megadott. */
  readonly onRefresh?: () => void;
  readonly refreshing?: boolean;
  readonly testID?: string;
}

/**
 * Egységes képernyőkeret: görgethető tartalom, téma szerinti háttér, egységes
 * margók, és alul a rendszer által foglalt sáv (safe area) kihagyása.
 * A felső sávot a Stack/Tab fejléc kezeli.
 */
export function Screen({ children, onRefresh, refreshing = false, testID }: ScreenProps) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();

  return (
    <ScrollView
      testID={testID}
      keyboardShouldPersistTaps="handled"
      style={{ backgroundColor: theme.colors.background }}
      refreshControl={
        onRefresh === undefined ? undefined : (
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={theme.colors.primary}
            colors={[theme.colors.primary]}
          />
        )
      }
      contentContainerStyle={[
        styles.content,
        {
          padding: theme.spacing.lg,
          paddingBottom: theme.spacing.lg + insets.bottom,
          gap: theme.spacing.lg,
          maxWidth: theme.maxContentWidth,
        },
      ]}>
      {children}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: {
    width: '100%',
    alignSelf: 'center',
  },
});
