# Projektállapot – Stock & ETF Analyzer

> Utolsó frissítés: **2026-11-22**, PHASE 08 vége.

## Cél röviden
Mobilalkalmazás (Expo SDK 58, React Native, TypeScript) részvények, ETF-ek és saját portfólió átlátható, forrásolt, reprodukálható elemzésére. Az AI csak magyaráz. Részletek: [REQUIREMENTS.md](REQUIREMENTS.md).

## Aktuális fázis
- **Lezárt fázis:** PHASE 08 – ETF-elemzés (**KÉSZ**). Átadás: [handoffs/phase-08-handoff.md](handoffs/phase-08-handoff.md). Útmutató: [phases/phase-08-etf-analysis.md](phases/phase-08-etf-analysis.md).
- **Előző:** PHASE 07 – Értékelés és DCF – [handoffs/phase-07-handoff.md](handoffs/phase-07-handoff.md).
- **Következő:** PHASE 09 – Portfólió és kockázat (prompt: `09_…`). Építhet a PHASE 08 `risk.ts` függvényeire és a 04A FX-rétegére.

## Készültség

| Terület | Állapot |
|---|---|
| Tervezés | **Kész** (PHASE 01); a 04A/04B-ben a valós adatokhoz igazítva |
| Expo projekt | **Kész, fut** – SDK 58, RN 0.88.1, React 19.3.0, TS 6.0.3 strict, Expo Router. Emulátoron utoljára a PHASE 02-ben futott (KI-12). |
| Navigáció / UI | Stack: Kezdőlap, A projektről, „nem található”. A PHASE 04-ben nincs UI-változás; a képernyők a PHASE 12-ben jönnek. |
| Domain modell | **Kész** (PHASE 03) + 04A/04B + 06 + **08: `domain/etf/` (`EtfProfile`, `EtfClassification`, `EtfHoldingsSnapshot`)**; 06: `analysis/stock-fundamentals.ts` (`MetricOrigin`, `FundamentalMetric`, `StockOverview`, kimutatás- és mutatótáblák, `TrendSeries`, `QualityAnalysis`, `QualitativeFinding`, `StockDataQuality`); `InstrumentProfile.beta` |
| Rétegek | domain → contracts → application → infrastructure / server → config → presentation; ESLint-tel kikényszerítve |
| **Proxy** | **Kész, lokálisan élő adattal igazolva**: 10 API route (`health`, `providers/status`, `fx`, `search`, `securities/{isin}/listings`, `stocks/{id}/financials`, `instruments/{id}/quote`, `/prices`, `/profile`, `/dividends`); `ProviderRouter` fallbackkel; kvóta-őr; csomagmátrix env-ből |
| **Adatforrások** | **Élő, igazolt**: `sec-edgar` (US kimutatások), `ecb-fx` (FX), `openfigi` (ISIN → jegyzések), **`fmp`** (US ár, ártörténet, profil, osztalék, keresés), **`eodhd`** (ár, ártörténet 1 év, osztalék, keresés, ISIN → jegyzések pénznemmel; US + 6 európai tőzsde); `mock` (demó). **Free-ben nem elérhető**: ETF-metaadat/holdings, nem US profil és kimutatás → `UNAVAILABLE / PLAN_LIMIT` |
| **FX** | **Kész** (04A): natív és kijelzési pénznem külön, ráta + dátum + forrás, elavult rátánál hiba |
| Kliens adatelérés | `mock` mód: demó gateway-ek; `live` mód: proxy gateway-ek (`EXPO_PUBLIC_API_BASE_URL`); 04B: +4 use case; 06: `analyzeStockFundamentals` (részleges hibatűréssel); 07: `analyzeStockValuation`, `recalculateStockValuation`; **08: `analyzeEtf`** |
| Lint / formázás / typecheck | **Zöld** (2026-11-22, PHASE 08 vége): `npm run check` exit 0 |
| Tesztek | **927/927 zöld** (59 suite; PHASE 08: +144, ebből D-070: +4; PHASE 07: +122). PHASE 08: új modulok ~99% sor (motor 100%). PHASE 07: új DCF-motor 100% sor, új alkalmazási modulok ~97% sor. Lefedettség: `src/calculations` + új PHASE 06 modulok ~97–98% sor. Élő API-t teszt nem hív: valós, megvágott fixture-ök (12 SEC-cég – 06: adósság-tagekkel bővítve –, ECB, OpenFIGI, FMP 10, EODHD 21 fájl) + hamis `fetch` |
| Expo ellenőrzések (04B) | élő füstpróba (saját dev szerver, 8083); `expo export` web: 10 API route; Android: Hermes bundle **szerverkód és titok nélkül** (szkennelve) |
| Biztonság (04B) | Kulcs csak szerver env-ben; repó-szkenner (220 fájl): 0 találat; válasz, napló és env-figyelmeztetés kulcsmentes (teszt) |
| **Számítási motor** | **Kész** (PHASE 05, D-055…D-058) + 06: `priceRange` (52 hetes tartomány). Az első fogyasztó (PHASE 06 use case) elkészült. |
| **Fundamentális elemzés** | **Kész** (PHASE 06, D-059…D-063): `totalDebt` összerakva (KI-42 megoldva); éves/negyedéves kimutatás-nézetek, Q4, TTM; időszaki mutatók; 1/3/5/10 éves CAGR összehasonlíthatósági ellenőrzéssel; értékelés (ár + legutóbbi FY); minőségi modell pontszám nélkül. UI nincs (PHASE 12). |
| **Értékelés és DCF** | **Kész** (PHASE 07, D-064, D-065): `runDcf` (explicit PV, Gordon TV `r > g`-vel, EV, equity, IV/részvény, MOS), Bear/Base/Bull, szenzitivitási tábla ugyanazzal az engine-nel, konfigurálható küszöbök, Forward P/E (csak forrásból; ma `MISSING`), magyarázható kimenet. Kiinduló feltevések általánosak, felülírhatók (KI-58). UI nincs (PHASE 12). |
| **ETF-elemzés** | **Kész** (PHASE 08, D-066…D-069): `analyzeEtf`; jegyzés-szintű profil mezőnkénti lefedettséggel; price vs total return (acc/dist módszer, összehasonlítási alap); volatilitás, max DD, downside dev., Sharpe/Sortino (rf-fel), béta és tracking (TR indexsorral); TER-költség; holdings (top N, HHI, ország/szektor/deviza); hedged vs. mögöttes devizakockázat; feature-modell súlyozás nélkül; P/E/DCF `notApplicable`. **Free korlát:** ETF-metaadat és holdings csak kézi bevitelből (KI-65); SEC N-PORT igazolt, adapter nincs (KI-66). UI nincs (PHASE 12). |
| Tárolás, cache | **Nincs** – PHASE 13 (SQLite, proxy cache) |
| Git | `main`-en a PHASE 07 merge (`3fc0258`); a PHASE 08 a **`phase-08`** branchen **commitolva** (`10bf075`); merge a `main`-be: PR-rel (a tulajdonos dönt) |

