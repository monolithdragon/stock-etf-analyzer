# Handoff – PHASE 12 → PHASE 13

> Dátum: 2026-11-23 · Elkészült: **PHASE 12 – UI/UX és navigáció** · Következik: **PHASE 13 – Tárolás, cache, offline (MVP)**
> Kezdőbarát útmutató: [../phases/phase-12-ui-ux-navigation.md](../phases/phase-12-ui-ux-navigation.md) · Előző handoff: [phase-11-handoff.md](phase-11-handoff.md)

## 1. Készültség
**PHASE 12: KÉSZ** – egy fontos megszorítással: **emulátoron/telefonon nem futott** (KI-100). Igazolás: Jest (valódi route-fa, `renderRouter`) + Metro bundle (Android, web).

| Elfogadási feltétel | Állapot | Bizonyíték |
|---|---|---|
| Fő folyamat UI-ból: ticker keresése → elemzés megnyitása | ✅ | `routes.test.tsx`: Kezdőlap → Keresés → „DEMO” → `hit-DEMO@XNAS` → `/stock/DEMO@XNAS`; ETF-találat → `/etf/DEMOETF@XETR` |
| Stock, ETF és portfólió képernyő külön logikát használ | ✅ | `stock-view-model.ts`, `etf-view-model.ts`, `portfolio-view-model.ts` + külön képernyők; `presentation-view-models.test.ts` |
| Loading / error / missing-data állapotok kezeltek | ✅ | `useAsyncResult` + `LoadingState`/`ErrorState`(újrapróbálás)/`EmptyState`/`DataNotices` (demó, elavult, részleges, frissítés); N/A/N/M okkal; blokkoló hiba (D-081/3) |
| Az app fordul, a navigációs smoke tesztek lefutnak | ✅ | `npx expo export -p android` (Hermes 4,3 MB) és `-p web` exit 0; 15/15 smoke teszt |
| Kötelező kimenetek: navigáció + képernyők, theme/tokens + formatters, phase-12 doksi, handoff, README, projektállapot | ✅ | lásd 3. pont |

Képernyők: Kezdőlap, Keresés, Részvényelemzés (ár/alapadatok, értékeltség, növekedés, jövedelmezőség, mérleg, cash flow, DCF, kockázat, score/döntés, magyarázat, adatminőség), ETF-elemzés (alapadatok, TER/AUM, benchmark, holdings, országok, szektorok, súlyozás/stílus, osztalék, követés, kockázat, hozam, magyarázat), Portfólió (érték, P/L, allokáció, devizakitettség, koncentráció, ETF-átfedés, kockázat, magyarázat beleegyezéssel, tranzakció-űrlap), Figyelő (váz), Összehasonlítás (váz), Beállítások (bázispénznem, téma, AI-gomb, adatforrás).

## 2. Mi készült (röviden)
- **Navigáció (D-079):** gyökér Stack + `(tabs)` (5 fül, `expo-router/js-tabs`); Stack: `stock/[listingId]`, `etf/[listingId]`, `compare`, `about`. A D-034 leváltva.
- **Presentation-rétegek:** `format/`, `view-models/`, `screens/`, `analysis/`, `components/` (bővítve), `state/`, `hooks/`, `navigation.ts`. A route-fájlok vékonyak.
- **Formázás és a11y (D-080):** kézi hu-HU formázók; N/A/N/M; provenance-nézet minden mutatónál; szín + előjel/ikon/szöveg; WCAG AA kontraszt teszttel (a világos paletta 5 színe sötétebb lett); ≥ 48 dp érintés; betűméret-skálázás 1,8× korláttal; téma: rendszer/világos/sötét.
- **Állapot és szabályok (D-081):** `useAsyncResult`; adatjelzések; blokkoló hiba (részvény); a döntés csak a motorból; AI-gomb alapból ki, portfóliónál beleegyezés; beállítások és figyelőlista memóriában.
- **Új use case:** `createPortfolio` (+ `AppServices.createPortfolio`). MVP: egy portfólió, azonosító `main`.
- **Grafikon:** nincs könyvtár; natív sávdiagram (D-080/8, Ideiglenes).
- **Új csomag: nincs.**

