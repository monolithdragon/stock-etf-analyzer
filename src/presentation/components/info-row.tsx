import { StyleSheet, View } from 'react-native';

import { useTheme } from '@/presentation/theme';

import { AppText } from './app-text';

export interface InfoRowProps {
  readonly label: string;
  readonly value: string;
}

/** Címke–érték sor (pl. „Verzió: 0.1.0”). */
export function InfoRow({ label, value }: InfoRowProps) {
  const theme = useTheme();

  return (
    <View style={[styles.row, { gap: theme.spacing.md }]}>
      <AppText tone="textSecondary" style={styles.label}>
        {label}
      </AppText>
      <AppText variant="bodyStrong" style={styles.value}>
        {value}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  label: {
    flexShrink: 1,
  },
  value: {
    flexShrink: 1,
    textAlign: 'right',
  },
});
