# Adatforrások – Stock & ETF Analyzer

> Ellenőrzés dátuma: **2026-11-21** (PHASE 01; a SEC, az ECB/Frankfurter és az OpenFIGI a **PHASE 04A-ban élő próbahívásokkal újraellenőrizve**, lásd 10. fejezet). Az ingyenes keretek és feltételek gyakran változnak; az FMP és az EODHD adatait a PHASE 04B ellenőrzi.
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
| **EODHD** (kulcs megvan) | kell | Free: **20 hívás/nap**, 1 év történet | globális EOD: részvény, ETF, forex, index (150 000+ ticker) | Fundamentals csomag: globális részvény és ETF, US alapok. A free-ben `[NEM IGAZOLT]` (a források ellentmondanak), de 10 hívás/kérés áron gyakorlatilag max. 2/nap | free: 1 év; fizetős: 30+ év | `[NEM IGAZOLT]` | EOD | free live: 15 perc késleltetés | személyes és kereskedelmi csomagok külön | `[IGAZOLT]` | **IGEN** |
| **Financial Modeling Prep** (kulcs megvan) | kell | Basic: 250 hívás/nap, 500 MB/30 nap | US szimbólumok egy köre; nem US a free-ben `[NEM IGAZOLT]` | korlátozott a free-ben | EOD | fizetős `[HARMADIK FÉL]` | `[HARMADIK FÉL]` | EOD | „personal use” csomagok | `[HARMADIK FÉL]` (két hivatalos URL is HTTP 403) | **IGEN** |
| Tiingo | kell | Starter $0: 50 kérés/óra, 1 000/nap, 500 egyedi ticker/hó | `[NEM IGAZOLT]` (US EOD várható) | free: 5 év, fizetős kiegészítő | 30+ év | `[NEM IGAZOLT]` | `[NEM IGAZOLT]` | EOD | „Internal Use Only”: csak saját használat | `[IGAZOLT]` (keret, licenc) | most nem (4. fejezet) |
| Finnhub | kell | ~60 hívás/perc | US valós idejű quote | „basic fundamentals” | candles prémium | prémium | igen | valós idejű (US) | „personal use only” | `[HARMADIK FÉL]` | nem |
| Twelve Data | kell | Basic $0: 8 kredit/perc, 800/nap | valós idejű US részvény/ETF, forex | free: nincs | – | nincs | igen | valós idejű (US) | **Basic: „Internal non-display usage”** | `[IGAZOLT]` | nem |
| Alpha Vantage | kell | **25 kérés/nap** | – | `[NEM IGAZOLT]` | – | `[NEM IGAZOLT]` | – | – | ToS `[NEM IGAZOLT]`; prémium $49.99/hó-tól | `[IGAZOLT]` (keret) | nem |
| Massive | kell | free stocks csomag az oldalon **nem látszott** | – | „Financials & Ratios” $29/hó | Stocks Advanced $199/hó | – | – | – | „Individual use only” | `[IGAZOLT]` | nem |
| MNB árfolyamok | – | – | hivatalos HUF árfolyamok | – | – | – | igen | – | – | `[NEM IGAZOLT]` | később opcionális |
| SEC N-PORT | nem kell | SEC fair access | US-regisztrált alapok (UCITS NEM) | – | – | negyedéves, késleltetett `[NEM IGAZOLT]` | – | – | – | `[NEM IGAZOLT]` | PHASE 08 vizsgálja |

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
| 5 | `fmp` | US ár, profil, kiegészítő fundamentum, ETF info (csomagfüggő) | **igen** (megvan) | 04B |
| 6 | `eodhd` | globális EOD ár, split, osztalék, keresés, tőzsdelista; fundamentum/ETF csak megfelelő csomaggal | **igen** (megvan) | 04B |
| – | `ProviderRouter` + kvóta-költségvetés | képesség × piac szerinti választás és fallback | – | 04B |

### 5.2 Routing tábla (kiinduló, `[FELTÉTELEZÉS]`, a PHASE 04B véglegesíti a valós képességek alapján)

| Képesség | US | Európa (UCITS ETF, részvény) | Globális |
|---|---|---|---|
| Keresés | `fmp` → `eodhd` → SEC ticker-lista | `eodhd` → `openfigi` (ISIN) | `eodhd` → `openfigi` |
| Listingek egy ISIN-hez | `openfigi` | `openfigi` → `eodhd` | `openfigi` → `eodhd` |
| Legutóbbi ár | `fmp` → `eodhd` | `eodhd` | `eodhd` |
| Napi ártörténet | `fmp` → `eodhd` | `eodhd` (free: 1 év) | `eodhd` (free: 1 év) |
| Split, osztalék | `fmp` → `eodhd` | `eodhd` | `eodhd` |
| Pénzügyi kimutatások | `sec-edgar` (reported) → `fmp` | **`UNAVAILABLE` (PLAN_LIMIT)** free-ben; fizetős `eodhd` Fundamentals-szel bekapcsolható | ua. |
| ETF metaadat | `fmp` / `eodhd` (csomagfüggő) + kézi bevitel | `eodhd` Fundamentals (fizetős) + kézi bevitel | ua. |
| ETF holdings | nincs igazolt forrás | nincs igazolt forrás | ua. |
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
| ETF holdings, ország-, szektorsúly, overlap | **Később** | csak ha a fizetős forrás igazoltan adja (PHASE 08) |
| Forward P/E, elemzői becslések | Nem | csak igazolt forrásból, `estimated` jelöléssel |
| Valós idejű ár | Nem cél | – |
| Tracking difference/error | Feltételes / később | indexadat kell |
| Sharpe/Sortino | Feltételes; az `rf` felhasználói beállítás | – |

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

**04B**
- [ ] A meglévő EODHD kulcs csomagja `/api/user`-rel (0 hívás) (U-13).
- [ ] A meglévő FMP kulcs csomagja és lefedettsége (dashboard + próbahívás; U-13, U-15). Az FMP `[HARMADIK FÉL]` adatainak igazolása.
- [ ] EODHD free: mely végpontok érhetők el (fundamentum? live?), a történet mélysége (U-14).
- [ ] Mindkét szolgáltató ToS-e: megjelenítés, cache, attribúció személyes csomagban.
- [ ] Fixture: legalább 3 UCITS ETF (pl. eltérő devizájú listingekkel, GBX-szel) és 3 nem US részvény.

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
