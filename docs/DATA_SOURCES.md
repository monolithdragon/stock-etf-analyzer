# Adatforrások – Stock & ETF Analyzer

> Ellenőrzés dátuma: **2026-11-21** (PHASE 01; a SEC, az ECB/Frankfurter és az OpenFIGI a **PHASE 04A-ban**, az **FMP és az EODHD a PHASE 04B-ben** élő próbahívásokkal ellenőrizve, lásd 10. és 11. fejezet; a **SEC N-PORT a PHASE 08-ban, 2026-11-22**, lásd 13. fejezet; az **AI-szolgáltatók a PHASE 11-ben, 2026-11-23**, lásd 14. fejezet). Az ingyenes keretek és feltételek gyakran változnak.
> Kapcsolódó döntések: D-023 (lefedettség), D-024 (adapterek, routing), D-025 (Security/Listing), D-027 (fizetős bővítés nyitva), D-008 (csak saját használat).

## 1. Jelölések

| Jelölés | Jelentés |
|---|---|
| `[IGAZOLT]` | A szolgáltató hivatalos oldalán ellenőrizve 2026-11-21-én. |
| `[HARMADIK FÉL]` | A hivatalos oldal nem volt olvasható (JS-render, 403, PDF), harmadik fél összefoglalója alapján. **Nem szabad rá véglegesen építeni.** |
| `[NEM IGAZOLT]` | Nem sikerült ellenőrizni. Ellenőrizendő, addig nem ígérhető. |
| `[FELTÉTELEZÉS]` | Tervezési alapértelmezés, felülvizsgálandó. |

## 2. Mire kell adat? (igények)

A célpiacok: **US, Európa (UCITS ETF-ek és részvények), globális ETF-ek és részvények** (DP-01 válasz, D-023).

| Igény | Melyik funkcióhoz | Kritikus? |
|---|---|---|
| Keresés és azonosítás (ticker, MIC, ISIN, CIK); egy ETF/részvény összes listingje | UF-01 | igen |
| Legutóbbi ár (késleltetett/EOD elég) | UF-02/03/05 | igen |
| Napi ártörténet (split-korrigált és nyers) | hozam, kockázat, ETF, DCF ár | igen |
| Éves (és negyedéves) pénzügyi kimutatások | UF-02, DCF | igen (részvény) |
| Részvényszám (outstanding, hígított súlyozott) | market cap, EPS, DCF | igen |
| Osztalék, split | hozam, osztalékhozam, split-kezelés | közepes |
| ETF metaadat (TER, AUM, benchmark, replikáció, kibocsátó, domicil, dist/acc) | UF-03 | közepes |
| ETF holdings, ország- és szektorsúly | koncentráció, look-through | alacsony az MVP-ben |
| FX (HUF, EUR, USD, GBP, CHF, JPY és a globális listingek devizái) | portfólió, kijelzési pénznem | igen |
| Kockázatmentes hozam (Sharpe) | kockázati mutatók | alacsony |

## 3. Összehasonlító táblázat

| Szolgáltató | Kulcs | Ingyenes keret | Lefedettség (free) | Fundamentumok | Historikus | ETF holdings | FX | Késleltetés | Licenc / kereskedelmi | Státusz | Adapter? |
|---|---|---|---|---|---|---|---|---|---|---|---|
| **SEC EDGAR** (data.sec.gov) | nem kell | nincs kvóta, max **10 kérés/mp**, User-Agent deklaráció kötelező | US SEC-filerek (10-K, 10-Q, 8-K, 20-F, 40-F, 6-K) | **igen**: XBRL companyfacts/companyconcept/frames, csak standard taxonómiák | a filingek idejétől | nem | nem | XBRL API ~1 percen belül | US szövetségi kormányzati adat, általában közkincs `[FELTÉTELEZÉS – jogilag nem ellenőrizve]` | `[IGAZOLT]` | **IGEN** |
| **ECB referencia-árfolyam** | nem kell | – | ~30 deviza EUR ellen, köztük HUF, USD, GBP, CHF, JPY | – | hosszú | – | **igen** | naponta ~16:00 CET, munkanapokon | „csak tájékoztató célra” | `[IGAZOLT]` | **IGEN** (Frankfurteren át) |
| **Frankfurter v2** | nem kell | „nincs kvóta”, visszaélés elleni rate limit | 219 deviza, 112 forrás. Alapból blended, ECB közvetlenül: `/v2/providers/ecb/rates` | – | napi, 1948-tól | – | **igen** | naponta egyszer vagy néhányszor | nyílt forráskódú; közvetlen providerre a provider feltételei vonatkoznak | `[IGAZOLT]` | **IGEN** (az ECB-adapter szállítója) |
| **OpenFIGI** | opcionális | kulcs nélkül 25 kérés/perc (10 job/kérés), kulccsal 250/perc (100 job/kérés) | globális azonosító-leképezés (ID_ISIN támogatott, válaszban ticker és exchCode) | – | – | – | – | – | ingyenes; ToS `[NEM IGAZOLT]` | `[IGAZOLT]` (limitek) | **IGEN** |
| **EODHD** (kulcs megvan, **free**) | kell | Free: **20 hívás/nap** (+ egyszeri bónusz), 1 év történet | globális EOD: részvény, ETF, forex, index | **free-ben NINCS** (élő próba: HTTP 403 „Only EOD data allowed for free users”) | free: 1 év (élő próba); fizetős: 30+ év | nincs (fundamentum-csomag kellene) | EOD | live: 15–20 perc késleltetés | személyes használat: tárolás/elemzés igen, továbbadás/megjelenítés másnak nem | `[IGAZOLT]` (04B élő) | **IGEN – kész** |
| **Financial Modeling Prep** (kulcs megvan, **free**) | kell | Basic: 250 hívás/nap `[HARMADIK FÉL]` | **csak US, annak is egy része** (élő próba: `SAP.DE`, `VWCE.DE`, `BRK-B` → 402) | nem vizsgált (a SEC adja) | free-ben is mély (2010 igazolva) | **nincs** (`etf/info`, `etf/holdings` → 402) | nem vizsgált | nem közölt | „personal use” `[HARMADIK FÉL]` (ToS-oldal 403) | képességek `[IGAZOLT]` (04B élő), keret/ToS `[HARMADIK FÉL]` | **IGEN – kész** |
| Tiingo | kell | Starter $0: 50 kérés/óra, 1 000/nap, 500 egyedi ticker/hó | `[NEM IGAZOLT]` (US EOD várható) | free: 5 év, fizetős kiegészítő | 30+ év | `[NEM IGAZOLT]` | `[NEM IGAZOLT]` | EOD | „Internal Use Only”: csak saját használat | `[IGAZOLT]` (keret, licenc) | most nem (4. fejezet) |
| Finnhub | kell | ~60 hívás/perc | US valós idejű quote | „basic fundamentals” | candles prémium | prémium | igen | valós idejű (US) | „personal use only” | `[HARMADIK FÉL]` | nem |
| Twelve Data | kell | Basic $0: 8 kredit/perc, 800/nap | valós idejű US részvény/ETF, forex | free: nincs | – | nincs | igen | valós idejű (US) | **Basic: „Internal non-display usage”** | `[IGAZOLT]` | nem |
| Alpha Vantage | kell | **25 kérés/nap** | – | `[NEM IGAZOLT]` | – | `[NEM IGAZOLT]` | – | – | ToS `[NEM IGAZOLT]`; prémium $49.99/hó-tól | `[IGAZOLT]` (keret) | nem |
| Massive | kell | free stocks csomag az oldalon **nem látszott** | – | „Financials & Ratios” $29/hó | Stocks Advanced $199/hó | – | – | – | „Individual use only” | `[IGAZOLT]` | nem |
| MNB árfolyamok | – | – | hivatalos HUF árfolyamok | – | – | – | igen | – | – | `[NEM IGAZOLT]` | később opcionális |
| SEC N-PORT | nem kell (User-Agent) | SEC fair access | US-regisztrált alapok (UCITS NEM) | – | – | **teljes lista, negyedéves, ~60 nap késés; súly, ország, ISIN, deviza – szektor nincs** | – | – | nyilvános SEC-adat | `[IGAZOLT]` (PHASE 08 élő, 13.2) | adapter nem készül (D-071); helyette kibocsátói fájl-import (KI-74) |

