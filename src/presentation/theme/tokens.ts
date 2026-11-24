import type { TextStyle } from 'react-native';

/** Térközök (px). Mindig ezekből válassz, ne írj be tetszőleges számot. */
export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
} as const;

/** Lekerekítések (px). */
export const radius = {
  sm: 6,
  md: 10,
  lg: 16,
} as const;

export type TypographyVariant =
  'title' | 'heading' | 'subheading' | 'body' | 'bodyStrong' | 'caption' | 'number' | 'numberLarge';

/**
 * Betűstílusok. Rendszerbetűtípust használunk (nincs külön font-letöltés).
 * A számok `tabular-nums` változatot kapnak: azonos szélességű számjegyek → az oszlopok
 * egymás alá rendeződnek (PHASE 12).
 */
export const typography: Readonly<Record<TypographyVariant, TextStyle>> = {
  title: { fontSize: 28, lineHeight: 34, fontWeight: '700' },
  heading: { fontSize: 20, lineHeight: 26, fontWeight: '600' },
  subheading: { fontSize: 17, lineHeight: 24, fontWeight: '600' },
  body: { fontSize: 16, lineHeight: 24, fontWeight: '400' },
  bodyStrong: { fontSize: 16, lineHeight: 24, fontWeight: '600' },
  caption: { fontSize: 13, lineHeight: 18, fontWeight: '400' },
  number: { fontSize: 16, lineHeight: 24, fontWeight: '600', fontVariant: ['tabular-nums'] },
  numberLarge: { fontSize: 30, lineHeight: 36, fontWeight: '700', fontVariant: ['tabular-nums'] },
};

/**
 * Minimális érintési felület (dp). Android Material: 48, iOS HIG: 44 → a nagyobbat használjuk.
 */
export const minTouchTarget = 48;

/**
 * A rendszer-betűméret szorzójának felső határa: a nagyon nagy beállítás is olvasható marad,
 * de a sorok nem esnek szét (a tartalom ettől még tördelődik).
 */
export const maxFontSizeMultiplier = 1.8;

/** Olvasható szélesség tabletre/webre. */
export const maxContentWidth = 720;
