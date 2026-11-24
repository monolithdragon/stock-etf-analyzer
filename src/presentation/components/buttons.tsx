import { Pressable, View, type PressableProps } from 'react-native';

import { useTheme } from '@/presentation/theme';

import { AppText } from './app-text';

export interface SecondaryButtonProps extends Omit<PressableProps, 'children' | 'style'> {
  readonly label: string;
  /** Kisebb, szövegszerű gomb (pl. „Részletek”); az érintési felület ekkor is ≥ 48 dp. */
  readonly compact?: boolean;
}

/**
 * Másodlagos (keretes) gomb. Statikus `style` (lásd PrimaryButton: `<Link asChild>`-dal is
 * működjön). Az érintési felület mindig legalább `minTouchTarget`.
 */
export function SecondaryButton({ label, compact = false, ...rest }: SecondaryButtonProps) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      {...rest}
      android_ripple={{ color: theme.colors.surfaceMuted, foreground: true }}
      hitSlop={compact ? 8 : undefined}
      style={{
        minHeight: compact ? 36 : theme.minTouchTarget,
        borderRadius: theme.radius.md,
        borderWidth: 1,
        borderColor: theme.colors.primary,
        paddingVertical: compact ? theme.spacing.xs : theme.spacing.sm,
        paddingHorizontal: theme.spacing.lg,
        alignItems: 'center',
        justifyContent: 'center',
        alignSelf: compact ? 'flex-start' : 'stretch',
        overflow: 'hidden',
        opacity: rest.disabled === true ? 0.5 : 1,
      }}>
      {({ pressed }) => (
        <AppText variant="bodyStrong" tone="primary" style={{ opacity: pressed ? 0.7 : 1 }}>
          {label}
        </AppText>
      )}
    </Pressable>
  );
}

export interface ChoiceOption<T extends string> {
  readonly value: T;
  readonly label: string;
}

export interface ChoiceGroupProps<T extends string> {
  /** A csoport felolvasható neve (pl. „Bázispénznem”). */
  readonly label: string;
  readonly options: readonly ChoiceOption<T>[];
  readonly value: T;
  readonly onChange: (value: T) => void;
}

/** Egyválasztós csoport (rádiógombok szegmens-stílusban), akadálymentes szerepekkel. */
export function ChoiceGroup<T extends string>({
  label,
  options,
  value,
  onChange,
}: ChoiceGroupProps<T>) {
  const theme = useTheme();
  return (
    <View
      accessibilityRole="radiogroup"
      accessibilityLabel={label}
      style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.sm }}>
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <Pressable
            key={option.value}
            accessibilityRole="radio"
            accessibilityState={{ checked: selected }}
            accessibilityLabel={option.label}
            onPress={() => onChange(option.value)}
            style={{
              minHeight: theme.minTouchTarget,
              minWidth: theme.minTouchTarget,
              paddingHorizontal: theme.spacing.lg,
              borderRadius: theme.radius.md,
              borderWidth: 1,
              borderColor: selected ? theme.colors.primary : theme.colors.border,
              backgroundColor: selected ? theme.colors.primary : theme.colors.surface,
              alignItems: 'center',
              justifyContent: 'center',
            }}>
            <AppText
              variant="bodyStrong"
              style={{ color: selected ? theme.colors.onPrimary : theme.colors.text }}>
              {selected ? `✓ ${option.label}` : option.label}
            </AppText>
          </Pressable>
        );
      })}
    </View>
  );
}