### 3.1 EODHD hívásköltségek és korlátok `[IGAZOLT]` (https://eodhd.com/financial-apis/api-limits)

| Kérés típusa | Költség (API hívás) |
|---|---|
| End-of-Day, Splits, Dividends | 1 / kérés |
| Live (delayed) | 1 / szimbólum |
| Search, Exchanges List, Exchange Symbol List, Calendar | 1 |
| Intraday, Technical, News, Screener | 5 |
| Fundamental Data, Options, Macro, Insider | 10 |
| Bulk (teljes tőzsde) | 100; szimbólumlistával 100 + N |
| `/api/user` (csomag és felhasználás lekérdezése) | **0** |

További tények:
- A napi keret éjfélkor (GMT) nullázódik. Elfogyásakor a válasz **HTTP 402**. Sikertelen kérés nem számít bele.
- Percenként legfeljebb 1 000 kérés; túllépéskor **HTTP 429**.
- A `filter` paraméter nem csökkenti a költséget.
- **Következmény a free csomagra:** bulk nem fér bele (100 > 20). Fundamentumból legfeljebb 2 kérés/nap, és az elérhetősége sem igazolt.

**Források:**
- SEC EDGAR API: https://www.sec.gov/search-filings/edgar-application-programming-interfaces
- SEC fair access: https://www.sec.gov/about/webmaster-frequently-asked-questions
- ECB: https://www.ecb.europa.eu/stats/policy_and_exchange_rates/euro_reference_exchange_rates/html/index.en.html
- Frankfurter: https://frankfurter.dev/
- OpenFIGI: https://www.openfigi.com/api/documentation
- EODHD: https://eodhd.com/pricing, https://eodhd.com/financial-apis/api-limits
- FMP (403): https://site.financialmodelingprep.com/developer/docs/pricing, https://site.financialmodelingprep.com/pricing-plans
- Tiingo: https://www.tiingo.com/about/pricing
- Finnhub: https://finnhub.io/pricing
- Twelve Data: https://twelvedata.com/pricing
- Alpha Vantage: https://www.alphavantage.co/premium/
- Massive: https://massive.com/pricing

## 4. Kizárt vagy most nem integrált források

| Forrás | Döntés | Indok |
|---|---|---|
| Yahoo Finance (nem hivatalos végpontok) | **Tilos** | Nincs hivatalos nyilvános API; ellentétes a CLAUDE.md 8. szabályával. |
| Kibocsátói weboldalak scrape-elése | **Tilos** | ToS-kockázat; csak kifejezett engedéllyel. |
| Több API-kulcs egy szolgáltatónál a keret megkerülésére | **Tilos** | CLAUDE.md 8. |
| Twelve Data Basic | Nem | „Internal non-display usage”, vagyis UI-ban nem jeleníthető meg. |
| Tiingo | Most nem | Csak US-t fed le; az FMP és az EODHD ezt lefedi. **Hozzáadható**, ha az FMP US-kerete kevésnek bizonyul (az adapter-minta miatt olcsó). |
| Finnhub | Most nem | A free-ben az ártörténet prémium, az ETF holdings prémium `[HARMADIK FÉL]`. |
| Alpha Vantage | Most nem | 25 kérés/nap, ez kevés. |
| Massive | Most nem | Nincs látható free stocks csomag. |

## 5. Elfogadott stratégia (D-023, D-024)

### 5.1 Adapterek (a PHASE 04 készíti el, D-028 szerint két részletben)

| # | Adapter | Szerep | Kulcs | Rész |
|---|---|---|---|---|
| 1 | `sec-edgar` | US **jelentett** fundamentumok, ticker → CIK | nem (User-Agent kell) | 04A ✅ kész |
| 2 | `ecb-fx` (Frankfurter v2 ECB provider) | FX | nem | 04A ✅ kész |
| 3 | `openfigi` | ISIN ↔ ticker/tőzsde; egy ETF összes listingje | opcionális | 04A ✅ kész |
| 4 | `mock` | determinisztikus teszt- és demóadat (`kind: mock`) | – | 04A ✅ kész |
| 5 | `fmp` | US ár, ártörténet (3 korrekció), profil, osztalék, szöveges keresés | **igen** (megvan) | 04B ✅ kész |
| 6 | `eodhd` | késleltetett ár, EOD ártörténet, osztalék, keresés (ISIN is), ISIN → jegyzések pénznemmel | **igen** (megvan) | 04B ✅ kész |
| – | `ProviderRouter` + kvóta-költségvetés + csomagmátrix | képesség × piac szerinti választás és fallback (D-049, D-051) | – | 04B ✅ kész |

### 5.2 Routing tábla (**véglegesítve a PHASE 04B-ben**, D-049; kód: `src/server/routing/provider-router.ts`)