Fázisonkénti állapot: [ROADMAP.md](ROADMAP.md).

## A projektmappa tartalma (2026-11-22, PHASE 08 vége)
```
stock-etf-analyzer/
├─ CLAUDE.md, README.md, app.json, package.json, tsconfig.json, jest.config.js
├─ eslint.config.js          ESLint + Prettier + RÉTEGSZABÁLYOK
├─ .env.example              minta (04B: FMP_PLAN, EODHD_PLAN magyarázattal); a valódi értékek: .env.local (gitignore)
├─ scripts/record-sec-fixtures.mjs   SEC fixture-rögzítő (D-047; 06: --add-new-tags mód)
├─ src/
│  ├─ app/                   képernyők + api/v1/**/+api.ts (10 proxy-route, vékonyak)
│  ├─ domain/                tiszta TS (04B: market/, instrument/; 06: analysis/stock-fundamentals.ts; 08: etf/)
│  ├─ calculations/          PHASE 05: tiszta képletek – core/, fundamentals/, valuation/ (07: dcf, dcf-scenarios, valuation-bands), returns/ (06: price-range; 08: risk), etf/ (08: holdings, exposure), portfolio/, definitions.ts
│  ├─ contracts/             zod (04B: market.ts, search.ts, provider-status.ts)
│  ├─ application/           portok + use case-ek (06: analyze-stock-fundamentals.ts; 07: analyze-stock-valuation.ts) + stock-analysis/ (06) + valuation/ (07: DCF-bemenet, feltevések, összerakás) + etf-analysis/ (08) + shared/ (08)
│  ├─ testing/               07: CSAK tesztekhez – közös valós-fixture beállítás (stock-analysis-fixtures.ts)
│  ├─ infrastructure/        api-client/ (proxy kliens + gateway-ek), mock/, system/
│  ├─ server/                CSAK SZERVER: env, server-context, http/, handlers/,
│  │                         providers/ (sec-edgar [06: sec-debt.ts], ecb-fx, openfigi, fmp, eodhd, mock + __fixtures__),
│  │                         routing/ (provider-router, plans, quota, markets), logging, testing/
│  ├─ config/                env.ts, container.ts (kliens composition root)
│  ├─ presentation/          components/, theme/, strings/, di/
│  └─ __tests__/             routes, proxy-integration, calculations-purity (07: + UI-ban nincs DCF), stock-fundamentals-integration (06), stock-valuation-integration (07), etf-analysis-integration + etf-stock-separation (08)
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
- **PHASE 05:**
  - D-055 számítási motor: szám-szintű képletek (`CalcResult`) + `Metric`-adapter, rétegszabály;
  - D-056 véglegesített fundamentális definíciók (N/M negatív nevezőnél, EPS-sorrend, NOPAT-kulcs csak explicit tartalékkal, ROE „bármely nevező ≤ 0” szabály, DOL 1%-os küszöb, EV-egyszerűsítés, TTM osztalék);
  - D-057 DCF-konvenciók (év végi diszkontálás, `r > g`);
  - D-058 hozam-, ETF- és portfólió-konvenciók (365,25 nap, effektív havi ráta, TER-közelítés, tracking error periódusszám).
- **PHASE 06:**
  - D-059 `totalDebt` lejárat szerinti bontásból (nincs dupla számolás; hiányzó rövid komponens → `estimated`; bank/IFRS → `MISSING`);
  - D-060 időszakok: oszlopok, Q4 = FY − (Q1+Q2+Q3), TTM, frissesség-továbbadás, YoY negyedéves növekedés;
  - D-061 CAGR-feltételek (pénznem, év vége ±7 nap, split-gyanú 1,5×), 52 hetes tartomány záróárakból;
  - D-062 értékelés: aktuális ár + legutóbbi FY + legfrissebb mérleg; szolgáltatói béta; pénznem-őr;
  - D-063 minőségi modell pontszám nélkül, MOAT/MANAGEMENT csak forrásolt lelettel; `MetricOrigin`.
- **PHASE 07:**
  - D-064 DCF-motor (5 év alapeset, 1–10; `r ≤ g` → `INVALID_INPUT` magyarázattal; FCF ≤ 0 → `NOT_MEANINGFUL`; hiányzó adósság/pénz → `MISSING`), bemeneti modell forrással és felülírással, kiinduló Bear/Base/Bull feltevések, szenzitivitás ugyanazzal az engine-nel, megjelenítési javaslat; a D-022 véglegesítve;
  - D-065 konfigurálható értékelési küszöbök (nem objektív igazság), Forward P/E csak forrásból, TTM-szorzó elvetve (KI-52), FX a PHASE 09-be (KI-50), EV-egyszerűsítés marad (KI-44).

- **PHASE 08:**
  - D-066 kockázati konvenciók (egyszerű napi hozam, √252, minta szórás, downside dev. N = összes, rf nélkül nincs Sharpe/Sortino, béta közös dátumokon, min. 126 napi hozam);
  - D-067 holdings-modell (nem normalizált súly, részleges/teljes, top N feltétele, HHI csak teljes listán, régió-levezetés küszöbökkel);
  - D-068 deviza-fogalmak (jegyzési ≠ alap ≠ mögöttes; hedged = teljes fedezés feltevése; kijelzési deviza csak megjelenítés);
  - D-069 ETF use case (különválasztás őrteszttel, kézi metaadat validálva, total return módszer-sorrend, tracking csak TR indexszel, feature-modell súlyozás nélkül, N-PORT adapter elhalasztva).

- **PHASE 08 utáni tulajdonosi döntések:** D-070 megbízhatósági címke (`standard` ≥ 240, `short_window` 126–239 napi hozam); D-071 holdings-fájl import a N-PORT adapter helyett.

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
- **Commit:** a PHASE 08 commitolva a `phase-08` branchen (`10bf075`); a `main`-be merge PR-rel, a tulajdonos döntése szerint.
- **Ellentmondás-javítás:** a PHASE 07 handoff „commit nélkül” állapotot írt, de a PHASE 07 már commitolva és a `main`-be merge-ölve volt (`aee88fc`, merge `3fc0258`).
- **Eldöntve (2026-11-22):** D-070 kockázati megbízhatósági címke (megvalósítva); D-071 N-PORT adapter helyett kibocsátói holdings-fájl import (PHASE 13, KI-74).
- **EAS Hosting próbatelepítés** (D-004, KI-29): legkésőbb a PHASE 16 előtt; Expo-fiók kell.
- **FMP keret és ToS** (KI-39): a tulajdonos ellenőrizze az FMP-fiók dashboardján (a hivatalos oldal 403).
- DP-05 (fizetős adatcsomag): tudatosan nyitott. Nem US fundamentumhoz és ETF-metaadathoz kellene.
- KI-04 (opcionális): `ANDROID_HOME` / `Path` javítása.

Egyik sem blokkolja a PHASE 08-at. Részletek: [KNOWN_ISSUES.md](KNOWN_ISSUES.md).