## 3. Módosított / új fájlok
- **Új route-ok:** `src/app/(tabs)/{_layout,index,search,portfolio,watchlist,settings}.tsx` (az `index.tsx` áthelyezve a `(tabs)`-ba), `src/app/stock/[listingId].tsx`, `src/app/etf/[listingId].tsx`, `src/app/compare.tsx`. Módosítva: `src/app/_layout.tsx`.
- **Új presentation:**
  - `format/{formatters,errors,index}.ts`; `hooks/use-async-result.ts`; `navigation.ts`;
  - `state/{settings-context,watchlist-context}.tsx`;
  - `view-models/{metric-row,evaluation-view-model,stock-view-model,etf-view-model,portfolio-view-model}.ts`;
  - `analysis/{analysis-header,evaluation-sections,explanation-section}.tsx`;
  - `screens/{home,search,stock-analysis,etf-analysis,portfolio,portfolio-forms,watchlist,compare,settings}-screen.tsx` (a forms: `portfolio-forms.tsx`);
  - `components/{buttons,list-item,metric-row,section,states,status-badge,weight-bars}.tsx`; `theme/contrast.ts`.
- **Módosított presentation:** `components/{app-text,card,screen,index}`, `theme/{colors,tokens,use-theme,index}`, `strings/hu.ts`, `di/app-services-context.test.tsx`.
- **Application/config:** új `src/application/use-cases/create-portfolio.ts`; módosítva `src/application/index.ts`, `src/config/container.ts`.
- **Tesztek:** új `src/__tests__/presentation-view-models.test.ts` (11), `src/presentation/format/formatters.test.ts` (23), `src/application/use-cases/create-portfolio.test.ts` (5), `src/presentation/screens/portfolio-forms.test.ts` (4); bővítve `src/presentation/theme/theme.test.ts` (+7); újraírva `src/__tests__/routes.test.tsx` (5 → 15).
- **Docs:** új: ez a handoff, `docs/phases/phase-12-ui-ux-navigation.md`; módosítva: `DECISIONS` (D-079…D-081, D-034 leváltva), `KNOWN_ISSUES` (blokkolók, KI-97…KI-109, KI-12/89/95, U-10/U-11), `ROADMAP`, `PROJECT_STATE`, `ARCHITECTURE` (5.2), `README`.

## 4. Parancsok és tényleges eredmények (2026-11-23, a projekt gyökerében)

