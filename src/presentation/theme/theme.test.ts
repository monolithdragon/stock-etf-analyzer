import {
  contrastRatio,
  getTheme,
  palette,
  resolveScheme,
  WCAG_AA_TEXT,
} from '@/presentation/theme';

describe('theme', () => {
  it('a világos és a sötét paletta ugyanazokat a tokeneket definiálja', () => {
    expect(Object.keys(palette.dark).sort()).toEqual(Object.keys(palette.light).sort());
  });

  it('minden szín érvényes 6 jegyű hex kód', () => {
    for (const scheme of ['light', 'dark'] as const) {
      for (const value of Object.values(palette[scheme])) {
        expect(value).toMatch(/^#[0-9A-F]{6}$/i);
      }
    }
  });

  it('getTheme a sémának megfelelő palettát adja', () => {
    expect(getTheme('dark').colors).toBe(palette.dark);
    expect(getTheme('light').scheme).toBe('light');
  });
});

describe('akadálymentesség: kontraszt (WCAG AA 4,5:1)', () => {
  const TEXT_TOKENS = [
    'text',
    'textSecondary',
    'primary',
    'positive',
    'negative',
    'warning',
    'info',
  ] as const;
  const SURFACES = ['background', 'surface', 'surfaceMuted'] as const;

  it.each(['light', 'dark'] as const)(
    '%s: minden szövegszín minden felületen olvasható',
    (scheme) => {
      const colors = palette[scheme];
      for (const fg of TEXT_TOKENS) {
        for (const bg of SURFACES) {
          const ratio = contrastRatio(colors[fg], colors[bg]);
          if (ratio < WCAG_AA_TEXT)
            throw new Error(`${scheme}: ${fg} / ${bg} = ${ratio.toFixed(2)}`);
        }
      }
    },
  );

  it.each(['light', 'dark'] as const)('%s: gombfelirat az elsődleges színen', (scheme) => {
    expect(
      contrastRatio(palette[scheme].onPrimary, palette[scheme].primary),
    ).toBeGreaterThanOrEqual(WCAG_AA_TEXT);
  });

  it('a kontrasztképlet ismert értékeket ad', () => {
    expect(contrastRatio('#000000', '#FFFFFF')).toBeCloseTo(21, 5);
    expect(contrastRatio('#FFFFFF', '#FFFFFF')).toBeCloseTo(1, 5);
    expect(() => contrastRatio('red', '#FFFFFF')).toThrow();
  });
});

describe('téma-preferencia', () => {
  it('a felhasználói választás felülírja a rendszert', () => {
    expect(resolveScheme('dark', 'light')).toBe('dark');
    expect(resolveScheme('light', 'dark')).toBe('light');
    expect(resolveScheme('system', 'dark')).toBe('dark');
    expect(resolveScheme('system', null)).toBe('light');
  });

  it('a téma tartalmazza az érintési minimumot és a betűméret-korlátot', () => {
    expect(getTheme('light').minTouchTarget).toBeGreaterThanOrEqual(44);
    expect(getTheme('dark').maxFontSizeMultiplier).toBeGreaterThan(1);
  });
});
