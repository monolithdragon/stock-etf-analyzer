# Ismert problémák, kockázatok, ismeretlenek – Stock & ETF Analyzer

> Frissítve: 2026-11-21 (PHASE 04A vége). Valószínűség (V) és hatás (H) skálája: **A** = Alacsony, **K** = Közepes, **M** = Magas.

## Blokkolók

**Nincs blokkoló a PHASE 04B indításához.** Előfeltétel: a tulajdonos az FMP és EODHD kulcsát a `.env.local`-ba írja (nem a chatbe), és az esetleg futó dev szervert újraindítja (KI-17).

## PHASE 04A – ismert problémák és leletek (2026-11-21)

| ID | Probléma / lelet | Hatás | Állapot / teendő | Felelős fázis |
|---|---|---|---|---|
| KI-17 | A spike idején a **8081-es porton már futott egy Expo dev szerver** (valószínűleg a tulajdonosé), amely a `.env.local` létrehozása előtt indult, ezért nem látta a `SEC_USER_AGENT`-et (health: `sec-edgar configured: false`). A saját ellenőrzés a 8082-es porton futott. | A | **Teendő:** env-változás után a dev szervert újra kell indítani (Ctrl+C, majd `npm start`). A futó folyamatot nem állítottuk le. | tulajdonos |
| KI-18 | Negyedéves SEC-adatnál a **Q2/Q3 cash flow tételek hiányoznak**: a 10-Q halmozott (YTD) cash flow-t ad, és a 3 hónapos időszak csak különbségképzéssel állna elő (`calculated`). | K (06) | **Tudatos (D-043):** `MISSING` + megjegyzés. A YTD-különbség a PHASE 06 feladata (D-021). | 06 |
| KI-19 | **Q4 nincs** a negyedéves készletben (a 10-K nem ad 3 hónapos Q4-et). | K (06) | **Tudatos (D-021):** `Q4 = FY − (Q1+Q2+Q3)` számítás a PHASE 06-ban. | 06 |
| KI-20 | Tag-lefedettség: a **JPM negyedéves árbevétele** és a **BRK-B EPS-e** `MISSING` (a cégek más tageket használnak, pl. bankoknál „RevenuesNetOfInterestExpense”). | A | **Őszintén `MISSING`.** Új tag felvétele csak valós fixture-rel igazolva (R-05), a PHASE 06-ban. | 06 |
| KI-21 | **US részvény tőzsdéje ISIN-ből nem határozható meg** az OpenFIGI-vel: ISIN-kérésre csak a kompozit `US` sor jön. | K | A US-listinget a ticker adja (pl. `AAPL@XNAS`); az ISIN → US listing a PHASE 04B-ben az EODHD/FMP keresővel. | 04B |
| KI-22 | Az OpenFIGI **nem ad jegyzési pénznemet** → `ListingCandidate.tradingCurrency: null`. | K | **Tudatos (D-042).** A PHASE 04B árforrása tölti ki (EODHD). | 04B |
| KI-23 | A rate limiter (SEC 110 ms) és a ticker-memo **memóriabeli, példányonkénti**; az EAS Hosting / Workers példányai nem osztanak memóriát (U-03). | A (saját használat) | Elfogadva a D-008 mellett. Tartós/globális limiter: PHASE 13/15 (vagy Cloudflare KV, D-004 tartalék). | 13, 15 |
| KI-24 | **Nincs proxy cache:** minden kimutatás-kérés egy teljes SEC companyfacts letöltés (több MB). | K (költség, sebesség) | **Tudatos (D-044):** `no-store`. TTL-cache: PHASE 13 (ARCHITECTURE 11.: kimutatás 7 nap). | 13 |
| KI-25 | A **ticker → CIK leképezés változhat** (valós lelet: az XOM ticker új holding-CIK-re mutat, amely alatt még nincs 10-K → az éves készlet üres). | A | Kezelve: üres készlet + megjegyzés. A ticker-lista 24 órás memóban van. | – |
| KI-26 | A csak összehasonlító adatként szereplő éves időszakok címkéje a záródátum évéből jön (január 1–7. → előző év) `[FELTÉTELEZÉS]`. | A | Megjegyzés jelzi a kimenetben. A PHASE 06 felülvizsgálja (pl. 52/53 hetes, januári év végű cégek). | 06 |
| KI-27 | A dev szerver az API-route (szerver) kód változását **nem töltötte újra** (gyorsítótárazott szerver-bundle). | A | Szerverkód módosítása után a dev szervert újra kell indítani. | – |
| KI-28 | A címlapról (dei) vett részvényszám dátuma (`asOf`) **eltér** az időszak végétől (pl. JNJ: 2025-12-28 mérleg, 2026-02-06 címlap). | A | Az `asOf` és a `reference` jelzi (R-16). A PHASE 06 dönt a market cap-számításnál. | 06 |
| KI-29 | Az **EAS Hosting nem telepít „secret” típusú env-változót**, csak „plain text”/„sensitive”-et (Expo docs). Az EAS-próbatelepítés nem készült el. | K (04B kulcsok) | A D-004 Ideiglenes marad. A kulcsokat „sensitive” változóként kell kezelni, vagy a Cloudflare Workers tartalék. Döntés: a PHASE 04B / 16 előtt. | 04B, 16 |

