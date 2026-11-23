/**
 * Keresés / ticker hozzáadása (PHASE 12). Adat: `searchInstruments` use case.
 * A keresés csak beküldéskor fut (nem minden leütésre) – a free API-keret véges (KI-68).
 */
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import type { InstrumentSearchHit } from '@/domain';
import {
  AppText,
  Card,
  EmptyState,
  ErrorState,
  ListItem,
  LoadingState,
  PrimaryButton,
  Screen,
  SecondaryButton,
  TextField,
} from '@/presentation/components';
import { useAppServices } from '@/presentation/di/app-services-context';
import { useAsyncResult } from '@/presentation/hooks/use-async-result';
import { analysisHref, toInstrumentKind } from '@/presentation/navigation';
import { useWatchlist } from '@/presentation/state/watchlist-context';
import { strings } from '@/presentation/strings/hu';
import { useTheme } from '@/presentation/theme';

const KIND_LABEL = { stock: 'Részvény', etf: 'ETF', unknown: 'Ismeretlen típus' } as const;

function HitRow({ hit }: { readonly hit: InstrumentSearchHit }) {
  const theme = useTheme();
  const router = useRouter();
  const watchlist = useWatchlist();
  const kind = toInstrumentKind(hit.kindHint);
  const watched = watchlist.has(hit.listingId);
  const subtitle = [
    hit.listingId,
    KIND_LABEL[kind],
    hit.exchangeName,
    hit.tradingCurrency,
    hit.isin,
  ]
    .filter((x): x is string => x !== null && x !== '')
    .join(' · ');
  return (
    <View
      style={{
        gap: theme.spacing.xs,
        paddingVertical: theme.spacing.xs,
        borderBottomWidth: 1,
        borderBottomColor: theme.colors.border,
      }}>
      <ListItem
        testID={`hit-${hit.listingId}`}
        title={hit.name ?? hit.symbol}
        subtitle={subtitle}
        trailing={
          <AppText tone="primary" importantForAccessibility="no">
            ›
          </AppText>
        }
        accessibilityHint={strings.search.openHint}
        onPress={() => router.push(analysisHref(hit.listingId, kind))}
      />
      <SecondaryButton
        compact
        label={watched ? strings.watchlist.inList : strings.watchlist.add}
        disabled={watched}
        onPress={() => watchlist.add({ listingId: hit.listingId, name: hit.name, kind })}
      />
    </View>
  );
}

export function SearchScreen() {
  const services = useAppServices();
  const [query, setQuery] = useState('');
  const [submitted, setSubmitted] = useState<string | null>(null);
  const trimmed = query.trim();

  const search = useAsyncResult(
    () => services.searchInstruments(submitted ?? ''),
    [services, submitted],
    { enabled: submitted !== null },
  );

  const submit = () => {
    if (trimmed.length === 0) return;
    setSubmitted(trimmed);
    if (trimmed === submitted) search.reload();
  };

  return (
    <Screen testID="search-screen">
      <Card title={strings.search.title} subtitle={strings.search.subtitle}>
        <TextField
          testID="search-input"
          label={strings.search.inputLabel}
          placeholder={strings.search.placeholder}
          value={query}
          onChangeText={setQuery}
          autoCapitalize="characters"
          autoCorrect={false}
          returnKeyType="search"
          onSubmitEditing={submit}
        />
        <PrimaryButton
          label={strings.search.submit}
          onPress={submit}
          disabled={trimmed.length === 0}
        />
      </Card>

      {submitted === null ? (
        <EmptyState title={strings.search.idleTitle} message={strings.search.idleMessage} />
      ) : search.state.status === 'loading' ? (
        <LoadingState label={strings.search.loading} />
      ) : search.state.status === 'error' ? (
        <ErrorState error={search.state.error} onRetry={search.reload} />
      ) : search.state.data.hits.length === 0 ? (
        <EmptyState
          title={strings.search.noResultsTitle}
          message={`${strings.search.noResultsMessage} („${submitted}”)`}
        />
      ) : (
        <Card
          title={`${strings.search.results} (${search.state.data.hits.length})`}
          subtitle={`${strings.search.source}: ${search.state.data.provenance.sourceName}`}>
          {search.state.data.hits.map((hit) => (
            <HitRow key={hit.listingId} hit={hit} />
          ))}
          {search.state.data.omitted.truncated > 0 && (
            <AppText
              variant="caption"
              tone="textSecondary">{`${strings.search.truncated}: ${search.state.data.omitted.truncated}`}</AppText>
          )}
        </Card>
      )}
    </Screen>
  );
}
