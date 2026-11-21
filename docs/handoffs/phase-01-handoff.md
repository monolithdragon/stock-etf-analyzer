# Handoff – PHASE 01 → PHASE 02

> Dátum: 2026-11-21 · Előző fázis: PHASE 01 (Követelmények és architektúra) · Következő fázis: **PHASE 02 – Projekt setup** (`02_PROJEKT_SETUP.md`)

## 1. Készültség
**PHASE 01: KÉSZ.** Csak tervezési dokumentumok készültek. Nincs alkalmazáskód, nincs `package.json`, nincs git repó.

## 2. Létrehozott fájlok
- `docs/PROJECT_STATE.md`
- `docs/REQUIREMENTS.md` (extra: termékcél, felhasználói folyamatok, MVP-bontás, NFR)
- `docs/ARCHITECTURE.md`
- `docs/DECISIONS.md` (D-001…D-028; a D-023…D-028 a döntési pontok megválaszolása után készült)
- `docs/ROADMAP.md`
- `docs/DATA_SOURCES.md`
- `docs/DATA_DICTIONARY.md`
- `docs/KNOWN_ISSUES.md`
- `docs/phases/phase-01-requirements-architecture.md`
- `docs/handoffs/phase-01-handoff.md`

Módosított fájl: nincs. A `CLAUDE.md` változatlan.

## 3. Futtatott parancsok és ellenőrzések
- Csak olvasó környezetellenőrzés volt:
  - `node -v` → v26.10.0
  - `npm -v` → 12.2.0
  - `git --version` → 2.56.1.windows.1
  - Android SDK mappa: platforms 35/36/37.0, AVD `Medium_Phone_API_37.0`
  - `ANDROID_HOME` nincs beállítva; `adb` és `java` nincs a PATH-ban (JDK: `C:\Program Files\Android\Android Studio\jbr`).
- Webes ellenőrzések: Expo SDK 58 referencia, changelog, upgrade guide, sqlite/securestore/env/API routes/unit-testing docs, valamint az adatszolgáltatók oldalai. Az eredmény és a források a DATA_SOURCES és ARCHITECTURE 14 fejezetben vannak.
- **Tesztek / lint / typecheck: NEM FUTOTT.** Nincs kód. Semmi sincs PASS-nak jelölve.

## 4. A PHASE 02-t érintő legfontosabb tények (ellenőrizve 2026-11-21)
1. Az **Expo SDK 58** 2026-10-15-én jelent meg.
   - React Native 0.88; React 19.3.0 (a referenciaoldal szerint, U-01).
   - Node: 22.13+ / 24.3+ / 26+ (a telepített v26.10.0 megfelel).
   - Android 7+, compileSdk 37, targetSdk 36.
2. Az SDK 58-as **Expo Go store-verzió** megjelenése nem igazolt. Az Expo szerint addig a `create-expo-app` **SDK 57**-es projektet adhat, ezért az SDK 58-at **explicit** kell választani (U-12: pontos parancs, pl. `--template default@sdk-58`, ellenőrizendő). Az SDK 58-as Expo Go a CLI-n át telepíthető Android emulátorra.
3. A **New Architecture** kötelező (SDK 55 óta). A **Strict TypeScript API** az alapértelmezett (RN 0.87+).
4. Expo Router SDK 58: a `web.output` alapértelmezése `"server"`, és az API route-ok ezzel működnek. Ez a proxyhoz kell (D-004), de a PHASE 02-ben még **nem** kell API route-ot írni.
5. Teszt: az SDK 58-ban a `jest-expo` Jest 30-at igényel; Router-tesztekhez `@testing-library/react-native` ≥ 14; a `react-test-renderer` elavult. Telepítés `npx expo install … -- --dev`-vel (Windowson a `--` szükséges az Expo docs szerint).
6. Az `EXPO_PUBLIC_*` változók plain-textként bekerülnek az appba, ezért **soha** nem tartalmazhatnak titkot.

