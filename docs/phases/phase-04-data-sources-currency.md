# PHASE 04 – Adatforrások, proxy és deviza (kezdőbarát útmutató)

> Dátum: 2026-11-21 · Állapot: **04A KÉSZ**, 04B következik (D-028) · Előző: [phase-03-architecture-domain-model.md](phase-03-architecture-domain-model.md) · Átadás: [../handoffs/phase-04a-handoff.md](../handoffs/phase-04a-handoff.md)

Ez az útmutató lépésenként leírja, mi készült a PHASE 04A-ban, miért, és hogyan ellenőrizheted magad. A **teljes, aktuális kód a repóban van** a megadott útvonalakon. Itt a lényeget, a parancsokat és a várt eredményt mutatjuk meg. A PHASE 04B (FMP, EODHD, routing) a 04B végén új fejezetként kerül ide.

## Tartalom
0. [Szakszavak röviden](#0-szakszavak-röviden)
1. [Indulóállapot ellenőrzése](#1-indulóállapot-ellenőrzése)
2. [A .env.local létrehozása (SEC User-Agent)](#2-a-envlocal-létrehozása)
3. [Az adatforrások ellenőrzése élő próbahívásokkal](#3-az-adatforrások-ellenőrzése)
4. [Valós teszt-fixture-ök rögzítése](#4-valós-teszt-fixture-ök-rögzítése)
5. [Domain-bővítések (jegyzés-jelölt, kimutatás-készlet, FX)](#5-domain-bővítések)
6. [Contracts – az API-szerződés v1](#6-contracts)
7. [A szerver (proxy): szolgáltatók, handlerek, route-ok](#7-a-szerver-proxy)
8. [Kliensoldal: proxy-kliens, FxService, use case-ek](#8-kliensoldal)
9. [Rétegszabályok kiegészítése + bizonyítás](#9-rétegszabályok)
10. [Tesztek](#10-tesztek)
11. [A proxy kipróbálása lokálisan (spike)](#11-a-proxy-kipróbálása-lokálisan)
12. [Build- és biztonsági ellenőrzés](#12-build--és-biztonsági-ellenőrzés)
13. [Gyakori hibák és javításuk](#13-gyakori-hibák)
14. [A 04A befejezésének feltételei](#14-befejezési-feltételek)

---

## 0. Szakszavak röviden

| Szó | Jelentés |
|---|---|
| **Proxy / BFF** | Saját kis szerver az app és a külső adatszolgáltatók között. Ő tárolja a titkokat (API-kulcsokat), ő hívja a szolgáltatót, és egységes alakban adja tovább az adatot. |
| **API route** | Az Expo Router olyan fájlja (`…+api.ts`), amely nem képernyő, hanem szerveroldali végpont: HTTP-kérést kap, választ ad. |
| **Adapter (provider)** | Egy szolgáltatóhoz (SEC, ECB, OpenFIGI) írt kód, amely a szolgáltató saját formátumát a mi egységes formátumunkra alakítja. |
| **DTO** | „Data Transfer Object”: az adat alakja a hálózaton. A szolgáltatói DTO csak az adapterben él. |
| **Normalizálás** | Egységesítés: dátum ISO-formátumra, időszak FY/Q1…-re, pénznem ISO-kódra, hiányzó érték `MISSING` státuszra (soha nem 0-ra). |
| **Fixture** | Rögzített (itt: valós, megvágott) szolgáltatói válasz, amelyen a teszt fut. Így a teszt nem függ az internettől. |
| **Provenance** | Az érték „származási lapja”: forrás, lekérés ideje, az adat dátuma, a használt XBRL tag. |
| **ECB referencia-árfolyam** | Az Európai Központi Bank napi devizaárfolyama, EUR-hoz viszonyítva. |
| **Keresztárfolyam** | Két nem-EUR deviza aránya az EUR-on át: `HUF → USD = (EUR→USD) / (EUR→HUF)`. |
| **ISIN / MIC / FIGI** | Értékpapír-azonosító (pl. `IE00BK5BQT80`) / tőzsdekód (pl. `XETR`) / Bloomberg-féle nyílt azonosító. |
| **CIK** | A SEC cégazonosítója (10 számjegy, pl. `0000320193` = Apple). |
| **Spike** | Rövid próba, amely egy bizonytalan műszaki kérdést dönt el (itt: működik-e a proxy az Expo Router API route-okkal). |

## 1. Indulóállapot ellenőrzése

**Cél:** meggyőződni, hogy a PHASE 03 állapota ép.
**Hol:** a projekt gyökérmappája (`c:\Users\lujzi\Documents\stock-etf-analyzer`), VS Code terminál vagy PowerShell.

```powershell
git status
npm run check
```

**Elvárt (a 04A előtt):** tiszta munkakönyvtár; `npm run check` → `Tests: 98 passed`. (A 04A után: `Tests: 228 passed`.)

## 2. A .env.local létrehozása

**Cél:** a SEC csak akkor szolgál ki, ha a kérés `User-Agent` fejlécében kapcsolattartó e-mail-cím van. Ezt a proxy a `SEC_USER_AGENT` környezeti változóból olvassa. A cím személyes adat, ezért **nem kerülhet a kódba és a gitbe**.

1. VS Code: Explorer → a projekt gyökerén jobb klikk → **New File** → név: `.env.local`.
2. Tartalom (a saját címeddel):
   ```
   SEC_USER_AGENT="StockEtfAnalyzer a-te-email-cimed@pelda.hu"
   ```
3. Ellenőrzés (a `.env.local` gitignore-olt):
   ```powershell
   git check-ignore .env.local
   ```
   **Elvárt kimenet:** `.env.local`.

> **Fontos:** API-kulcsot (FMP, EODHD) soha ne illessz be chatbe; azokat is ide kell írni, a PHASE 04B elején.
> Ha fut egy `npm start` dev szerver, az env-változás után **újra kell indítani** (Ctrl+C, majd `npm start`) – lásd [13. fejezet](#13-gyakori-hibák).

## 3. Az adatforrások ellenőrzése

**Cél:** a PHASE 04 prompt 2. feladata szerint a forrás kiválasztása előtt ellenőrizni a formátumot, a limitet és a korlátokat. Mi ezt élő próbahívásokkal tettük; az eredmény a [DATA_SOURCES.md 10. fejezetében](../DATA_SOURCES.md) van, hivatkozásokkal.

A legfontosabb tanulságok:
- **ECB / Frankfurter v2:** kulcs nélkül, `[{date, base, quote, rate}]` tömb. Hétvégén a pénteki rátát adja. Az ECB által nem közölt devizára üres listát ad, hibás bemenetre HTTP 422-t.
- **OpenFIGI:** ISIN-ből jegyzéseket ad, de **jegyzési pénznemet és MIC-et nem**, csak Bloomberg tőzsdekódot (`exchCode`). Ezért csak a próbahívással **igazolt** `exchCode → MIC` párokat használjuk (pl. Xetra = `GT`, nem `GY`, ahogy emlékezetből írtuk volna).
- **SEC EDGAR:** kulcs nincs, de User-Agent kell (nélküle HTTP 403). Cégenként több MB adatot ad, és a formátumban meglepetések vannak (lásd 4. fejezet).

Kipróbálhatod magad is (PowerShellben a `curl.exe`-t használd):
```powershell
curl.exe -s "https://api.frankfurter.dev/v2/providers/ecb/rates?base=EUR&quotes=USD,HUF"
```
**Elvárt:** `[{"date":"…","base":"EUR","quote":"HUF","rate":…},{…"quote":"USD"…}]`.

## 4. Valós teszt-fixture-ök rögzítése

**Cél:** a tesztek valós, de kis méretű adaton fussanak, internet nélkül (R-05: a SEC XBRL tagek heterogének, ezt csak valós adat mutatja meg).

**Fájl:** [`scripts/record-sec-fixtures.mjs`](../../scripts/record-sec-fixtures.mjs). A script:
- a `.env.local`-ból olvassa a `SEC_USER_AGENT`-et (nem írja ki, nem menti el);
- letölti a ticker → CIK listát és 12 cég companyfacts adatát, 250 ms szünettel;
- megvágja őket: csak a normalizáló által használt XBRL tagek és a 2021 utáni tények maradnak;
- kiírja a `src/server/providers/sec-edgar/__fixtures__/` mappába.

**Futtatás** (a projekt gyökerében):
```powershell
node scripts/record-sec-fixtures.mjs
```
**Elvárt kimenet:** `Ticker-lista: 10399 sor.`, majd cégenként egy sor, pl. `AAPL (CIK 0000320193): 1476 tény → …`, végül `Kész.`. Egy `MODULE_TYPELESS_PACKAGE_JSON` figyelmeztetés ártalmatlan.

**Mit mutatott meg a valós adat?** (Ezek mind javításra kerültek.)
| Lelet | Javítás |
|---|---|
| BRK-B, WMT: a `RevenueFromContract…` tag csak részösszeg | a `Revenues` lett az első a prioritási listán |
| `…BeforeIncomeTaxesDomestic` = csak belföldi adózás előtti eredmény | kivettük a listából |
| JNJ: a mérleg mellé egy KÉSŐBBI 10-Q címlapjának részvényszáma került | a címlap-adat csak az időszak saját filingjéből jöhet |
| XOM: a `cik` mező szöveg (`"2115436"`), nem szám | a séma mindkettőt elfogadja (csak számjegyekkel) |
| TSM: TWD és USD egységben is jelent | a kimutatás pénzneme a domináns egység (TWD) |

A többi fixture (ECB, OpenFIGI) a próbahívások valós válaszaiból készült, `_fixture` fejléccel (forrás, URL, dátum).

## 5. Domain-bővítések

**Cél:** az új adatok típushelyes, validált formája – UI-tól és hálózattól függetlenül (D-042, D-046).

| Fájl | Mi ez? |
|---|---|
| [`src/domain/instrument/listing-candidate.ts`](../../src/domain/instrument/listing-candidate.ts) | `ListingCandidate`: tőzsdei jegyzés-jelölt, ahol a pénznem lehet `null` (az OpenFIGI nem adja – nem találjuk ki). `SecurityListings`: a jegyzések + a kihagyott sorok okonkénti száma. |
| [`src/domain/fundamentals/financial-statement-set.ts`](../../src/domain/fundamentals/financial-statement-set.ts) | Egy cég kimutatásai egy gyakoriságra; a konstruktor tiltja a források keverését. |
| [`src/domain/fx/fx-conversion.ts`](../../src/domain/fx/fx-conversion.ts) | Devizaátváltás: közvetlen / inverz / EUR-on át számolt ráta, GBX /100, a natív összeg megtartása. Hiányzó rátánál hiba, **nincs becslés**. |
| [`src/domain/shared/currency.ts`](../../src/domain/shared/currency.ts) | Javítás: a `GBp` (penny) `GBX` lesz. A sima nagybetűsítés `GBP`-t (fontot) csinált volna belőle, ami 100-szoros hiba. |

**A képlet egy példán** (valós ECB-ráta 2026-11-20): 100 USD → HUF = 100 / 1,099 × 373,55 = **33 989,99 HUF**. Az eredményben a natív `100 USD`, a ráta, a dátuma (`2026-11-20`) és a forrása is benne van.

## 6. Contracts

**Cél:** a kliens és a proxy UGYANAZT a zod-sémát használja, így ami a szerverről elmegy, azt a kliens el is fogadja (D-039, D-044).

| Fájl | Végpont |
|---|---|
| [`src/contracts/fx.ts`](../../src/contracts/fx.ts) | `GET /api/v1/fx` |
| [`src/contracts/listings.ts`](../../src/contracts/listings.ts) | `GET /api/v1/securities/{isin}/listings` |
| [`src/contracts/financials.ts`](../../src/contracts/financials.ts) | `GET /api/v1/stocks/{listingId}/financials` – **minden sortétel-kulcs kötelező**, így tétel nem tűnhet el csendben |
| [`src/contracts/health.ts`](../../src/contracts/health.ts) | `GET /api/v1/health` |
| [`src/contracts/quote.ts`](../../src/contracts/quote.ts) | + `quoteToDto` (domain → hálózati alak) |

Új segéd: `withDomain(séma, konstruktor)` a [`shared.ts`](../../src/contracts/shared.ts)-ben. A zod az alakot ellenőrzi, az üzleti szabályt a domain-konstruktor, így egy szabály csak egy helyen él. Új hibakód: `CAPABILITY_UNAVAILABLE` („ehhez nincs bekötött forrás”). A teljes szerződés: [DATA_DICTIONARY 11.](../DATA_DICTIONARY.md).

## 7. A szerver (proxy)

**Cél:** a titkokat és a szolgáltatói formátumokat a szerveren tartani (D-004, D-005).

```
src/app/api/v1/…+api.ts      ← vékony route: csak továbbhív
  → src/server/handlers/       bemenet-validáció, hibából HTTP-válasz, kimenet ellenőrzése
    → src/server/providers/    sec-edgar, ecb-fx, openfigi, mock (a MarketDataProvider szerződés szerint)
      → src/server/http/       request-json.ts: timeout / 429 / 402 / 404 / 5xx / hibás JSON egységesen
```

- [`market-data-provider.ts`](../../src/server/providers/market-data-provider.ts): képességenként külön metódus (`getQuote`, `getPriceHistory`, `getFinancialStatements`, `getSecurityListings`, `getFxRates`). Egy adapter csak azt valósítja meg, amit a forrás tényleg ad. A képességlista a metódusokból származik, így nem lehet „hazudni”.
- [`server-context.ts`](../../src/server/server-context.ts): `PROXY_DATA_MODE=live` (alap) → SEC, ECB, OpenFIGI; `mock` → csak a demó szolgáltató. **Soha nem vegyesen** (D-045).
- [`env.ts`](../../src/server/env.ts): a `SEC_USER_AGENT` értéke soha nem kerül naplóba vagy hibaüzenetbe.
- Árfolyamhoz (quote) a 04A-ban nincs élő forrás → a proxy őszintén `501 CAPABILITY_UNAVAILABLE`-t ad, nem demóadatot.

## 8. Kliensoldal

**Cél:** az app a use case-eken át, a saját szerződésen keresztül kérjen adatot.

| Fájl | Mi ez? |
|---|---|
| [`src/application/ports/index.ts`](../../src/application/ports/index.ts) | `MarketDataGateway` (+ jegyzések, kimutatások), **új** `FxGateway` |
| [`src/application/use-cases/convert-money.ts`](../../src/application/use-cases/convert-money.ts) | **FxService**: átváltás; ≤ 4 nap FRESH, ≤ 10 nap STALE (átvált, jelölve), régebbi → hiba |
| [`src/application/use-cases/get-market-reference-data.ts`](../../src/application/use-cases/get-market-reference-data.ts) | `getSecurityListings`, `getFinancialStatements` (frissesség a saját óránkkal) |
| [`src/infrastructure/api-client/proxy-http-client.ts`](../../src/infrastructure/api-client/proxy-http-client.ts) | offline → `NETWORK`, timeout → `TIMEOUT`, nem JSON → `CONTRACT_MISMATCH` |
| [`src/infrastructure/api-client/proxy-gateways.ts`](../../src/infrastructure/api-client/proxy-gateways.ts) | a proxy-végpontok hívása a közös sémákkal |
| [`src/config/container.ts`](../../src/config/container.ts) | `mock` → demó gateway-ek; `live` + URL → proxy gateway-ek; `live` URL nélkül → őszinte hiba |

**Kézi frissítés és frissesség (feladat 10.):** a 04A-ban nincs cache, ezért minden hívás friss lekérés. Minden eredményben benne van a `fetchedAt` (mikor kértük le), az `asOf` (mire vonatkozik az adat) és a `freshness` (FRESH/STALE/EXPIRED/UNKNOWN). A UI (PHASE 12) ebből jelez és ajánl frissítést.

## 9. Rétegszabályok

**Cél:** a szerverkód (és benne a titok) soha ne kerülhessen az appba (ARCHITECTURE 3.).

**Fájl:** [`eslint.config.js`](../../eslint.config.js). Új zónák:
- `src/server` → csak `domain` és `contracts` importálható;
- `src/config` → nem importálhat `src/server`-t;
- `src/app/api/**` → importálhatja a `src/server`-t, a kliensoldali rétegeket nem.

**Bizonyítás:** négy szándékosan hibás, ideiglenes fájllal futtattuk az ESLintet (`src/config/zz-bad.ts`, `src/server/zz-bad.ts`, `src/presentation/zz-bad.ts`, `src/app/api/v1/zz-bad+api.ts`), majd töröltük őket. **Kimenet (rövidítve):**
```
src\app\api\v1\zz-bad+api.ts   error  … A +api.ts route vékony: csak a src/server handlereit hívhatja
src\config\zz-bad.ts           error  … A kliens (src/config) soha nem importálhat src/server-t …
src\presentation\zz-bad.ts     error  … A presentation csak use case-eken át (useAppServices) ér el adatot
src\server\zz-bad.ts           error  … A src/server csak a domaint és a contracts-ot importálhatja …
✖ 4 problems (4 errors, 0 warnings)
```
A valódi `health+api.ts` (amely a szervert importálja) hiba nélkül átment.

## 10. Tesztek

```powershell
npm test
```
**Elvárt:** `Test Suites: 19 passed`, `Tests: 228 passed`.

| Tesztfájl | Mit igazol? |
|---|---|
| `src/server/http/http.test.ts` | timeout, offline, 429 + Retry-After, 402, 404, 5xx, hibás JSON; ütemező (SEC ≤ 10/mp); env (az érték nem kerül hibaüzenetbe) |
| `src/server/providers/sec-edgar/sec-edgar.test.ts` | mind a 12 valós cégen: szerződés-egyezés, egy forrás, hiány ≠ 0, időszakhossz; golden értékek (pl. AAPL FY2025 árbevétel = 416 161 000 000 USD); hibaágak |
| `src/server/providers/ecb-fx/ecb-fx-provider.test.ts` | valós ECB-ráták, hétvége, nem közölt deviza, 422, hibás szerkezet |
| `src/server/providers/openfigi/openfigi-provider.test.ts` | VWCE 179 sorából 11 igazolt jegyzés; US kompozit; „No identifier found.” |
| `src/server/handlers/api-handlers.test.ts` | minden végpont, bemenet-validáció, HTTP-kódok, a health és a napló nem szivárogtat |
| `src/domain/fx/fx-conversion.test.ts` | inverz és keresztárfolyam, GBX, régebbi dátum, demó marad demó |
| `src/application/use-cases/phase04-use-cases.test.ts` | FRESH / STALE / EXPIRED / történeti átváltás |
| `src/__tests__/proxy-integration.test.ts` | **végponttól végpontig**: kliens use case → proxy-kliens → valódi szerver-handler → adapter → fixture, hálózat nélkül |

## 11. A proxy kipróbálása lokálisan

**Cél (D-004 spike):** igazolni, hogy a proxy az Expo dev szerverén valóban fut, és élő adatot ad.

1. Indítsd a dev szervert (ha már fut egy, előbb állítsd le Ctrl+C-vel, hogy az új `.env.local`-t is lássa):
   ```powershell
   npm start
   ```
2. **Másik** terminálban hívd meg a végpontokat:
   ```powershell
   curl.exe -s http://localhost:8081/api/v1/health
   curl.exe -s "http://localhost:8081/api/v1/fx?quotes=USD,HUF"
   curl.exe -s http://localhost:8081/api/v1/securities/IE00BK5BQT80/listings
   curl.exe -s "http://localhost:8081/api/v1/stocks/AAPL@XNAS/financials?period=annual"
   curl.exe -s http://localhost:8081/api/v1/instruments/AAPL@XNAS/quote
   ```

**Elvárt (2026-11-21-i futás alapján):**
| Végpont | Eredmény |
|---|---|
| health | `"dataMode":"live"`, `sec-edgar`, `ecb-fx`, `openfigi` mind `"configured":true` |
| fx | `"base":"EUR"`, a HUF és az USD rátája az utolsó ECB-nappal |
| listings | 11 jegyzés, pl. `VWCE@XETR`, `VWRA@XLON`; `"omitted":{"unmappedVenue":160,"composite":8,…}` |
| financials | `"entityName":"Apple Inc."`, 45 kimutatás (15 év × 3) |
| quote | `"code":"CAPABILITY_UNAVAILABLE"` – árforrás a PHASE 04B-ben |

Ha a health szerint `sec-edgar` `"configured":false`, a dev szerver a `.env.local` előtt indult: indítsd újra.

## 12. Build- és biztonsági ellenőrzés

```powershell
npx expo export --platform web --output-dir $env:TEMP\export-web
npx expo export --platform android --output-dir $env:TEMP\export-android
```
**Elvárt:** a web-exportnál `API routes (5)` lista; az Androidnál egy `entry-….hbc` fájl (~3,6 MB). Ellenőriztük, hogy az Android-bundle-ben **nincs** szolgáltatói URL (`data.sec.gov`, `api.openfigi.com`), szerverkód vagy a User-Agent értéke, és hogy a repó fájljaiban sincs `.env.local`-érték.

## 13. Gyakori hibák

| Tünet | Ok | Javítás |
|---|---|---|
| A SEC HTTP 403-at ad, vagy a health szerint `sec-edgar` nincs konfigurálva | hiányzik vagy hibás a `SEC_USER_AGENT`, vagy a dev szerver a `.env.local` előtt indult | írd be: `SEC_USER_AGENT="AppNév cím@domain.hu"`, majd indítsd újra a dev szervert |
| `Port 8081 is unavailable` | már fut egy dev szerver | használd azt, vagy állítsd le (Ctrl+C), vagy indíts másik porton: `npx expo start --port 8082` |
| A szerverkód módosítása után a régi viselkedés látszik | a dev szerver gyorsítótárazza a szerver-bundle-t | indítsd újra a dev szervert (KI-27) |
| `CAPABILITY_UNAVAILABLE` az árfolyamnál | a 04A-ban nincs árforrás | várt viselkedés; PHASE 04B |
| `UNSUPPORTED_MARKET` egy európai részvény kimutatásánál | a SEC csak US-filereket fed le | várt; nem US fundamentum: DATA_SOURCES 6. |
| `npm run check` Prettier-hibát ad egy `__fixtures__` fájlra | régi `.prettierignore` | a `.prettierignore` végén legyen: `**/__fixtures__/**` |
| A rögzítő script: „SEC_USER_AGENT nincs beállítva” | nincs `.env.local`, vagy nincs benne `@` | lásd [2. fejezet](#2-a-envlocal-létrehozása) |

## 14. Befejezési feltételek

**PHASE 04A (mind teljesült, 2026-11-21):**
- [x] `MarketDataProvider` szerződés + valós adapterek (SEC, ECB, OpenFIGI) + mock
- [x] Futásidejű validáció minden külső válaszra; hibaállapotok tesztelve
- [x] Normalizálás: dátum, időszak, pénznem, egység, provenance; hiány ≠ 0
- [x] FX service: natív és kijelzési pénznem külön, ráta + dátum + forrás, nincs csendes becslés
- [x] Titok csak szerver env-ben (szkenneléssel igazolva)
- [x] A proxy lokálisan fut; a spike eredménye a D-004-ben
- [x] `npm run check` exit 0 (228 teszt); a tesztek nem hívnak élő API-t
- [x] Dokumentáció: DATA_SOURCES, DATA_DICTIONARY, DECISIONS, KNOWN_ISSUES, ROADMAP, PROJECT_STATE, handoff

**PHASE 04B (következik):** FMP és EODHD adapter, ProviderRouter, kvóta-költségvetés, `/providers/status`, ár- és ártörténet-végpontok – lásd [ROADMAP](../ROADMAP.md) „04B”.
