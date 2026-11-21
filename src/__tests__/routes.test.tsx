/**
 * Navigációs smoke teszt: a valódi src/app route-könyvtárat rendereli.
 * A tesztfájl NEM lehet az src/app mappában, mert ott minden fájl route-tá válik.
 */
import { fireEvent, renderRouter, screen } from 'expo-router/testing-library';

import { strings } from '@/presentation/strings/hu';
import { palette } from '@/presentation/theme';

const APP_DIR = './src/app';

describe('alap route-ok', () => {
  it('a kezdőlap a "/" útvonalon renderelődik, jogi nyilatkozattal', async () => {
    await renderRouter(APP_DIR, { initialUrl: '/' });

    expect(screen).toHavePathname('/');
    expect(screen.getByText(strings.appName)).toBeOnTheScreen();
    expect(screen.getByText(strings.home.noDataYet)).toBeOnTheScreen();
    expect(screen.getByText(strings.disclaimer)).toBeOnTheScreen();
  });

  it('a kezdőlap gombja a "/about" képernyőre navigál', async () => {
    await renderRouter(APP_DIR, { initialUrl: '/' });

    // A <Link asChild> a gyerek elemre role="link"-et tesz (navigációs elem), ezért nem "button".
    // RNTL 14: a fireEvent aszinkron – await nélkül az act() hívások átfednek és a tesztek összeakadnak.
    await fireEvent.press(screen.getByRole('link', { name: strings.home.aboutButton }));

    expect(await screen.findByText(strings.about.configTitle)).toBeOnTheScreen();
    expect(screen).toHavePathname('/about');
  });

  it('a <Link asChild> gomb megtartja a háttérszínét (regresszió: függvény-style elveszett)', async () => {
    await renderRouter(APP_DIR, { initialUrl: '/' });

    expect(screen.getByRole('link', { name: strings.home.aboutButton })).toHaveStyle({
      backgroundColor: palette.light.primary,
    });
  });

  it('a "/about" képernyő alapértelmezett, titokmentes konfigurációt mutat', async () => {
    await renderRouter(APP_DIR, { initialUrl: '/about' });

    expect(screen.getByText(strings.about.dataModeMock)).toBeOnTheScreen();
    expect(screen.getByText(strings.common.notSet)).toBeOnTheScreen();
    expect(screen.queryByText(strings.about.configIssuesTitle)).not.toBeOnTheScreen();
  });

  it('ismeretlen útvonalon a "nem található" képernyő jelenik meg', async () => {
    await renderRouter(APP_DIR, { initialUrl: '/nincs-ilyen-oldal' });

    expect(screen.getByText(strings.notFound.message)).toBeOnTheScreen();
  });
});
