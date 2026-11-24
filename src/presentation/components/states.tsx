/**
 * Lekérési állapotok egységes megjelenítése (PHASE 12): betöltés, hiba + újrapróbálás,
 * üres állapot, valamint adat-figyelmeztetések (demó, elavult, részleges, frissítés).
 */
import type { ReactNode } from 'react';
import { ActivityIndicator, View } from 'react-native';

import type { AppError } from '@/domain';
import { formatAppError } from '@/presentation/format';
import { strings } from '@/presentation/strings/hu';
import { useTheme } from '@/presentation/theme';

import { AppText } from './app-text';
import { SecondaryButton } from './buttons';
import { TONE_ICON, type StatusTone } from './status-badge';

export function LoadingState({ label = strings.states.loading }: { readonly label?: string }) {
  const theme = useTheme();
  return (
    <View
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={label}
      accessibilityLiveRegion="polite"
      style={{ alignItems: 'center', gap: theme.spacing.md, paddingVertical: theme.spacing.xl }}>
      <ActivityIndicator color={theme.colors.primary} />
      <AppText tone="textSecondary">{label}</AppText>
    </View>
  );
}

export interface ErrorStateProps {
  readonly error: AppError;
  /** Ha megadott és a hiba átmeneti jellegű, „Újrapróbálás” gomb jelenik meg. */
  readonly onRetry?: () => void;
}

export function ErrorState({ error, onRetry }: ErrorStateProps) {
  const theme = useTheme();
  const formatted = formatAppError(error);
  return (
    <View
      accessibilityLiveRegion="assertive"
      style={{
        gap: theme.spacing.md,
        padding: theme.spacing.lg,
        borderRadius: theme.radius.lg,
        borderWidth: 1,
        borderColor: theme.colors.negative,
        backgroundColor: theme.colors.surface,
      }}>
      <AppText variant="subheading" tone="negative" accessibilityRole="header">
        {`${TONE_ICON.warning} ${formatted.title}`}
      </AppText>
      <AppText>{formatted.message}</AppText>
      {onRetry !== undefined && (
        <SecondaryButton
          label={strings.states.retry}
          accessibilityHint={strings.states.retryHint}
          onPress={onRetry}
        />
      )}
    </View>
  );
}

export interface EmptyStateProps {
  readonly title: string;
  readonly message: string;
  readonly action?: ReactNode;
}

export function EmptyState({ title, message, action }: EmptyStateProps) {
  const theme = useTheme();
  return (
    <View
      style={{
        gap: theme.spacing.md,
        padding: theme.spacing.lg,
        borderRadius: theme.radius.lg,
        borderWidth: 1,
        borderStyle: 'dashed',
        borderColor: theme.colors.border,
        alignItems: 'flex-start',
      }}>
      <AppText variant="subheading" accessibilityRole="header">
        {title}
      </AppText>
      <AppText tone="textSecondary">{message}</AppText>
      {action}
    </View>
  );
}

export interface DataNotice {
  readonly id: string;
  readonly tone: Exclude<StatusTone, 'positive' | 'negative' | 'neutral'>;
  readonly title: string;
  readonly message: string;
}

/**
 * Adat-figyelmeztetések sávja (demóadat, elavult adat, részleges adat, frissítés folyamatban).
 * Ikon + cím + szöveg: a jelentés nem csak színből derül ki.
 */
export function DataNotices({ notices }: { readonly notices: readonly DataNotice[] }) {
  const theme = useTheme();
  if (notices.length === 0) return null;
  return (
    <View style={{ gap: theme.spacing.sm }}>
      {notices.map((notice) => (
        <View
          key={notice.id}
          testID={`notice-${notice.id}`}
          accessible
          accessibilityLabel={`${notice.title}. ${notice.message}`}
          style={{
            flexDirection: 'row',
            gap: theme.spacing.sm,
            padding: theme.spacing.md,
            borderRadius: theme.radius.md,
            borderLeftWidth: 4,
            borderLeftColor: theme.colors[notice.tone],
            backgroundColor: theme.colors.surfaceMuted,
          }}>
          <AppText tone={notice.tone} variant="bodyStrong">
            {TONE_ICON[notice.tone]}
          </AppText>
          <View style={{ flex: 1, gap: 2 }}>
            <AppText variant="bodyStrong">{notice.title}</AppText>
            <AppText variant="caption">{notice.message}</AppText>
          </View>
        </View>
      ))}
    </View>
  );
}
