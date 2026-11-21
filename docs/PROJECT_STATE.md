# Projektállapot – Stock & ETF Analyzer

> Utolsó frissítés: **2026-11-21**, PHASE 02 vége.

## Cél röviden
Mobilalkalmazás (Expo SDK 58, React Native, TypeScript) részvények, ETF-ek és saját portfólió átlátható, forrásolt, reprodukálható elemzésére. Az AI csak magyaráz. Részletek: [REQUIREMENTS.md](REQUIREMENTS.md).

## Aktuális fázis
- **Lezárt fázis:** PHASE 02 – Expo SDK 58 projekt és fejlesztői környezet (**KÉSZ**). Átadás: [handoffs/phase-02-handoff.md](handoffs/phase-02-handoff.md).
- **Következő fázis:** PHASE 03 – Architektúra és domain modell (prompt: `03_…` a promptcsomagban).

## Készültség

| Terület | Állapot |
|---|---|
| Tervezés (követelmények, architektúra, adatforrások, adatszótár, roadmap) | **Kész** (PHASE 01) |
| Expo projekt | **Kész, fut** – SDK 58, RN 0.88.1, React 19.3.0, TS 6.0.3 strict, Expo Router. Android emulátoron ellenőrizve (Expo Go 58.0.5), világos és sötét módban. |
| Navigáció | Stack: Kezdőlap (`/`), A projektről (`/about`), „nem található”. A tabok a PHASE 12-ben jönnek (D-034). |
| Theme / UI-alap | Világos/sötét paletta, térköz- és betűtokenek, 5 közös komponens, magyar szövegek egy helyen |
| Env-konfiguráció | `.env.example` (titok nélkül), `src/config/env.ts` validált nyilvános env; `.env*` gitignore-olva |
| Lint / formázás / typecheck | **Zöld** (2026-11-21): `npm run check` exit 0 |
| Tesztek | **15/15 zöld** (3 suite): env-parser, theme, navigációs smoke tesztek |
| Expo ellenőrzések | `npx expo install --check`: up to date; `npx expo-doctor@latest`: 20/20 |
| Git | Inicializálva (`main`), első commit kész |
| Domain, számítás, adat, proxy, tárolás | **Nincs** – PHASE 03-tól |
| Adatforrás-kulcsok | Nincsenek; a PHASE 04B-ig nem is kellenek |

Fázisonkénti állapot: [ROADMAP.md](ROADMAP.md).

## A projektmappa tartalma (2026-11-21)
```
stock-etf-analyzer/
├─ CLAUDE.md                 állandó projektutasítások
├─ README.md                 telepítés, indítás, parancsok (kezdőbarát)
├─ app.json, package.json, package-lock.json, tsconfig.json
├─ eslint.config.js, .prettierrc.json, .prettierignore, .gitattributes, .gitignore
├─ .env.example              env-minta, titok nélkül
├─ .vscode/                  ajánlott bővítmények, mentéskori ESLint-javítás
├─ assets/                   ikonok, splash
├─ src/
│  ├─ app/                   _layout.tsx, index.tsx, about.tsx, +not-found.tsx
│  ├─ config/                env.ts (+ teszt)
│  ├─ presentation/
│  │  ├─ components/         Screen, Card, AppText, InfoRow, PrimaryButton
│  │  ├─ theme/              colors, tokens, use-theme, navigation-theme (+ teszt)
│  │  └─ strings/hu.ts
│  └─ __tests__/routes.test.tsx
└─ docs/
   ├─ PROJECT_STATE.md  REQUIREMENTS.md  ARCHITECTURE.md  DECISIONS.md  ROADMAP.md
   ├─ DATA_SOURCES.md  DATA_DICTIONARY.md  KNOWN_ISSUES.md
   ├─ phases/phase-01-requirements-architecture.md, phase-02-project-setup.md
   └─ handoffs/phase-01-handoff.md, phase-02-handoff.md
```

## Fejlesztői környezet (2026-11-21-én ellenőrizve)

