# Projektállapot – Stock & ETF Analyzer

> Utolsó frissítés: **2026-11-21**, PHASE 03 vége.

## Cél röviden
Mobilalkalmazás (Expo SDK 58, React Native, TypeScript) részvények, ETF-ek és saját portfólió átlátható, forrásolt, reprodukálható elemzésére. Az AI csak magyaráz. Részletek: [REQUIREMENTS.md](REQUIREMENTS.md).

## Aktuális fázis
- **Lezárt fázis:** PHASE 03 – Architektúra, domain modellek és alkalmazási rétegek (**KÉSZ**). Átadás: [handoffs/phase-03-handoff.md](handoffs/phase-03-handoff.md).
- **Következő fázis:** PHASE 04A – Proxy váz és ingyenes alapforrások (prompt: `04_ADATFORRASOK_ES_DEVIZA.md`, első chat; D-028).

## Készültség

| Terület | Állapot |
|---|---|
| Tervezés (követelmények, architektúra, adatforrások, adatszótár, roadmap) | **Kész** (PHASE 01) |
| Expo projekt | **Kész, fut** – SDK 58, RN 0.88.1, React 19.3.0, TS 6.0.3 strict, Expo Router. Android emulátoron ellenőrizve (Expo Go 58.0.5), világos és sötét módban. |
| Navigáció | Stack: Kezdőlap (`/`), A projektről (`/about`), „nem található”. A tabok a PHASE 12-ben jönnek (D-034). |
| Theme / UI-alap | Világos/sötét paletta, térköz- és betűtokenek, 5 közös komponens, magyar szövegek egy helyen |
| Env-konfiguráció | `.env.example` (titok nélkül), `src/config/env.ts` validált nyilvános env; `.env*` gitignore-olva |
| Domain modell | **Kész** (PHASE 03): `Instrument` (Stock \| Etf), `Listing`, `Quote`, `PriceSeries`, `FinancialStatement` (3 változat), `FinancialMetric`, `FxRate`, `Portfolio`, `Transaction` (5 típus), `Position` (típus), `AnalysisResult`, `DataProvenance`, `Metric<T>`, `Result`/`AppError`; validált konstruktorok |
| Rétegek | **Kész**: `src/domain`, `src/contracts` (zod 4.6.7), `src/application` (4 port, 2 use case), `src/infrastructure` (mock, memóriabeli tároló, rendszeróra), `src/config/container.ts` (composition root), `AppServicesProvider` |
| Rétegszabályok | **Kikényszerítve** ESLinttel (`import/no-restricted-paths`, `no-restricted-imports`, `no-restricted-globals` → nincs `fetch` a képernyőkben); szándékos hibákkal igazolva |
| Lint / formázás / typecheck | **Zöld** (2026-11-21): `npm run check` exit 0 |
| Tesztek | **98/98 zöld** (9 suite): domain, contracts, use case-ek, composition root, DI-hook, env, theme, navigáció |
| Expo ellenőrzések | `npx expo install --check`: up to date (PHASE 03); `npx expo export --platform android`: bundle OK (PHASE 03); `npx expo-doctor@latest`: 20/20 (PHASE 03) |
| Git | `main`; a PHASE 03 változásai commitra várnak (a tulajdonos dönt a commitról) |
| Számítás, valós adat, proxy, tárolás | **Nincs** – PHASE 04A (adat/proxy), 05 (képletek), 13 (SQLite) |
| Adatforrás-kulcsok | Nincsenek; a PHASE 04B-ig nem is kellenek |

Fázisonkénti állapot: [ROADMAP.md](ROADMAP.md).

## A projektmappa tartalma (2026-11-21, PHASE 03 vége)
```
stock-etf-analyzer/
├─ CLAUDE.md                 állandó projektutasítások
├─ README.md                 telepítés, indítás, parancsok (kezdőbarát)
├─ app.json, package.json, package-lock.json, tsconfig.json
├─ eslint.config.js          ESLint + Prettier + RÉTEGSZABÁLYOK (PHASE 03)
├─ jest.config.js            Jest (jest-expo), kanonikus útvonallal (D-041)
├─ .prettierrc.json, .prettierignore, .gitattributes, .gitignore, .env.example
├─ .vscode/, assets/
├─ src/
│  ├─ app/                   _layout.tsx (AppServicesProvider), index, about, +not-found
│  ├─ domain/                tiszta TS: shared/, instrument/, market/, fundamentals/, fx/, portfolio/, analysis/
│  ├─ contracts/             zod sémák, quote DTO, API-boríték
│  ├─ application/           ports/, use-cases/ (get-listing-quote, record-transaction)
│  ├─ infrastructure/        system/, mock/, api-client/ (live helyőrző)
│  ├─ config/                env.ts, container.ts (composition root)
│  ├─ presentation/          components/, theme/, strings/, di/
│  └─ __tests__/routes.test.tsx
└─ docs/
   ├─ PROJECT_STATE.md  REQUIREMENTS.md  ARCHITECTURE.md  DECISIONS.md  ROADMAP.md
   ├─ DATA_SOURCES.md  DATA_DICTIONARY.md  KNOWN_ISSUES.md
   ├─ phases/phase-01…, phase-02…, phase-03-architecture-domain-model.md
   └─ handoffs/phase-01…, phase-02…, phase-03-handoff.md
```
Rétegek és adatút: [ARCHITECTURE.md](ARCHITECTURE.md) 3., 4.4, 5.

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
- **PHASE 03:**
  - D-035 domain-konvenciók (diszkriminált uniók, branded típusok, smart constructorok, `null` vs `Metric`; Security = `Instrument`);
  - D-036 `Result`/`AppError`;
  - D-037 negyedév 80–100 nap;
  - D-038 rétegszabályok ESLinttel;
  - D-039 zod 4.6.7, validációs munkamegosztás;
  - D-040 csak használt portok, függvény-factory DI;
  - D-041 `jest.config.js` kanonikus útvonallal (Windows).

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

Egyik sem blokkolja a PHASE 04A-t. A PHASE 04A-hoz kulcs nem kell, csak a SEC User-Agent kapcsolattartó (a tulajdonos írja a `.env.local`-ba). Részletek: [KNOWN_ISSUES.md](KNOWN_ISSUES.md).
