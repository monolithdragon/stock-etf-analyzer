# Projektállapot – Stock & ETF Analyzer

> Utolsó frissítés: **2026-11-21**, PHASE 04B vége (a teljes PHASE 04 lezárva).

## Cél röviden
Mobilalkalmazás (Expo SDK 58, React Native, TypeScript) részvények, ETF-ek és saját portfólió átlátható, forrásolt, reprodukálható elemzésére. Az AI csak magyaráz. Részletek: [REQUIREMENTS.md](REQUIREMENTS.md).

## Aktuális fázis
- **Lezárt fázis:** PHASE 04 – Adatforrások, proxy és deviza (**KÉSZ**: 04A + 04B). Átadás: [handoffs/phase-04-handoff.md](handoffs/phase-04-handoff.md) (a 04A részletei: [handoffs/phase-04a-handoff.md](handoffs/phase-04a-handoff.md)). Útmutató: [phases/phase-04-data-sources-currency.md](phases/phase-04-data-sources-currency.md).
- **Következő:** PHASE 05 – Pénzügyi calculation engine (prompt: `05_…`). Élő adatforrást nem igényel.

## Készültség

| Terület | Állapot |
|---|---|
| Tervezés | **Kész** (PHASE 01); a 04A/04B-ben a valós adatokhoz igazítva |
| Expo projekt | **Kész, fut** – SDK 58, RN 0.88.1, React 19.3.0, TS 6.0.3 strict, Expo Router. Emulátoron utoljára a PHASE 02-ben futott (KI-12). |
| Navigáció / UI | Stack: Kezdőlap, A projektről, „nem található”. A PHASE 04-ben nincs UI-változás; a képernyők a PHASE 12-ben jönnek. |
| Domain modell | **Kész** (PHASE 03) + 04A (`ListingCandidate`, `FinancialStatementSet`, `FxConversion`…) + **04B**: `PriceAdjustment`, `DividendHistory`, `InstrumentProfile`, `InstrumentSearchResult`, `UNAVAILABLE` hibafajta |
| Rétegek | domain → contracts → application → infrastructure / server → config → presentation; ESLint-tel kikényszerítve |
| **Proxy** | **Kész, lokálisan élő adattal igazolva**: 10 API route (`health`, `providers/status`, `fx`, `search`, `securities/{isin}/listings`, `stocks/{id}/financials`, `instruments/{id}/quote`, `/prices`, `/profile`, `/dividends`); `ProviderRouter` fallbackkel; kvóta-őr; csomagmátrix env-ből |
| **Adatforrások** | **Élő, igazolt**: `sec-edgar` (US kimutatások), `ecb-fx` (FX), `openfigi` (ISIN → jegyzések), **`fmp`** (US ár, ártörténet, profil, osztalék, keresés), **`eodhd`** (ár, ártörténet 1 év, osztalék, keresés, ISIN → jegyzések pénznemmel; US + 6 európai tőzsde); `mock` (demó). **Free-ben nem elérhető**: ETF-metaadat/holdings, nem US profil és kimutatás → `UNAVAILABLE / PLAN_LIMIT` |
| **FX** | **Kész** (04A): natív és kijelzési pénznem külön, ráta + dátum + forrás, elavult rátánál hiba |
| Kliens adatelérés | `mock` mód: demó gateway-ek; `live` mód: proxy gateway-ek (`EXPO_PUBLIC_API_BASE_URL`); 04B: +4 use case (`getPriceHistory`, `getInstrumentProfile`, `getDividendHistory`, `searchInstruments`) |
| Lint / formázás / typecheck | **Zöld** (2026-11-21): `npm run check` exit 0 |
| Tesztek | **337/337 zöld** (25 suite). Élő API-t teszt nem hív: valós, megvágott fixture-ök (12 SEC-cég, ECB, OpenFIGI, **FMP 10, EODHD 21 fájl**) + hamis `fetch` |
| Expo ellenőrzések (04B) | élő füstpróba (saját dev szerver, 8083); `expo export` web: 10 API route; Android: Hermes bundle **szerverkód és titok nélkül** (szkennelve) |
| Biztonság (04B) | Kulcs csak szerver env-ben; repó-szkenner (220 fájl): 0 találat; válasz, napló és env-figyelmeztetés kulcsmentes (teszt) |
| Számítás, tárolás, cache | **Nincs** – PHASE 05 (képletek), 13 (SQLite, proxy cache) |
| Git | branch `phase-04a`; a PHASE 04B változásai commitra várnak (a tulajdonos dönt) |

Fázisonkénti állapot: [ROADMAP.md](ROADMAP.md).

