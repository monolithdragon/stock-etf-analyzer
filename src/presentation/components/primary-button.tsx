import { Pressable, type PressableProps } from 'react-native';

import { useTheme } from '@/presentation/theme';

import { AppText } from './app-text';

export interface PrimaryButtonProps extends Omit<PressableProps, 'children' | 'style'> {
  readonly label: string;
}

/**
 * Elsődleges gomb. Navigációhoz Expo Router `<Link asChild>`-dal együtt használd:
 * `<Link href="/about" asChild><PrimaryButton label="…" /></Link>`.
 *
 * FONTOS: a `style` szándékosan statikus objektum, NEM `({ pressed }) => …` függvény.
 * A `<Link asChild>` a saját style-ját tömbként egyesíti a gyerekével, és a tömbbe
 * került függvényt a React Native figyelmen kívül hagyja – így a háttérszín elveszne
 * (ezt a PHASE 02-ben az emulátoron észleltük, regressziós teszt: src/__tests__/routes.test.tsx).
 * A lenyomás-visszajelzés ezért a gyerek render-propban és Android ripple-lel történik.
 */
export function PrimaryButton({ label, ...rest }: PrimaryButtonProps) {
  const theme = useTheme();

  return (
    <Pressable
      {...rest}
      accessibilityRole="button"
      android_ripple={{ color: theme.colors.surfaceMuted, foreground: true }}
      style={{
        backgroundColor: theme.colors.primary,
        borderRadius: theme.radius.md,
        paddingVertical: theme.spacing.md,
        paddingHorizontal: theme.spacing.lg,
        alignItems: 'center',
        overflow: 'hidden',
      }}>
      {({ pressed }) => (
        <AppText
          variant="bodyStrong"
          style={{ color: theme.colors.onPrimary, opacity: pressed ? 0.75 : 1 }}>
          {label}
        </AppText>
      )}
    </Pressable>
  );
}
