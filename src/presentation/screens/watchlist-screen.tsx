/**
 * Figyelőlista (PHASE 14): tételenként ár, napi változás, frissesség és utolsó frissítés
 * (`getWatchlistOverview`, a cache-en át). A score és az értékelési státusz teljes elemzést
 * igényel, ezért csak a „Score és értékelés betöltése” gombra töltődik (kvótakímélés).
 * Innen nyílik az összehasonlítás, a screener és a riasztások.
 */
import { Link, useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { View } from 'react-native';

import type { InstrumentSnapshot } from '@/application';
import { ok } from '@/domain';
import {
  AppText,
  Card,
  EmptyState,
  ListItem,
  MetricRows,
  PrimaryButton,
  Screen,
  SecondaryButton,
  StatusBadge,
} from '@/presentation/components';
import { useAppServices } from '@/presentation/di/app-services-context';
import { useAsyncResult } from '@/presentation/hooks/use-async-result';
import { analysisHref } from '@/presentation/navigation';
import { useSettings } from '@/presentation/state/settings-context';
import { useWatchlist } from '@/presentation/state/watchlist-context';
import { strings } from '@/presentation/strings/hu';
import { useTheme } from '@/presentation/theme';
import { buildWatchlistRow } from '@/presentation/view-models/insights-view-model';

interface ScoreState {
  readonly snapshots: Readonly<Record<string, InstrumentSnapshot>>;
  readonly errors: Readonly<Record<string, string>>;
}

export function WatchlistScreen() {
  const theme = useTheme();
  const router = useRouter();
  const services = useAppServices();
  const { settings } = useSettings();
  const watchlist = useWatchlist();
  const ids = watchlist.items.map((i) => i.listingId).join('|');
  const overview = useAsyncResult(
    async () => ok(await services.getWatchlistOverview(watchlist.items)),
    [services, ids],
    { enabled: watchlist.items.length > 0 },
  );
  // PHASE 13 szabály: lehúzás = KÉZI frissítés (a cache-rekordok jelölve, a tartalék megmarad).
  const manualRefresh = () => {
    services.localData
      .refreshListings(watchlist.items.map((i) => i.listingId))
      .then(() => overview.reload())
      .catch(() => overview.reload());
  };
  const [scores, setScores] = useState<ScoreState | null>(null);
  const [loadingScores, setLoadingScores] = useState(false);

  const loadScores = () => {
    setLoadingScores(true);
    void (async () => {
      const snapshots: Record<string, InstrumentSnapshot> = {};
      const errors: Record<string, string> = {};
      for (const item of watchlist.items) {
        const loaded = await services.loadInstrumentSnapshot(item, {
          displayCurrency: settings.baseCurrency,
        });
        if (loaded.ok) snapshots[item.listingId] = loaded.value;
        else errors[item.listingId] = loaded.error.message;
      }
      setScores({ snapshots, errors });
      setLoadingScores(false);
    })();
  };

  const rows = useMemo(() => {
    const markets =
      overview.state.status === 'success'
        ? new Map(overview.state.data.map((r) => [r.item.listingId, r.market]))
        : new Map();
    return watchlist.items.map((item) =>
      buildWatchlistRow(
        item,
        markets.get(item.listingId) ?? null,
        scores?.snapshots[item.listingId] ?? null,
        scores?.errors[item.listingId] ?? null,
      ),
    );
  }, [watchlist.items, overview.state, scores]);

  return (
    <Screen testID="watchlist-screen" onRefresh={manualRefresh} refreshing={overview.refreshing}>
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
          {overview.state.status === 'loading' && (
            <AppText variant="caption" tone="textSecondary">
              {strings.watchlist.pricesLoading}
            </AppText>
          )}
          {rows.map((row, index) => {
            const item = watchlist.items[index]!;
            return (
              <View
                key={row.key}
                testID={`watch-row-${row.key}`}
                style={{
                  gap: theme.spacing.xs,
                  paddingVertical: theme.spacing.sm,
                  borderBottomWidth: 1,
                  borderBottomColor: theme.colors.border,
                }}>
                <ListItem
                  title={row.title}
                  subtitle={row.subtitle}
                  trailing={
                    <AppText tone="primary" importantForAccessibility="no">
                      ›
                    </AppText>
                  }
                  onPress={() => router.push(analysisHref(item.listingId, item.kind))}
                />
                {row.badges.map((b) => (
                  <StatusBadge key={b.label} label={b.label} tone={b.tone} />
                ))}
                <MetricRows rows={row.rows} />
                {row.updatedText !== null && (
                  <AppText variant="caption" tone="textSecondary">
                    {row.updatedText}
                  </AppText>
                )}
                {row.scoreText !== null && <AppText variant="caption">{row.scoreText}</AppText>}
                {row.valuationText !== null && (
                  <AppText variant="caption">{row.valuationText}</AppText>
                )}
                {row.errorText !== null && (
                  <AppText variant="caption" tone="negative">{`N/A – ${row.errorText}`}</AppText>
                )}
                <SecondaryButton
                  compact
                  label={strings.watchlist.remove}
                  onPress={() => watchlist.remove(item.listingId)}
                />
              </View>
            );
          })}
          <SecondaryButton
            label={loadingScores ? strings.watchlist.loadingScores : strings.watchlist.loadScores}
            accessibilityHint={strings.watchlist.loadScoresHint}
            disabled={loadingScores}
            onPress={loadScores}
          />
          <AppText variant="caption" tone="textSecondary">
            {strings.watchlist.loadScoresHint}
          </AppText>
        </Card>
      )}
      <Card title={strings.watchlist.toolsTitle}>
        <View style={{ gap: theme.spacing.sm }}>
          <Link href="/compare" asChild>
            <SecondaryButton label={strings.compare.open} />
          </Link>
          <Link href="/screener" asChild>
            <SecondaryButton label={strings.screener.open} />
          </Link>
          <Link href="/alerts" asChild>
            <SecondaryButton label={strings.alerts.open} />
          </Link>
        </View>
      </Card>
    </Screen>
  );
}
