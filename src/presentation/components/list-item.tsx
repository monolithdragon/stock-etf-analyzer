import type { ReactNode } from 'react';
import { Pressable, TextInput, View, type TextInputProps } from 'react-native';

import { useTheme } from '@/presentation/theme';

import { AppText } from './app-text';

export interface ListItemProps {
  readonly title: string;
  readonly subtitle?: string;
  /** Jobb oldali kiegészítő (pl. „Részvény”, „›”). */
  readonly trailing?: ReactNode;
  readonly onPress?: () => void;
  readonly accessibilityHint?: string;
  readonly testID?: string;
}

/** Kattintható listasor, legalább 48 dp magas (érintési méret). */
export function ListItem({
  title,
  subtitle,
  trailing,
  onPress,
  accessibilityHint,
  testID,
}: ListItemProps) {
  const theme = useTheme();
  const content = (
    <>
      <View style={{ flex: 1, gap: 2 }}>
        <AppText variant="bodyStrong">{title}</AppText>
        {subtitle !== undefined && (
          <AppText variant="caption" tone="textSecondary">
            {subtitle}
          </AppText>
        )}
      </View>
      {trailing}
    </>
  );
  const style = {
    minHeight: theme.minTouchTarget,
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
  };
  if (onPress === undefined) {
    return (
      <View style={style} testID={testID}>
        {content}
      </View>
    );
  }
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={subtitle === undefined ? title : `${title}, ${subtitle}`}
      accessibilityHint={accessibilityHint}
      android_ripple={{ color: theme.colors.surfaceMuted }}
      onPress={onPress}
      style={style}>
      {content}
    </Pressable>
  );
}

export interface TextFieldProps extends Omit<TextInputProps, 'style'> {
  readonly label: string;
  /** Mezőhöz tartozó validációs hiba (a use case VALIDATION hibájából). */
  readonly error?: string | null;
}

/** Címkézett beviteli mező; a címke a képernyőolvasónak is az. */
export function TextField({ label, error, ...rest }: TextFieldProps) {
  const theme = useTheme();
  const hasError = error !== undefined && error !== null;
  return (
    <View style={{ gap: theme.spacing.xs }}>
      <AppText variant="caption" tone="textSecondary">
        {label}
      </AppText>
      <TextInput
        accessibilityLabel={label}
        placeholderTextColor={theme.colors.textSecondary}
        maxFontSizeMultiplier={theme.maxFontSizeMultiplier}
        {...rest}
        style={[
          theme.typography.body,
          {
            minHeight: theme.minTouchTarget,
            paddingHorizontal: theme.spacing.md,
            borderRadius: theme.radius.md,
            borderWidth: 1,
            borderColor: hasError ? theme.colors.negative : theme.colors.border,
            backgroundColor: theme.colors.surface,
            color: theme.colors.text,
          },
        ]}
      />
      {hasError && (
        <AppText variant="caption" tone="negative" accessibilityLiveRegion="polite">
          {`⚠ ${error}`}
        </AppText>
      )}
    </View>
  );
}
