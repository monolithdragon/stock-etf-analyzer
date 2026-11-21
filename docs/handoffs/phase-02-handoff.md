# Handoff – PHASE 02 → PHASE 03

> Dátum: 2026-11-21 · Előző fázis: PHASE 02 (Projekt setup) · Következő fázis: **PHASE 03 – Architektúra és domain modell**
> Kezdőbarát részletek: [../phases/phase-02-project-setup.md](../phases/phase-02-project-setup.md)

## 1. Készültség
**PHASE 02: KÉSZ.** Minden elfogadási feltétel teljesült (ROADMAP PHASE 02 „Eredmény”):
- Fut az Expo SDK 58 + TS strict + Expo Router projekt. Az Android emulátoron ellenőrizve: `Medium_Phone_API_37.0`, Expo Go 58.0.5, világos és sötét mód, valódi koppintásos navigáció.
- Lint, formázás, typecheck és tesztek zöldek. Az Expo függőségellenőrzés és a doctor lefutott.
- Git repó (`main`) az első committal.
- Üzleti funkció nem készült.

## 2. Tényleges verziók
`expo` 58.0.26 · `react-native` 0.88.1 · `react` 19.3.0 · `expo-router` 58.0.32 · `typescript` 6.0.3 · `eslint` 9.39.5 · `eslint-config-expo` 58.0.4 · `prettier` 3.10.1 · `jest` 30.5.2 · `jest-expo` 58.0.15 · `@testing-library/react-native` 14.1.0. Sablon: `expo-template-default` 58.0.35 (`--template default@sdk-58`).

## 3. Létrehozott / módosított fájlok
**Új (gyökér):** `package.json`, `package-lock.json`, `app.json`, `tsconfig.json`, `eslint.config.js`, `.prettierrc.json`, `.prettierignore`, `.gitattributes`, `.gitignore`, `.env.example`, `.vscode/settings.json`, `.vscode/extensions.json`, `README.md`, `assets/` (ikonok, splash).
**Új (kód):**
- `src/app/{_layout,index,about,+not-found}.tsx`
- `src/config/env.ts` (+ `env.test.ts`)
- `src/presentation/theme/{colors,tokens,use-theme,navigation-theme,index}.ts` (+ `theme.test.ts`)
- `src/presentation/components/{app-text,card,info-row,primary-button,screen}.tsx` + `index.ts`
- `src/presentation/strings/hu.ts`
- `src/__tests__/routes.test.tsx`

**Új (docs):** `docs/phases/phase-02-project-setup.md`, `docs/handoffs/phase-02-handoff.md`.
**Módosított docs:**
- `PROJECT_STATE.md` (újraírva);
- `ROADMAP.md` (02 KÉSZ, 03 következik, 03-as kapcsolódási pontok);
- `KNOWN_ISSUES.md` (KI-01…KI-10, PI-06, U-01/U-12 lezárva, R-06/R-15/R-24 frissítve);
- `DECISIONS.md` (D-001 kiegészítés, új D-029…D-034);
- `ARCHITECTURE.md` (5. megjegyzés, 14. verziók).

A `CLAUDE.md` változatlan.

## 4. Futtatott parancsok és tényleges eredmények (2026-11-21)

| Parancs | Eredmény |
|---|---|
| `node -v` / `npm -v` / `git --version` | v26.10.0 / 12.2.0 / 2.56.1.windows.1 |
| `npx create-expo-app@5.0.0 stock-etf-analyzer --template default@sdk-58 --no-install --no-agents-md` (scratchpad mappában) | `✅ Your project is ready!` |
| `npm install` | 563 csomag, 3 moderate audit-figyelmeztetés |
| `npx expo install eslint eslint-config-expo prettier eslint-config-prettier eslint-plugin-prettier jest-expo jest @types/jest @testing-library/react-native -- --save-dev` | települt; a csomagok egy része a `dependencies`-ben maradt → kézzel áthelyezve, `npm install` (KI-03) |
| `npm run typecheck` | exit 0 (első futás „Cannot find name 'it'” → javítva: `types: ["jest"]`) |
| `npm run lint` | exit 0 (első futás 2 Prettier-eltérés → `prettier --write` javította) |
| negatív lint-próba (ideiglenes fájl) | 2 várt hiba: `no-floating-promises`, `no-explicit-any`; a fájl törölve |
| `npm run format:check` | `All matched files use Prettier code style!` |
| `npm test` | **15/15 passed, 3 suite** (két egymást követő futásban is). Korábbi piros futások: `getByRole('button')` → `link`; RNTL 14 `await` hiánya → átfedő `act()`; gomb háttérszín-regresszió (javítás előtt piros, utána zöld) |
| `npm run check` | exit 0 |
| `npx expo install --check` | `Dependencies are up to date` |
| `npx expo-doctor@latest` | `20/20 checks passed. No issues detected!` |
| `emulator -avd Medium_Phone_API_37.0` + `npx expo start --android` | Expo Go 58.0.5 telepítve; `Android Bundled 10450ms … (1465 modules)`; képernyőképek: Kezdőlap, A projektről, sötét mód; a Metro naplóban nincs warning vagy error |
| `git init -b main`, `git add .`, `git commit` | első commit (hash: `git log --oneline`) |

