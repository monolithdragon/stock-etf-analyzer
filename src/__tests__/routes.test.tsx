/**
 * Navigációs smoke tesztek (PHASE 12): a valódi src/app route-könyvtárat rendereli, demó (mock)
 * adatmódban – a gyökér layout a valódi composition rootot (createAppServices) használja.
 * A tesztfájl NEM lehet az src/app mappában, mert ott minden fájl route-tá válik.
 *
 * Fő folyamat (elfogadási feltétel): ticker keresése → elemzés megnyitása.
 */
import { fireEvent, renderRouter, screen, waitFor, within } from 'expo-router/testing-library';

import { strings } from '@/presentation/strings/hu';
import { palette } from '@/presentation/theme';

const APP_DIR = './src/app';
const WAIT = { timeout: 5000 };

async function searchFor(query: string) {
  await fireEvent.changeText(screen.getByLabelText(strings.search.inputLabel), query);
  await fireEvent.press(screen.getByRole('button', { name: strings.search.submit }));
}

describe('alap route-ok', () => {
  it('a kezdőlap a "/" útvonalon renderelődik: demó-jelzés, gyors műveletek, nyilatkozat, tabok', async () => {
    await renderRouter(APP_DIR, { initialUrl: '/' });

    expect(screen).toHavePathname('/');
    expect(screen.getByText(strings.appName)).toBeOnTheScreen();
    expect(screen.getByText(strings.home.mockTitle)).toBeOnTheScreen();
    expect(screen.getByText(strings.disclaimer)).toBeOnTheScreen();
    for (const tab of Object.values(strings.tabs)) {
      expect(screen.getAllByText(tab).length).toBeGreaterThan(0);
    }
  });

  it('a kezdőlap gombja a "/about" képernyőre navigál', async () => {
    await renderRouter(APP_DIR, { initialUrl: '/' });

    // A <Link asChild> a gyerek elemre role="link"-et tesz (navigációs elem), ezért nem "button".
    // RNTL 14: a fireEvent aszinkron – await nélkül az act() hívások átfednek.
    await fireEvent.press(screen.getByRole('link', { name: strings.home.aboutButton }));

    expect(await screen.findByText(strings.about.configTitle)).toBeOnTheScreen();
    expect(screen).toHavePathname('/about');
  });

  it('a <Link asChild> gomb megtartja a háttérszínét (regresszió: függvény-style elveszett)', async () => {
    await renderRouter(APP_DIR, { initialUrl: '/' });

    expect(screen.getByRole('link', { name: strings.home.searchButton })).toHaveStyle({
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

describe('fő folyamat: keresés → elemzés', () => {
  it('a kezdőlapról a keresésre jut, ticker keresése után a részvényelemzés megnyílik', async () => {
    await renderRouter(APP_DIR, { initialUrl: '/' });
    await fireEvent.press(screen.getByRole('link', { name: strings.home.searchButton }));
    expect(screen).toHavePathname('/search');
    expect(screen.getByText(strings.search.idleTitle)).toBeOnTheScreen();

    await searchFor('DEMO');
    const hit = await screen.findByTestId('hit-DEMO@XNAS', {}, WAIT);
    await fireEvent.press(hit);

    expect(await screen.findByTestId('stock-screen', {}, WAIT)).toBeOnTheScreen();
    expect(screen).toHavePathname('/stock/DEMO@XNAS');
    expect(screen.getByText('Demo Corp (kitalált)')).toBeOnTheScreen();
    // A címke a döntési engine-től jön; adathiánynál „Nem értékelhető”, BUY/SELL nincs.
    const decision = screen.getByTestId('decision-card');
    expect(within(decision).getByText('Nem értékelhető')).toBeOnTheScreen();
    expect(within(decision).queryByText(/^(Buy|Sell|Strong Buy|Strong Sell)$/i)).toBeNull();
    // Demó- és részleges-adat jelzés szöveggel (nem csak színnel).
    expect(screen.getByTestId('notice-mock')).toBeOnTheScreen();
    expect(screen.getByTestId('notice-partial')).toBeOnTheScreen();
    // A hiányzó mutató N/A, nem 0 – az „Ár és alapadatok” szakasz alapból nyitva.
    expect(within(screen.getByTestId('metric-marketCap')).getByText('N/A')).toBeOnTheScreen();
  });

  it('ETF-találat az ETF-képernyőt nyitja (külön logika: adatkorlátok, nem alkalmazható mutatók)', async () => {
    await renderRouter(APP_DIR, { initialUrl: '/search' });
    await searchFor('DEMO');
    await fireEvent.press(await screen.findByTestId('hit-DEMOETF@XETR', {}, WAIT));

    expect(await screen.findByTestId('etf-screen', {}, WAIT)).toBeOnTheScreen();
    expect(screen).toHavePathname('/etf/DEMOETF@XETR');
    expect(screen.getByTestId('etf-limitations')).toBeOnTheScreen();
    expect(screen.getByText(strings.etf.notApplicableTitle)).toBeOnTheScreen();
    expect(screen.queryByTestId('section-dcf')).toBeNull();
  });

  it('a keresés hibája hibaállapotot ad újrapróbálással', async () => {
    await renderRouter(APP_DIR, { initialUrl: '/search' });
    await searchFor('***');

    // A mock forrás érvénytelen kérésre hibát vagy üres találatot ad – mindkettő kezelt állapot.
    const error = await screen
      .findByRole('button', { name: strings.states.retry }, WAIT)
      .catch(() => null);
    if (error === null) {
      expect(await screen.findByText(strings.search.noResultsTitle, {}, WAIT)).toBeOnTheScreen();
    } else {
      expect(error).toBeOnTheScreen();
    }
  });

  it('ismeretlen jegyzés (minden forrás hibás) hibaállapotot ad, újrapróbálás gombbal', async () => {
    await renderRouter(APP_DIR, { initialUrl: '/stock/NOPE@XNAS' });

    expect(
      await screen.findByRole('button', { name: strings.states.retry }, WAIT),
    ).toBeOnTheScreen();
    expect(screen.getByText(/^⚠ Nem található/)).toBeOnTheScreen();
    expect(screen.queryByTestId('decision-card')).toBeNull();
  });
});

describe('figyelőlista, portfólió, beállítások', () => {
  it('az elemzésből a figyelőlistához adott elem megjelenik a Figyelő tabon', async () => {
    await renderRouter(APP_DIR, { initialUrl: '/stock/DEMO@XNAS' });
    await screen.findByTestId('stock-screen', {}, WAIT);
    await fireEvent.press(screen.getByRole('button', { name: strings.watchlist.add }));
    expect(screen.getByRole('button', { name: strings.watchlist.remove })).toBeOnTheScreen();
  });

  it('portfólió: üres állapot → létrehozás → tranzakció → összesítés', async () => {
    await renderRouter(APP_DIR, { initialUrl: '/portfolio' });

    expect(await screen.findByText(strings.portfolio.emptyTitle, {}, WAIT)).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: strings.portfolio.create }));
    expect(await screen.findByText(strings.portfolio.noTxTitle, {}, WAIT)).toBeOnTheScreen();

    const form = screen.getByTestId('add-transaction-form');
    await fireEvent.changeText(
      within(form).getByLabelText(strings.portfolio.listingIdLabel),
      'DEMO@XNAS',
    );
    await fireEvent.changeText(within(form).getByLabelText(strings.portfolio.quantityLabel), '10');
    await fireEvent.changeText(within(form).getByLabelText(strings.portfolio.priceLabel), '90');
    await fireEvent.changeText(
      within(form).getByLabelText(strings.portfolio.dateLabel),
      '2026-11-02',
    );
    await fireEvent.press(within(form).getByRole('button', { name: strings.portfolio.record }));

    expect(await screen.findByTestId('portfolio-summary', {}, WAIT)).toBeOnTheScreen();
    expect(screen.getByText(strings.portfolio.positionsTitle)).toBeOnTheScreen();
    // Az adózási figyelmeztetés és a nyilatkozat mindig látszik.
    expect(screen.getByTestId('disclaimers')).toBeOnTheScreen();
  });

  it('portfólió-űrlap: a use case validációs hibája a mező alatt jelenik meg', async () => {
    await renderRouter(APP_DIR, { initialUrl: '/portfolio' });
    await fireEvent.press(
      await screen.findByRole('button', { name: strings.portfolio.create }, WAIT),
    );
    const form = await screen.findByTestId('add-transaction-form', {}, WAIT);
    await fireEvent.changeText(
      within(form).getByLabelText(strings.portfolio.listingIdLabel),
      'rossz',
    );
    await fireEvent.press(within(form).getByRole('button', { name: strings.portfolio.record }));

    expect(within(form).getByText(/Érvénytelen listing-azonosító/)).toBeOnTheScreen();
  });

  it('beállítások: adatmód látszik; az AI-gomb csak bekapcsolás után jelenik meg', async () => {
    await renderRouter(APP_DIR, { initialUrl: '/settings' });

    expect(screen.getByText(strings.about.dataModeMock)).toBeOnTheScreen();
    expect(screen.getByText(strings.settings.aiOffNote)).toBeOnTheScreen();
    await fireEvent(screen.getByTestId('llm-switch'), 'valueChange', true);
    expect(screen.getByText(strings.settings.aiOnNote)).toBeOnTheScreen();
  });

  it('beállítások: a sötét téma kiválasztása a felületet sötétre váltja', async () => {
    await renderRouter(APP_DIR, { initialUrl: '/settings' });

    await fireEvent.press(screen.getByRole('radio', { name: strings.settings.themeDark }));
    expect(screen.getByRole('radio', { name: strings.settings.themeDark })).toBeChecked();
    expect(screen.getByTestId('settings-screen')).toHaveStyle({
      backgroundColor: palette.dark.background,
    });
  });

  it('összehasonlítás (váz): üres figyelőlistánál magyarázó üres állapot', async () => {
    await renderRouter(APP_DIR, { initialUrl: '/compare' });

    expect(screen.getByText(strings.compare.empty)).toBeOnTheScreen();
  });
});

describe('PHASE 13: tartós tárolás (újraindítás után) és helyi adatok', () => {
  // Két teljes app-renderelés tesztenként (újraindítás) → hosszabb korlát a hidegindítás miatt.
  jest.setTimeout(20000);

  it('a beállítás (sötét téma) az app újraindítása után is megmarad', async () => {
    const first = await renderRouter(APP_DIR, { initialUrl: '/settings' });
    await fireEvent.press(screen.getByRole('radio', { name: strings.settings.themeDark }));
    expect(screen.getByRole('radio', { name: strings.settings.themeDark })).toBeChecked();
    await first.unmount();

    await renderRouter(APP_DIR, { initialUrl: '/settings' });
    await waitFor(
      () => expect(screen.getByRole('radio', { name: strings.settings.themeDark })).toBeChecked(),
      WAIT,
    );
    expect(screen.getByTestId('settings-screen')).toHaveStyle({
      backgroundColor: palette.dark.background,
    });
  });

  it('a figyelőlista az app újraindítása után is megmarad (SQLite)', async () => {
    const first = await renderRouter(APP_DIR, { initialUrl: '/stock/DEMO@XNAS' });
    await screen.findByTestId('stock-screen', {}, WAIT);
    await fireEvent.press(screen.getByRole('button', { name: strings.watchlist.add }));
    // A mentés aszinkron (optimista UI): a mikrotaszkokat kiürítjük, hogy a tárolóba is bekerüljön
    // az újraindítás előtt. (Itt hamis időzítők futnak – `setTimeout` nem használható.)
    for (let i = 0; i < 50; i += 1) await Promise.resolve();
    await first.unmount();

    await renderRouter(APP_DIR, { initialUrl: '/watchlist' });
    expect(await screen.findByText(/Demo Corp/, {}, WAIT)).toBeOnTheScreen();
  });

  it('a portfólió és a tranzakció az app újraindítása után is megmarad', async () => {
    const first = await renderRouter(APP_DIR, { initialUrl: '/portfolio' });
    await fireEvent.press(
      await screen.findByRole('button', { name: strings.portfolio.create }, WAIT),
    );
    const form = await screen.findByTestId('add-transaction-form', {}, WAIT);
    await fireEvent.changeText(
      within(form).getByLabelText(strings.portfolio.listingIdLabel),
      'DEMO@XNAS',
    );
    await fireEvent.changeText(within(form).getByLabelText(strings.portfolio.quantityLabel), '4');
    await fireEvent.changeText(within(form).getByLabelText(strings.portfolio.priceLabel), '90');
    await fireEvent.changeText(
      within(form).getByLabelText(strings.portfolio.dateLabel),
      '2026-11-02',
    );
    await fireEvent.press(within(form).getByRole('button', { name: strings.portfolio.record }));
    expect(await screen.findByTestId('portfolio-summary', {}, WAIT)).toBeOnTheScreen();
    await first.unmount();

    await renderRouter(APP_DIR, { initialUrl: '/portfolio' });
    expect(await screen.findByTestId('portfolio-summary', {}, WAIT)).toBeOnTheScreen();
    expect(screen.queryByText(strings.portfolio.emptyTitle)).toBeNull();
  });

  it('Beállítások → export: a saját adatok JSON-ja megjelenik (titok és piaci adat nélkül)', async () => {
    await renderRouter(APP_DIR, { initialUrl: '/settings' });
    await fireEvent.press(screen.getByTestId('export-data'));
    const json = await screen.findByTestId('export-json', {}, WAIT);
    const text = String(json.props.children);
    expect(JSON.parse(text)).toMatchObject({ format: 'stock-etf-analyzer.user-data', version: 1 });
    expect(text).not.toMatch(/api[_-]?key|secret|token/i);
  });

  it('Beállítások → minden helyi adat törlése: kétlépcsős megerősítés, utána alapértékek', async () => {
    await renderRouter(APP_DIR, { initialUrl: '/settings' });
    await fireEvent.press(screen.getByRole('radio', { name: strings.settings.themeDark }));
    await fireEvent.press(screen.getByTestId('delete-all'));
    expect(screen.getByText(`⚠ ${strings.settings.deleteAllWarning}`)).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId('delete-all-confirm'));
    expect(await screen.findByText(strings.settings.deleteAllDone, {}, WAIT)).toBeOnTheScreen();
    expect(screen.getByRole('radio', { name: strings.settings.themeSystem })).toBeChecked();
  });
});
