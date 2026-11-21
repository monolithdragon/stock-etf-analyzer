import type { ReactNode } from 'react';
import { View } from 'react-native';

import { useTheme } from '@/presentation/theme';

import { AppText } from './app-text';

export interface CardProps {
  readonly title?: string;
  readonly children: ReactNode;
}

/** Keretes, téma szerinti felület egy összetartozó tartalomblokkhoz. */
export function Card({ title, children }: CardProps) {
  const theme = useTheme();

  return (
    <View
      style={{
        backgroundColor: theme.colors.surface,
        borderColor: theme.colors.border,
        borderWidth: 1,
        borderRadius: theme.radius.lg,
        padding: theme.spacing.lg,
        gap: theme.spacing.md,
      }}>
      {title !== undefined && (
        <AppText variant="heading" accessibilityRole="header">
          {title}
        </AppText>
      )}
      {children}
    </View>
  );
}
