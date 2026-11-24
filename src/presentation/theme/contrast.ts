/**
 * WCAG 2.x kontrasztarány (PHASE 12, akadálymentesség).
 * A tesztek ezzel ellenőrzik, hogy a szövegszínek minden felületen elérik az AA szintet
 * (normál szöveg: 4,5:1).
 */
function channel(value: number): number {
  const c = value / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** `#RRGGBB` relatív fénysűrűsége (0–1). */
export function relativeLuminance(hex: string): number {
  const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (match === null) throw new Error(`Érvénytelen hex szín: ${hex}`);
  const [r, g, b] = [match[1], match[2], match[3]].map((h) => parseInt(h ?? '0', 16));
  return 0.2126 * channel(r ?? 0) + 0.7152 * channel(g ?? 0) + 0.0722 * channel(b ?? 0);
}

/** Kontrasztarány 1–21 között. */
export function contrastRatio(foreground: string, background: string): number {
  const a = relativeLuminance(foreground);
  const b = relativeLuminance(background);
  const [light, dark] = a > b ? [a, b] : [b, a];
  return (light + 0.05) / (dark + 0.05);
}

/** WCAG AA minimum normál méretű szövegre. */
export const WCAG_AA_TEXT = 4.5;
