import { useState } from 'react';
import { Pressable, View } from 'react-native';

import { useTheme } from '@/presentation/theme';
import type { DetailLine, MetricRowModel } from '@/presentation/view-models/metric-row';

import { AppText } from './app-text';

export function DetailList({ lines }: { readonly lines: readonly DetailLine[] }) {
  const theme = useTheme();
  return (
    <View
      style={{
        gap: theme.spacing.xs,
        padding: theme.spacing.md,
        borderRadius: theme.radius.md,
        backgroundColor: theme.colors.surfaceMuted,
      }}>
      {lines.map((line, index) => (
        <AppText key={`${line.label}-${index}`} variant="caption">
          <AppText variant="caption" tone="textSecondary">{`${line.label}: `}</AppText>
          {line.value}
        </AppText>
      ))}
    </View>
  );
}

/**
 * Egy mutató sora: címke, érték (vagy N/A, N/M … jelölés), opcionális kiegészítő.
 * Koppintásra kinyílnak a részletek: forrás, időszak, pénznem, frissesség, képlet, hiány oka.
 */
export function MetricRow({ row }: { readonly row: MetricRowModel }) {
  const theme = useTheme();
  const [open, setOpen] = useState(false);
  const missing = row.status !== 'OK';

  return (
    <View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={row.accessibilityLabel}
        accessibilityHint="Koppints a forrás és a részletek megjelenítéséhez."
        accessibilityState={{ expanded: open }}
        onPress={() => setOpen((v) => !v)}
        style={{
          minHeight: theme.minTouchTarget,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: theme.spacing.md,
          paddingVertical: theme.spacing.xs,
        }}>
        <View style={{ flexShrink: 1, gap: 2 }}>
          <AppText tone="textSecondary">{row.label}</AppText>
          {row.hint !== null && (
            <AppText variant="caption" tone="textSecondary">
              {row.hint}
            </AppText>
          )}
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.xs }}>
          <AppText
            variant="number"
            tone={missing ? 'textSecondary' : 'text'}
            style={{ textAlign: 'right', fontStyle: missing ? 'italic' : 'normal' }}>
            {row.text}
          </AppText>
          <AppText variant="caption" tone="textSecondary" importantForAccessibility="no">
            {open ? '▴' : '▾'}
          </AppText>
        </View>
      </Pressable>
      {open && <DetailList lines={row.details} />}
    </View>
  );
}

export function MetricRows({ rows }: { readonly rows: readonly MetricRowModel[] }) {
  const theme = useTheme();
  return (
    <View style={{ gap: theme.spacing.xs }}>
      {rows.map((row) => (
        <View
          key={row.key}
          style={{ borderBottomWidth: 1, borderBottomColor: theme.colors.border }}
          testID={`metric-${row.key}`}>
          <MetricRow row={row} />
        </View>
      ))}
    </View>
  );
}