| Képesség | US | Európa (UCITS ETF, részvény) | Globális |
|---|---|---|---|
| Keresés (piactól független) | szöveg: `fmp` → `eodhd`; ISIN: `eodhd` (az FMP ISIN-keresése free-ben 402) | ua. | ua. |
| Listingek egy ISIN-hez (piactól független) | `openfigi` → `eodhd` (az EODHD pénznemet is ad) | ua. | ua. |
| Legutóbbi ár | `fmp` → `eodhd` | `eodhd` | `eodhd` (csak az igazolt tőzsdék: lásd 11.2) |
| Napi ártörténet | `fmp` → `eodhd` | `eodhd` (free: 1 év, levágás + megjegyzés) | ua. |
| Osztalék | `fmp` → `eodhd` | `eodhd` | `eodhd` |
| Split | **nincs bekötve** (az FMP `splits` végpontja free-ben működik – későbbi bővítés) | – | – |
| Profil | `fmp` | **`UNAVAILABLE` (PLAN_LIMIT)** | ua. |
| Pénzügyi kimutatások | `sec-edgar` (csak US: ticker-ütközés elleni védelem) | **`UNAVAILABLE` (PLAN_LIMIT)**; fizetős EODHD Fundamentals kellene | ua. |
| ETF metaadat | **`UNAVAILABLE` (PLAN_LIMIT)** – FMP `etf/info` 402, EODHD fundamentals 403; **kézi bevitel kész (PHASE 08, `EtfMetadataInput`)** | ua. | ua. |
| ETF holdings | **`UNAVAILABLE` (PLAN_LIMIT)**; kézi pillanatkép kész (PHASE 08); SEC N-PORT igazolt, adapter nincs (KI-66) | ua. (N-PORT: UCITS-ra nem) | ua. |
| FX | `ecb-fx` | `ecb-fx` | `ecb-fx`; ami nincs az ECB listán → `MISSING` |

### 5.3 Routing-szabályok
1. **Egy adatsor = egy forrás.** Egy kimutatás vagy idősor értékei nem keverhetők két szolgáltatóból, mert eltérők lehetnek a definíciók. Különböző adatkészlet (pl. SEC kimutatás + EODHD ár) együtt használható, külön provenance-szel.
2. **Fallback** csak `UNSUPPORTED`, `NOT_FOUND`, `RATE_LIMITED`, `QUOTA_EXHAUSTED`, `TIMEOUT` vagy `UPSTREAM_ERROR` esetén. `UPSTREAM_INVALID` esetén is lehet fallback, de naplózni kell. A provenance mindig a **ténylegesen használt** forrást mutatja.
3. **Kvóta-költségvetés:** a proxy szolgáltatónként számolja a napi felhasználást (EODHD: a 3.1 költségtábla szerint).
   - A keret közelében csak cache-ből szolgál ki.
   - Prioritás: portfólió-tételek > watchlist > keresés.
   - EODHD csomag és maradék: `/api/user` (0 hívás).
   - A tartós számláló tárolása: U-03.
4. **Csomagszint konfigurációból** (`FMP_PLAN`, `EODHD_PLAN`) képességmátrixot kapcsol. A fizetős váltáshoz elég env-módosítás és proxy-újratelepítés, appkiadás nem kell (D-027).
5. A nem elérhető képesség `UNAVAILABLE` státuszt kap, ok-kóddal: `PLAN_LIMIT` | `NOT_COVERED` | `QUOTA_EXHAUSTED`.

### 5.4 Kapacitásbecslés free módban `[FELTÉTELEZÉS – a valós végpont-költségek a PHASE 04-ben mérendők]`

| Forrás | Napi keret | Becsült felhasználás | Mire elég |
|---|---|---|---|
| EODHD free | 20 hívás | 1 hívás/instrumentum/nap (inkrementális EOD); keresés 1 | kb. **15–18 nem US instrumentum napi frissítése**, vagy kevesebb, ha keresés is van |
| FMP free | 250 hívás | ár + történet kb. 2–3 hívás/US instrumentum (a kimutatás a SEC-ből jön) | kb. 80–100 US instrumentum frissítése/nap `[HARMADIK FÉL keret]` |
| SEC | ≤10 kérés/mp | 1 companyfacts/cég, 7 napos cache | gyakorlatilag korlátlan személyes használatra |
| ECB/Frankfurter | nincs kvóta | 1 kérés/nap/bázis | korlátlan |

## 6. Funkciók, amelyek korlátozottak vagy későbbiek

| Funkció | Free módban | Fizetős csomaggal (D-027, DP-05) |
|---|---|---|
| US részvény éves fundamentumok | **MVP** (SEC) | – |
| Negyedéves adat / TTM (US) | Feltételes (SEC Q4 származtatott) | – |
| Nem US részvény fundamentumok | **`UNAVAILABLE` (PLAN_LIMIT)**; a DCF csak kézi bemenettel | EODHD Fundamentals ($59.99/hó) vagy All-in-One ($99.99/hó), havi számlázás `[IGAZOLT]` |
| UCITS ETF és nem US részvény árfolyama | **MVP, korlátozott** (EODHD free: 20 hívás/nap, 1 év történet) | EODHD EOD ($19.99/hó): 100 000 hívás/nap, 30+ év |
| Hosszú távú (>1 év) kockázati mutatók nem US-re | `INSUFFICIENT_DATA` a free 1 éves történet miatt | fizetős EODHD |
| ETF metaadat (TER, AUM…) | részleges + kézi bevitel (`user_input`) | EODHD Fundamentals (ETF) – holdings `[NEM IGAZOLT]` |
| ETF holdings, ország-, szektorsúly, overlap | **Kézi pillanatkép** (PHASE 08 motor kész); US: SEC N-PORT adapterrel (KI-66; szektor nélkül) | fizetős forrás csak igazolás után |
| Forward P/E, elemzői becslések | Nem | csak igazolt forrásból, `estimated` jelöléssel |
| Valós idejű ár | Nem cél | – |
| Tracking difference/error | Motor kész (PHASE 08); **total return indexsor kell** – free forrásból nincs (KI-69) | indexadat kell |
| Sharpe/Sortino | Kész (PHASE 08, D-066); az `rf` felhasználói beállítás, nélküle `MISSING` | – |

## 7. Szabályok (minden adatforrásra)

1. Kulcs csak szerveroldalon (proxy env), soha a kliensen.
   - Lokálisan `.env.local` (gitignore-olt), élesben EAS environment variable (secret).
   - **API-kulcsot soha ne illessz be chatbe**, és ne commitold.
2. Minden szolgáltatói válasz zod-validáción megy át, és csak utána normalizálódik.
3. Provenance minden rekordon: `sourceId`, `fetchedAt`, `asOf`, `period`, `currency`, `unit`, `kind`.
4. A SEC User-Agent az app nevét és az üzemeltető kapcsolattartási címét tartalmazza `SEC_USER_AGENT` env változóból. Kódba nem kerül.
5. A rate limitet és a kvótát a proxy tartja be (5.3).
6. Licenc: **csak saját használat** (D-008). A személyes csomagok adata nem osztható meg másokkal. A cache-elési és megjelenítési feltételeket a PHASE 04 szolgáltatónként rögzíti.
7. Attribúció, ahol előírt. A forrás neve a provenance-nézetben mindig látszik.
8. Mock adat mindig `kind: "mock"` jelöléssel, nem keverhető éles adattal.

