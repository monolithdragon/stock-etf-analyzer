import { View } from 'react-native';

import { AppText, SecondaryButton } from '@/presentation/components';
import { useWatchlist, type InstrumentKind } from '@/presentation/state/watchlist-context';
import { strings } from '@/presentation/strings/hu';
import { useTheme } from '@/presentation/theme';

export interface AnalysisHeaderProps {
  readonly title: string;
  readonly subtitle: string;
  readonly primaryValue?: string;
  readonly primaryHint?: string;
  readonly meta?: readonly string[];
}

export function AnalysisHeader({
  title,
  subtitle,
  primaryValue,
  primaryHint,
  meta = [],
}: AnalysisHeaderProps) {
  const theme = useTheme();
  return (
    <View style={{ gap: theme.spacing.xs }} testID="analysis-header">
      <AppText variant="title" accessibilityRole="header">
        {title}
      </AppText>
      <AppText tone="textSecondary">{subtitle}</AppText>
      {primaryValue !== undefined && (
        <AppText
          variant="numberLarge"
          accessibilityLabel={`${strings.analysis.price}: ${primaryValue}`}>
          {primaryValue}
        </AppText>
      )}
      {primaryHint !== undefined && (
        <AppText variant="caption" tone="textSecondary">
          {primaryHint}
        </AppText>
      )}
      {meta.map((line) => (
        <AppText key={line} variant="caption" tone="textSecondary">
          {line}
        </AppText>
      ))}
    </View>
  );
}

export function WatchlistToggle({
  listingId,
  name,
  kind,
}: {
  readonly listingId: string;
  readonly name: string | null;
  readonly kind: InstrumentKind;
}) {
  const watchlist = useWatchlist();
  const watched = watchlist.has(listingId);
  return (
    <SecondaryButton
      label={watched ? strings.watchlist.remove : strings.watchlist.add}
      accessibilityState={{ selected: watched }}
      onPress={() =>
        watched ? watchlist.remove(listingId) : watchlist.add({ listingId, name, kind })
      }
    />
  );
}
