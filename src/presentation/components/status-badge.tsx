import { View } from 'react-native';

import { useTheme } from '@/presentation/theme';

import { AppText } from './app-text';

export type StatusTone = 'positive' | 'negative' | 'warning' | 'info' | 'neutral';

/**
 * Szöveges ikon tónusonként – a jelentés így nem CSAK színből derül ki (akadálymentesség).
 * Unicode-jel: nem kell hozzá betűtípus-letöltés, minden platformon megjelenik.
 */
export const TONE_ICON: Readonly<Record<StatusTone, string>> = {
  positive: '▲',
  negative: '▼',
  warning: '⚠',
  info: 'ℹ',
  neutral: '•',
};

export interface StatusBadgeProps {
  readonly label: string;
  readonly tone: StatusTone;
  /** Saját ikon (pl. `✓`); alapból a tónus ikonja. */
  readonly icon?: string;
}

/** Kis címke ikon + szöveg párossal (pl. „▲ +2,3%”, „⚠ Elavult adat”). */
export function StatusBadge({ label, tone, icon }: StatusBadgeProps) {
  const theme = useTheme();
  const color = tone === 'neutral' ? 'textSecondary' : tone;
  return (
    <View
      accessible
      accessibilityLabel={label}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        alignSelf: 'flex-start',
        gap: theme.spacing.xs,
        paddingHorizontal: theme.spacing.sm,
        paddingVertical: 2,
        borderRadius: theme.radius.sm,
        borderWidth: 1,
        borderColor: theme.colors[color],
        backgroundColor: theme.colors.surface,
      }}>
      <AppText variant="caption" tone={color} importantForAccessibility="no">
        {icon ?? TONE_ICON[tone]}
      </AppText>
      <AppText variant="caption" tone={color} style={{ fontWeight: '600' }}>
        {label}
      </AppText>
    </View>
  );
}