## 8. PHASE 04 ellenőrzési lista

**04A** (2026-11-21, részletek: 10. fejezet)
- [x] SEC `company_tickers.json` (ticker → CIK) elérhetősége és formátuma – `[IGAZOLT]` (10 399 sor; User-Agent nélkül HTTP 403).
- [x] SEC companyfacts: **12** valós US cég fixture-je (R-05) – AAPL, MSFT, NVDA, AMZN, GOOGL, JPM, KO, XOM, JNJ, WMT, BRK-B, TSM.
- [x] Frankfurter v2 ECB provider válaszformátum – `[IGAZOLT]`. A hat kijelzési deviza (HUF, EUR, USD, GBP, CHF, JPY) mind szerepel; ami nincs az ECB-listán (pl. AED), üres választ kap → `missing`.
- [x] OpenFIGI: ISIN → listingek – `[IGAZOLT]` (VWCE: 179 sor, ebből 11 igazolt tőzsdei jegyzés). **Pénznemet és MIC-et nem ad** (D-042).
- [x] D-004 spike: API route-ok lokálisan működnek; EAS Hosting: nincs KV/rate-limit primitív (U-03). EAS-próbatelepítés nem készült (D-004).

**04B** (2026-11-21, részletek: 11. fejezet)
- [x] EODHD csomag `/api/user`-rel: `subscriptionType: free`, `dailyRateLimit: 20` (U-13).
- [x] FMP csomag és lefedettség próbahívásokkal: free, csak US (annak is egy része), ETF-végpontok 402 (U-13, U-15). A dashboard (keret) ellenőrzése a tulajdonosé (KI-39).
- [x] EODHD free végpontjai: EOD (1 év), késleltetett live, osztalék, keresés igen; fundamentum 403 (U-14).
- [~] ToS: EODHD – olvasva (11.4); FMP – a ToS-oldal 403, `[HARMADIK FÉL]` (KI-39).
- [x] Fixture: **3 UCITS ETF** (VWCE@XETR, IWDA@XAMS, ISF@XLON – GBX, többlistinges keresés GBX/GBP/USD/EUR/CHF) és **4 nem US részvény** (SAP@XETR, ASML@XAMS, NESN@XSWX – CHF, OTP@XBUD – HUF).

## 9. Kapcsolódó platform-tények (Expo, `[IGAZOLT]` 2026-11-21)

- `EXPO_PUBLIC_*` változók plain-textként bekerülnek az appba. Titokra tilos használni.
- Az Expo Router API route-ok szerveren futnak és minden env változót olvashatnak. A kliens kódba importált titok viszont a bundle-be kerülhet.
- `expo-sqlite`: SQLCipher Expo Go-ban nem elérhető, és prebuild kell hozzá. SQLCipher nélküli binárisban a `PRAGMA key` csendben nem csinál semmit.
- `expo-secure-store`: Androidon az adat eltávolításkor elvész. Nem lehet kritikus adat egyetlen forrása.
- **(PHASE 04A)** SDK 58-ban az API route-ok a `web.output: "server"` beállítással működnek; a dinamikus szegmens (`[id]`) a handler 2. argumentuma. A `npx expo start` a route-okat is kiszolgálja (alapból a 8081-es porton). Forrás: https://docs.expo.dev/router/web/api-routes/
- **(PHASE 04A)** EAS Hosting: Cloudflare Workers alapú; nincs tartós KV-, cache- vagy rate-limit primitív; „Secrets cannot be deployed with Expo Hosting” – csak „plain text” és „sensitive” változó. Források: https://docs.expo.dev/eas/hosting/introduction/, https://docs.expo.dev/eas/hosting/reference/worker-runtime/, https://docs.expo.dev/eas/hosting/reference/caching/, https://docs.expo.dev/eas/environment-variables/usage/

## 10. PHASE 04A – élő próbahívásokkal igazolt tények (2026-11-21)

Minden alábbi tény saját próbahívásból származik. A válaszok a `src/server/providers/*/__fixtures__/` mappában rögzítve vannak (valós, de megvágott teszt-fixture-ök, D-047).

### 10.1 SEC EDGAR – `sec-edgar` adapter (MEGVALÓSÍTVA)

| Tény | Érték |
|---|---|
| Ticker → CIK | `GET https://www.sec.gov/files/company_tickers.json` → `{ "0": { "cik_str": 320193, "ticker": "AAPL", "title": "Apple Inc." }, … }`, 10 399 sor |
| Tények | `GET https://data.sec.gov/api/xbrl/companyfacts/CIK##########.json` → `{ cik, entityName, facts: { "us-gaap" \| "ifrs-full" \| "dei": { Tag: { label, units: { USD: [ { start?, end, val, accn, fy, fp, form, filed, frame? } ] } } } } }` |
| User-Agent | Kötelező. Kapcsolattartó nélkül **HTTP 403** („Request Rate Threshold Exceeded” oldal). A proxy a `SEC_USER_AGENT` env-ből küldi. |
| Rate limit | ≤ 10 kérés/mp (fair access) → a proxy 110 ms-os ütemezővel tartja be (példányonként, KI-23). |
| Méret | companyfacts: több MB / cég (AAPL nyersen kb. 6 MB). A proxy csak a használt tageket validálja szigorúan (D-043). |
| Lefedettség | csak SEC-filerek; 20-F/40-F (külföldi) filer: csak éves adat, IFRS-tagekkel, gyakran a saját pénznemében (TSM: TWD). |
| Formátum-meglepetések | `cik` néha **string** (XOM új CIK-je: `"2115436"`); a `fy` az összehasonlító adatnál a BEADÓ filing éve (pl. 2023-as AAPL-adat `fy: 2026`); a 10-Q 6/9 hónapos YTD tényeket is ad; a ticker → CIK leképezés változhat (XOM: új holding-CIK, még 10-K nélkül). |
| Licenc | US szövetségi kormányzati adat, `[FELTÉTELEZÉS – jogilag nem ellenőrizve]` közkincs. |

### 10.2 ECB referencia-árfolyam (Frankfurter v2) – `ecb-fx` adapter (MEGVALÓSÍTVA)