## A projektmappa tartalma (2026-11-21, PHASE 04B vége)
```
stock-etf-analyzer/
├─ CLAUDE.md, README.md, app.json, package.json, tsconfig.json, jest.config.js
├─ eslint.config.js          ESLint + Prettier + RÉTEGSZABÁLYOK
├─ .env.example              minta (04B: FMP_PLAN, EODHD_PLAN magyarázattal); a valódi értékek: .env.local (gitignore)
├─ scripts/record-sec-fixtures.mjs   SEC fixture-rögzítő (D-047)
├─ src/
│  ├─ app/                   képernyők + api/v1/**/+api.ts (10 proxy-route, vékonyak)
│  ├─ domain/                tiszta TS (04B: market/dividend.ts, instrument/instrument-profile.ts, instrument-search.ts)
│  ├─ contracts/             zod (04B: market.ts, search.ts, provider-status.ts)
│  ├─ application/           portok + use case-ek (04B: get-market-data.ts)
│  ├─ infrastructure/        api-client/ (proxy kliens + gateway-ek), mock/, system/
│  ├─ server/                CSAK SZERVER: env, server-context, http/, handlers/,
│  │                         providers/ (sec-edgar, ecb-fx, openfigi, fmp, eodhd, mock + __fixtures__),
│  │                         routing/ (provider-router, plans, quota, markets), logging, testing/
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
| Node.js | v26.10.0; npm 12.2.0 (KI-03) |
| Git | 2.56.1; `.gitattributes` LF-et kényszerít |
| Android Studio + emulátor | `Medium_Phone_API_37.0`, Expo Go 58.0.5 (PHASE 02) |
| `.env.local` | **létezik**: `SEC_USER_AGENT`, `FMP_API_KEY`, `EODHD_API_KEY`, `FMP_PLAN=free`, `EODHD_PLAN=free` (értékvakon ellenőrizve); gitignore-olt |
| Futó dev szerverek | a 8081-es (valószínűleg a tulajdonosé) és egy 8082-es folyamat **régi szerverkóddal** fut → újraindítandó (KI-41, KI-27) |
| Szolgáltatói keret 2026-11-21 | EODHD: a napi 20 hívás a fázis próbáin elfogyott (+ néhány bónuszhívás); UTC éjfélkor nullázódik (KI-32) |

## Fő döntések (összefoglaló)
- D-001 Expo SDK 58 / RN 0.88.1 / React 19.3.0 / TS 6.0.3 strict / Expo Router; Node 26; npm.
- D-003 Clean Architecture-lite; D-004 vékony proxy (Expo Router API routes; EAS Hosting – **Ideiglenes**); D-005 adapterek a szerveren.
- D-008 csak saját használat; D-023 US + Európa + globális; D-024 adapterek és routing; D-025 Security/Listing; D-027 fizetős bővítés nyitva; D-028 PHASE 04 két részben.
- PHASE 02: D-029…D-034. PHASE 03: D-035…D-041. PHASE 04A: D-042…D-048.
- **PHASE 04B:**
  - D-049 `ProviderRouter`, véglegesített routing-tábla, fallback-szabályok; SEC csak US (nem US kimutatás: `PLAN_LIMIT`);
  - D-050 ártörténet-korrekció explicit fajtával (`NONE` | `SPLIT` | `SPLIT_DIVIDEND`);
  - D-051 csomagmátrix env-ből, napi kvóta prioritással (keresés ≤ 75%);
  - D-052 jegyzés-pénznem: helyszíni szabály (US → USD, Xetra → EUR) vagy EODHD kereső, soha nem kitalálva;
  - D-053 `UNAVAILABLE` hibafajta + `unavailableReason` a szerződésben; 402 → kvóta (EODHD) / csomag (FMP);
  - D-054 új domain-típusok és végpontok; szerverkontextus a `globalThis`-en.

Teljes lista: [DECISIONS.md](DECISIONS.md).

## A tulajdonos válaszai a döntési pontokra (2026-11-21)

| DP | Válasz |
|---|---|
| DP-01 | US részvények és ETF-ek, európai UCITS ETF-ek és részvények, globális ETF-ek és részvények |
| DP-02 | Csak saját használat |
| DP-03 | FMP és EODHD kulcs megvan (04B: mindkettő **free**); az ajánlott további forrásokhoz is legyen adapter |
| DP-04 | Lehetőleg ingyenes AI, de maradjon más lehetőség |
| DP-05 | Később dönt, ne legyen kizárva (fizetős csomag: env-váltással bekapcsolható, D-051) |
| (04A) | A SEC User-Agent kapcsolattartó e-mailjét a tulajdonos a `.env.local`-ba írta |

## Nyitott kérdések
- **Commit:** a PHASE 04B változásai nincsenek commitolva (a tulajdonos dönt). Javasolt üzenet a handoffban.
- **EAS Hosting próbatelepítés** (D-004, KI-29): legkésőbb a PHASE 16 előtt; Expo-fiók kell.
- **FMP keret és ToS** (KI-39): a tulajdonos ellenőrizze az FMP-fiók dashboardján (a hivatalos oldal 403).
- DP-05 (fizetős adatcsomag): tudatosan nyitott. Nem US fundamentumhoz és ETF-metaadathoz kellene.
- KI-04 (opcionális): `ANDROID_HOME` / `Path` javítása.

Egyik sem blokkolja a PHASE 05-öt. Részletek: [KNOWN_ISSUES.md](KNOWN_ISSUES.md).
