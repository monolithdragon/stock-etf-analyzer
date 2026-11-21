# PHASE 02 – Expo SDK 58 projekt és fejlesztői környezet (kezdőbarát útmutató)

> Dátum: 2026-11-21 · Állapot: **KÉSZ** · Előző: [phase-01-requirements-architecture.md](phase-01-requirements-architecture.md) · Átadás: [../handoffs/phase-02-handoff.md](../handoffs/phase-02-handoff.md)

Ez a dokumentum lépésről lépésre leírja, hogyan készült el a projektváz, és hogyan tudod te magad újra elvégezni vagy ellenőrizni. Minden lépésnél megtalálod a célt, a parancsot, azt, hogy **hol** kell futtatni, az elvárt eredményt és a gyakori hibákat.

## Tartalom
0. [Mi készült el, mi nem](#0-mi-készült-el-mi-nem)
1. [Szakszavak röviden](#1-szakszavak-röviden)
2. [Környezet ellenőrzése](#2-környezet-ellenőrzése)
3. [SDK 58 sablon generálása](#3-sdk-58-sablon-generálása)
4. [Fájlok átvétele a projektbe](#4-fájlok-átvétele-a-projektbe)
5. [Függőségek telepítése](#5-függőségek-telepítése)
6. [TypeScript beállítás](#6-typescript-beállítás)
7. [ESLint, Prettier, sorvégek](#7-eslint-prettier-sorvégek)
8. [npm scriptek](#8-npm-scriptek)
9. [Theme, komponensek, navigáció](#9-theme-komponensek-navigáció)
10. [Környezeti változók (env)](#10-környezeti-változók-env)
11. [Tesztek](#11-tesztek)
12. [Ellenőrzések futtatása](#12-ellenőrzések-futtatása)
13. [Indítás Android emulátoron](#13-indítás-android-emulátoron)
14. [Saját telefon és iOS](#14-saját-telefon-és-ios)
15. [Git és az első commit](#15-git-és-az-első-commit)
16. [Gyakori hibák és javításuk](#16-gyakori-hibák-és-javításuk)
17. [Befejezési feltételek](#17-befejezési-feltételek)

---

## 0. Mi készült el, mi nem

**Elkészült:**
- Expo SDK 58 + TypeScript (strict) + Expo Router projekt a meglévő mappában. A `CLAUDE.md` és a `docs/` érintetlen maradt.
- Navigáció: Kezdőlap (`/`), A projektről (`/about`), „nem található” képernyő.
- Világos és sötét téma, közös UI-komponensek, magyar szövegek egy helyen.
- Env-minta (`.env.example`) és validált nyilvános konfiguráció (`src/config/env.ts`).
- ESLint, Prettier, typecheck, Jest (15 teszt), npm scriptek.
- Git repó és első commit.
- Ellenőrizve: az app fut az Android emulátoron (Expo Go 58.0.5), világos és sötét módban is.

**Szándékosan NEM készült el** (későbbi fázisok):
- domainmodellek, rétegszabályok (PHASE 03);
- proxy, API-végpontok, adatszolgáltatók (PHASE 04);
- pénzügyi képletek és képernyők (PHASE 05–12), tárolás (PHASE 13).

---

## 1. Szakszavak röviden

| Szó | Jelentés |
|---|---|
| **Terminál** | Parancssori ablak. Windowson VS Code: *Terminal → New Terminal*, vagy a Start menüből „PowerShell”. |
| **Projekt gyökér** | A `c:\Users\lujzi\Documents\stock-etf-analyzer` mappa, ahol a `package.json` van. **Minden parancsot itt futtass**, hacsak a lépés mást nem ír. |
| **npm** | A Node.js csomagkezelője. Ezzel telepítjük a könyvtárakat és futtatjuk a scripteket (`npm run …`). |
| **Expo SDK 58** | Az Expo keretrendszer egy verziója. Összehangolt csomagverziókat ad (React Native 0.88, React 19.3). |
| **Expo Go** | Telefonos/emulátoros app, amely natív build nélkül futtatja a fejlesztés alatt álló projektet. |
| **Metro** | Az Expo „bundlere”: a TypeScript-kódot egyetlen JavaScript-csomaggá fűzi, és kiszolgálja az appnak. |
| **Expo Router** | Fájlalapú navigáció: az `src/app/` mappa minden fájlja egy képernyő (útvonal). |
| **TypeScript strict** | Szigorú típusellenőrzés, amely sok hibát még futtatás előtt kiszűr. |
| **ESLint** | Kódminőség-ellenőrző (pl. tiltja az `any` típust). |
| **Prettier** | Automatikus kódformázó (szóközök, idézőjelek, sortörés). |
| **Jest** | Tesztfuttató. |
| **Emulátor (AVD)** | Virtuális Android telefon a számítógépen (Android Studio része). |

---

## 2. Környezet ellenőrzése

**Cél:** megbizonyosodni arról, hogy a gépen a megfelelő eszközök vannak.
**Hol:** bármely terminálban.

```powershell
node -v
npm -v
git --version
```

**Elvárt eredmény (2026-11-21-én ezen a gépen):**
```
v26.10.0
12.2.0
git version 2.56.1.windows.1
```

Az Expo SDK 58 a Node.js **22.13+ / 24.3+ / 26+** verziókat támogatja. Páratlan főverzió (23, 25) nem támogatott. Ezt a `package.json` `engines` mezője is rögzíti.

**Gyakori hiba:** `node: command not found` / „nem ismeri fel parancsként”: a Node.js nincs telepítve, vagy a terminált a telepítés előtt nyitottad meg. Telepítsd a https://nodejs.org oldalról (LTS), majd nyiss új terminált.

---

## 3. SDK 58 sablon generálása

**Cél:** hivatalos, SDK 58-hoz illő kiinduló projekt.
**Miért így:**
1. A sima `npx create-expo-app` ekkor még **SDK 57**-es projektet adhat (SDK 58 changelog). Ezért kell az explicit `--template default@sdk-58`.
2. A projektmappa nem üres (`CLAUDE.md`, `docs/`), ezért **ideiglenes mappába** generálunk, és onnan vesszük át a fájlokat.

**Hol:** egy ideiglenes mappában, **nem** a projektgyökérben (pl. `C:\Temp\gen`).

```powershell
mkdir C:\Temp\gen
cd C:\Temp\gen
npx create-expo-app@5.0.0 stock-etf-analyzer --template default@sdk-58 --no-install --no-agents-md
```

- `--no-install`: még nem telepít csomagokat (azt a végleges helyen tesszük).
- `--no-agents-md`: nem generál saját AI-utasításfájlt; nálunk a `CLAUDE.md` az irányadó.

**Elvárt eredmény:** `✅ Your project is ready!`. A generált `package.json`-ban `"expo": "~58.0.26"`, `"react-native": "0.88.1"`, `"react": "19.3.0"`.

**Ellenőrzés:** az npm registry szerint a `expo-template-default` csomag `sdk-58` címkéje 2026-11-21-én `58.0.35`:
```powershell
npm view expo-template-default dist-tags
```

---

## 4. Fájlok átvétele a projektbe

**Cél:** a sablonból csak azt hozzuk át, ami kell. A meglévő fájlokat nem írjuk felül.

| Átvettük | Nem vettük át (és miért) |
|---|---|
| `package.json`, `app.json`, `tsconfig.json`, `.gitignore` (utána módosítva) | `.git/` – saját repót indítunk a projektgyökérben |
| `assets/images/`: `icon.png`, `splash-icon.png`, `favicon.png`, `android-icon-*.png`; `assets/expo.icon/` | demóképek (React/Expo logók, tutorial, tab-ikonok) |
| `.vscode/extensions.json` (bővítve) | `LICENSE` – az Expo sablon licence (650 Industries copyright), a mi privát projektünkre félrevezető volna |
| | `README.md` – sajátot írtunk |
| | `scripts/reset-project.js` – a demót átmozgató script; kezdőként veszélyes, nem kell |
| | `src/` demókód (animált logó, Explore tab, demókomponensek) – helyette saját, minimális váz |

A kódot nem a sablon `src/components`, `src/constants`, `src/hooks` mappáiba tettük, hanem az ARCHITECTURE 5. szerinti **`src/presentation/`** alá (D-029).

---

## 5. Függőségek telepítése

**Hol:** a projektgyökérben.

### 5.1 A sablon csomagjai
```powershell
npm install
```
**Elvárt:** `added … packages`, és nincs `ERR!`. A „moderate severity vulnerabilities” üzenet ismert (KNOWN_ISSUES KI-01). **Ne** futtasd az `npm audit fix --force` parancsot, mert felülírná az SDK 58-hoz pinnelt verziókat.

### 5.2 Fejlesztői eszközök (lint, formázó, teszt)
```powershell
npx expo install eslint eslint-config-expo prettier eslint-config-prettier eslint-plugin-prettier jest-expo jest @types/jest @testing-library/react-native -- --save-dev
```
- Az `npx expo install` az SDK 58-hoz illő verziót választja.
- A `--` utáni rész az npm-nek szól. A PowerShell elfogadja így is; ha mégis gondot okoz, írd idézőjelben: `"--"`.

> ⚠️ **Lelet (2026-11-21, npm 12.2.0):** az Expo dokumentációban szereplő `-- --dev` kapcsoló hatástalan volt, a csomagok a `dependencies` részbe kerültek. `--save-dev`-vel a csomagok egy része sem került át (`jest`, `jest-expo`, `@types/jest`, `eslint-config-expo`). Ezeket kézzel helyeztük át a `devDependencies` részbe, majd `npm install`-t futtattunk. **Telepítés után mindig nézd meg a `package.json`-t.**

**Telepített verziók (ellenőrizve: `npm ls --depth=0`):**

| Csomag | Verzió |
|---|---|
| expo | 58.0.26 |
| expo-router | 58.0.32 |
| react / react-native | 19.3.0 / 0.88.1 |
| typescript | 6.0.3 |
| eslint / eslint-config-expo | 9.39.5 / 58.0.4 |
| prettier | 3.10.1 |
| jest / jest-expo | 30.5.2 / 58.0.15 |
| @testing-library/react-native | 14.1.0 |

> ℹ️ Az npm 12 figyelmeztet: `install scripts blocked … @parcel/watcher`. Ez a Jest fájlfigyelőjének natív modulja. Az előre lefordított Windows-változat (`@parcel/watcher-win32-x64`) települt és betölthető, ezért a tesztek működnek. Teendő nincs (KI-02).

---

## 6. TypeScript beállítás

**Fájl:** `tsconfig.json` (projektgyökér). Teljes, aktuális tartalom:

```json
{
  "extends": "expo/tsconfig.base",
  "compilerOptions": {
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "noFallthroughCasesInSwitch": true,
    "types": ["jest"],
    "paths": {
      "@/*": ["./src/*"],
      "@/assets/*": ["./assets/*"]
    }
  },
  "include": ["**/*.ts", "**/*.tsx", ".expo/types/**/*.ts", "expo-env.d.ts"]
}
```

| Beállítás | Miért |
|---|---|
| `strict` | Szigorú típusellenőrzés (CLAUDE.md). |
| `noUncheckedIndexedAccess` | A `tomb[i]` típusa `T \| undefined`. Pénzügyi kódnál ez kikényszeríti a hiányzó adat kezelését („a hiányzó adat nem nulla”). |
| `noImplicitOverride`, `noFallthroughCasesInSwitch` | Olcsó extra biztonság. |
| `types: ["jest"]` | A **TypeScript 6.0-ban a `types` alapértéke `[]`**, ezért a Jest globálisokat (`describe`, `it`, `expect`) fel kell sorolni. Enélkül a typecheck „Cannot find name 'it'” hibát ad. |
| `paths` `@/*` | Import-alias: `import { strings } from '@/presentation/strings/hu'` a hosszú `../../..` helyett. |

**Import-konvenció:**
- Mappán kívülre mindig a `@/` aliasszal importálj, mappán belül relatív úttal (`./app-text`).
- Sorrend: külső csomagok → `@/` belső → relatív importok, csoportonként üres sorral. Az ESLint `import/order` szabálya ellenőrzi, és `npm run lint:fix` automatikusan rendezi.

---

## 7. ESLint, Prettier, sorvégek

**Fájlok:** `eslint.config.js`, `.prettierrc.json`, `.prettierignore`, `.gitattributes`, `.vscode/settings.json` – mind a projektgyökérben. A teljes tartalom a repóban van; a lényeg:

`eslint.config.js` (ESLint 9 „flat config”, az Expo dokumentáció mintájára):
- alap: `eslint-config-expo/flat` (React, React Native, TypeScript, import szabályok);
- `eslint-plugin-prettier/recommended`: a formázási eltérés lint-hibaként jelenik meg;
- `@typescript-eslint/no-explicit-any: error`: az `any` tiltott (CLAUDE.md);
- `@typescript-eslint/no-floating-promises: error`: az el nem várt `Promise` hiba (típusinformációs lint, `projectService`). Ez a szabály ebben a fázisban valódi tesztszivárgást fogott meg (lásd 11.);
- `import/order`: import-sorrend (6. pont).

`.prettierrc.json`:
```json
{
  "singleQuote": true,
  "printWidth": 100,
  "trailingComma": "all",
  "bracketSameLine": true,
  "endOfLine": "lf"
}
```

`.prettierignore`: a `*.md` fájlokat a Prettier **nem** formázza. A magyar dokumentációt és a táblázatokat kézzel tartjuk karban.

`.gitattributes`: `* text=auto eol=lf`.
**Miért kell:** ezen a gépen a Git rendszerszintű beállítása `core.autocrlf=true` (`C:/Program Files/Git/etc/gitconfig`), ezért checkoutkor Windows-sorvégek (CRLF) keletkeznének, és a Prettier minden sorra „Delete ␍” hibát adna. A `.gitattributes` ezt megelőzi.

**Ellenőrzés:** lásd 12. pont (`npm run lint`, `npm run format:check`).

---

## 8. npm scriptek

**Fájl:** `package.json` → `"scripts"`:

```json
{
  "start": "expo start",
  "android": "expo start --android",
  "ios": "expo start --ios",
  "web": "expo start --web",
  "typecheck": "tsc --noEmit",
  "lint": "expo lint --max-warnings 0",
  "lint:fix": "expo lint --fix",
  "format": "prettier --write .",
  "format:check": "prettier --check .",
  "test": "jest",
  "test:watch": "jest --watch",
  "check": "npm run typecheck && npm run lint && npm run format:check && npm test",
  "doctor": "npx expo-doctor@latest",
  "deps:check": "npx expo install --check"
}
```

- `lint` `--max-warnings 0`-val fut: a figyelmeztetés is hibának számít, így nem halmozódik fel.
- Az `expo lint` alapból csak az `/src`, `/app` és `/components` mappákat ellenőrzi, ezért **minden kód és teszt az `src/` alatt van**.
- `test` egyszer fut (nem figyelő módban), így használható ellenőrzésre; figyelő mód: `test:watch`.

---

## 9. Theme, komponensek, navigáció

**Cél:** működő alapnavigáció, kezdőképernyő és egyszerű, következetes téma, pénzügyi funkciók nélkül.

### 9.1 Fájlok (a teljes, aktuális kód a repóban)

| Fájl | Szerep |
|---|---|
| `src/app/_layout.tsx` | Gyökér layout: `ThemeProvider` + `Stack` navigáció, státuszsor-szín |
| `src/app/index.tsx` | Kezdőlap (`/`): cím, fejlesztési állapot, „A projektről” gomb, jogi nyilatkozat |
| `src/app/about.tsx` | A projektről (`/about`): verzió, Expo SDK, nyilvános konfiguráció, figyelmeztetések, alapelvek |
| `src/app/+not-found.tsx` | Ismeretlen útvonal |
| `src/presentation/theme/colors.ts` | Világos/sötét paletta szemantikus tokenekkel (`background`, `surface`, `text`, `primary`, `positive`, `negative` …) |
| `src/presentation/theme/tokens.ts` | Térközök, lekerekítések, betűstílusok |
| `src/presentation/theme/use-theme.ts` | `getTheme()` (tiszta függvény) és `useTheme()` hook (a rendszer világos/sötét beállítását követi) |
| `src/presentation/theme/navigation-theme.ts` | A navigáció fejléc- és háttérszínei a saját témából |
| `src/presentation/components/*` | `Screen`, `Card`, `AppText`, `InfoRow`, `PrimaryButton` |
| `src/presentation/strings/hu.ts` | Minden magyar UI-szöveg egy helyen (D-019) |

### 9.2 Szabályok
- Az **`src/app/` mappában minden fájl route** (képernyő). Komponenst, segédfüggvényt vagy tesztet **ne** tegyél ide.
- Komponensben ne írj közvetlen színt vagy szöveget: `useTheme().colors.*` és `strings.*`.
- A tabos főnavigáció (dashboard, portfólió, watchlist, beállítások) a PHASE 12 feladata. Most egyszerű `Stack` van.

### 9.3 Lelet: `<Link asChild>` és a gomb stílusa
Az emulátoron az „A projektről” gombnak eleinte nem volt kék háttere. **Ok:** a `<Link asChild>` a saját `style`-ját tömbként egyesíti a gyerekével, a `Pressable` függvény formájú `style`-ját (`({ pressed }) => …`) pedig ebben a tömbben a React Native figyelmen kívül hagyja. **Javítás:** a `PrimaryButton` statikus style-objektumot használ, a lenyomás-visszajelzés a gyerek render-propban és Android ripple-lel történik. Regressziós teszt: `src/__tests__/routes.test.tsx`.

---

## 10. Környezeti változók (env)

**Cél:** minta a konfigurációhoz úgy, hogy titok ne kerüljön a kódba vagy a gitbe.

### 10.1 Fájlok
- `.env.example` – **csak minta, üres értékekkel**. Ez kerül gitbe.
- `.env.local` – ide írod a valódi értékeket (PHASE 04B-től: API-kulcsok). **Nem** kerül gitbe.
- `.gitignore`:
  ```
  .env*
  !.env.example
  ```

### 10.2 Ha szükséged van rá (a PHASE 02-höz nem kell)
**Hol:** projektgyökér, PowerShell:
```powershell
Copy-Item .env.example .env.local
```
Utána nyisd meg a `.env.local`-t VS Code-ban, és töltsd ki. A változás csak az `npm start` újraindítása után érvényes.

### 10.3 Kliens vs szerver változók
| Előtag | Hol olvasható | Titok lehet? |
|---|---|---|
| `EXPO_PUBLIC_*` | az appban (kliens) | **NEM** – plain-textként bekerül az appba |
| minden más (pl. `FMP_API_KEY`) | csak a proxy szerveren (PHASE 04-től) | igen |

### 10.4 `src/config/env.ts`
- `parsePublicEnv()` tiszta függvény: validálja az `EXPO_PUBLIC_DATA_MODE` (`mock` | `live`, alapértelmezés `mock`) és az `EXPO_PUBLIC_API_BASE_URL` (http/https URL) értékét.
- Hibás értéknél **nem nyeli el csendben a hibát**: `issues` listát ad, amelyet az „A projektről” képernyő figyelmeztetésként megjelenít.
- Az Expo csak a `process.env.EXPO_PUBLIC_VALAMI` alakú, statikus hozzáférést helyettesíti be. `process.env[nev]` vagy destrukturálás nem működik.
- A zod-alapú validáció a PHASE 03-ban jön (D-014). Addig ez kézi és tesztelt.

**Ellenőrzés:** `git check-ignore -v .env.local` → kiírja a `.gitignore` szabályt (vagyis ignorált). Lásd 15.

---

## 11. Tesztek

**Beállítás:** a `package.json`-ban `"jest": { "preset": "jest-expo" }`. Az SDK 58-hoz Jest 30 kell, a Router-tesztekhez RNTL ≥ 14.

**Konvenció (D-032):**
- Unit teszt a forrás mellett: `valami.test.ts` (pl. `src/config/env.test.ts`).
- Navigációs/képernyő teszt: `src/__tests__/` – **soha** nem az `src/app/` alatt (ott route lenne belőle).

**Tesztfájlok (15 teszt):**

| Fájl | Mit ellenőriz |
|---|---|
| `src/config/env.test.ts` (7) | alapértelmezés, üres érték = hiányzó, érvényes live konfiguráció, helyi IP:port, ismeretlen mód → hiba, érvénytelen URL-ek, live URL nélkül → hiba |
| `src/presentation/theme/theme.test.ts` (3) | a két paletta tokenkészlete azonos, érvényes hex színek, `getTheme` |
| `src/__tests__/routes.test.tsx` (5) | `/` renderel (cím, „nincs pénzügyi adat”, jogi nyilatkozat); a gomb `/about`-ra navigál; a gomb megtartja a háttérszínét (regresszió); `/about` mock módot és „nincs megadva” URL-t mutat, figyelmeztetés nélkül; ismeretlen útvonal → „nem található” |

> ⚠️ **Lelet – RNTL 14:** a `render`/`fireEvent` **aszinkron** (Promise-t ad vissza), ezért `await fireEvent.press(…)` kell. `await` nélkül „overlapping act() calls” hiba jön, és a *következő* tesztek véletlenszerűen elbuknak. Ezt a `no-floating-promises` lint-szabály most már automatikusan jelzi.
>
> A `<Link asChild>` a gyerekre `role="link"`-et tesz, ezért a tesztben `getByRole('link', …)` kell, nem `'button'`.

---

## 12. Ellenőrzések futtatása

**Hol:** projektgyökér. A ténylegesen futtatott parancsok és eredményük (2026-11-21):

| # | Parancs | Elvárt / tényleges eredmény |
|---|---|---|
| 1 | `npm run typecheck` | nincs kimenet a script fejlécén túl, **exit 0** ✅ (az első `expo start` előtt és után is) |
| 2 | `npm run lint` | nincs hibalista, **exit 0** ✅ |
| 3 | `npm run format:check` | `All matched files use Prettier code style!` ✅ |
| 4 | `npm test` | `Test Suites: 3 passed, 3 total` · `Tests: 15 passed, 15 total` ✅ |
| 5 | `npm run check` | az 1–4 egyben, **exit 0** ✅ |
| 6 | `npx expo install --check` | `Dependencies are up to date` ✅ |
| 7 | `npx expo-doctor@latest` | `20/20 checks passed. No issues detected!` ✅ |

**Negatív próba a lint-szabályokra:** egy ideiglenes fájl el nem várt Promise-szal és `any` típussal pontosan 2 hibát adott (`no-floating-promises`, `no-explicit-any`). A fájlt utána töröltük.

---

## 13. Indítás Android emulátoron

**Előfeltétel:** Android Studio, Android SDK (`%LOCALAPPDATA%\Android\Sdk`), AVD `Medium_Phone_API_37.0`.

### 13.1 Lépések
1. **Emulátor indítása:** Android Studio → *Device Manager* → `Medium_Phone_API_37.0` → ▶. Várd meg az Android kezdőképernyőt.
   (Terminálból is indítható: `& "$env:LOCALAPPDATA\Android\Sdk\emulator\emulator.exe" -avd Medium_Phone_API_37.0`.)
2. **App indítása** (projektgyökér):
   ```powershell
   npm run android
   ```
3. **Elvárt kimenet** (ténylegesen ezt kaptuk):
   ```
   Using src/app as the root directory for Expo Router.
   React Compiler enabled
   Starting Metro Bundler
   › Opening exp://<gép-IP>:8081 … on Medium_Phone_API_37.0
   - Fetching Expo Go
   - Installing Expo Go on Medium_Phone_API_37.0
   Android Bundled 10450ms node_modules\expo-router\entry.js (1465 modules)
   ```
   Az első futáskor az Expo CLI automatikusan letölti és telepíti az SDK 58-hoz illő **Expo Go 58.0.5**-öt. Store-ból nem kell telepíteni.
4. **Elvárt képernyő:** „Kezdőlap” fejléc, „Stock & ETF Analyzer” cím, „Fejlesztési állapot” kártya, **kék** „A projektről” gomb, alatta a jogi nyilatkozat. A gomb megnyomására megjelenik „A projektről” képernyő (Alkalmazás 0.1.0, Expo SDK 58.0.0, Adatmód: mock, Proxy URL: nincs megadva).
5. Sötét mód: ha az emulátor sötét módra vált (Beállítások → Kijelző → Sötét téma), az app is sötét lesz. Ezt ellenőriztük.

### 13.2 `ANDROID_HOME` és `adb` – kell-e?
- Az **Expo CLI-nek nem kell**: `ANDROID_HOME` nélkül az alapértelmezett helyen (`%USERPROFILE%\AppData\Local\Android\Sdk`) keresi az SDK-t. Így futott nálunk is.
- Az `adb` parancs kényelmes a terminálból (eszközlista, képernyőkép), és később a development buildhez az `ANDROID_HOME` is kell.

**Lelet ezen a gépen:** a felhasználói `Path` már tartalmazza a `%ANDROID_HOME%\platform-tools`, `%ANDROID_HOME%\emulator` és `%JAVA_HOME%\bin` bejegyzéseket, de:
1. az `ANDROID_HOME` és a `JAVA_HOME` nincs definiálva;
2. a felhasználói `Path` típusa a registryben `REG_SZ`, nem `REG_EXPAND_SZ`. Emiatt a `%…%` hivatkozások **akkor sem oldódnának fel**, ha a változók léteznének.

**Javítás (opcionális, a gép felhasználói beállítását módosítja – a PHASE 02-ben NEM futtattuk, a te döntésed):**
PowerShellben (nem kell rendszergazda):
```powershell
# 0) Biztonsági mentés a jelenlegi felhasználói Path-ról
(Get-Item 'HKCU:\Environment').GetValue('Path', $null, 'DoNotExpandEnvironmentNames') | Out-File "$HOME\path-backup.txt"

# 1) ANDROID_HOME beállítása
[Environment]::SetEnvironmentVariable('ANDROID_HOME', "$env:LOCALAPPDATA\Android\Sdk", 'User')

# 2) A Path típusának javítása REG_EXPAND_SZ-re (a tartalom változatlan marad)
$p = (Get-Item 'HKCU:\Environment').GetValue('Path', $null, 'DoNotExpandEnvironmentNames')
Set-ItemProperty -Path 'HKCU:\Environment' -Name Path -Value $p -Type ExpandString
```
Utána **zárd be és nyisd újra a VS Code-ot** (vagy jelentkezz ki és be), majd új terminálban:
```powershell
adb version
adb devices
```
Elvárt: `Android Debug Bridge version …`, és futó emulátornál `emulator-5554  device`.
Visszaállítás: a `path-backup.txt` tartalmát visszaírhatod ugyanígy.
A `JAVA_HOME` csak development buildhez kell (`npx expo run:android`). Ennek JDK-követelményét akkor ellenőrizzük (KI-05).

---

## 14. Saját telefon és iOS

### Android telefon
1. Telepítsd az **Expo Go**-t a Play Store-ból. Az Expo Go-nak **SDK 58-at kell támogatnia**. Az SDK 58 changelogja (2026-10-15) szerint a store-verzió „a következő hetekben” jelenik meg; 2026-11-21-én a store-állapotot nem ellenőriztük (KI-08).
2. A gép és a telefon legyen ugyanazon a Wi-Fi-n.
3. `npm start` → olvasd be a QR-kódot az Expo Go-val.
4. Ha az Expo Go „incompatible SDK” hibát ír: a store-verzió még nem SDK 58-as. Ilyenkor USB-kábellel és bekapcsolt USB-hibakereséssel az `npm run android` maga telepíti az SDK 58-as Expo Go-t (az `adb`-nek látnia kell a telefont), vagy maradj az emulátornál.

### iOS
- **iOS szimulátorhoz macOS + Xcode kell.** Windows alatt nem futtatható.
- iPhone-on: App Store-os Expo Go (ha már SDK 58-as) + `npm start` + QR-kód a Kamera appal.
- Telepíthető iOS build Windows alól csak felhőben (EAS Build), **fizetős Apple Developer fiókkal**. Ez a PHASE 16 témája.

---

## 15. Git és az első commit

**Hol:** projektgyökér.

```powershell
git init -b main
git add .
git status
```
**Ellenőrizd a `git status` listájában:** nincs benne `node_modules/`, `.expo/`, `.env.local` vagy más `.env` fájl, csak a `.env.example`.

```powershell
git check-ignore -v .env.local
```
Elvárt: `.gitignore:…:.env*	.env.local` (vagyis ignorált).

```powershell
git commit -m "chore: PHASE 02 – Expo SDK 58 projektváz"
git log --oneline
```
Elvárt: egy commit a listában.

**Gyakori hiba:** `Please tell me who you are` → `git config --global user.name "Neved"` és `git config --global user.email "email@cimed"`, majd újra commit.

---

## 16. Gyakori hibák és javításuk

| Tünet | Ok | Javítás |
|---|---|---|
| `npm run typecheck`: „Cannot find name 'it' / 'describe'” | TS 6.0: `types` alapértéke `[]` | `tsconfig.json` → `"types": ["jest"]` (már benne van) |
| Prettier: „Delete ␍” minden sorban | CRLF sorvégek (Windows autocrlf) | `.gitattributes` (benne van); egyszeri javítás: `npm run format` |
| „overlapping act() calls”, véletlenszerűen bukó tesztek | RNTL 14 aszinkron `fireEvent`/`render` `await` nélkül | `await fireEvent.press(...)`; a lint jelzi |
| Gomb háttér nélkül `<Link asChild>`-ban | függvény formájú `style` a `Pressable`-ön | statikus style (lásd 9.3) |
| Fejlesztői csomag a `dependencies`-ben | npm 12: `-- --dev` hatástalan | `-- --save-dev`, és ellenőrizd a `package.json`-t |
| `Failed to resolve the Android SDK path` | az SDK nem az alapértelmezett helyen van | állítsd be az `ANDROID_HOME`-ot (13.2) |
| `No Android connected device found` | nem fut emulátor | indítsd el az emulátort (13.1/1), utána `npm run android` |
| Expo Go „incompatible SDK version” | régi Expo Go | emulátoron az `npm run android` maga frissíti; telefonon lásd 14. |
| Új `.env.local` érték nem látszik | a Metro induláskor olvassa be | állítsd le (`Ctrl+C`), majd `npm start` újra; szükség esetén `npx expo start -c` (cache törlés) |
| `npm run lint` hibát ad formázásra | Prettier-eltérés | `npm run lint:fix` vagy `npm run format` |
| A tesztfájl route-ként jelenik meg | a tesztfájl az `src/app/` alatt van | tedd az `src/__tests__/` mappába |

---

## 17. Befejezési feltételek

| Feltétel | Állapot |
|---|---|
| Expo SDK 58 + TS + Expo Router projekt | ✅ |
| Node és függőségverziók az SDK 58 alapján ellenőrizve | ✅ (`expo install --check`, `expo-doctor` 20/20) |
| TS strict, lint, formázó, import-konvenció | ✅ |
| Alapnavigáció, kezdőképernyő, theme | ✅ (emulátoron is ellenőrizve, világos és sötét mód) |
| Env-minta, titok nélkül; `.env*` ignorálva | ✅ |
| npm scriptek: start, typecheck, lint, test | ✅ (+ format, check, doctor, deps:check) |
| Android indítás dokumentálva; iOS korlátok leírva | ✅ |
| Ellenőrzések lefutottak, hibák javítva | ✅ (lásd 12.) |
| Nem készült el későbbi üzleti funkció | ✅ |
| Git + első commit | ✅ (lásd handoff) |
| Fázisdokumentáció + handoff | ✅ |