| Tény | Érték |
|---|---|
| Végpont | `GET https://api.frankfurter.dev/v2/providers/ecb/rates?base=EUR&quotes=USD,HUF&date=YYYY-MM-DD` |
| Válasz | `[{ "date": "2026-11-20", "base": "EUR", "quote": "USD", "rate": 1.099 }, …]`; paraméter nélkül `EUR → EUR = 1.0` sort is tartalmaz |
| Hétvége / ünnep | a `date=2026-11-15` (vasárnap) válasza a 2026-11-13-i (pénteki) ráta |
| Nem közölt deviza | pl. `quotes=AED` → `[]` (HTTP 200) |
| Hibák | ismeretlen deviza / hibás dátum → **HTTP 422** `{ "status": 422, "message": "invalid currency: XXX" }`; ismeretlen provider → 404 |
| Kulcs, kvóta | nincs; `cache-control: public, max-age≈40 000` a válaszban |
| ECB devizalista | a provider metaadata szerint (történetiekkel együtt) 45 kód, köztük HUF, USD, GBP, CHF, JPY |
| Feltétel | ECB: „csak tájékoztató célra” (D-017); terms: https://www.ecb.europa.eu/services/using-our-site/disclaimer/html/index.en.html |

### 10.3 OpenFIGI – `openfigi` adapter (MEGVALÓSÍTVA)

| Tény | Érték |
|---|---|
| Végpont | `POST https://api.openfigi.com/v3/mapping`, törzs: `[{ "idType": "ID_ISIN", "idValue": "IE00BK5BQT80" }]` |
| Válasz | jobonként `{ data: [{ figi, name, ticker, exchCode, compositeFIGI, securityType, marketSector, shareClassFIGI, … }] }` \| `{ warning: "No identifier found." }` \| `{ error: "Invalid idValue format." }` |
| Limit (kulcs nélkül) | válaszfejléc: `ratelimit-limit: 25`, `ratelimit-policy: 25;w=60` (25 kérés/perc) |
| Hibás törzs | HTTP 400 „Bad request.” |
| **Amit NEM ad** | jegyzési pénznem, MIC, dátum |
| UCITS ETF (VWCE) | 179 sor: Xetra, LSE, Euronext Amsterdam, Borsa Italiana, SIX, német regionális tőzsdék + sok MTF/OTC helyszín és szintetikus ticker (pl. `VWRAEUR`) |
| US részvény (AAPL) | ISIN-kérésre **csak a kompozit `US` sor** jön; konkrét tőzsde csak ticker + `exchCode`/`micCode` kéréssel (KI-21) |

**`exchCode` → MIC igazolás** (`micCode` kérésszűrővel; a tábla a kódban: `src/server/providers/openfigi/exchange-codes.ts`):

| exchCode | MIC (üzemeltetői) | Bizonyíték |
|---|---|---|
| LN | XLON | micCode=XLON → LN |
| GT | XETR | micCode=XETR → GT (**nem** GY) |
| GF / GS / GD / GM / GH | XFRA / XSTU / XDUS / XMUN / XHAM | micCode=… → ugyanaz |
| NA | XAMS | micCode=XAMS → NA (VWCE, IWDA) |
| SE | XSWX | micCode=XSWX → SE |
| IM | XMIL | micCode=MTAA → IM (MTAA = XMIL szegmens) |
| UN / UP | XNYS / ARCX | micCode=XNYS / ARCX → UN / UP |
| UW / UQ | XNAS | micCode=XNGS → UW (AAPL), XNMS → UQ (QQQ); szegmens → XNAS |
| nem igazolt | – | pl. XPAR (FP) és ETFP: a próba-ISIN-re nem jött sor → nincs a táblában |

## 11. PHASE 04B – élő próbahívásokkal igazolt tények (2026-11-21)

Minden tény saját próbahívásból származik, a tulajdonos **free** kulcsaival (a kulcs sehol nem került ki). A válaszok megvágva a `src/server/providers/{fmp,eodhd}/__fixtures__/` mappában vannak.

### 11.1 Financial Modeling Prep – `fmp` adapter (MEGVALÓSÍTVA)

| Tény | Érték |
|---|---|
| API | **stable** API: `https://financialmodelingprep.com/stable/{végpont}?symbol=…&apikey=…` (a kulcs URL-paraméter) |
| Csomag | free (Basic). Napi keret: 250 `[HARMADIK FÉL]` – a hivatalos árlista és ToS a mi eszközeinkkel HTTP 403. |
| Működik free-ben (US) | `quote`, `profile`, `historical-price-eod/full` + `/non-split-adjusted` + `/dividend-adjusted`, `dividends`, `splits`, `search-symbol` |
| NEM működik free-ben | `etf/info`, `etf/holdings`, `search-isin` → **402** „Restricted Endpoint”; nem US szimbólum (`SAP.DE`, `VWCE.DE`) és egyes US szimbólumok (`BRK-B`) → **402** „Premium Query Parameter” |
| Ismeretlen ticker | szintén **402** (nem 404!) → nem különböztethető meg a csomagkorláttól (KI-30) |
| `quote` | tömb; `price`, `exchange` (`NASDAQ` \| `NYSE` \| `AMEX`…), `timestamp` (Unix mp); **nincs pénznem** |
| `historical-price-eod/full` | csökkenő sorrend; `close` **split-korrigált, osztalékkal nem** (NVDA 2024-06-07: 120.89) |
| `non-split-adjusted` | az `adjClose` mező itt **nyers** ár (1208.9) – a mezőnév félrevezető |
| `dividend-adjusted` | `adjClose` split + osztalék (120.55) |
| Történet | free-ben is mély: 2001 és 2010 adat lekérhető; `from`/`to` nélkül ~5 év |
| `dividends` | `dividend` (tényleges), `adjDividend` (split-korr.), dátumok, `frequency`; nincs pénznem |
| `profile` | `currency`, `cik`, `isin`, `exchange`, `exchangeFullName`, `isEtf`, `isFund`, `country`, `sector`…; hiány gyakran `""` |
| `search-symbol` | `symbol` utótaggal (`ISF.L`, `SAP.DE`), `exchange` (`LSE`, `AMS`, `XETRA`, `MIL`, `FSX`, `NASDAQ`, `NYSE`, `AMEX`, `OTC`, `CRYPTO`…), `currency` (`GBp`, `ZAc` is) |
| `exchange` → MIC (igazolt) | `NASDAQ`→XNAS, `NYSE`→XNYS, `AMEX`→ARCX vagy XASE (kétértelmű: keresésben nem képezzük le), `XETRA`→XETR, `LSE`→XLON, `AMS`→XAMS, `MIL`→XMIL, `FSX`→XFRA |

### 11.2 EODHD – `eodhd` adapter (MEGVALÓSÍTVA)

