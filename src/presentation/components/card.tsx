import type { ReactNode } from 'react';
import { View } from 'react-native';

import { useTheme } from '@/presentation/theme';

import { AppText } from './app-text';

export interface CardProps {
  readonly title?: string;
  /** Rövid magyarázó sor a cím alatt. */
  readonly subtitle?: string;
  readonly children: ReactNode;
  readonly testID?: string;
}

/** Keretes, téma szerinti felület egy összetartozó tartalomblokkhoz. */
export function Card({ title, subtitle, children, testID }: CardProps) {
  const theme = useTheme();

  return (
    <View
      testID={testID}
      style={{
        backgroundColor: theme.colors.surface,
        borderColor: theme.colors.border,
        borderWidth: 1,
        borderRadius: theme.radius.lg,
        padding: theme.spacing.lg,
        gap: theme.spacing.md,
      }}>
      {title !== undefined && (
        <View style={{ gap: theme.spacing.xs }}>
          <AppText variant="heading" accessibilityRole="header">
            {title}
          </AppText>
          {subtitle !== undefined && (
            <AppText variant="caption" tone="textSecondary">
              {subtitle}
            </AppText>
          )}
        </View>
      )}
      {children}
    </View>
  );
}