## PHASE 03 – ismert problémák és leletek (2026-11-21)

| ID | Probléma / lelet | Hatás | Állapot / teendő | Felelős fázis |
|---|---|---|---|---|
| KI-11 | **A PHASE 02 route-tesztjei kisbetűs meghajtójú munkakönyvtárból (`c:\…`, pl. VS Code terminál, Git Bash) pirosak voltak** (5/15: „Invalid hook call”). Ok: a Jest a modulokat `c:\` és `C:\` kulccsal kétszer töltötte be, így két React-példány keletkezett. PowerShellből (`C:\…`) zöldek voltak, ezért a PHASE 02 „15/15” eredménye csak onnan igaz. | K: hamis piros teszt a VS Code-ban | **Megoldva:** `jest.config.js` kanonikus `rootDir`-rel (D-041). Igazolva: kisbetűs útvonalról 98/98 zöld. | – |
| KI-12 | A PHASE 03-ban az appot **nem** indítottuk el emulátoron. Ellenőrizve: typecheck, lint, tesztek (a route-tesztek a valódi `_layout`-ot renderelik a Providerrel), `npx expo export --platform android` (Hermes bundle sikeres). Látható UI-változás nem történt. | A | **Nyitott.** A PHASE 04A-ban sem futtattuk emulátoron (nincs UI-változás); ellenőrizve: `npx expo export --platform android` (Hermes bundle, 3,6 MB) és a route-tesztek. Következő UI-változásnál: `npm run android`. | 12 |
| KI-13 | A portfólió-tároló memóriában él (`InMemoryPortfolioRepository`): az app újraindításakor az adatok elvesznek. | A most (nincs portfólió-UI) | **Tudatos (D-040).** SQLite: PHASE 13. | 13 |
| KI-14 | `live` adatmódban az árfolyam-lekérés `UPSTREAM / NOT_IMPLEMENTED` hibát ad. | A | **Részben megoldva (04A):** `live` módban a proxy gateway-ek futnak (kimutatás, jegyzés, FX). Az árfolyamhoz nincs még élő forrás: `CAPABILITY_UNAVAILABLE` → `MISSING_DATA(['source'])`; proxy URL nélkül `NOT_IMPLEMENTED`. Árforrás: PHASE 04B. | 04B |
| KI-15 | A lokális ID-generátor `Math.random`-ot és időbélyeget használ (nem kriptográfiai UUID). Egy eszközön belül egyedi, eszközök között nem garantáltan. | A | **Nyitott.** Tartós tárolásnál felülvizsgálandó (pl. `expo-crypto` `randomUUID`). | 13 |
| KI-16 | Az ARCHITECTURE 7. tervében szereplő `Logger` port és az ARCHITECTURE 10. naplózás még nincs megvalósítva; az `FxGateway` és az `AiGateway` sem. | A | **Részben megoldva (04A):** `FxGateway` kész (`convertMoney`); szerveroldali JSON-napló kész (`src/server/logging.ts`). Kliensoldali `Logger` port még nincs (nincs használója); `AiGateway`: PHASE 11. | 11, 12 |

## PHASE 02 – ismert problémák és leletek (2026-11-21)

| ID | Probléma / lelet | Hatás | Állapot / teendő | Felelős fázis |
|---|---|---|---|---|
| KI-01 | `npm audit`: 22 közepes (moderate) súlyosságú sérülékenység, mind tranzitív, a fejlesztői eszközláncban (fő ok: `glob` 9.0.0–14.0.1 a Jest-függőségekben). Az `npm audit fix --force` törné az SDK 58-hoz pinnelt verziókat. | A: csak fejlesztői/teszt eszköz, nem kerül az appba | **Nyitott, tudatosan nem javítva.** Újraellenőrzés Expo/Jest patch-frissítéskor és a PHASE 15-ben. | 15 |
| KI-02 | Az npm 12 `allowScripts` alapból blokkolja a `@parcel/watcher` install-scriptjét (a Jest fájlfigyelőjéhez kell). Az előre fordított `@parcel/watcher-win32-x64` települt és betölthető. | A | **Nincs teendő.** Ha a `npm run test:watch` mégis hibát adna: `npm install-scripts approve @parcel/watcher`. | – |
| KI-03 | Az Expo docs szerinti `npx expo install … -- --dev` npm 12.2.0-val hatástalan, a csomag a `dependencies`-be kerül. `--save-dev`-vel sem került át minden csomag (`jest`, `jest-expo`, `@types/jest`, `eslint-config-expo`). | A | **Kerülőút:** `-- --save-dev`, és utána mindig ellenőrizni kell a `package.json`-t; ha kell, kézi áthelyezés + `npm install`. Rögzítve a README-ben és a fázisútmutatóban. | minden fázis |
| KI-04 | A felhasználói `Path` hivatkozik a `%ANDROID_HOME%`-ra és a `%JAVA_HOME%`-ra, de ezek nincsenek definiálva, és a `Path` registry-típusa `REG_SZ` (nem `REG_EXPAND_SZ`), így a hivatkozások nem oldódnak fel. Az `adb` nincs a PATH-ban. | A: az Expo CLI `ANDROID_HOME` nélkül is megtalálja az SDK-t az alapértelmezett helyen | **Nyitott (opcionális).** A javítás leírása: `docs/phases/phase-02-project-setup.md` 13.2. Gépbeállítást módosít, ezért a tulajdonos dönt róla; a PHASE 02-ben nem futtattuk. | tulajdonos |
| KI-05 | A JDK az Android Studio JBR-je (OpenJDK 25.0.3), a `JAVA_HOME` nincs beállítva. A helyi natív build (`npx expo run:android`, development build) JDK-követelménye RN 0.88 / Gradle mellett nincs igazolva. | A most (Expo Go) / K dev buildnél | **Nyitott.** Akkor kell ellenőrizni, amikor development buildre váltunk (D-002). | dev build döntéskor |
| KI-06 | A sablon néhány SDK 58-as függősége jelenleg nincs használva (`@expo/ui`, `expo-glass-effect`, `expo-device`, `expo-symbols`, `expo-web-browser`, `expo-image`, `react-native-reanimated`/`worklets`, `react-native-gesture-handler`). | A: Expo Go-ban nincs költsége, natív buildben méretet növel | **Nyitott.** A PHASE 12 a UI-döntések után eltávolíthatja a feleslegeseket (D-029). | 12 |
| KI-07 | A web platform (`npm run web`, `web.output: "server"`) nincs tesztelve. Nem célplatform, de az API route-ok (proxy) ugyanerre a szerverkimenetre épülnek. | A | **Nyitott.** A PHASE 04A spike ellenőrzi az API route-okat. **04A:** az API route-ok lokálisan működnek (`npx expo start`), a `npx expo export --platform web` szerver-bundle elkészül; a web UI továbbra sem tesztelt. | 04A |
| KI-08 | Az SDK 58-as Expo Go **store-verziójának** elérhetőségét nem ellenőriztük. Emulátoron az Expo CLI maga telepítette az Expo Go 58.0.5-öt. | A emulátoron / K saját telefonon | **Nyitott.** Saját telefonos teszt előtt a store-verziót ellenőrizni kell; tartalék: USB + `npm run android` vagy development build. | 12 vagy 16 |
| KI-09 | Az RNTL 14 `render`/`fireEvent` aszinkron. `await` nélkül átfedő `act()` hívások keletkeznek, és a *következő* tesztek véletlenszerűen buknak. | – | **Megoldva:** `await` + `@typescript-eslint/no-floating-promises` lint-szabály (D-030, D-032). | – |
| KI-10 | A `<Link asChild>` + függvény formájú `Pressable` `style` miatt a gomb háttere eltűnt (emulátoron észlelve). | – | **Megoldva:** statikus style a `PrimaryButton`-ban + regressziós teszt (D-034). | – |

A DP-01…DP-04 döntési pontokra 2026-11-21-én megjött a válasz. A DP-05 tudatosan nyitva marad; a terv ehhez igazodik (D-027).

## Döntési pontok

| ID | Kérdés | Válasz (2026-11-21) | Hatás |
|---|---|---|---|
| **DP-01** | Milyen piacokat akarsz elemezni? | US részvények és ETF-ek, európai UCITS ETF-ek és részvények, globális ETF-ek és részvények | D-023, D-025 |
| **DP-02** | Saját használat vagy nyilvános kiadás? | Csak saját használat | D-008 Elfogadva |
| **DP-03** | Melyik árfolyam-szolgáltató? | FMP és EODHD kulcs megvan. Ha más is ajánlott, ahhoz is legyen adapter. | D-024: + SEC EDGAR, ECB/Frankfurter, OpenFIGI adapter (ingyenesek, kiegészítők) |
| **DP-04** | AI-költség, modell | Lehetőleg ingyenes, de maradjon más lehetőség | D-026: szabályalapú összefoglaló az alap, LLM opcionális |
| **DP-05** | Fizetős adatforrás a nem US lefedettségért? | **Nyitott**, később dönt; ne legyen kizárva | D-027: csomagszint konfigurációból, appkiadás nélkül bekapcsolható |

**Új, nem sürgős kérdés:** a meglévő FMP és EODHD kulcs ingyenes vagy fizetős csomaghoz tartozik? Ezt a PHASE 04B ellenőrzi; az EODHD-nél ingyenesen, a `/api/user` végponttal (U-13).

## Kockázatok

| ID | Kockázat | V | H | Mitigáció | Felelős fázis |
|---|---|---|---|---|---|
| R-01 | **A nem US lefedettség ingyenesen erősen korlátozott:** EODHD free 20 hívás/nap és 1 év történet; nem US fundamentum free-ben nincs. A célpiac viszont US + Európa + globális (D-023). | M | M | Kvóta-költségvetés és prioritás (DATA_SOURCES 5.3); inkrementális frissítés; cache; ár alapú elemzés; őszinte `PLAN_LIMIT` jelölés; fizetős bővítés konfigurációval (D-027) | 04B |
| R-02 | Az ingyenes csomagok „personal/internal use” feltételűek. **Megoldva:** csak saját használat (D-008). A feltételeket így is be kell tartani (pl. az adat nem osztható meg másokkal). | A | A | D-008; DATA_SOURCES 7.6 | 04 |
| R-03 | **Nincs igazolt ingyenes ETF holdings forrás.** | M | K | Holdings az MVP-n kívül; SEC N-PORT vizsgálat (csak US alapok); kézi metaadat | 08 |
| R-04 | Rate limitek (SEC 10/mp; Tiingo 50/óra; FMP 250/nap; AV 25/nap). | K | K | Proxy cache; deduplikált kérések; adattípusonkénti TTL; 429-kezelés `retryAfter`-rel | 04, 13 |
| R-05 | **A SEC XBRL tagek heterogének** (pl. több árbevétel-tag, adósság-komponensek duplázása), ami hibás mutatókat okozhat. | M | M | Tag-fallback lista; 10+ valós cég fixture-tesztje; a provenance-ben a használt tag; `MISSING`, ha bizonytalan **04A:** 12 valós cég fixture-je, tag-prioritás valós adaton javítva (Revenues elöl, Domestic kizárva), a `reference` a használt taget mutatja, a totalDebt szándékosan MISSING (D-043). | 04, 06 |
| R-06 | Az SDK 58-as Expo Go store-elérhetősége nem igazolt; a `create-expo-app` alapból SDK 57-et adhat. **PHASE 02: kezelve.** Explicit `--template default@sdk-58`; emulátoron az Expo CLI telepítette az Expo Go 58.0.5-öt. Saját telefonhoz lásd KI-08. | A | K | Explicit SDK 58 sablon; Expo Go CLI-ből Android emulátorra; szükség esetén development build | 02 ✅ |
| R-07 | **Proxy visszaélés:** fiók nélkül bárki hívhatja a végpontot, aki ismeri az URL-t. | K | K | Allowlist, validáció, rate limit, cache, AI kill switch és napi keret; később app attestation | 04, 11, 15 |
| R-08 | Az EAS Hosting rate-limit/KV képessége nem ismert (U-03). | K | K | Spike a 04-ben; tartalék: Cloudflare Workers (D-004) **04A:** U-03 megválaszolva: nincs KV/rate-limit primitív → memóriabeli limiter (KI-23); a Cloudflare-tartalék indoka erősödött. | 04 |
| R-09 | AI-költség és hallucináció. | K | M | Strukturált kimenet + zod; `basedOn`; csak számított bemenet; cache; költségkorlát; az AI opcionális | 11 |
| R-10 | Jogi: a BUY/SELL címkék nyilvános kiadásnál befektetési ajánlásnak minősülhetnének (MiFID II / MAR, jogi ellenőrzés kellene). **Saját használatnál nem releváns** (D-008); csak akkor, ha a DP-02 megváltozik. | A | A | Jogi nyilatkozat; konfigurálható címkék | 10 |
| R-11 | Késői integráció: a UI csak a 12-ben jön, így a hibák későn derülnek ki. | K | K | Use case-integrációs tesztek a 04-től; opcionális dev-diagnosztika képernyő (ROADMAP kiegészítések 2.) | 04–11 |
| R-12 | Lebegőpontos kerekítési hiba. | A | K | Kerekítés csak a megjelenítésnél; tűréses tesztek; D-009 felülvizsgálata a 09-ben | 05, 09 |
| R-13 | Adatvédelem: a portfólió összetétele AI-hívással az LLM-szolgáltatóhoz kerül. | K | K | Explicit, egyszeri beleegyezés; minimális DTO (súlyok és típusok, összegek nélkül, ha elég) | 11 |
| R-14 | Strict TypeScript API (RN 0.87+): harmadik fél csomagjai típushibát okozhatnak. | K | A | Csak kompatibilis csomag; a `customConditions` opt-out csak végső esetben, dokumentálva (RN 0.89 után megszűnik) | 02, 12 |
| R-15 | Windows környezet: az `ANDROID_HOME` nincs beállítva, az `adb` nincs a PATH-ban. **PHASE 02: az Expo CLI nélküle is működik** (alapértelmezett SDK-hely); az opcionális javítás dokumentálva (KI-04). | A | A | Lépésenkénti útmutató a 02-ben (fázisútmutató 13.2) | 02 ✅ |
| R-16 | A `sharesOutstanding` (címlap) dátuma eltér az ár dátumától, ami torzítja a market capet. | K | A | `asOf` megjelenítése; a dátumeltérés jelzése | 06 |
| R-17 | ADR / külföldi filer: a beszámoló pénzneme eltér a jegyzés pénznemétől. | K | K | DATA_DICTIONARY 4.3/8: FX-konverzió dátummal; hiányában `MISSING` | 06, 07 |
| R-18 | DCF egyszerűsítés: az FCF (OCF − CapEx) nem tiszta FCFF. | M | K | Jelölés a UI-ban; a 07 dönthet FCFF-közelítésről (D-022) | 07 |
| R-19 | A szolgáltatói feltételek és keretek változnak (az ellenőrzés 2026-11-21-i). | K | K | Újraellenőrzés minden adatfázisban; adapter-minta a cseréhez | 04, 16 |
| R-20 | Az app-szintű adatbázis-titkosítás nem elérhető Expo Go-ban (SQLCipher). | M | A | OS szintű eszköztitkosítás; O-05 opcionális dev builddel | 13 |
| R-21 | Több szolgáltató, eltérő definíciókkal (pl. FMP vs SEC árbevétel), ami inkonzisztens mutatókat okozhat. | K | M | „Egy adatsor = egy forrás”; nincs csendes keverés; provenance a ténylegesen használt forrással; contract tesztek szolgáltatónként | 04B |
| R-22 | EODHD free kvóta: 20 hívás/nap. Egy fundamentum-kérés 10, egy bulk 100 hívás, így free-ben gyakorlatilag nincs fundamentum és bulk; kb. 15–18 nem US instrumentum frissíthető naponta. | M | K | Kvóta-költségvetés; prioritás (portfólió > watchlist > keresés); `/api/user` (0 hívás); a 402/429 kezelése | 04B |
| R-23 | Az FMP free lefedettsége és feltételei hivatalos forrásból nem igazoltak (két hivatalos URL is 403). | K | K | A PHASE 04B a saját kulccsal próbahívásokkal és a fiók-dashboarddal igazolja | 04B |
| R-24 | API-kulcs szivárgása (chatbe illesztés, véletlen commit). **PHASE 02:** `.gitignore` → `.env*` + `!.env.example`, `git check-ignore` ellenőrizve. | K | M | Kulcs csak `.env.local`-ba (gitignore), soha chatbe; a PHASE 02 `.gitignore`-ja; secret-scan a PHASE 15-ben | 02 ✅, 04, 15 |
| R-25 | A PHASE 04 túl nagy egy chathez. | M | K | D-028: 04A + 04B **04A:** a 04A egy chatben elkészült (D-028 Elfogadva). | 04 |
| R-26 | Ugyanaz az ETF több tőzsdén és devizában forog, ami rossz listing választásához és téves P/L-hez vezethet. **PHASE 03:** az `Instrument`/`Listing` modell és a listinghez kötött `Transaction` elkészült. | K | K | D-025 Security/Listing; a pozíció listinghez kötött; a keresés listinget kínál | 03 ✅, 09 |
| R-27 | Az ECB kb. 30 devizát közöl. Globális listingeknél lehet olyan deviza, ami nincs benne. | K | K | `MISSING` státusz; opcionálisan a Frankfurter más központi banki forrása, külön provenance-szel **04A:** megvalósítva: az ECB-n kívüli deviza `missing` listába kerül, átváltáskor `MISSING_DATA` (D-046). | 04A |

## Ismeretlenek (ellenőrizendő)

| ID | Kérdés | Ki ellenőrzi |
|---|---|---|
| ~~U-01~~ | **Lezárva (PHASE 02):** React **19.3.0**, RN 0.88.1 (sablon + `npm ls` + `expo install --check`) | – |
| U-02 | Az SDK 58-as Expo Go store-verziója megjelent-e. **PHASE 02 részeredmény:** emulátorra a CLI telepíti (Expo Go 58.0.5); a store-t nem ellenőriztük → KI-08 | saját telefonos teszt előtt |
| U-03 | Van-e az EAS Hostingon tartós rate-limit/KV primitív, vagy elég-e a memóriabeli | **Megválaszolva (04A):** nincs ilyen primitív (Expo docs); a memóriabeli limiter példányonkénti (KI-23). |
| U-04 | Az FMP free keretei és licence hivatalos forrásból (most `[HARMADIK FÉL]`) | PHASE 04B |
| U-05 | ~~Alpha Vantage ToS~~ – nem releváns, nincs adapter (D-024) | – |
| U-06 | ~~Tiingo lefedettség~~ – nem releváns, amíg nincs Tiingo adapter (D-024) | – |
| U-07 | SEC `company_tickers.json` (ticker → CIK) elérhetősége és formátuma | **Lezárva (04A):** elérhető, `{ "0": { cik_str, ticker, title } }`, 10 399 sor; User-Agent nélkül 403. |
| U-08 | A SEC N-PORT használhatósága US ETF holdingsra (gyakoriság, késleltetés) | PHASE 08 |
| U-09 | A `@anthropic-ai/sdk` futása az EAS Hosting runtime-on | PHASE 11 |
| U-10 | `Intl` (hu-HU) támogatás Hermesen mindkét platformon | PHASE 12 |
| U-11 | Grafikonkönyvtár kompatibilitása SDK 58 / RN 0.88 / New Architecture mellett | PHASE 12 |
| ~~U-12~~ | **Lezárva (PHASE 02):** `npx create-expo-app@5.0.0 <név> --template default@sdk-58` (SDK 58 changelog; `expo-template-default` `sdk-58` = 58.0.35) | – |
| U-13 | A meglévő FMP és EODHD kulcs csomagszintje (free vagy fizetős) | PHASE 04B (EODHD `/api/user`, FMP dashboard) |
| U-14 | EODHD free: mely végpontok érhetők el (fundamentum? live/delayed?), történetmélység | PHASE 04B |
| U-15 | FMP free: van-e nem US lefedettség, ETF-adat | PHASE 04B |
| U-16 | Ingyenes LLM-lehetőségek (lokális modell, más szolgáltatók free kerete) | PHASE 11 |

## Promptcsomag-ellentmondások (feloldva: D-020)

| ID | Ellentmondás | Feloldás | Javaslat a tulajdonosnak |
|---|---|---|---|
| PI-01 | A `00_KEZDES_ES_HASZNALAT.md` a PHASE 02-höz „Expo SDK 57”-et ír; a 12, 13, 14 és 16-os prompt is SDK 57-et említ. A CLAUDE.md és a 01/02 SDK 58-at. | **SDK 58** (a CLAUDE.md az irányadó) | Javítsd a promptokban az „SDK 57”-et „SDK 58”-ra |
| PI-02 | A 02, 03 és 04-es prompt „Equity Analyst” néven hivatkozik a projektre. | Ugyanaz a projekt: Stock & ETF Analyzer | Névcsere a promptokban |
| PI-03 | A 02-es prompt a `docs/00_PROJECT_INSTRUCTION.md`-t kéri. | A valós fájl a gyökérben lévő `CLAUDE.md` (tartalma azonos a `00_PROJECT_INSTRUCTIONS.md`-vel) | Útvonal javítása a 02-es promptban |
| PI-04 | A 02-es prompt a `docs/phase-01-handoff.md`-t kéri. | A valós hely: `docs/handoffs/phase-01-handoff.md` (a CLAUDE.md konvenciója) | Útvonal javítása a 02-es promptban |
| PI-05 | Egyik prompt sem rendeli fázishoz a backend/proxy építését. | ROADMAP „kiegészítések” 1. pont | – |
| PI-06 | A 02-es prompt (aktuális változat) a `docs/handoffd/phase-01-handoff.md`-t kéri (elírás: „handoffd”). | A valós hely: `docs/handoffs/phase-01-handoff.md` | Elírás javítása a 02-es promptban |
| PI-07 | A 03-as prompt a `docs/phases/phase-02-handoff.md`-t kéri, és „Equity Analyst” néven hivatkozik a projektre. | A valós hely: `docs/handoffs/phase-02-handoff.md`; a név: Stock & ETF Analyzer (PI-02) | Útvonal javítása a 03-as promptban |
| PI-08 | A 03-as prompt `Instrument`, `Stock`, `Etf` modelleket kér, a D-025 `Security`/`Listing` fogalmakat használ. | `Instrument = Stock \| Etf` a Security típusneve, a `Listing` külön (D-035) | – |