| Tény | Érték |
|---|---|
| API | `https://eodhd.com/api/{végpont}/{KÓD}.{TŐZSDE}?fmt=json&api_token=…` |
| `/api/user` (0 hívás) | `subscriptionType: free`, `dailyRateLimit: 20`, `extraLimit` (egyszeri bónusz), `apiRequests` (mai felhasználás). A `name`/`email` mezőt nem tároljuk. |
| Fejléc | `x-ratelimit-limit: 1200` (percenkénti) |
| `real-time` | `{ code, timestamp, close, … }`; **nincs pénznem**; ismeretlen ticker: **HTTP 200, minden érték `"NA"`** |
| `eod` | `[{ date, open, high, low, close, adjusted_close, volume }]`; **nincs pénznem**; `adjusted_close` split + osztalék (ASML 1455.4 vs 1453.4556) |
| Free ablak | 1 évnél régebbi időszakra **HTTP 200, egyetlen, a kért időszakon KÍVÜLI sor** `warning: "Data is limited by one year as you have free subscription"` mezővel → az adapter eldobja és jelzi |
| `div` | `value` (split-korr.), `unadjustedValue`, `currency` **soronként** (ISF.LSE: ár GBX, osztalék GBP), dátumok (Európán kívül gyakran `null`) |
| `search` | `Code`, `Exchange`, `Name`, `Type` (`ETF`, `Common Stock`…), `Country`, `Currency` (GBX is), `ISIN`, `isPrimary`; ISIN-nel is keres; `exchange=` szűrő működik |
| Fundamentals | **HTTP 403** „Only EOD data allowed for free users” (a 403 nem számított bele a keretbe) |
| Hibás ticker (`eod`) | **404** `text/html` „Ticker Not Found.” |
| Tőzsdekód ↔ MIC (igazolt) | `XETRA`↔XETR, `F`↔XFRA, `LSE`↔XLON, `AS`↔XAMS, `SW`↔XSWX, `BUD`↔XBUD; `US` = ország-szint (US MIC-ek → `.US`, keresésből nem képezzük vissza) |
| Hívásköltség | EOD, live, div, search: 1; user: 0; fundamentals: 10 (doksi + 3.1) |

### 11.3 Kapacitás free módban (a 5.4 frissítése, élő adatok alapján)

| Forrás | Napi keret | Költség a mi végpontjainkon | Megjegyzés |
|---|---|---|---|
| EODHD free | 20 | quote 1 (+1 pénznem-keresés, ha nincs helyszíni szabály, naponta egyszer), ártörténet 1 (+1), osztalék 1, keresés 1 | kb. 8–15 nem US instrumentum/nap; a keresés legfeljebb a keret 75%-a (D-051) |
| FMP free | 250 `[HARMADIK FÉL]` | minden végpont 1 | kb. 80–120 US instrumentum/nap (quote + ártörténet) |

### 11.4 Feltételek (ToS)

