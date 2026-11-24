/**
 * Színpaletta világos és sötét módra.
 *
 * Szabály: a komponensek soha nem írnak be közvetlen hex színt, mindig ezeket a
 * szemantikus tokeneket használják (`useTheme().colors.*`).
 *
 * A `positive` / `negative` színek pl. hozam előjelére szolgálnak. A jelentést
 * soha nem szabad CSAK színnel átadni (akadálymentesség) – mindig legyen mellette
 * előjel, ikon vagy szöveg is (PHASE 12).
 *
 * PHASE 12: a világos paletta akcentusszínei sötétebbek lettek, hogy MINDEN felületen
 * (háttér, kártya, halvány sáv) elérjék a WCAG AA 4,5:1 kontrasztot – teszt: theme.test.ts.
 */
export type ColorScheme = 'light' | 'dark';

export interface ColorTokens {
  /** Képernyő háttere */
  readonly background: string;
  /** Kártyák, fejléc háttere */
  readonly surface: string;
  /** Halványabb felület (pl. információs sáv) */
  readonly surfaceMuted: string;
  readonly border: string;
  readonly text: string;
  readonly textSecondary: string;
  /** Elsődleges akciószín (gomb, link) */
  readonly primary: string;
  /** Szöveg az elsődleges színű háttéren */
  readonly onPrimary: string;
  readonly positive: string;
  readonly negative: string;
  readonly warning: string;
  readonly info: string;
}

export const palette: Readonly<Record<ColorScheme, ColorTokens>> = {
  light: {
    background: '#F6F7F9',
    surface: '#FFFFFF',
    surfaceMuted: '#EEF0F3',
    border: '#D9DDE3',
    text: '#0F1720',
    textSecondary: '#5B6573',
    primary: '#1B62D4',
    onPrimary: '#FFFFFF',
    positive: '#18723A',
    negative: '#BF1F2B',
    warning: '#8A5D00',
    info: '#0862C8',
  },
  dark: {
    background: '#0B0F14',
    surface: '#141A21',
    surfaceMuted: '#1C232C',
    border: '#2A333E',
    text: '#E6EAF0',
    textSecondary: '#9AA4B2',
    primary: '#4C8DFF',
    onPrimary: '#0B0F14',
    positive: '#3FB950',
    negative: '#F85149',
    warning: '#D29922',
    info: '#58A6FF',
  },
};
