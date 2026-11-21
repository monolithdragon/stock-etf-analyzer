# PHASE 01 – Követelmények és architektúra (kezdőbarát útmutató)

> Dátum: 2026-11-21 · Állapot: **KÉSZ** · Ebben a fázisban **nem készült programkód**, csak tervezési dokumentumok.

## 1. Miről szólt ez a fázis, és miért kellett?

Egy pénzügyi alkalmazásnál a legdrágább hiba a rosszul megválasztott alap: rossz adatforrás, rossz helyen tárolt titkos kulcs, vagy a felületbe keveredő képletek. Ezért mielőtt egyetlen sor kód születne, leírtuk:
- **mit** tudjon az app, és mit ne (követelmények);
- **hogyan** épüljön fel (architektúra);
- **honnan** jön az adat, és milyen feltételekkel (adatforrások);
- **mit jelent** pontosan egy-egy pénzügyi mező (adatszótár);
- **milyen sorrendben** épül (roadmap);
- **mi lehet a baj** (kockázatok).

Minden fázis **külön chatben** fut, és az új chat nem látja a régit. A folytonosságot ezek a fájlok biztosítják: a következő AI ezekből tudja, hol tart a projekt.

## 2. Mi készült? (fájllista)

Minden fájl a `c:\Users\lujzi\Documents\stock-etf-analyzer\docs\` mappában van.

| Fájl | Mire jó | Mikor nyisd meg |
|---|---|---|
| `PROJECT_STATE.md` | Hol tart most a projekt, mi van telepítve | Minden fázis elején |
| `REQUIREMENTS.md` | Termékcél, felhasználói folyamatok, MVP és később bontás | Ha kérdés, hogy „ez benne van-e” |
| `ARCHITECTURE.md` | Rétegek, adatfolyam, mappaszerkezet, proxy, teszt, biztonság, cache, offline, kiadás | Fejlesztés közben |
| `DECISIONS.md` | Döntések indoklással és dátummal | Ha valami „miért így van?” |
| `ROADMAP.md` | Fázisok célja, határa, befejezési feltétele | Fázisváltáskor |
| `DATA_SOURCES.md` | Adatszolgáltatók összevetése, korlátok, licenc, források | PHASE 04 és 08 előtt |
| `DATA_DICTIONARY.md` | Pénzügyi mezők és képletek definíciója, egységek | PHASE 05–09 |
| `KNOWN_ISSUES.md` | Kockázatok, ismeretlenek, döntési pontok (a válaszaiddal) | Ha valami kockázatos vagy bizonytalan |
| `phases/phase-01-requirements-architecture.md` | Ez az útmutató | – |
| `handoffs/phase-01-handoff.md` | Átadás a következő chatnek | PHASE 02 indításakor |

## 3. Fogalomtár

| Szó | Jelentés |
|---|---|
| **API** | Egy másik program „ablaka”, amin keresztül adatot kérhetünk (pl. árfolyamot). |
| **API-kulcs** | Jelszószerű azonosító, amivel egy szolgáltató tudja, ki kér adatot. Titok, nem kerülhet az appba. |
| **Proxy / BFF** | Saját kis szerver, ami az app helyett hívja a szolgáltatókat, és náluk tartja a titkos kulcsokat. A BFF jelentése „Backend for Frontend”. |
| **Rate limit** | Korlát, hogy percenként/naponta hány kérést engedélyez a szolgáltató. |
| **Cache** | Átmeneti tároló. Ha nemrég már lekértük az adatot, nem kérjük le újra. |
| **TTL** | „Time to live”: meddig tekintjük frissnek a cache-ben tárolt adatot. |
| **DTO** | „Data Transfer Object”: adatcsomag, ahogy két rendszer között utazik. |
| **Validáció** | Ellenőrzés, hogy az érkezett adat tényleg olyan formájú-e, amilyet várunk. |
| **Normalizálás** | A különböző forrásokból jövő adat egységes formára hozása (dátum, pénznem, egység). |
| **Domainmodell** | A program saját fogalmai (Részvény, ETF, Tranzakció…), függetlenül attól, honnan jön az adat. |
| **Provenance** | „Származás”: honnan jön egy adat, mikor kértük le, milyen időszakra vonatkozik. |
| **N/A, N/M** | N/A = nem értelmezhető (pl. P/E egy ETF-re); N/M = nem értelmes (pl. P/E veszteséges cégnél). |
| **MVP** | „Minimum Viable Product”: a legkisebb, már használható változat. |
| **Expo / React Native** | Keretrendszer, amivel egy kódból Android- és iOS-app készíthető. Az Expo **SDK 58** a verzió. |
| **Expo Go** | Telefonos app, amivel fejlesztés közben buildelés nélkül kipróbálható a program. |
| **Development build** | A saját appunk fejlesztői változata. Akkor kell, ha az Expo Go nem tud valamit. |
| **EAS** | Az Expo felhős szolgáltatásai: build, frissítés, hosting. |
| **SEC EDGAR** | Az amerikai tőzsdefelügyelet ingyenes adatbázisa a cégek hivatalos beszámolóival. |
| **XBRL** | Géppel olvasható formátum a pénzügyi beszámolókhoz. |
| **ECB referencia-árfolyam** | Az Európai Központi Bank naponta közzétett devizaárfolyamai (benne a HUF is). |
| **ETF, TER, UCITS** | ETF = tőzsdén kereskedett alap; TER = éves teljes költséghányad; UCITS = EU-s alapszabályozás (az EU-ban forgalmazott ETF-ek többsége ilyen). |
| **DCF** | Diszkontált cash flow: a jövőbeli pénzáramok mai értékéből becsült cégérték. Becslés, nem tény. |
| **LLM** | Nagy nyelvi modell (pl. Claude), az AI-magyarázatot írja. |

## 4. Mit csináltunk, lépésről lépésre

> Ebben a fázisban **nem kellett parancsot futtatnod**. Az alábbi lépéseket az AI végezte el. Minden lépésnél leírjuk a célt, az eredményt és azt, hogy hol találod.

### 4.1 A projektmappa felmérése
- **Cél:** megtudni, van-e már valami, amire építeni kell.
- **Eredmény:** a mappában csak a `CLAUDE.md` volt. Nincs kód, és nincs git.
- **Hol:** `PROJECT_STATE.md`.

### 4.2 A promptcsomag átolvasása (00–16)
- **Cél:** a roadmap illeszkedjen a következő fázisok promptjaihoz.
- **Eredmény:** 5 ellentmondást találtunk. Például több prompt SDK 57-et említ, és néhány fájlútvonal rossz. Ezeket feloldottuk és rögzítettük.
- **Hol:** `KNOWN_ISSUES.md` → „Promptcsomag-ellentmondások”; `DECISIONS.md` D-020.

### 4.3 Termékcél és felhasználói folyamatok (1. feladat)
- **Eredmény:** 6 fő folyamat (ticker felvétele, részvényelemzés, ETF-elemzés, DCF, portfólió, AI-magyarázat), edge case-ekkel.
- **Hol:** `REQUIREMENTS.md` 1–2.

### 4.4 MVP / később / opcionális bontás (2. feladat)
- **Eredmény:** 15 MVP-funkció (a válaszaid után kettővel bővült), 5 feltételes (adatfüggő), 5 v1.0-s, valamint a későbbi és az opcionális funkciók.
- **Hol:** `REQUIREMENTS.md` 3.

### 4.5 Technológiai terv, hivatalos forrásból ellenőrizve (3. feladat)
- **Eredmény:**
  - SDK 58: 2026-10-15-én jelent meg; React Native 0.88; Node 22.13+/24.3+/26+; Android 7+; iOS 16.4+.
  - A New Architecture kötelező.
  - Az új Expo Go csak az SDK 58-at támogatja.
  - Ellenőriztük az `expo-sqlite`, `expo-secure-store` és `jest-expo` adatait is.
- **Hol:** `ARCHITECTURE.md` 14; `DECISIONS.md` D-001, D-002.

### 4.6 Adatforrás-stratégia (4. feladat)
- **Eredmény:**
  - 13 szolgáltatót vetettünk össze.
  - Ajánlás: SEC EDGAR (ingyenes, hivatalos US beszámolók), ECB (ingyenes devizaárfolyam), egy ingyenes árfolyam-szolgáltató.
  - **Fontos korlát:** az ingyenes csomagok többsége csak személyes használatra szól, és US-fókuszú. Az ETF-ek pontos összetételére (holdings) nincs igazolt ingyenes forrás.
- **Hol:** `DATA_SOURCES.md`.

### 4.7 Kell-e backend? (5. feladat)
- **Eredmény:** igen, de **csak egy vékony proxy**. Feladata a titkos kulcsok tartása, az adatok egységesítése és cache-elése. Nem tárol portfóliót, és nincs benne felhasználói fiók. Három opciót vetettünk össze (nincs backend / vékony proxy / teljes backend).
- **Hol:** `ARCHITECTURE.md` 6; `DECISIONS.md` D-004.

### 4.8 Adatfolyam (6. feladat)
- **Eredmény:** a teljes út: szolgáltató → ellenőrzés → egységesítés → domainmodell → számítás → pontozás → AI → képernyő. Minden lépésnél leírtuk, hol fut és mi a hibaállapot.
- **Hol:** `ARCHITECTURE.md` 4.

### 4.9 Adatminőségi és pénzügyi szabályok (7. feladat)
- **Eredmény:**
  - A hiányzó adat nem nulla; 8 állapotot definiáltunk.
  - Rögzítettük a pénznem- és egységszabályokat, a pénzügyi időszakot, a részvényfelosztást és a restatementet.
  - Négy plusz kettő adattípust különböztetünk meg: jelentett / számított / becsült / AI / felhasználói / demó.
- **Hol:** `DATA_DICTIONARY.md` 1–4.

### 4.10 Domainmodell-terv (8. feladat)
- **Hol:** `DATA_DICTIONARY.md` 3, 6–9; `ARCHITECTURE.md` 5.

### 4.11 Teszt, biztonság, naplózás, cache, offline, kiadás (9. feladat)
- **Hol:** `ARCHITECTURE.md` 8–13.

### 4.12 Roadmap (10. feladat)
- **Eredmény:** a PHASE 02–16 mindegyikénél rögzítettük a célt, a határt (mi van benne és mi nincs), a függőséget és a befejezési feltételt.
- **Hol:** `ROADMAP.md`.

### 4.13 Döntési pontok (11. feladat)
- **Eredmény:** 5 kérdés neked, mindegyikhez biztonságos alapértelmezéssel. 2026-11-21-én megválaszoltad őket (a hatásukat a 8. fejezet írja le). Csak a DP-05 maradt tudatosan nyitva.
- **Hol:** `KNOWN_ISSUES.md` → „Döntési pontok”.

## 5. Így ellenőrizheted te magad

1. Nyisd meg a VS Code-ot a `stock-etf-analyzer` mappán.
2. A bal oldali fájlfában nyisd le a `docs` mappát. A fenti 10 fájlnak ott kell lennie.
3. Egy `.md` fájlt megnyitva nyomd meg a `Ctrl+Shift+V`-t: formázott előnézetet kapsz. A Mermaid-ábrák a beépített előnézetben nem feltétlenül rajzolódnak ki, ehhez Mermaid-bővítmény kellhet. Ez nem hiba.
4. Nézd meg a `KNOWN_ISSUES.md` „Döntési pontok” táblázatát: ott vannak a válaszaid és a hatásuk. Csak a DP-05 (fizetős adat) maradt nyitva.

**Elvárt eredmény:** minden fájl megnyílik, és a mappában **nincs** `package.json` vagy forráskód. Ez így helyes, hiszen ebben a fázisban nem írtunk kódot.

## 6. Felkészülés a PHASE 02-re

**Már megvan** (2026-11-21-én ellenőrizve):
- Node.js v26.10.0
- npm 12.2.0
- Git 2.56.1
- Android Studio, SDK és a `Medium_Phone_API_37.0` emulátor

**Még nincs kész, ezt a PHASE 02 lépésről lépésre végigviszi:**
- Az `ANDROID_HOME` környezeti változó nincs beállítva.
- Az `adb` parancs nincs a PATH-ban.

**Ha meg akarod nézni a verziókat**, ezt bármikor megteheted:
1. A VS Code-ban: menü **Terminal → New Terminal**. Alul megnyílik egy PowerShell ablak.
2. Írd be egyenként, és nyomj Entert:
   ```powershell
   node -v
   git --version
   ```
3. Elvárt eredmény: `v26.10.0` (vagy újabb 26.x), illetve `git version 2.56.1.windows.1` (vagy újabb).

**Gyakori hibák:**

| Tünet | Ok | Megoldás |
|---|---|---|
| `node : The term 'node' is not recognized…` | A Node nincs telepítve, vagy a terminál a telepítés előtt nyílt meg | Zárd be és nyisd újra a VS Code-ot |
| A Node verziója 23 vagy 25 | Páratlan főverzió, az SDK 58 nem támogatja | Telepíts LTS változatot (22, 24 vagy 26) |

## 7. A PHASE 01 befejezési feltételei

- [x] Nincs alkalmazáskód, csak tervezési fájlok.
- [x] A 9 kötelező dokumentum elkészült (plusz a `REQUIREMENTS.md`).
- [x] A terv elég konkrét a PHASE 02 indításához (handoff: `docs/handoffs/phase-01-handoff.md`).
- [x] Minden bizonytalan vagy szolgáltatófüggő állítás jelölve van (`[IGAZOLT]` / `[HARMADIK FÉL]` / `[NEM IGAZOLT]` / `[FELTÉTELEZÉS]`).
- [x] A roadmapben minden későbbi fázisnak van célja, határa és befejezési feltétele.

## 8. A döntéseid hatása (2026-11-21)

| Válaszod | Mi változott a tervben |
|---|---|
| US + európai + globális piacok | Mindhárom célpiac. US-re teljes elemzés. Az európai és globális instrumentumokra ingyenesen **ár alapú** elemzés (hozam, kockázat, költség, portfólió); a cégadatok (fundamentumok) itt csak fizetős csomaggal érhetők el. A program megkülönbözteti az értékpapírt (ISIN) és a tőzsdei jegyzést, mert egy UCITS ETF több tőzsdén és devizában is forog. |
| Csak saját használat | Az ingyenes „személyes” adatcsomagok megfelelnek, és nyilvános kiadással kapcsolatos jogi teendő nincs. |
| FMP + EODHD kulcs, és adapter minden ajánlotthoz | 6 adapter készül: FMP, EODHD, valamint három ingyenes kiegészítő (SEC EDGAR: hivatalos US beszámolók; ECB: devizaárfolyam; OpenFIGI: ISIN-keresés), és egy demó/teszt adapter. Egy „útválasztó” dönti el, melyik adatot honnan kérjük, és vigyáz a napi keretekre. Más szolgáltatót most nem ajánlok (indok: DATA_SOURCES 4.). |
| Ingyenes AI, de legyen más lehetőség | Alapból ingyenes, szabályalapú magyar összefoglaló készül a telefonon (nem „AI”, nem téved). Az LLM (pl. Claude) később bekapcsolható. |
| Fizetős adat: később | Ha később fizetős EODHD csomagot veszel, a szerver beállításában kell átírni egy értéket; az appot nem kell újra kiadni. |

**Fontos biztonsági szabály a kulcsaidhoz:** az FMP és az EODHD kulcsot **soha ne másold be a chatbe**, és ne tedd semmilyen kódfájlba. A PHASE 04B lépésről lépésre megmutatja, hogyan kerüljenek a `.env.local` nevű fájlba, amelyet a git nem követ.

**Az adapterek mikor készülnek?** A projekt szabálya szerint egy chat csak a saját fázisát végzi el, a PHASE 01-ben pedig nem írunk programkódot. Az adapterek a **PHASE 04**-ben készülnek, két chatben (04A, 04B), mert együtt túl nagyok egy chathez.

## 9. Hogyan indítsd a PHASE 02-t?

1. Nyiss **új chatet** ugyanebben a projektmappában (`c:\Users\lujzi\Documents\stock-etf-analyzer`).
2. Javasolt, de nem kötelező: javítsd a `02_PROJEKT_SETUP.md` promptban a két útvonalat (lásd `KNOWN_ISSUES.md` PI-03, PI-04):
   - `docs/00_PROJECT_INSTRUCTION.md` → `CLAUDE.md`
   - `docs/phase-01-handoff.md` → `docs/handoffs/phase-01-handoff.md`
3. Másold be a `02_PROJEKT_SETUP.md` teljes tartalmát az új chatbe.
4. Az AI először a `docs/` fájlokat és a handoffot olvassa el. Ha nem tenné, kérd meg rá.
