import type { ReactNode } from 'react';
import { ScrollView, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useTheme } from '@/presentation/theme';

export interface ScreenProps {
  readonly children: ReactNode;
}

/**
 * Egységes képernyőkeret: görgethető tartalom, téma szerinti háttér, egységes
 * margók, és alul a rendszer által foglalt sáv (safe area) kihagyása.
 * A felső sávot a Stack fejléc kezeli.
 */
export function Screen({ children }: ScreenProps) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();

  return (
    <ScrollView
      style={{ backgroundColor: theme.colors.background }}
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
