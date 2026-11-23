/**
 * Kezdőlap / Dashboard (PHASE 12). Szándékosan kevés elem: adatmód, gyors műveletek,
 * figyelőlista-előnézet. Számot itt nem mutatunk lekérés nélkül (nincs elavult adat frissként).
 */
import { Link, useRouter } from 'expo-router';
import { View } from 'react-native';

import {
  AppText,
  Card,
  DataNotices,
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

export interface HomeScreenProps {
  /** `mock` | `live` – a route adja át a nyilvános konfigurációból. */
  readonly dataMode: 'mock' | 'live';
  readonly proxyConfigured: boolean;
}

export function HomeScreen({ dataMode, proxyConfigured }: HomeScreenProps) {
  const theme = useTheme();
  const router = useRouter();
  const watchlist = useWatchlist();
  const preview = watchlist.items.slice(0, 3);

  const notices =
    dataMode === 'mock'
      ? [
          {
            id: 'mock',
            tone: 'info' as const,
            title: strings.home.mockTitle,
            message: strings.home.mockMessage,
          },
        ]
      : proxyConfigured
        ? []
        : [
            {
              id: 'no-proxy',
              tone: 'warning' as const,
              title: strings.home.noProxyTitle,
              message: strings.home.noProxyMessage,
            },
          ];

  return (
    <Screen testID="home-screen">
      <View style={{ gap: theme.spacing.xs }}>
        <AppText variant="title" accessibilityRole="header">
          {strings.appName}
        </AppText>
        <AppText tone="textSecondary">{strings.home.tagline}</AppText>
      </View>
      <DataNotices notices={notices} />

      <Card title={strings.home.quickTitle}>
        <Link href="/search" asChild>
          <PrimaryButton label={strings.home.searchButton} />
        </Link>
        <Link href="/portfolio" asChild>
          <SecondaryButton label={strings.home.portfolioButton} />
        </Link>
      </Card>

      <Card
        title={strings.watchlist.title}
        subtitle={`${watchlist.items.length} ${strings.watchlist.itemsUnit}`}>
        {preview.length === 0 ? (
          <EmptyState
            title={strings.watchlist.emptyTitle}
            message={strings.watchlist.emptyMessage}
          />
        ) : (
          preview.map((item) => (
            <ListItem
              key={item.listingId}
              title={item.name ?? item.listingId}
              subtitle={item.listingId}
              onPress={() => router.push(analysisHref(item.listingId, item.kind))}
            />
          ))
        )}
        {watchlist.items.length > 0 && (
          <Link href="/watchlist" asChild>
            <SecondaryButton label={strings.home.allWatchlist} />
          </Link>
        )}
      </Card>

      <Link href="/about" asChild>
        <SecondaryButton label={strings.home.aboutButton} />
      </Link>

      <AppText variant="caption" tone="textSecondary">
        {strings.disclaimer}
      </AppText>
    </Screen>
  );
}
