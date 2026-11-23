/**
 * Összehasonlítás (PHASE 12 – VÁZ). A teljes funkció a PHASE 14-ben készül (ROADMAP):
 * csak összehasonlítható mutatók (azonos típus, azonos hozam-alap, azonos pénznem/időszak).
 *
 * Itt csak a jelöltek csoportosítása látszik típus szerint – szám NEM jelenik meg, mert az
 * összehasonlíthatósági szabályok még nincsenek megvalósítva (nem mutatunk félrevezető táblát).
 */
import { AppText, Card, EmptyState, ListItem, Screen } from '@/presentation/components';
import { useWatchlist, type InstrumentKind } from '@/presentation/state/watchlist-context';
import { strings } from '@/presentation/strings/hu';

const GROUPS: readonly { readonly kind: InstrumentKind; readonly title: string }[] = [
  { kind: 'stock', title: 'Részvények' },
  { kind: 'etf', title: 'ETF-ek' },
  { kind: 'unknown', title: 'Ismeretlen típus (nem hasonlítható)' },
];

export function CompareScreen() {
  const watchlist = useWatchlist();
  return (
    <Screen testID="compare-screen">
      <Card title={strings.compare.title} subtitle={strings.compare.subtitle}>
        <AppText variant="caption">{strings.compare.rules}</AppText>
      </Card>
      {watchlist.items.length === 0 ? (
        <EmptyState title={strings.watchlist.emptyTitle} message={strings.compare.empty} />
      ) : (
        GROUPS.map((group) => {
          const items = watchlist.items.filter((i) => i.kind === group.kind);
          if (items.length === 0) return null;
          return (
            <Card key={group.kind} title={`${group.title} (${items.length})`}>
              {items.map((item) => (
                <ListItem
                  key={item.listingId}
                  title={item.name ?? item.listingId}
                  subtitle={item.listingId}
                />
              ))}
              {group.kind !== 'unknown' && items.length < 2 && (
                <AppText variant="caption" tone="textSecondary">
                  {strings.compare.needTwo}
                </AppText>
              )}
            </Card>
          );
        })
      )}
    </Screen>
  );
}
