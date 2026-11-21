# Projektállapot – Stock & ETF Analyzer

> Utolsó frissítés: **2026-11-21**, PHASE 04A vége.

## Cél röviden
Mobilalkalmazás (Expo SDK 58, React Native, TypeScript) részvények, ETF-ek és saját portfólió átlátható, forrásolt, reprodukálható elemzésére. Az AI csak magyaráz. Részletek: [REQUIREMENTS.md](REQUIREMENTS.md).

## Aktuális fázis
- **Lezárt rész:** PHASE 04A – Proxy váz és ingyenes alapforrások (**KÉSZ**). Átadás: [handoffs/phase-04a-handoff.md](handoffs/phase-04a-handoff.md). Útmutató: [phases/phase-04-data-sources-currency.md](phases/phase-04-data-sources-currency.md).
- **Következő:** PHASE 04B – FMP, EODHD, routing és kvóta (ugyanaz a prompt: `04_ADATFORRASOK_ES_DEVIZA.md`, a chat elejére: „PHASE 04B rész, a 04A kész, lásd `docs/handoffs/phase-04a-handoff.md`”; D-028). A teljes PHASE 04 a 04B végén zárul (`docs/handoffs/phase-04-handoff.md`).

## Készültség

| Terület | Állapot |
|---|---|
| Tervezés (követelmények, architektúra, adatforrások, adatszótár, roadmap) | **Kész** (PHASE 01); a 04A-ban a valós adatokhoz igazítva |
| Expo projekt | **Kész, fut** – SDK 58, RN 0.88.1, React 19.3.0, TS 6.0.3 strict, Expo Router. Emulátoron utoljára a PHASE 02-ben futott (KI-12). |
| Navigáció / UI | Stack: Kezdőlap, A projektről, „nem található”. A 04A-ban nincs UI-változás; a képernyők a PHASE 12-ben jönnek. |
| Domain modell | **Kész** (PHASE 03) + 04A: `ListingCandidate`, `SecurityListings`, `FinancialStatementSet`, `FxRateSet`, `FxConversion`, `deriveFxRate`, `convertMoney`; `GBp` → `GBX` |
| Rétegek | domain → contracts → application → infrastructure / **server** → config → presentation; ESLint-tel kikényszerítve (04A: új zónák `src/server`, `src/config`, `src/app/api/**`; szándékos hibákkal igazolva) |
| **Proxy (04A)** | **Kész, lokálisan igazolva**: 5 API route (`/api/v1/health`, `/fx`, `/securities/{isin}/listings`, `/stocks/{id}/financials`, `/instruments/{id}/quote`); hosztfüggetlen handlerek; kimenet-önellenőrzés; `PROXY_DATA_MODE` live XOR mock |
| **Adatforrások (04A)** | **Élő, igazolt**: `sec-edgar` (US jelentett kimutatások), `ecb-fx` (ECB-ráták), `openfigi` (ISIN → jegyzések); `mock` (demó). **Nincs még**: árfolyam, ártörténet, profil, osztalék, ETF-adat → PHASE 04B (FMP, EODHD) / 08 |
| **FX (04A)** | **Kész**: `FxGateway` + `convertMoney` (FxService): natív és kijelzési pénznem külön, ráta + dátum + forrás a kimenetben, EUR-on át számolt keresztárfolyam, GBX /100, elavult rátánál hiba (nincs becslés) |
| Kliens adatelérés | `mock` mód: demó gateway-ek (`kind: 'mock'`); `live` mód: proxy gateway-ek (`EXPO_PUBLIC_API_BASE_URL`); URL nélkül őszinte hiba |
| Lint / formázás / typecheck | **Zöld** (2026-11-21): `npm run check` exit 0 |
| Tesztek | **228/228 zöld** (19 suite). Élő API-t teszt nem hív: valós, megvágott fixture-ök (12 SEC-cég, ECB, OpenFIGI) + hamis `fetch`; végponttól végpontig integrációs teszt (kliens ↔ szerver, hálózat nélkül) |
| Expo ellenőrzések (04A) | `npx expo install --check`: up to date; `npx expo export --platform web`: szerver-bundle 5 route-tal OK; `--platform android`: Hermes bundle OK, **szerverkód és titok nélkül** (szkennelve) |
| Biztonság (04A) | Titok csak szerver env-ben; a repóban nincs `.env.local`-érték (szkennelve, 159 fájl); a napló és a health-válasz nem tartalmaz User-Agentet vagy kulcsot |
| Számítás, tárolás, cache | **Nincs** – PHASE 05 (képletek), 13 (SQLite, proxy cache) |
| Git | `main`; a PHASE 04A változásai commitra várnak (a tulajdonos dönt) |

Fázisonkénti állapot: [ROADMAP.md](ROADMAP.md).

