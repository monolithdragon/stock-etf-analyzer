/**
 * Figyelőlista (PHASE 12 – váz). Csak a listát kezeli; árat/elemzést a megnyitott képernyő kér.
 * Tartós tárolás: PHASE 13; riasztások, screener: PHASE 14.
 */
import { Link, useRouter } from 'expo-router';
import { View } from 'react-native';

import {
  AppText,
  Card,
  EmptyState,
  ListItem,
  PrimaryButton,
  Screen,
  SecondaryButton,
} from '@/presentation/components';
import { analysisHref } from '@/presentation/navigation';
import { useWatchlist } from '@/presentation/state/watchlist-context';
import { strings } from '@/presentation/strings/hu';
import { useTheme } from '@/presentation/theme';

const KIND_LABEL = { stock: 'Részvény', etf: 'ETF', unknown: 'Ismeretlen típus' } as const;

export function WatchlistScreen() {
  const theme = useTheme();
  const router = useRouter();
  const watchlist = useWatchlist();

  return (
    <Screen testID="watchlist-screen">
      <AppText variant="caption" tone="textSecondary">
        {strings.watchlist.memoryNote}
      </AppText>
      {watchlist.items.length === 0 ? (
        <EmptyState
          title={strings.watchlist.emptyTitle}
          message={strings.watchlist.emptyMessage}
          action={
            <Link href="/search" asChild>
              <PrimaryButton label={strings.home.searchButton} />
            </Link>
          }
        />
      ) : (
        <Card title={`${strings.watchlist.title} (${watchlist.items.length})`}>
          {watchlist.items.map((item) => (
            <View
              key={item.listingId}
              style={{
                gap: theme.spacing.xs,
                paddingVertical: theme.spacing.xs,
                borderBottomWidth: 1,
                borderBottomColor: theme.colors.border,
              }}>
              <ListItem
                title={item.name ?? item.listingId}
                subtitle={`${item.listingId} · ${KIND_LABEL[item.kind]}`}
                trailing={
                  <AppText tone="primary" importantForAccessibility="no">
                    ›
                  </AppText>
                }
                onPress={() => router.push(analysisHref(item.listingId, item.kind))}
              />
              <SecondaryButton
                compact
                label={strings.watchlist.remove}
                onPress={() => watchlist.remove(item.listingId)}
              />
            </View>
          ))}
        </Card>
      )}
      <Link href="/compare" asChild>
        <SecondaryButton label={strings.compare.open} />
      </Link>
    </Screen>
  );
}
