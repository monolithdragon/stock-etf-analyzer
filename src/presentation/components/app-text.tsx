import { Text, type TextProps } from 'react-native';

import { useTheme, type ColorTokens, type TypographyVariant } from '@/presentation/theme';

type TextTone = keyof Pick<
  ColorTokens,
  'text' | 'textSecondary' | 'primary' | 'positive' | 'negative' | 'warning' | 'info'
>;

export interface AppTextProps extends TextProps {
  /** Betűstílus (méret, vastagság). Alapértelmezés: `body`. */
  readonly variant?: TypographyVariant;
  /** Szövegszín szemantikus tokenként. Alapértelmezés: `text`. */
  readonly tone?: TextTone;
}

/**
 * Témához igazodó szöveg. Közvetlen `<Text>` helyett ezt használd.
 * A rendszer-betűméretet követi (felső korlát: `maxFontSizeMultiplier`).
 */
export function AppText({ variant = 'body', tone = 'text', style, ...rest }: AppTextProps) {
  const theme = useTheme();
  return (
    <Text
      maxFontSizeMultiplier={theme.maxFontSizeMultiplier}
      style={[theme.typography[variant], { color: theme.colors[tone] }, style]}
      {...rest}
    />
  );
}