| Parancs | Eredmény |
|---|---|
| `git status` (kiinduláskor) | `main`, clean; a PHASE 11 merge-ölve (`6a907d3`, PR #7) |
| `npx jest` (kiinduláskor, új tesztek nélkül) | 1387 teszt / 77 suite; a 2 régi kezdőlap-teszt a kezdőlap tartalmának cseréje miatt bukott (várt) – lásd KI-107 a handoff-szám eltéréséről |
| `CI=1 npx expo start --port 8093` (~90 mp, `timeout`-tal leállítva) | csak a typed routes (`.expo/types/router.d.ts`) újragenerálásához |
| `git switch -c phase-12` | új munkaág |
| `npm run check` (a fázis végén) | **exit 0**: typecheck ✅, lint (`--max-warnings 0`) ✅, Prettier ✅, **1447/1447 teszt, 81 suite** ✅ (+60) |
| `npx expo export -p android` (scratch mappába) | exit 0, Hermes bundle 4,3 MB |
| `npx expo export -p web` (scratch mappába) | exit 0, route-onkénti kliens-chunkok + 11 API route |
| Szkennelés: `ANTHROPIC_API_KEY`/`EODHD_API_KEY`/`FMP_API_KEY` a kliens-bundle-ökben | **0** találat (web kliens és Android `.hbc`); az export-mappák törölve |

**Fejlesztés közbeni leletek:**
1. Ismeretlen tickernél a részvény-use case részleges hibatűrése egy csupa N/A elemzést adott → UI-szabály: ha minden forrás hibás, hibaállapot + újrapróbálás (D-081/3). ETF-nél ez forráslista hiányában nem vihető át (KI-106).
2. A világos `primary` a háttéren 4,32:1 volt (AA alatt) → palettajavítás + automatikus kontraszt-teszt.
3. RNTL 14: a `fireEvent.changeText` is aszinkron – `await` nélkül átfedő `act()` hívások.
4. React Compiler lint: ref írása render közben tilos → effektbe került.
5. A `Tabs` export az `expo-router`-ből SDK 58-ban deprecated → `expo-router/js-tabs`.

## 5. Ismert hibák / korlátok
Részletek: [../KNOWN_ISSUES.md](../KNOWN_ISSUES.md), „PHASE 12” szakasz.
- **KI-100 (K):** emulátoron/telefonon nem futott (megjelenés, TalkBack, nagy betű, billentyűzet nem ellenőrzött).
- **KI-97 (K):** portfólió, figyelőlista, beállítások memóriában (PHASE 13).
- **KI-109 (K):** lehúzásos frissítés kvótát fogyaszt (nincs cache).
- **KI-101 (K):** nincs ETF-metaadat űrlap → free csomagban az ETF-képernyő többnyire „Nem elérhető”.
- KI-98 (vonaldiagram nincs), KI-99 (Unicode tab-ikonok), KI-102 (DCF-/score-szerkesztő nincs), KI-103 (Compare váz), KI-104 (Jest act-figyelmeztetés), KI-105 (egy portfólió, csak vétel/eladás), KI-106 (ETF blokkoló hiba), KI-107 (tesztszám-eltérés), KI-108 (`basedOn` nem kattintható).

## 6. Nyitott kérdések (a tulajdonos dönt)
- **Commit:** tulajdonosi kérésre commitolva a `phase-12` branchen (`80c5284`); a push, a PR és a merge a tulajdonos döntése. Üzenet:
  `feat: PHASE 12 – UI/UX és navigáció (tabok + Stack, részvény/ETF/portfólió képernyők külön view-modellel, közös formázók, AA kontraszt, állapotok, provenance-nézet, magyarázat-szekció, createPortfolio)`
- **Eszközös ellenőrzés:** `npm run android` + a fázis-útmutató 14. fejezetének listája.
- **Grafikon:** kell-e vonaldiagram (árfolyam/TWR) a PHASE 14-ben? (`react-native-svg` új függőség lenne.)
- A korábbi nyitott pontok (LLM bekapcsolása DP-04, EAS-próba, FMP ToS, DP-05) változatlanok, nem blokkolják a PHASE 13-at.

## 7. Indulási útmutató a PHASE 13-hoz
1. **Olvasnivaló:** `docs/PROJECT_STATE.md`, ez a handoff, ROADMAP PHASE 12 „kapcsolódási pontok”, ARCHITECTURE 11–12. (cache, offline), D-013, D-079…D-081.
2. **Ellenőrzés:** `git status`, `git branch --show-current`, majd `npm run check`. Elvárt: exit 0, **1447 teszt** (ha a PHASE 12 commitolva/merge-ölve van).
3. **Ahová a tárolás kötődik (az interfész marad):**
   - `src/presentation/state/settings-context.tsx` – `AppSettings` (bázispénznem, téma, `llmEnabled`) → kv-store; a `SettingsProvider` `initial` propja már fogad kezdőértéket (betöltés után).
   - `src/presentation/state/watchlist-context.tsx` – `WatchlistItem[]` (csak azonosító, név, típus) → kv-store vagy SQLite.
   - `PortfolioRepository` port → SQLite adapter a `src/infrastructure`-ben; a container `createDefaultDependencies` cseréli. A UI a `main` azonosítót használja (`MAIN_PORTFOLIO_ID`).
   - A tárolás port legyen az application/infrastructure rétegben; a presentation ne importáljon tárolót közvetlenül (ESLint-zóna).
4. **Cache + offline:** a `useAsyncResult` `refreshing` állapota („a régi adat látszik, frissítés folyamatban”) használható a cache-ből kiszolgált adatra; offline a `DataNotices` „Elavult adat” jelzése kell (soha ne friss-ként). KI-109: a lehúzásos frissítés ne kerülje meg a cache-t ok nélkül.
5. **ETF forrás-összesítő** (KI-106) és a kibocsátói holdings-import (D-071, KI-74) a PHASE 13 tervében.
6. **Tilos (marad):** pontozás vagy formázás a komponensben; hiány 0-ként; automatikus LLM-hívás; titok a kliensben.
