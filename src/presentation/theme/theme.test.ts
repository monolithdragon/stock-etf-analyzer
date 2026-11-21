import { getTheme, palette } from '@/presentation/theme';

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