## 5. Ismert hibák és korlátok
Részletek: KNOWN_ISSUES „PHASE 02”.
- **KI-01:** 22 moderate `npm audit` találat a fejlesztői eszközláncban; tudatosan nincs javítva (a `--force` törné az SDK-pineket).
- **KI-03:** npm 12 + `expo install -- --dev` nem ment devDependency-be. Telepítés után mindig nézd meg a `package.json`-t.
- **KI-04:** `ANDROID_HOME` nincs beállítva, a `Path` típusa `REG_SZ`, az `adb` nincs a PATH-ban. Az Expo-t nem akadályozza; a javítás opcionális, a tulajdonos dönt (fázisútmutató 13.2).
- **KI-05:** dev buildhez a JDK-követelmény nincs igazolva (JBR = OpenJDK 25).
- **KI-06:** a sablon nem használt függőségei megmaradtak (PHASE 12).
- **KI-07:** a web nincs tesztelve (PHASE 04A).
- **KI-08:** az SDK 58-as Expo Go store-verziója nincs ellenőrizve (az emulátoron a CLI telepítette).

## 6. Nyitott kérdések
- KI-04: akarja-e a tulajdonos a felhasználói `Path`/`ANDROID_HOME` javítását? Nem blokkoló.
- DP-05 és U-13 változatlanul nyitott (PHASE 04B). A PHASE 03-at nem blokkolják.

## 7. Útmutató a PHASE 03 indításához
1. **Olvasd el:**
   - `CLAUDE.md`, `docs/PROJECT_STATE.md`;
   - `docs/ARCHITECTURE.md` 3. (rétegek, importszabályok), 5., 7. (Result/AppError, DI);
   - `docs/DATA_DICTIONARY.md` (`Metric<T>`, provenance, Security/Listing);
   - `docs/DECISIONS.md` D-003, D-009…D-011, D-014, D-025, D-029…D-034;
   - ez a handoff.
2. **Ellenőrizd az indulóállapotot:** `git status` (tiszta), `npm run check` (zöld), `npm run deps:check`.
3. **Hova kerül az új kód:** `src/domain`, `src/contracts`, `src/application/{ports,use-cases}`, `src/config/container.ts` (composition root), `src/infrastructure/mock` (in-memory repo). Tesztfájl **soha** nem lehet az `src/app` alatt.
4. **Rétegszabályok:**
   - Az `eslint.config.js`-be kerülnek, `no-restricted-imports` (vagy `import/no-restricted-paths`) szabállyal; az `eslint-plugin-import` már elérhető az `eslint-config-expo`-n át, új csomag nem kell.
   - Szándékosan hibás importtal mutasd meg, hogy a szabály működik (ROADMAP PHASE 03).
   - Az `expo lint` csak az `src/` alatt ellenőriz; ez elég.
5. **Zod (D-014):** `npx expo install zod`, majd ellenőrizd, hogy a `dependencies` részbe került (KI-03), és nézd meg a verzió-kompatibilitást. Az `src/config/env.ts` kézi validációja ekkor zodra cserélhető (opcionális).
6. **Meglévő integrációs pontok:**
   - `@/` alias;
   - `noUncheckedIndexedAccess` (indexelésnél `undefined`-ot kezelni kell);
   - `no-floating-promises` (aszinkron use case-eknél minden Promise-t kezelni kell);
   - `getTheme()` / `useTheme()`;
   - `strings` (`src/presentation/strings/hu.ts`).
   - Az `about.tsx` közvetlenül importálja a `publicEnvResult`-ot; a composition root után átköthető Contextre.
7. **Ne építsd meg:** valós API-t, képleteket, proxy-végpontokat vagy képernyőket (ROADMAP PHASE 03 „Nincs benne”).
8. **Lezáráskor:** frissítsd az ARCHITECTURE 3./5. és a DATA_DICTIONARY fejezeteit a tényleges kódhoz, és készítsd el a `phase-03` útmutatót és handoffot.