- **EODHD** (https://eodhd.com/financial-apis/terms-conditions, olvasva 2026-11-21): a „Non-Professional User” személyes befektetési célra **tárolhatja, feldolgozhatja és elemezheti** az adatot; **tilos** továbbadni, újraközölni, másnak megjeleníteni vagy hozzáférést adni (fiókmegosztás is). Attribúciót a ToS nem ír elő; az adat „nem feltétlenül valós idejű vagy pontos”. → Összhangban a D-008-cal (csak saját használat). Több felhasználós kiadás előtt üzleti csomag kell.
- **FMP**: a ToS-oldal HTTP 403 (`[HARMADIK FÉL]`: „personal use” csomagok). A tulajdonos ellenőrizze a fiókjában (KI-39). Addig ugyanazt a szabályt alkalmazzuk, mint az EODHD-nél.
- A forrás neve minden válasz provenance-ében szerepel (`sourceId`, `sourceName`), a UI ezt mutatja (7. fejezet 7. pont).

### 11.5 Források

- EODHD: https://eodhd.com/pricing, https://eodhd.com/financial-apis/api-limits, https://eodhd.com/financial-apis/api-for-historical-data-and-volumes, https://eodhd.com/financial-apis/live-realtime-stocks-api, https://eodhd.com/financial-apis/api-splits-dividends, https://eodhd.com/financial-apis/search-api-for-stocks-etfs-mutual-funds, https://eodhd.com/financial-apis/user-api, https://eodhd.com/financial-apis/terms-conditions
- FMP: https://site.financialmodelingprep.com/developer/docs (HTTP 403 a mi eszközeinkkel), élő próbák: `https://financialmodelingprep.com/stable/…`

### 11.6 Új fixture rögzítése (eljárás)

1. Ellenőrizd a mai EODHD-felhasználást: `GET https://eodhd.com/api/user?api_token=…&fmt=json` (0 hívás).
2. A kulcsot csak a `.env.local`-ból olvasó szkripttel kérj le (soha ne írd parancssorba vagy chatbe), a válaszból töröld a `name`/`email` mezőt, és értékvak szkennerrel ellenőrizd, hogy a kulcs nincs a fájlban.
3. Mentsd `{ "_fixture": { source, url, recordedAt, note }, "response": … }` alakban a `__fixtures__` mappába (D-047).

## 12. PHASE 06 – ténylegesen felhasznált mezők a fundamentális elemzéshez (2026-11-22)

| Mező az elemzésben | Forrás (free) | Státusz |
|---|---|---|
| Ticker, tőzsde (MIC) | a listing-azonosító | mindig |
| Név, szektor, iparág, ország, tőzsdenév | FMP `/stable/profile` (csak US) | nem US: `UNAVAILABLE / PLAN_LIMIT` |
| **Béta** | FMP `/stable/profile` `beta` (élő fixture-ön igazolva: AAPL 1,089) | `reported`, tájékoztató; módszertan nem közölt |
| Ár | FMP / EODHD `quote` (D-049) | `reported`, saját frissesség |
| Piaci érték | **saját számítás**: ár × SEC részvényszám (az FMP `marketCap` nem kerül be; AAPL-en egyezik) | `calculated` |
| Kint lévő részvények | SEC `CommonStockSharesOutstanding` / dei címlap | `reported` |
| 52 hetes csúcs/mélypont | **saját számítás** az 1 éves ártörténet záróáraiból (az FMP `yearHigh/yearLow` intraday, nem kerül be) | `calculated` |
| Kimutatások (IS/BS/CF) | SEC companyfacts (csak US; nem US: `PLAN_LIMIT`) | `reported` |
| **`totalDebt`** | SEC: `LongTermDebtNoncurrent` / `LongTermDebtAndCapitalLeaseObligations` + `DebtCurrent` vagy (`LongTermDebtCurrent` / `…CapitalLeaseObligationsCurrent` + `ShortTermBorrowings` vagy `CommercialPaper` + `OtherShortTermBorrowings`) – élő próbával, 12 cégen kiválasztva (D-059) | `calculated` / `estimated`; bank, biztosító, IFRS: `MISSING` |
| Osztalék (TTM) | FMP / EODHD osztaléktörténet, 2 év | `calculated`; lefedettség ismeretlen → esemény nélkül `MISSING` |

**Fixture-bővítés (2026-11-22):** `node scripts/record-sec-fixtures.mjs --add-new-tags` – a meglévő SEC-fixture-ökbe csak a `sec-tags.ts`-be újonnan felvett tagek kerülnek, az eredeti rögzítés napjáig (`filed <= recordedAt`) beadott tényekkel; a régi tények változatlanok. 12 SEC-hívás (nincs napi keret, 10 kérés/mp limit; a szkript 250 ms-ot vár).

## 13. PHASE 08 – ETF-adatok: tényleges lefedettség és a SEC N-PORT próba (2026-11-22)

### 13.1 Mit kap ma az ETF-elemzés, és honnan

| Adat | Forrás (free) | Státusz az elemzésben |
|---|---|---|
| Ticker, tőzsde (MIC) | a listing-azonosító | mindig |
| Jegyzési deviza | árfolyam → ártörténet → profil (ebben a sorrendben) | `reported`; GBX megmarad (pl. ISF@XLON) |
| Név, ISIN, domicil | FMP profil (csak US) | nem US: kézi bevitel vagy `UNAVAILABLE / PLAN_LIMIT` |
| TER, AUM, kibocsátó, indulás, replikáció, benchmark, acc/dist, UCITS, fedezés, alapdeviza, kategóriák | **nincs free forrás** (FMP `etf/info` 402, EODHD fundamentals 403) | csak `EtfMetadataInput` (kézi, `user_input`); nélküle `UNAVAILABLE / PLAN_LIMIT` (KI-65) |
| Holdings (súly, ország, szektor, deviza) | **nincs free adapter**; SEC N-PORT igazolt (13.2), adapter nincs (KI-66) | kézi pillanatkép, vagy `UNAVAILABLE / PLAN_LIMIT` |
| Ártörténet (total return) | EODHD `adjusted_close` / FMP `dividend-adjusted` (`SPLIT_DIVIDEND`) | `reported`; free EODHD: 1 év (KI-70) |
| Ártörténet (árhozam) | FMP split-korrigált (`SPLIT`); EODHD-nél nincs ilyen → nyers `close` (`NONE`) tartalék | `reported` |
| Osztalék | FMP / EODHD (az ISF GBP-ben, az ára GBX-ben – a motor normalizál) | `reported` |
| Indexsor (tracking, béta) | **nincs** (TR index free forrásból nem igazolt) | a hívó adja; nélküle `MISSING` (KI-69) |
| Forgalom (volume) | az EODHD `eod` válaszában van, de a normalizált `PricePoint` nem tárolja | kézi bevitel, különben `MISSING` (KI-67) |

### 13.2 SEC N-PORT – élő próba (2026-11-22, 3 kérés, a `.env.local` User-Agentjével)

| Kérdés | Eredmény `[IGAZOLT]` |
|---|---|
| Elérhetőség | `https://data.sec.gov/submissions/CIK##########.json` → a `filings.recent` listában `NPORT-P` (iShares Trust: 1449 db; SPDR S&P 500 ETF Trust: 28 db). A dokumentum: `https://www.sec.gov/Archives/edgar/data/{cik}/{accession}/primary_doc.xml` (XML, iShares-sorozat: ~1,5 MB, SPY: ~0,45 MB). |
| Gyakoriság, késleltetés | Negyedéves nyilvános kitettség (a negyedév-végi hónap). Példa: iShares Morningstar Small-Cap – időszak vége 2026-08-31, beadva 2026-10-26; SPY – 2026-06-30, beadva 2026-08-28 → **~60 nap késés**. |
| Mezők | `seriesName`, `seriesId`, `repPdEnd`, `repPdDate`, `totAssets`, `netAssets`; tételenként (`invstOrSec`): `name`, `cusip`, `<isin value="…">` (attribútum!), `balance`, `curCd`, **`pctVal` (százalék, pl. 0.0833 = 0,0833%)**, `invCountry`, `issuerCat`, `assetCat`. Negatív `pctVal` is előfordul (derivatíva). |
| Ami NINCS | **szektor** (GICS); UCITS alapok (csak US-regisztrált alapok adnak N-PORT-ot). |
| Ticker → sorozat | `https://www.sec.gov/files/company_tickers_mf.json` (mezők: `cik`, `seriesId`, `classId`, `symbol`; 28 670 sor): IVV, VOO, IJR benne van; **SPY (UIT) nincs** – CIK-kel közvetlenül érhető el; VWCE (UCITS) nincs. |
| Egy CIK – sok alap | A trust-CIK alatt minden sorozat külön `NPORT-P`; a megfelelőt a `seriesId` alapján kell kiválasztani. |
| Licenc | Nyilvános SEC-adat; a SEC fair-access szabályai (≤ 10 kérés/mp, User-Agent) érvényesek. |

**Következtetés (D-069/9):** a N-PORT US ETF-ekre alkalmas holdings-forrás (súly, ország, ISIN, deviza), de szektorsúlyt nem ad, UCITS-ra nem jó, és ~2–5 hónapos. Az adapterhez XML-feldolgozás (függőség kompatibilitás-ellenőrzéssel), sorozat-kiválasztás és valós, megvágott fixture kell – ez külön lépés (KI-66).

**D-071 (2026-11-22):** a N-PORT adapter nem készül. Ok: csak US-regisztrált alapokat fed le, az EU-s lakossági befektető a PRIIPs miatt jellemzően nem vehet KID nélküli US ETF-et `[ÁLTALÁNOS – brókerenként ellenőrizendő]`. Helyette a kibocsátói holdings-fájl import a terv (PHASE 13, KI-74): a felhasználó maga tölti le a fájlt (iShares, Vanguard, Xtrackers), az app csak beolvassa – nincs scraping, nincs automatikus letöltés a kibocsátói oldalakról.


## 14. PHASE 11 – AI-szolgáltatók: lokális LLM vs. felhős API (2026-11-23, U-16)

> Jelölések, mint az 1. fejezetben. Élő LLM-hívás ebben a fázisban **nem** történt: a `.env.local`-ban az `ANTHROPIC_API_KEY` üres, és `AI_PROVIDER=template`, `AI_ENABLED=false`. Az Anthropic-adatok a hivatalos API-dokumentáció 2026-11-03-i árlistájából és az SDK 1.12.0 típusaiból származnak. A harmadik fél szolgáltatóiról szóló állítások **nem igazoltak**: a free keretek gyakran változnak, ingyenességet vagy korlátlanságot ezekre nem ígérünk.

### 14.1 Mi az „AI” ebben az appban – és mi nem

Az AI **adatforrásnak nem számít.** Számot, mutatót vagy döntést nem állít elő, csak a már kiszámolt `AiInputDto`-t fogalmazza meg (D-076…D-078). Az alapértelmezés a **szabályalapú `template`**: ingyenes, offline, determinisztikus. Az LLM opcionális „plusz réteg”.

### 14.2 Összehasonlítás

| Szempont | `template` (alap) | Anthropic Claude (proxyn át) – megvalósítva | Lokális LLM (pl. Ollama / llama.cpp a tulajdonos gépén) – csak vizsgálva | Más felhős free keretek – csak vizsgálva |
|---|---|---|---|---|
| Licenc | saját kód | kereskedelmi API, ToS szerint `[IGAZOLT: hivatalos SDK, Apache-2.0]` | modellenként eltér: néhány nyílt súlyú modell Apache-2.0, másoknak saját közösségi licence van felhasználási korlátokkal `[ÁLTALÁNOS – modellenként ellenőrizendő]` | szolgáltatónként; a free kereteknél gyakran megengedett, hogy a bemenet a szolgáltatás fejlesztésére kerüljön `[NEM IGAZOLT]` |
| Hardverigény | nincs (a telefonon fut) | nincs (felhő) | 7–8B paraméteres, kvantált modellhez kb. 6–8 GB RAM/VRAM; a telefonon, Expo Go alatt nem futtatható `[ÁLTALÁNOS]`. Gyakorlatban a proxy mellett, a tulajdonos PC-jén futna | nincs |
| Adatvédelem | az adat nem hagyja el az eszközt | az `AiInputDto` az Anthropichoz kerül; portfólió csak beleegyezéssel, összegek nélkül (D-076/4) | az adat a saját gépen marad | harmadik félhez kerül; a free kereteknél jellemzően kevesebb adatvédelmi garancia `[NEM IGAZOLT]` |
| Költség | 0 | tokenalapú: Opus 5.5 $4/$20, Sonnet 5.5 $2/$10, Haiku 5.5 $0.10/$0.50 per 1M input/output token (2026-11-03). ~6 000 + 1 500 tokennel magyarázatonként ≈ $0.054 / $0.027 / $0.0014; a gondolkodási tokenek miatt több lehet | áram és hardver; nincs tokendíj | free kerettel 0, de a keret napi/perces limites és visszavonható `[NEM IGAZOLT]` |
| Tokenlimit | – | 1M kontextus a jelenlegi modelleken; a mi kérésünk ~5–10 ezer token (DTO ≤ 96 KB) | kis modelleknél jellemzően 8–32 ezer kontextus `[ÁLTALÁNOS]`; a DTO belefér, de a hosszú rendszerprompt + DTO a határ közelébe kerülhet | szolgáltatónként `[NEM IGAZOLT]` |
| JSON-output | séma szerint, determinisztikus | strukturált kimenet JSON-sémával (`output_config.format`) `[IGAZOLT: SDK-típusok + tesztek]`; mi ráadásul újravalidálunk | egyes futtatók JSON-sémás / nyelvtan-alapú kimenetkényszert ismernek `[HARMADIK FÉL – nem igazolt]`; a magyar nyelvű minőség kis modelleken gyenge lehet | szolgáltatónként; van, ahol csak „JSON mode”, sémakényszer nélkül `[NEM IGAZOLT]` |
| Hallucináció | nincs (csak bemenetből épít) | lehetséges → séma + tartalmi őr szűri (D-077) | kis modelleknél gyakoribb → ugyanaz az őr, várhatóan sok `AI_INVALID_OUTPUT` | lehetséges → ugyanaz az őr |
| Elérhetőség | mindig (offline is) | hálózat + proxy kell; kill switch; napi keret | csak ha a tulajdonos gépe fut és elérhető | szolgáltatófüggő |

### 14.3 Javaslat (a tulajdonos dönt, DP-04)

1. **Marad a `template` alapértelmezésként.** Ez lefedi az elfogadási feltételeket („AI nélkül is működik”), és nincs költsége.
2. **Ha LLM kell:** `AI_PROVIDER=anthropic`, `AI_ENABLED=true`, `AI_MODEL=claude-haiku-5-5` (a legolcsóbb), `AI_DAILY_LIMIT` alacsonyan (pl. 20). A kulcs **csak** a `.env.local`-ba (lokálisan) vagy az EAS secretbe (élesben) kerülhet; chatbe soha.
   - Előtte az EAS Hosting runtime-on egy próbatelepítéssel igazolni kell az SDK működését (KI-90).
   - Az alapértelmezett modell a D-016 szerint `claude-opus-5-5`; ennek választása a tulajdonos költségdöntése.
3. **Lokális LLM:** akkor érdemes, ha az adatvédelem a legfontosabb, és a tulajdonos gépe a proxy mellett fut. Megvalósítás:
   - új `AiProvider`-adapter (pl. `local-ai-provider.ts`), amely a lokális futtató HTTP API-ját hívja; ugyanazon a szolgáltatáson és őrön megy át;
   - a futtató API-ja és JSON-sémakényszere a választott eszköz hivatalos dokumentációjából ellenőrizendő;
   - külön döntés és élő próba kell hozzá. A kis modellek magyar nyelvű, sémahű kimenete kockázatos.
4. **Más felhős free keret:** most nem javasolt. A keret és a feltételek változékonyak, a free csomagok adatvédelmi feltételei gyengébbek lehetnek, és minden új szolgáltató új titkot és új adaptert jelent. Ha mégis kell, a 14.2 sorait a szolgáltató hivatalos oldaláról kell igazolni, mielőtt adapter készül.

### 14.4 Tények az Anthropic-integrációról (PHASE 11, igazolva)

| Tény | Forrás / igazolás |
|---|---|
| Csomag: `@anthropic-ai/sdk` 1.12.0 (2026-11-20), Apache-2.0; függőségek: `standardwebhooks`, `json-schema-to-ts`, `@opentelemetry/api`; peer: `zod ^3.25 \|\| ^4` | `npm view` (2026-11-23) |
| A szerver-bundle-be bekerül (`/api/v1/ai/explain`, ~2 MB route); a kliens-bundle-ben nincs SDK, kulcs vagy szerverkód | `expo export -p web` + szkennelés |
| Az Expo lokális szerver-runtime-ja (`expo serve`) betölti; mock providerrel `POST` → 200, `GET` → 405 | füstpróba, 8083-as port |
| Strukturált kimenet: `output_config.format` (`betaZodOutputFormat`), effort `low`; refusal: `stop_reason: "refusal"` | SDK 1.12.0 típusok + egységtesztek hamis klienssel |
| Élő Claude-hívás | **nem történt** (nincs kulcs; tudatos) |
| EAS Hosting runtime | `[NEM IGAZOLT]` (KI-90) |
