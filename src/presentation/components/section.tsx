import { useState, type ReactNode } from 'react';
import { Pressable, View } from 'react-native';

import { useTheme } from '@/presentation/theme';

import { AppText } from './app-text';

export interface SectionProps {
  readonly title: string;
  /** Egysoros összegzés a fejlécben (pl. „6/12 mutató elérhető”). */
  readonly summary?: string;
  readonly initiallyOpen?: boolean;
  readonly children: ReactNode;
  readonly testID?: string;
}

/**
 * Összecsukható elemzési szakasz. A hosszú elemzőképernyő így kis telefonon is áttekinthető:
 * a fejlécek egy pillantással olvashatók, a részletek kérésre nyílnak.
 */
export function Section({ title, summary, initiallyOpen = false, children, testID }: SectionProps) {
  const theme = useTheme();
  const [open, setOpen] = useState(initiallyOpen);

  return (
    <View
      testID={testID}
      style={{
        backgroundColor: theme.colors.surface,
        borderColor: theme.colors.border,
        borderWidth: 1,
        borderRadius: theme.radius.lg,
        overflow: 'hidden',
      }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={summary === undefined ? title : `${title}. ${summary}`}
        accessibilityState={{ expanded: open }}
        onPress={() => setOpen((v) => !v)}
        style={{
          minHeight: theme.minTouchTarget,
          flexDirection: 'row',
          alignItems: 'center',
          gap: theme.spacing.md,
          paddingHorizontal: theme.spacing.lg,
          paddingVertical: theme.spacing.md,
        }}>
        <View style={{ flex: 1, gap: 2 }}>
          <AppText variant="subheading" accessibilityRole="header">
            {title}
          </AppText>
          {summary !== undefined && (
            <AppText variant="caption" tone="textSecondary">
              {summary}
            </AppText>
          )}
        </View>
        <AppText tone="textSecondary" importantForAccessibility="no">
          {open ? '▴' : '▾'}
        </AppText>
      </Pressable>
      {open && (
        <View
          style={{
            gap: theme.spacing.md,
            paddingHorizontal: theme.spacing.lg,
            paddingBottom: theme.spacing.lg,
          }}>
          {children}
        </View>
      )}
    </View>
  );
}
