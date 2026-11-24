import { View } from 'react-native';

import { formatPercent } from '@/presentation/format';
import { useTheme } from '@/presentation/theme';

import { AppText } from './app-text';

export interface WeightItem {
  readonly key: string;
  readonly label: string;
  /** Tört (0.25 = 25%). */
  readonly weight: number;
}

/**
 * Egyszerű vízszintes sávdiagram (allokáció, ország, szektor). Grafikonkönyvtár nélkül,
 * natív `View`-kból (D-079): nincs új függőség, és minden sáv mellett ott a szám is, így
 * képernyőolvasóval és színtévesztéssel is olvasható.
 *
 * A „Nem fedett” / „Besorolás nélkül” tétel külön sorként jelenik meg (a hiány nem 0).
 */
export function WeightBars({
  items,
  accessibilityLabel,
}: {
  readonly items: readonly WeightItem[];
  readonly accessibilityLabel: string;
}) {
  const theme = useTheme();
  return (
    <View accessibilityLabel={accessibilityLabel} style={{ gap: theme.spacing.sm }}>
      {items.map((item) => {
        const pct = formatPercent(item.weight);
        const width = `${Math.max(0, Math.min(1, item.weight)) * 100}%` as const;
        return (
          <View
            key={item.key}
            accessible
            accessibilityLabel={`${item.label}: ${pct}`}
            style={{ gap: 2 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}>
              <AppText style={{ flexShrink: 1 }}>{item.label}</AppText>
              <AppText variant="number">{pct}</AppText>
            </View>
            <View
              style={{
                height: 8,
                borderRadius: 4,
                backgroundColor: theme.colors.surfaceMuted,
                overflow: 'hidden',
              }}>
              <View style={{ width, height: 8, backgroundColor: theme.colors.primary }} />
            </View>
          </View>
        );
      })}
    </View>
  );
}