## A projektmappa tartalma (2026-11-21, PHASE 04A vége)
```
stock-etf-analyzer/
├─ CLAUDE.md, README.md, app.json, package.json, tsconfig.json, jest.config.js
├─ eslint.config.js          ESLint + Prettier + RÉTEGSZABÁLYOK (04A: server/config/api zónák)
├─ .env.example              minta (04A: PROXY_DATA_MODE); a valódi értékek: .env.local (gitignore)
├─ scripts/record-sec-fixtures.mjs   SEC fixture-rögzítő (fejlesztői eszköz, D-047)
├─ src/
│  ├─ app/                   képernyők + api/v1/**/+api.ts (proxy-route-ok, vékonyak)
│  ├─ domain/                tiszta TS (+ listing-candidate, financial-statement-set, fx-conversion)
│  ├─ contracts/             zod: quote, fx, listings, financials, health, API-boríték
│  ├─ application/           portok (Clock, IdGenerator, MarketDataGateway, FxGateway, PortfolioRepository),
│  │                         use case-ek (getListingQuote, getSecurityListings, getFinancialStatements,
│  │                         convertMoney, recordTransaction)
│  ├─ infrastructure/        api-client/ (proxy kliens + gateway-ek), mock/, system/
│  ├─ server/                CSAK SZERVER: env, server-context, http/, handlers/, providers/
│  │                         (sec-edgar, ecb-fx, openfigi, mock + __fixtures__), logging, testing/
│  ├─ config/                env.ts, container.ts (kliens composition root)
│  ├─ presentation/          components/, theme/, strings/, di/
│  └─ __tests__/             routes.test.tsx, proxy-integration.test.ts
└─ docs/                     PROJECT_STATE, REQUIREMENTS, ARCHITECTURE, DECISIONS, ROADMAP,
                             DATA_SOURCES, DATA_DICTIONARY, KNOWN_ISSUES, phases/, handoffs/
```

## Fejlesztői környezet (2026-11-21)

| Eszköz | Állapot |
|---|---|
| OS | Windows 11 Pro |
| Node.js | v26.10.0 (SDK 58: 22.13+ / 24.3+ / 26+); a rögzítő script a Node 26 TS type-strippingjét használja |
| npm | 12.2.0 (KI-03) |
| Git | 2.56.1; `.gitattributes` LF-et kényszerít |
| Android Studio + emulátor | `Medium_Phone_API_37.0`, Expo Go 58.0.5 (PHASE 02) |
| `.env.local` | **létezik** (a tulajdonos hozta létre a 04A-ban), benne a `SEC_USER_AGENT`; gitignore-olt |
| Futó dev szerver | a spike idején a 8081-es porton már futott egy Expo dev szerver → env-változás után újraindítandó (KI-17) |

## Fő döntések (összefoglaló)
- D-001 Expo SDK 58 / RN 0.88.1 / React 19.3.0 / TS 6.0.3 strict / Expo Router; Node 26; npm.
- D-003 Clean Architecture-lite; D-004 vékony proxy (Expo Router API routes; EAS Hosting – **Ideiglenes**, spike: lokálisan igazolva, nincs KV/rate-limit primitív, secret helyett „sensitive”); D-005 adapterek a szerveren.
- D-008 csak saját használat; D-023 US + Európa + globális; D-024 adapterek és routing; D-025 Security/Listing; D-027 fizetős bővítés nyitva; D-028 PHASE 04 két részben (**Elfogadva**).
- PHASE 02: D-029…D-034. PHASE 03: D-035…D-041.
- **PHASE 04A:**
  - D-042 `ListingCandidate` (pénznem nullable), csak igazolt exchCode → MIC, üzemeltetői MIC;
  - D-043 SEC-normalizálás (domináns pénznem, saját filing címkéje, restatement, tag-prioritás valós adaton, totalDebt MISSING);
  - D-044 proxy hibamodell (`AppError`, `CAPABILITY_UNAVAILABLE`), kimenet-önellenőrzés, `no-store`;
  - D-045 `PROXY_DATA_MODE` live XOR mock;
  - D-046 FX: EUR-pivot, keresztárfolyam a domainben, elavultság-szabály, GBp → GBX;
  - D-047 valós, megvágott fixture-ök + rögzítő script;
  - D-048 kimutatás-frissesség `[FELTÉTELEZÉS]`.

Teljes lista: [DECISIONS.md](DECISIONS.md).

## A tulajdonos válaszai a döntési pontokra (2026-11-21)

| DP | Válasz |
|---|---|
| DP-01 | US részvények és ETF-ek, európai UCITS ETF-ek és részvények, globális ETF-ek és részvények |
| DP-02 | Csak saját használat |
| DP-03 | FMP és EODHD kulcs megvan; az ajánlott további forrásokhoz is legyen adapter |
| DP-04 | Lehetőleg ingyenes AI, de maradjon más lehetőség |
| DP-05 | Később dönt, ne legyen kizárva |
| (04A) | A SEC User-Agent kapcsolattartó e-mailjét a tulajdonos a `.env.local`-ba írta; a fixture-rögzítéshez a használatát engedélyezte |

## Nyitott kérdések
- **Commit:** a PHASE 04A változásai nincsenek commitolva (a tulajdonos dönt).
- **EAS Hosting próbatelepítés** (D-004, KI-29): kell-e már a 04B-ben, vagy a PHASE 16-ig elég a lokális proxy? Expo-fiók kell hozzá.
- U-13: az FMP és EODHD kulcs csomagszintje – a PHASE 04B ellenőrzi.
- DP-05 (fizetős adatcsomag): tudatosan nyitott.
- KI-04 (opcionális): `ANDROID_HOME` / `Path` javítása.

Egyik sem blokkolja a PHASE 04B-t. A 04B elején a tulajdonos az FMP és EODHD kulcsot a `.env.local`-ba írja (nem a chatbe), majd újraindítja a dev szervert. Részletek: [KNOWN_ISSUES.md](KNOWN_ISSUES.md).