| Eszköz | Állapot |
|---|---|
| OS | Windows 11 Pro |
| Node.js | v26.10.0 – az SDK 58 támogatja (22.13+ / 24.3+ / 26+) |
| npm | 12.2.0 (figyelem: `-- --dev` hatástalan, lásd KI-03) |
| Git | 2.56.1; rendszerszinten `core.autocrlf=true` → a repóban `.gitattributes` LF-et kényszerít |
| Android Studio + SDK | telepítve (`%LOCALAPPDATA%\Android\Sdk`; platformok: android-35, 36, 37.0) |
| Android emulátor (AVD) | `Medium_Phone_API_37.0` (API 37) – az app ezen fut |
| Expo Go (emulátoron) | 58.0.5 – az Expo CLI telepítette automatikusan |
| JDK | Android Studio JBR, OpenJDK 25.0.3; `JAVA_HOME` nincs beállítva (csak dev buildhez kell, KI-05) |
| `ANDROID_HOME` | nincs beállítva – **az Expo CLI-nek nem kell** (alapértelmezett SDK-hely). Opcionális javítás: fázisútmutató 13.2 (KI-04) |
| `adb` a PATH-ban | nincs (a `Path` `REG_SZ` típusa miatt a `%ANDROID_HOME%` hivatkozás nem oldódik fel, KI-04) |
| macOS / iOS szimulátor | nincs; iOS csak EAS Builddel (felhőben), Apple fiókkal |

## Fő döntések (összefoglaló)
- D-001 Expo SDK 58 / RN **0.88.1** / React **19.3.0** / TS 6.0.3 strict / Expo Router; Node 26; npm.
- D-003 Clean Architecture-lite, moduláris monolit, kézi DI.
- D-004/D-005 Vékony proxy (Expo Router API routes + EAS Hosting, ideiglenes); a szolgáltató-adapterek a szerveren.
- **D-008** Kizárólag saját használat (DP-02).
- **D-023** Célpiacok: US + Európa (UCITS ETF, részvény) + globális. Free módban a nem US elemzés ár alapú (DP-01).
- **D-024** Adapterek: `sec-edgar`, `ecb-fx`, `openfigi`, `mock` (04A); `fmp`, `eodhd` (04B); ProviderRouter és kvóta-költségvetés (DP-03).
- **D-025** Security (ISIN) és Listing (`symbol@MIC`) szétválasztása (UCITS több listing).
- **D-026** Magyarázat: ingyenes szabályalapú összefoglaló az alap, LLM opcionális (DP-04).
- **D-027** Fizetős adatbővítés nyitva, konfigurációval bekapcsolható (DP-05).
- **D-028** A PHASE 04 két chatben (04A, 04B).
- D-010/D-011 `Metric<T>` státuszokkal, provenance típusok.
- **PHASE 02:**
  - D-029 struktúra (`src/app` + `src/presentation` + `src/config`);
  - D-030 ESLint + Prettier (`--max-warnings 0`, `no-explicit-any`, `no-floating-promises`, `import/order`);
  - D-031 TS-beállítás (`noUncheckedIndexedAccess`, `types: ["jest"]`);
  - D-032 tesztkonvenció;
  - D-033 env-minta;
  - D-034 Stack-navigáció, tabok a PHASE 12-ben.

Teljes lista: [DECISIONS.md](DECISIONS.md).

## A tulajdonos válaszai a döntési pontokra (2026-11-21)

| DP | Válasz |
|---|---|
| DP-01 | US részvények és ETF-ek, európai UCITS ETF-ek és részvények, globális ETF-ek és részvények |
| DP-02 | Csak saját használat |
| DP-03 | FMP és EODHD kulcs megvan; az ajánlott további forrásokhoz is legyen adapter |
| DP-04 | Lehetőleg ingyenes AI, de maradjon más lehetőség |
| DP-05 | Később dönt, ne legyen kizárva |

## Nyitott kérdések
- DP-05 (fizetős adatcsomag): tudatosan nyitott.
- U-13: a meglévő FMP és EODHD kulcs csomagszintje. A PHASE 04B ellenőrzi.
- KI-04 (opcionális): beállítod-e az `ANDROID_HOME`-ot és javítod-e a `Path` típusát (fázisútmutató 13.2)? A fejlesztést nem blokkolja.

Egyik sem blokkolja a PHASE 03-at. Részletek: [KNOWN_ISSUES.md](KNOWN_ISSUES.md).