## 5. Útmutató a PHASE 02 indításához
1. **Olvasd el:** `CLAUDE.md`, `docs/PROJECT_STATE.md`, `docs/ARCHITECTURE.md` (különösen 3, 5, 14), `docs/DECISIONS.md` (D-001, D-002, D-003, D-015, D-020), `docs/ROADMAP.md` (PHASE 02), `docs/KNOWN_ISSUES.md` (R-06, R-14, R-15, U-01, U-02, U-12).
2. **Ne generálj új mappát.** A projekt gyökere `c:\Users\lujzi\Documents\stock-etf-analyzer`, és a `CLAUDE.md` és a `docs/` megmaradjon. Ha a `create-expo-app` csak üres mappába generál, generálj ideiglenes almappába, és mozgasd át a tartalmat. A meglévő fájlokat ne írd felül.
3. **Az SDK 58 sablon** kiválasztása explicit. Utána: `npx expo install --check` és `npx expo-doctor@latest`.
4. **Git:** `git init`, `.gitignore` (`.env*`, kivéve `.env.example`; `node_modules`; Expo build-mappák), majd az első commit. Commit-attribúció a környezet szabályai szerint.
   - A `.env.example` **üres** helyőrzőket tartalmazzon: `FMP_API_KEY=`, `EODHD_API_KEY=`, `FMP_PLAN=free`, `EODHD_PLAN=free`, `SEC_USER_AGENT=`, `AI_PROVIDER=template`, `EXPO_PUBLIC_API_BASE_URL=` (ARCHITECTURE 6.5).
   - A tulajdonosnak meg kell mondani: a valódi kulcsok a `.env.local` fájlba kerülnek (a PHASE 04B-ben), **soha nem a chatbe**.
   - Ellenőrizni kell, hogy a `.env.local` tényleg ignorált: `git check-ignore .env.local`.
5. **Minőségi eszközök:** TS strict, ESLint (Expo konfiguráció), Prettier, `typecheck`/`lint`/`test` scriptek, Jest 30 + jest-expo + egy smoke teszt.
6. **Mappaszerkezet:** az ARCHITECTURE 5 vázához igazodj. Csak azokat a mappákat hozd létre, amelyek a setuphoz kellenek. Ha a sablon konvenciója eltér (pl. `app/` vs `src/app/`), azt rögzítsd a DECISIONS-ben.
7. **Windows/Android:** útmutató az `ANDROID_HOME` (`%LOCALAPPDATA%\Android\Sdk`) és a PATH (`platform-tools`) beállításához, majd indítás az `Medium_Phone_API_37.0` emulátoron.
8. **Ne építsd meg:** domainmodelleket, proxy-végpontokat, szolgáltatókat, tárolást vagy pénzügyi képernyőket. Ezek a 03-tól jönnek.
9. **Lezárás:** a tényleges React/RN verziót írd be a D-001-be. Frissítsd a PROJECT_STATE, ROADMAP és KNOWN_ISSUES fájlt (U-01, U-02, U-12 lezárása), és készítsd el a `phase-02` útmutatót és handoffot.

## 6. Döntési pontok – a tulajdonos válaszai (2026-11-21)
- **DP-01:** US + európai (UCITS ETF, részvény) + globális ETF és részvény → D-023, D-025.
- **DP-02:** csak saját használat → D-008.
- **DP-03:** FMP és EODHD kulcs megvan; az ajánlott továbbiakhoz is legyen adapter → D-024 (`sec-edgar`, `ecb-fx`, `openfigi`, `mock`, `fmp`, `eodhd`).
- **DP-04:** ingyenes-először AI → D-026 (szabályalapú összefoglaló az alap, LLM opcionális).
- **DP-05:** nyitott, ne legyen kizárva → D-027 (csomagszint konfigurációból).

A PHASE 02-t egyik sem érinti közvetlenül, csak a `.env.example` helyőrzőit (5. pont, 4. lépés). Az adapterek a PHASE 04A/04B feladatai (D-028). Nyitott: DP-05 és U-13.

## 7. Ismert promptcsomag-hibák, amelyek a PHASE 02-t érintik
- A 02-es prompt „Equity Analyst”-ot ír: ugyanaz a projekt.
- A `docs/00_PROJECT_INSTRUCTION.md` helyett a gyökérben lévő `CLAUDE.md` az irányadó.
- A `docs/phase-01-handoff.md` helyett ez a fájl: `docs/handoffs/phase-01-handoff.md`.
