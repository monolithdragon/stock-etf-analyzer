# Döntési napló – Stock & ETF Analyzer

**Formátum:** ID · dátum · státusz · kontextus · döntés · alternatívák · következmények · felülvizsgálat.

**Státuszok:**
- **Elfogadva**: érvényes, csak indokkal változtatható.
- **Javasolt**: alapértelmezés; az adott fázis véglegesíti vagy módosítja.
- **Ideiglenes**: spike vagy ellenőrzés függvénye.
- **Feltételezés**: a felhasználó válaszától függ (DP-xx).

Új döntést a lista végére kell írni. Régi döntést nem törlünk: ha módosul, „Felváltva: D-0xx” jelölést kap.

---

### D-001 – Platform és verziók
- **Dátum:** 2026-11-21 · **Státusz:** Elfogadva
- **Kontextus:** A CLAUDE.md előírja az Expo SDK 58-at, a TypeScript strict módot és az Expo Routert.
- **Döntés:**
  - Expo SDK 58, React Native 0.88, React 19.3.0 (a v58 referenciaoldal szerint), New Architecture (SDK 55 óta kötelező), TypeScript strict, Expo Router.
  - Node.js: a telepített **v26.10.0** megfelel (támogatott: 22.13+ / 24.3+ / 26+, páratlan főverzió nem).
  - Csomagkezelő: npm.
- **Alternatívák:** SDK 57 maradna Expo Go miatt. Elvetve: a CLAUDE.md az SDK 58-at írja elő, és az új Expo Go csak az SDK 58-at támogatja.
- **Következmények:** A Strict TypeScript API az alapértelmezett (RN 0.87+), ezért a deep importok típushibát adnak. Az SDK 58 előtti csomagverziókat nem szabad találomra használni.
- **Felülvizsgálat:** ha a PHASE 02-ben a `npx expo install --check` eltérő React verziót mutat, a valós verzió kerül ide.
- **PHASE 02 eredménye (2026-11-21, igazolva):** a `default@sdk-58` sablon (`expo-template-default` 58.0.35) és az `npm ls` szerint:
  - `expo` 58.0.26, `react-native` **0.88.1**, `react` **19.3.0**, `expo-router` 58.0.32, `typescript` **6.0.3**;
  - `npx expo install --check`: „Dependencies are up to date”; `npx expo-doctor@latest`: 20/20.
  - A 19.2.3-as eltérés (U-01) tehát téves volt; a React verziója 19.3.0.

### D-002 – Fejlesztési célplatform és futtatás
- **Dátum:** 2026-11-21 · **Státusz:** Elfogadva
- **Kontextus:**
  - Windows 11 fejlesztői gép; Android Studio, SDK (platform 35/36/37) és egy AVD (`Medium_Phone_API_37.0`) telepítve.
  - Az SDK 58-as Expo Go store-verziója 2026-11-21-én nem igazoltan elérhető. Az Expo szerint az SDK 58-as Expo Go a CLI-n át telepíthető Android eszközre/emulátorra és iOS szimulátorra.
  - A `create-expo-app` addig SDK 57 projektet generálhat alapból.
- **Döntés:**
  - Elsődleges fejlesztési cél az **Android emulátor**.
  - Expo Go (CLI-n át telepítve), amíg nem kell Expo Go-n kívüli natív modul; utána development build.
  - Az SDK 58 sablont a PHASE 02 **explicit** választja ki.
- **Alternatívák:** iOS-first. Elvetve: Windows alatt nincs iOS szimulátor.
- **Következmények:** Az MVP-ben kerülni kell az Expo Go-ban nem elérhető natív modulokat (pl. SQLCipher).

### D-003 – Architektúra: moduláris monolit, Clean Architecture-lite
- **Dátum:** 2026-11-21 · **Státusz:** Elfogadva
- **Döntés:**
  - Egy repó, egy Expo projekt.
  - Rétegek: `domain` → `calculations` → `scoring`; ezek mellett `contracts`, `application`, `infrastructure`, `server`, `presentation` és `config` (ARCHITECTURE 3.).
  - Kézi DI composition root-tal, DI-könyvtár nélkül.
  - A rétegszabályokat ESLint `no-restricted-imports` kényszeríti ki.
- **Alternatívák:** (A) feature-mappák rétegek nélkül: gyors, de a pénzügyi logika a UI-ba szivárog; (C) monorepo külön csomagokkal (pnpm workspaces): túl bonyolult egy kezdő tulajdonosnak.
- **Következmények:** Több mappa, de tesztelhető, és a pénzügyi logika független a UI-tól.

### D-004 – Vékony proxy/BFF: Expo Router API routes + EAS Hosting
- **Dátum:** 2026-11-21 · **Státusz:** Ideiglenes (a PHASE 04 spike-kal igazolja)
- **Kontextus:**
  - Az AI és az árfolyam-szolgáltatók kulcsai nem kerülhetnek a kliensbe.
  - A SEC User-Agent deklarációt és ≤10 kérés/mp-et kér.
  - Az ingyenes keretek kicsik.
- **Döntés:**
  - **Option B** (lásd a lenti összevetést): szerverfüggvények az Expo Router API route-okban (`src/app/api/v1/**/+api.ts`), EAS Hostingra telepítve.
  - A handler-logika hosztfüggetlen `Request → Response` függvény a `src/server/handlers`-ben.
  - Fejlesztésben a dev szerver lokálisan szolgálja ki az API route-okat.
- **Alternatívák:**
  - **(A) Nincs backend, a felhasználó saját kulcsot ad meg (BYOK, SecureStore)**
    - Előny: 0 infrastruktúra.
    - Hátrány: rossz UX; a kulcsot az eszközön kell tárolni; nincs megosztott cache; a SEC User-Agent az eszközről megy; az AI-költség a felhasználónál.
    - Megmarad tartalék módnak.
  - **(C) Teljes backend** (adatbázis, auth, ütemező, Postgres): skálázható, de költséges és túlméretezett egy személyes MVP-hez.
  - **Tartalék hoszt:** Cloudflare Workers.
    - Free: 100 000 kérés/nap, KV, Durable Objects SQLite.
    - Ha az EAS Hosting rate-limit/cache képessége nem elég (U-03), ide költözik a handler-kód.
- **Költség (igazolt, 2026-11-21):**
  - EAS free: 100 000 kérés/hó, 1 000 000 CPU-ms; Starter $19/hó.
  - Cloudflare Workers free: 100 000 kérés/nap; Paid minimum $5/hó.
- **Következmények:**
  - Az SDK 58-ban az API route-ok a `web.output: "server"` beállítással működnek. Ezt a PHASE 02/04 állítja be és ellenőrzi.
  - A natív app abszolút URL-lel hívja a proxyt (`EXPO_PUBLIC_API_BASE_URL`). A relatív fetch natívon alfa funkció.
- **Felülvizsgálat:** a PHASE 04 végén, a spike eredménye alapján.
- **Spike eredménye (PHASE 04A, 2026-11-21): részben igazolva, a státusz Ideiglenes marad.**
  - **Lokálisan igazolva:** `npx expo start` alatt mind az 5 API route élő adattal működik (`/api/v1/health`, `/fx`, `/securities/{isin}/listings`, `/stocks/{id}/financials`, `/instruments/{id}/quote`). Forrás: SEC, ECB/Frankfurter, OpenFIGI. Nem létező útvonal → 404 (nincs általános továbbító).
  - `npx expo export --platform web`: a szerver-bundle elkészül (5 függvény, ~629 KB/route). Az Android kliens-bundle-ben nincs szerverkód, szolgáltatói URL vagy User-Agent (szkenneléssel ellenőrizve).
  - Az SDK 58 dokumentáció szerint az API route-ok a meglévő `web.output: "server"` mellett működnek; a dinamikus szegmens a handler 2. argumentuma.
  - **EAS Hosting (Expo docs, 2026-11):**
    - Cloudflare Workers alapú.
    - **Nincs** tartós KV-, cache- vagy rate-limit primitív (U-03 megválaszolva).
    - „Secrets cannot be deployed with Expo Hosting”: csak „plain text” és „sensitive” láthatóságú változó telepíthető, telepítésenként rögzítve.
    - Az ingyenes csomag CPU- és kéréskorlátai a dokumentációból nem derültek ki.
  - **Nem csináltuk:** EAS Hosting próbatelepítést. Az `eas deploy` Expo-fiókot és a tulajdonos döntését igényli. Ezért a D-004 Ideiglenes marad; a tartalék (Cloudflare Workers + KV) indoka erősödött.
  - **Következmény:** a rate limiter memóriabeli és példányonkénti (KI-23); a proxy cache a PHASE 13 kérdése.

### D-005 – A szolgáltató-adapterek a szerveren futnak, a kliens csak a saját szerződést látja
- **Dátum:** 2026-11-21 · **Státusz:** Elfogadva
- **Döntés:** Az [1]–[3] lépés (provider → DTO validáció → normalizálás) a proxyban fut. A kliens csak `src/contracts` DTO-kat kap, verziózott `/api/v1` alatt, és újra validálja őket.
- **Indok:**
  - Szolgáltatócsere új appverzió nélkül.
  - A titkok a szerveren maradnak.
  - Megosztott cache.
- **Következmények:**
  - A mock adat a kliensen gateway-szinten (`MarketDataGateway`) és a szerveren adapter-szinten is elérhető.
  - Szerződésváltozásnál visszafelé kompatibilitás kell.

### D-006 – Adatforrás-stratégia
- **Dátum:** 2026-11-21 · **Státusz:** **Felváltva: D-024** (2026-11-21)
- **Döntés:**
  - US fundamentumok: SEC EDGAR XBRL.
  - FX: ECB referencia-árfolyam (Frankfurter v2 ECB provider, nem blended).
  - Árfolyam: a PHASE 04 választ a Tiingo Starter és az FMP Basic közül, a DATA_SOURCES 5. szempontjai szerint.
  - ETF holdings: nincs az MVP-ben.
  - Scraping és nem hivatalos API: tilos.
- **Alternatívák:** egyetlen fizetős all-in-one szolgáltató (pl. EODHD All-in-One ~$100/hó). Jobb lefedettség, de havi költség, és a licencet így is ellenőrizni kell.

### D-007 – MVP piaci lefedettség
- **Dátum:** 2026-11-21 · **Státusz:** **Felváltva: D-023** (2026-11-21, DP-01 válasz)
- **Döntés:**
  - Az elemzés az MVP-ben **US-listázott részvényekre és ETF-ekre** készül, mert ehhez van ingyenes, igazolható forrás.
  - Nem US instrumentum (UCITS ETF, BÉT) a portfólióban **kézi árral** (`user_input`) rögzíthető.
  - A teljes elemzés ezekre „Később”, fizetős forrással.
- **Következmények:** Egy magyar befektető tipikusan UCITS ETF-eket tart. Emiatt az MVP-portfólió értékelése részben kézi lesz (R-01).

### D-008 – Pozicionálás: személyes használat
- **Dátum:** 2026-11-21 · **Státusz:** **Elfogadva** (DP-02 válasz, 2026-11-21: „csak saját használatra”)
- **Döntés:** Az app kizárólag saját, nem kereskedelmi használatra készül. Nyilvános store-kiadás nem cél. Ha ez valaha változna, előfeltétel: kereskedelmi adatlicenc, jogi felülvizsgálat (R-10) és adatvédelmi tájékoztató.
- **Indok:** Az ingyenes csomagok többsége „personal/internal use” (Tiingo, Twelve Data, Massive, várhatóan FMP/Finnhub is).

### D-009 – Számábrázolás
- **Dátum:** 2026-11-21 · **Státusz:** Elfogadva
- **Döntés:**
  - JS `number` (float64).
  - Százalék belül tizedes tört.
  - Alapegység; kerekítés csak a megjelenítésnél.
  - Tesztben tűréssel hasonlítunk.
- **Alternatíva:** decimális könyvtár (pl. decimal.js). Elvetve az MVP-ben: elemzési appról van szó, nem főkönyvről.
- **Felülvizsgálat:** ha a portfólió-elszámolásnál (PHASE 09) centes pontosság kell.

### D-010 – Hiányzó adat modellje
- **Dátum:** 2026-11-21 · **Státusz:** Elfogadva
- **Döntés:** `Metric<T>` diszkriminált unió `MetricStatus`-szal (DATA_DICTIONARY 2.). A `null` soha nem `0`. A UI a státuszt szövegesen jeleníti meg (N/A, N/M stb.).

### D-011 – Provenance típusok
- **Dátum:** 2026-11-21 · **Státusz:** Elfogadva
- **Döntés:** `reported | calculated | estimated | ai_interpretation | user_input | mock`. A CLAUDE.md négy kategóriáját kiegészítjük: `user_input` (kézi TER, DCF feltevés) és `mock` (demóadat feltűnő jelölése).

### D-012 – Portfólió: a pozíció a tranzakciókból származik, átlagár-módszer
- **Dátum:** 2026-11-21 · **Státusz:** Javasolt (PHASE 09)
- **Döntés:**
  - Az egyetlen igazságforrás a tranzakciólista.
  - A pozíció számított vetület, így nincs inkonzisztens, kézzel szerkesztett pozíció.
  - Könyvelési módszer az MVP-ben: átlagár; FIFO később.
  - Adózási célra nem alkalmas, ezt a UI jelzi.

### D-013 – Tárolás
- **Dátum:** 2026-11-21 · **Státusz:** Javasolt (PHASE 13)
- **Döntés:**
  - `expo-sqlite` a strukturált adatra és a cache-re.
  - `expo-sqlite/kv-store` a kis beállításokra (AsyncStorage helyett, extra függőség nélkül).
  - `expo-secure-store` csak valódi titokra (pl. jövőbeli auth token, opcionális BYOK kulcs).
  - Mindhárom szerepel az SDK 58 docsban és elérhető Expo Go-ban.
- **Következmények:** Nincs app-szintű DB-titkosítás (SQLCipher Expo Go-ban nem elérhető). Ez ismert korlát (O-05).

### D-014 – Futásidejű validáció: zod, közös sémák
- **Dátum:** 2026-11-21 · **Státusz:** Elfogadva – véglegesítve a PHASE 03-ban: **D-039** (zod 4.6.7)
- **Döntés:** zod sémák a `src/contracts`-ban, amelyeket a szerver és a kliens is használ. A szolgáltatói DTO sémák a `src/server/providers/*`-ben vannak. A típusokat a sémákból származtatjuk (`z.infer`).

### D-015 – Tesztkeret
- **Dátum:** 2026-11-21 · **Státusz:** Elfogadva
- **Döntés:**
  - Jest 30 + `jest-expo` preset (az SDK 58-hoz Jest 30 kell).
  - `@testing-library/react-native` ≥ 14.
  - E2E: Maestro (PHASE 15).
  - Élő API tesztben tilos.
- **Forrás:** https://docs.expo.dev/develop/unit-testing/

### D-016 – AI-integráció
- **Dátum:** 2026-11-21 · **Státusz:** **Módosítva: D-026** (2026-11-21, ingyenes-először). Az alábbi Claude-részletek az opcionális LLM-providerre érvényesek.
- **Döntés:**
  - `AiGateway` port a kliensen, `AiProvider` port a szerveren. A mock provider kötelező.
  - Alapértelmezett valós provider: **Anthropic Claude API**, csak a proxyból, hivatalos `@anthropic-ai/sdk`-val.
  - Strukturált kimenet JSON sémával (`output_config.format`), plusz zod-validáció.
  - Modell env-ből (`AI_MODEL`), alapértelmezés: `claude-opus-5-5`.
  - Cache a bemeneti DTO hash-e alapján.
  - Kezelni kell a `stop_reason: "refusal"` esetet.
  - Az AI kikapcsolható; nélküle minden más működik.
- **Költségbecslés** (feltevés: ~6 000 bemeneti és ~1 500 kimeneti token/magyarázat; a gondolkodási tokenek kimenetként számlázódnak, így a valós költség magasabb lehet):

  | Modell | Ár (input/output, $/1M token) | Becsült költség/magyarázat |
  |---|---|---|
  | `claude-opus-5-5` | 4 / 20 | ≈ $0.054 |
  | `claude-sonnet-5-5` | 2 / 10 | ≈ $0.027 |
  | `claude-haiku-5-5` | 0.10 / 0.50 | ≈ $0.0014 |

  Az árak a 2026-11-03-i Anthropic-árlista szerint. A modellválasztás költségdöntés, ami a tulajdonosra tartozik (DP-04).
- **Nyitott:** az SDK futása EAS Hosting runtime-on `[NEM IGAZOLT]`, ezt a PHASE 11 spike-kal ellenőrzi.

### D-017 – FX-kezelés
- **Dátum:** 2026-11-21 · **Státusz:** Elfogadva
- **Döntés:**
  - ECB referencia-árfolyam, EUR-on át számolt keresztárfolyam.
  - Az alkalmazott ráta, a dátum és a forrás mindig tárolva van és megjeleníthető.
  - Elavult vagy hiányzó FX esetén nincs csendes becslés.
  - A natív és a kijelzési pénznem külön kezelendő.
- **Megjegyzés:** az ECB szerint a referencia-árfolyam „csak tájékoztató célra” szolgál. Az app nem tranzakciós célra használja.

### D-018 – Formátum-szabványok
- **Dátum:** 2026-11-21 · **Státusz:** Elfogadva
- **Döntés:** ISO 4217 pénznem, ISO 8601 dátum/idő, UTC időbélyeg, a tőzsde helyi kereskedési napja a napi adathoz, ISO 10383 MIC, ISO 6166 ISIN. GBX → GBP konverzió explicit.

### D-019 – UI-nyelv és formázás
- **Dátum:** 2026-11-21 · **Státusz:** Javasolt (PHASE 12)
- **Döntés:**
  - Magyar UI-szövegek, központilag kezelve (`presentation/strings`), így később i18n-képes.
  - Számformázás `Intl.NumberFormat`/`DateTimeFormat`-tal, alapértelmezett `hu-HU`.
  - Az `Intl` Hermes-támogatását a PHASE 12 ellenőrzi `[NEM IGAZOLT]`.

### D-020 – A promptcsomag ellentmondásainak feloldása
- **Dátum:** 2026-11-21 · **Státusz:** Elfogadva
- **Döntés:**
  - A gyökérben lévő `CLAUDE.md` az irányadó.
  - SDK **58** (nem 57).
  - A projekt neve „Stock & ETF Analyzer” (nem „Equity Analyst”).
  - A handoffok helye: `docs/handoffs/phase-XX-handoff.md`.
  - A backend/proxy fázisokhoz rendelése a ROADMAP szerint történik.
  - Részletek: KNOWN_ISSUES „Promptcsomag-ellentmondások”.

### D-021 – Pénzügyi időszak, restatement, Q4, TTM
- **Dátum:** 2026-11-21 · **Státusz:** Javasolt (PHASE 06)
- **Döntés:** DATA_DICTIONARY 4.3:
  - Az időszakot a start/end dátumokból határozzuk meg.
  - Restatementnél a legkésőbb beadott érték számít.
  - A Q4 származtatott és `calculated`.
  - TTM csak 4 egymást követő negyedévből.
  - Split-bázist egyeztetni kell.

### D-022 – DCF alapbeállítások
- **Dátum:** 2026-11-21 · **Státusz:** Javasolt (PHASE 07)
- **Döntés:**
  - FCF = OCF − CapEx, mint FCFF-közelítés; az egyszerűsítés a UI-ban jelölve van.
  - Javasolt alapeset 5 év explicit időszak; 3 év támogatott; legfeljebb 10.
  - Gordon-modell csak `r > g` esetén.
  - Bear/Base/Bull minden feltevése látható és szerkeszthető.

---

## Döntési pontok megválaszolása után (2026-11-21)

A tulajdonos válaszai:
- **DP-01:** US részvények és ETF-ek, európai UCITS ETF-ek és részvények, globális ETF-ek és részvények.
- **DP-02:** csak saját használat.
- **DP-03:** FMP és EODHD kulcs már van; ha más is ajánlott, arra is készüljön adapter.
- **DP-04:** AI lehetőleg ingyenesen, de maradjon lehetőség másra.
- **DP-05:** fizetős adat később eldöntendő, ne legyen kizárva.

### D-023 – Piaci lefedettség: US + Európa + globális (felváltja: D-007)
- **Dátum:** 2026-11-21 · **Státusz:** Elfogadva
- **Döntés:** Mindhárom piac célpiac. A lefedettség **képességenként** és **csomagszintenként** eltér, és ezt az app őszintén jelzi (DATA_SOURCES 5.2 és 6.):
  - **US:** teljes elemzés (SEC fundamentumok + FMP/EODHD ár).
  - **Európa és globális, free módban:** ár alapú elemzés EODHD-ből (hozam, volatilitás, drawdown, költség, portfólió-értékelés).
    - A fundamentum `UNAVAILABLE (PLAN_LIMIT)`.
    - A történet 1 év, ezért a hosszabb kockázati mutatók `INSUFFICIENT_DATA`.
  - **Európa és globális, fizetős EODHD-vel:** a fundamentumok és az ETF-metaadat konfigurációval bekapcsolhatók (D-027).
- **Következmények:**
  - A nem US részvények DCF-je free módban csak kézi bemenettel fut (`user_input`).
  - Kellenek UCITS-sajátosságok: több listing, GBX, eltérő devizák (D-025).

### D-024 – Több szolgáltató adapterrel és képesség alapú routinggal (felváltja: D-006)
- **Dátum:** 2026-11-21 · **Státusz:** Elfogadva (a routing tábla részleteit a PHASE 04B véglegesíti)
- **Döntés:**
  - **Adapterek** (PHASE 04):
    - `sec-edgar`, `ecb-fx` (Frankfurter v2 ECB provider), `openfigi`, `mock` (04A);
    - `fmp`, `eodhd` (04B).
    - Az első hármat a tulajdonos kérése szerint ajánlom: ingyenesek, és nem helyettesítik, hanem **kiegészítik** az FMP-t és az EODHD-t (jelentett US fundamentum, FX, ISIN-leképezés).
  - **Most nem készül adapter** a következőkhöz: Tiingo, Finnhub, Alpha Vantage, Twelve Data, Massive. Az indokok a DATA_SOURCES 4.-ben vannak. A Tiingo később hozzáadható, ha az FMP US-kerete kevés.
  - **`ProviderRouter`** a proxyban: képesség × piac → prioritási lista, fallback-szabályok, „egy adatsor = egy forrás”, és a provenance mindig a ténylegesen használt forrást mutatja (DATA_SOURCES 5.3).
  - **Kvóta-költségvetés** szolgáltatónként, az EODHD hívásköltség-táblájával (EOD 1, fundamentum 10, bulk 100; `/api/user` 0) `[IGAZOLT]`.
  - **Kulcsok:** csak szerver env.
    - Lokálisan `.env.local` (gitignore), élesben EAS secret.
    - `FMP_API_KEY`, `EODHD_API_KEY`, opcionális `OPENFIGI_API_KEY`.
    - Kulcs soha nem kerül chatbe vagy commitba.
- **Alternatívák:**
  - Egyetlen szolgáltató (csak EODHD): egyszerűbb, de free módban 20 hívás/nap mindenre kevés.
  - Minden elérhető szolgáltatóhoz adapter: sok karbantartás, kevés plusz érték.
- **Következmények:**
  - Nagyobb PHASE 04, ezért két részletben készül (D-028).
  - A contract tesztek szolgáltatónként kellenek.

### D-025 – Security és Listing szétválasztása
- **Dátum:** 2026-11-21 · **Státusz:** Elfogadva – megvalósítva a PHASE 03-ban (`Instrument` + `Listing`, D-035)
- **Kontextus:** Egy UCITS ETF ugyanazzal az ISIN-nel több tőzsdén, több devizában forog (pl. Xetra EUR, LSE USD vagy GBX). Ugyanez igaz sok globális részvényre.
- **Döntés:**
  - **`Security`** (értékpapír): ISIN, név, típus (`stock` | `etf`); ehhez tartozik a fundamentum és az ETF-metaadat.
  - **`Listing`** (tőzsdei jegyzés): `{symbol}@{MIC}`, jegyzési deviza, tőzsde; ehhez tartozik az ár és az ártörténet.
  - A pozíció egy konkrét **Listinghez** kötődik (ott és abban a devizában vettük).
  - ISIN hiányában forrásspecifikus azonosító, jelölve.
- **Következmények:** DATA_DICTIONARY 3. frissítve. A keresés listing-választást kínál (UF-01).

### D-026 – Magyarázat „ingyenes-először” (módosítja: D-016)
- **Dátum:** 2026-11-21 · **Státusz:** Elfogadva (a PHASE 11 implementálja és vizsgálja az opciókat)
- **Döntés:**
  - **Alapértelmezett provider: `template`.** Determinisztikus, szabályalapú magyar összefoglaló a score/decision/metrikák strukturált eredményéből.
    - Ingyenes, a **kliensen** fut (offline is), nem hallucinál.
    - Provenance: `calculated`; UI-címke: „Szabályalapú összefoglaló” (nem „AI”).
  - **Opcionális LLM-providerek** ugyanazon `AiProvider` port mögött, csak explicit bekapcsolással és költségkorláttal:
    - `anthropic` (Claude a proxyn át; modell env-ből, a D-016 szerint; a legolcsóbb opció `claude-haiku-5-5`, ≈ $0.0014/magyarázat a D-016 feltevéseivel);
    - `local` (lokális LLM; PHASE 11 vizsgálja);
    - más szolgáltatók esetleges ingyenes kerete (PHASE 11 vizsgálja, `[NEM IGAZOLT]`).
  - Env: `AI_PROVIDER = template | anthropic | local | …` (alapértelmezés `template`).
- **Következmények:** Az app AI-költség nélkül is ad közérthető magyarázatot. Az LLM csak „plusz réteg”.

### D-027 – A fizetős adatbővítés nyitva marad (DP-05)
- **Dátum:** 2026-11-21 · **Státusz:** Elfogadva
- **Döntés:**
  - Fizetős csomag nincs kizárva.
  - A szolgáltatói **csomagszint konfiguráció** (`FMP_PLAN`, `EODHD_PLAN`), amelyből a proxy képességmátrixot épít.
  - A váltáshoz env-módosítás és proxy-újratelepítés kell, kód- és appkiadás nem.
  - A UI a hiányzó képességet `UNAVAILABLE (PLAN_LIMIT)` státusszal és magyarázattal jelzi.
- **Költség-referencia:**
  - EODHD `[IGAZOLT]`, havi számlázás: EOD $19.99, Fundamentals $59.99, All-in-One $99.99/hó.
  - FMP `[HARMADIK FÉL]`: Starter kb. $19–29/hó.

### D-028 – A PHASE 04 két chatben (04A, 04B)
- **Dátum:** 2026-11-21 · **Státusz:** Elfogadva (a 04A elkészült: `docs/handoffs/phase-04a-handoff.md`)
- **Indok:** proxy váz, 6 adapter, routing, kvóta és FX egy chatben túl nagy, ami kontextus- és hibakockázatot jelent.
- **Döntés:**
  - **04A:** proxy váz és D-004 spike; contracts; `sec-edgar`, `ecb-fx`, `openfigi`, `mock`; `FxService`; kliens gateway. Átadás: `docs/handoffs/phase-04a-handoff.md`.
  - **04B:** `fmp`, `eodhd`, `ProviderRouter`, kvóta-költségvetés, képességmátrix, a DATA_SOURCES véglegesítése. Átadás: `docs/handoffs/phase-04-handoff.md`.
  - Mindkettő a `04_ADATFORRASOK_ES_DEVIZA.md` prompttal indul; a második chat elején jelezni kell: „PHASE 04B rész, a 04A kész”.

---

## PHASE 02 – Projekt setup (2026-11-21)

### D-029 – Projektstruktúra: sablon `src/app` + `src/presentation`
- **Dátum:** 2026-11-21 · **Státusz:** Elfogadva
- **Kontextus:**
  - Az SDK 58 `default` sablon `src/app/`-ot használ (route-ok), a `@/*` alias `./src/*`-ra mutat. Ez egyezik az ARCHITECTURE 5. tervével.
  - A sablon a UI-kódot `src/components`, `src/constants`, `src/hooks` alá teszi, és demótartalmat hoz (animált logó, Explore tab, `reset-project` script).
- **Döntés:**
  - A route-ok az `src/app/`-ban maradnak (sablonkonvenció).
  - A UI-kód az ARCHITECTURE szerinti `src/presentation/{components,theme,strings}` alá kerül; a nyilvános konfiguráció az `src/config/` alá.
  - Csak a setuphoz szükséges mappák készültek el; a többi réteget (`domain`, `calculations`, …) a saját fázisa hozza létre.
  - A sablon demókódja, demóképei, `LICENSE`-e (Expo copyright) és `reset-project` scriptje nem került át.
  - A sablon SDK 58-hoz pinnelt függőségei **megmaradtak**, a jelenleg nem használtak is (`@expo/ui`, `expo-glass-effect`, `expo-device`, `expo-symbols`, `expo-web-browser`, `expo-image`, `react-native-reanimated`/`worklets`, `react-native-gesture-handler`). Az eltávolításuk csak a UI-döntések után indokolt (PHASE 12, KI-06).
  - A sablon `typedRoutes` és `reactCompiler` kísérleti beállítása és a `web.output: "server"` (kell a PHASE 04 API route-okhoz, D-004) megmaradt.
- **Alternatívák:** a sablon mappái (`src/components` stb.) – elvetve, mert a PHASE 03 rétegszabályai (`no-restricted-imports`) mappaútvonalakra épülnek.
- **Következmények:** a route-fájlok vékonyak, és `@/presentation/*`-ból importálnak.

### D-030 – Kódminőségi eszközök
- **Dátum:** 2026-11-21 · **Státusz:** Elfogadva
- **Döntés:**
  - ESLint 9 flat config (`eslint-config-expo` 58.0.4) + Prettier 3 az `eslint-plugin-prettier`/`eslint-config-prettier` párossal, az Expo „Using ESLint” útmutatója szerint.
  - `npm run lint` = `expo lint --max-warnings 0`: a figyelmeztetés is hiba.
  - Projektszabályok:
    - `@typescript-eslint/no-explicit-any: error`;
    - `@typescript-eslint/no-floating-promises: error` (típusinformációs lint, `parserOptions.projectService`);
    - `import/order` (külső → `@/` → relatív, üres sorral).
  - A Prettier a `*.md` fájlokat nem formázza (kézzel karbantartott magyar dokumentáció).
  - `.gitattributes`: `* text=auto eol=lf`, mert a gépen `core.autocrlf=true`, és ez CRLF/Prettier konfliktust okozna.
- **Alternatívák:** Biome (egy eszköz lint+format) – elvetve: nem az Expo által dokumentált út, és az `eslint-config-expo` RN-specifikus szabályait elveszítenénk.
- **Következmények:** a típusinformációs lint lassabb; a projekt méreténél ez elhanyagolható (a PHASE 15 újramérheti).

### D-031 – TypeScript-beállítás
- **Dátum:** 2026-11-21 · **Státusz:** Elfogadva
- **Döntés:**
  - `expo/tsconfig.base` + `strict`, `noUncheckedIndexedAccess`, `noImplicitOverride`, `noFallthroughCasesInSwitch`.
  - `types: ["jest"]`, mert a TypeScript 6.0-ban a `types` alapértéke `[]`.
  - Alias: `@/*` → `./src/*`, `@/assets/*` → `./assets/*`.
  - Import-konvenció: mappán kívülre `@/` alias, mappán belül relatív.
- **Indok:** a `noUncheckedIndexedAccess` miatt a tömb- és rekordindexelés `T | undefined` típusú. Ez a „hiányzó adat nem nulla” szabályt (CLAUDE.md) típusszinten is kikényszeríti.
- **Elvetve:** `exactOptionalPropertyTypes` – az RN/Expo típusdefiníciókkal sok súrlódást okoz. A PHASE 03 a `domain` rétegre külön tsconfig nélkül újragondolhatja.

### D-032 – Tesztkonvenció
- **Dátum:** 2026-11-21 · **Státusz:** Elfogadva (kiegészíti: D-015)
- **Döntés:**
  - Jest 30.5.2 + `jest-expo` 58.0.15 + `@testing-library/react-native` 14.1.0; konfiguráció: `package.json` → `"jest": { "preset": "jest-expo" }`.
  - Unit teszt a forrás mellett (`*.test.ts`). Navigációs/képernyő teszt az `src/__tests__/`-ben az `expo-router/testing-library` `renderRouter('./src/app')` hívásával, a valódi route-könyvtáron.
  - **Tesztfájl soha nem lehet az `src/app/` alatt** (ott route lenne belőle).
  - Az RNTL 14 `render`/`fireEvent` és a `renderRouter` aszinkron, mindig `await`-tel hívjuk (a `no-floating-promises` kikényszeríti).
  - `npm test` egyszer fut (nem `--watchAll`, ahogy az Expo docs mintája), így CI-ben és a `check` scriptben is használható.

### D-033 – Környezeti konfiguráció mintája
- **Dátum:** 2026-11-21 · **Státusz:** Elfogadva
- **Döntés:**
  - `.env.example` üres helyőrzőkkel (ARCHITECTURE 6.5); a valódi értékek a `.env.local`-ba kerülnek.
  - `.gitignore`: `.env*` és `!.env.example`.
  - A kliens csak `EXPO_PUBLIC_*` változót olvas, kizárólag az `src/config/env.ts`-ben, statikus `process.env.EXPO_PUBLIC_X` hozzáféréssel.
  - Kézi, tesztelt validáció (`parsePublicEnv`). A zod a PHASE 03-ban jön (D-014).
  - Alapértelmezett adatmód: `mock`.
  - Hibás értéknél `issues` lista, amely a UI-ban látszik; nincs csendes javítás.
  - A szerveroldali titkokat (API-kulcsok) a PHASE 04 proxy olvassa, nem ez a modul.

### D-034 – Alapnavigáció: Stack, tabok a PHASE 12-ben
- **Dátum:** 2026-11-21 · **Státusz:** Elfogadva
- **Döntés:** gyökér `Stack` három route-tal: `index` (Kezdőlap), `about` (A projektről), `+not-found`. A sablon `NativeTabs` megoldása és az ARCHITECTURE 5. `(tabs)/` csoportja a PHASE 12-ben készül, amikor a képernyők tartalma ismert.
- **Indok:** a PHASE 02 csak működő alapnavigációt kér. Üres tabok előre gyártása hamis készültséget mutatna.
- **Lelet:** a `<Link asChild>` a gyerek `style`-ját tömbbe egyesíti, ezért függvény formájú `Pressable` `style`-t nem használunk link-gyerekben (`PrimaryButton`, regressziós teszt).

---

## PHASE 03 – Architektúra és domain modell (2026-11-21)

### D-035 – Domain modellezési konvenciók
- **Dátum:** 2026-11-21 · **Státusz:** Elfogadva (megvalósítja: D-010, D-011, D-025)
- **Döntés:**
  - **Diszkriminált unió** ott, ahol a változatok mezői eltérnek: `Instrument = Stock | Etf` (`kind`), `FinancialStatement` (`statementType`), `Transaction` (`type`: BUY/SELL, DIVIDEND/FEE, SPLIT), `Metric<T>` (`status`), `AppError` (`kind`), `AnalysisSubject` (`kind`).
  - **Közös típus** ott, ahol az alak egyforma: `Money`, `DataProvenance`, `FiscalPeriod`, `Quote`, `FxRate`, `Listing`, `Portfolio`.
  - A D-025 „Security” fogalmának típusneve a kódban **`Instrument`** (a ROADMAP és a fázisprompt nevezéktana), a mezőneve `securityId` marad.
  - **Branded típusok** az azonosítókra és formátumokra (`Isin`, `ListingId`, `CurrencyCode`, `IsoDate`…). Csak validáló `parse…` függvénnyel állíthatók elő, így ellenőrizetlen string nem csúszhat át.
  - **Smart constructor** (`create…`), amely `Result`-ot ad, ott, ahol invariáns van. A származtatott típusnak (`Position`) nincs konstruktora; a számítást a saját fázisa végzi (09).
  - Hiányzó egyszerű metaadat: explicit `null`. Forrásfüggő adat: `Metric<T>`.
  - A kimutatás minden sortétele kötelező kulcs. A meg nem adott tétel a konstruktorban `MISSING` lesz, így sosem keverhető a jelentett 0-val.
  - Minden mező `readonly`.
- **Alternatívák:**
  - zod-séma a domainben – elvetve, mert a domain ne függjön külső csomagtól;
  - osztályok – elvetve, mert a sima objektum + függvény egyszerűbb, szerializálható és tesztelhető.
- **Következmények:** a domain tiszta TS. Néhány körülhatárolt, kommentezett `as` cast van (márkázott típusok, a `validateFields` kimenete, a kimutatás-konstruktor kimenete).

### D-036 – Result és AppError séma
- **Dátum:** 2026-11-21 · **Státusz:** Elfogadva
- **Döntés:**
  - `Result<T, E = AppError> = { ok: true, value } | { ok: false, error }`; segédek: `ok`, `err`, `mapResult`, `andThen`.
  - `AppError` `kind` értékei:
    - `VALIDATION` (mezőlistával);
    - `NETWORK`, `TIMEOUT`, `RATE_LIMITED` (`retryAfterSec`);
    - `NOT_FOUND`;
    - `UPSTREAM` (`HTTP_ERROR` | `INVALID_RESPONSE` | `CONTRACT_MISMATCH` | `NOT_IMPLEMENTED`);
    - `MISSING_DATA` (`missing[]`), `CALCULATION_INVALID`, `STORAGE`, `AI`.
  - Az `isRetryable()` mondja meg, mi átmeneti hiba.
  - Az ARCHITECTURE 6.3 proxy-hibakódjait az `apiErrorToAppError` képezi le (pl. `UNSUPPORTED_MARKET` → `MISSING_DATA`, `INTERNAL` → `UPSTREAM/HTTP_ERROR`).
  - Kivételt csak programozási hiba esetén dobunk.
- **Alternatíva:** kivételosztályok, `try/catch`. Elvetve, mert a hibaág kezelése típusszinten nem kényszeríthető ki.
- **Következmények:** az ARCHITECTURE 7. tervében szereplő `UpstreamError` és rokonai egyetlen `UPSTREAM` kind alá kerültek, `failure` alkóddal.

### D-037 – Negyedéves időszak hossza: 80–100 nap (módosítja: DATA_DICTIONARY 4.3/2)
- **Dátum:** 2026-11-21 · **Státusz:** Elfogadva
- **Kontextus:** a PHASE 01-es 85–95 napos sáv kizárta volna a 14 hetes (98 napos) negyedévet, amely 53 hetes üzleti évben előfordul (pl. 2022-09-25…2022-12-31).
- **Döntés:** negyedév: 80–100 nap; év: 350–380 nap, mindkét végpontot beleszámolva. Konstans: `PERIOD_DURATION_DAYS`.
- **Felülvizsgálat:** a PHASE 04A/06-ban, valós SEC fixture-ökön.
- **PHASE 04A (2026-11-21): megerősítve.** 12 valós cég minden negyedéve belefért a 80–100 napos sávba (pl. KO 2026-04-04…07-03, 52/53 hetes naptár), a 10-Q-k 6/9 hónapos YTD tényei pedig helyesen kiestek (D-043).

### D-038 – Rétegszabályok kikényszerítése ESLinttel
- **Dátum:** 2026-11-21 · **Státusz:** Elfogadva
- **Döntés:**
  - `import/no-restricted-paths` zónák az ARCHITECTURE 3. táblázata szerint (`basePath`: a kanonikus projektgyökér).
  - `no-restricted-imports`:
    - a domainben regex tiltja az összes külső csomagot;
    - a contracts és az application rétegben a React/RN/Expo csomagok tiltottak.
  - `no-restricted-globals`: a `fetch` / `XMLHttpRequest` / `WebSocket` / `EventSource` tiltott a domain, contracts, application, presentation és `src/app` rétegben. Kivétel lesz a jövőbeli `src/app/api/**`.
  - Az `src/app` importálhat `src/config`-ot (composition root belépés), a `src/presentation` nem.
  - A tesztekre is ugyanezek a szabályok vonatkoznak.
  - Új csomag nem kellett.
- **Igazolás:** 4 ideiglenes, szándékosan hibás fájl 8 várt hibát adott (phase-03 útmutató, 7. lépés).
- **Következmények:** a PHASE 04A-ban a `src/app/api/**` és a `src/server` saját zónát kap (a `src/server` nem importálhat kliensoldali kódot, és a kliens sem a szervert).

### D-039 – zod 4 és a validáció munkamegosztása (véglegesíti: D-014)
- **Dátum:** 2026-11-21 · **Státusz:** Elfogadva
- **Döntés:**
  - zod **4.6.7** (`npx expo install zod` → `dependencies`; tiszta JS). Az `expo export` Android (Hermes) bundle sikeres.
  - A zod **csak** a `src/contracts`-ban van (és a PHASE 04A-tól a `src/server`-ben).
  - Munkamegosztás, hogy egy szabály egy helyen legyen:
    - a zod a szerkezetet ellenőrzi (ismeretlen JSON → típusos DTO);
    - az üzleti invariánsokat a domain ellenőrzi: a sémák a domain parsereit hívják (`fromDomainParser`), a mapperek a domain konstruktorait (`quoteFromDto` → `createQuote`).
  - A séma kimenetének illeszkedését a domain típushoz fordítási idejű ellenőrzés garantálja (`contracts.test.ts`; negatív próbával igazolva).
  - A contract-hibát a kliens `UPSTREAM/CONTRACT_MISMATCH`-ként, mezőútvonallal jelzi.
- **Nem változott:** az `src/config/env.ts` kézi validációja marad. Tesztelt és működik; a zodra cserélés csak átírás volna, érdemi haszon nélkül.

### D-040 – Portok és use case-ek: csak ami használatban van; függvény-factory DI
- **Dátum:** 2026-11-21 · **Státusz:** Elfogadva
- **Döntés:**
  - Portok: `Clock`, `IdGenerator`, `MarketDataGateway` (`getQuote`), `PortfolioRepository`.
  - A ROADMAP-ben felsorolt `FxGateway` (04A), `AiGateway` (11) és `Logger` akkor kerül be, amikor egy use case használja. A fázisprompt kifejezetten kéri, hogy ne legyen fölösleges interface.
  - Use case = `createX(deps) => (input) => Promise<Result<…>>`. Kevesebb kód, mint egy osztály, és a tesztben a függőség egyszerűen cserélhető.
  - A use case-ek az `AppServices` interfészen (`src/application/index.ts`) át jutnak a UI-hoz (`AppServicesProvider` / `useAppServices`).
  - A composition root (`createAppServices(env, overrides)`) a felülírt órát az adapterekhez is továbbadja.
  - `live` módban a PHASE 04A-ig az árfolyam-gateway őszinte `UPSTREAM/NOT_IMPLEMENTED` hibát ad, nem csendes demóadatot.
  - A mock gateway kitalált `DEMO*` tickereket használ, `kind: 'mock'` jelöléssel. Így valós árfolyamot nem találunk ki.
- **Következmények:** a portfólió-tároló mindkét módban memóriában él az SQLite-ig (PHASE 13), ezért az adatok újraindításkor elvesznek (KI-13).

### D-041 – Jest-konfiguráció külön fájlban, kanonikus útvonallal (Windows)
- **Dátum:** 2026-11-21 · **Státusz:** Elfogadva (módosítja: D-032 konfigurációs helyét)
- **Kontextus:**
  - Ha a munkakönyvtár kisbetűs meghajtóval (`c:\…`) érkezik, ahogy a VS Code-ban vagy Git Bash-ben, a Jest ugyanazt a modult két kulccsal (`c:\` és `C:\`) kétszer tölti be.
  - Ilyenkor két React-példány keletkezik, és a route-tesztek „Invalid hook call” hibával buknak (KI-11).
  - PowerShellből (`C:\…`) a tesztek zöldek voltak, ezért ez a PHASE 02-ben nem derült ki.
- **Döntés:**
  - A `package.json` `jest` kulcsa helyett `jest.config.js` készült.
  - Ez a projektgyökér valódi (`fs.realpathSync.native`) útvonalát használja `rootDir`-ként, és csak kis/nagybetű-eltérés esetén `chdir`-el rá.
  - Ugyanez a kanonikus útvonal az ESLint zónák `basePath`-ja.
- **Következmények:** a tesztek bármelyik terminálból zöldek. Más OS-en a `realpathSync.native` változatlan útvonalat ad.

---

## PHASE 04A – Proxy váz és ingyenes alapforrások (2026-11-21)

### D-042 – Jegyzés-jelölt (ListingCandidate) és üzemeltetői MIC
- **Dátum:** 2026-11-21 · **Státusz:** Elfogadva
- **Kontextus:** az OpenFIGI (valós válasz alapján) nem ad jegyzési pénznemet és MIC-et, csak Bloomberg `exchCode`-ot. A domain `Listing` viszont kötelezően tartalmaz pénznemet (a pozíció és a P/L ehhez kötődik).
- **Döntés:**
  - Új domain-típus: `ListingCandidate` (`tradingCurrency: CurrencyCode | null`) és `SecurityListings`. Ez utóbbi a kihagyott sorokat okonként megszámolja (`unmappedVenue`, `composite`, `invalidSymbol`). A `Listing` szigorú marad.
  - Az `exchCode` → MIC tábla CSAK igazolt párokat tartalmaz: 14 kódot, mindegyiket az OpenFIGI `micCode` szűrőjével ellenőriztük (a bizonyíték a kódban: `verifiedBy`). Ami nincs benne, az kimarad, de meg van számolva.
  - A listing-azonosítóban az **üzemeltetői (operating) MIC** szerepel (XNGS/XNMS → XNAS, MTAA → XMIL), így egy tőzsde egy azonosítót kap.
  - A kompozit (ország-szintű) sort az adatból ismerjük fel: `figi === compositeFIGI`.
- **Alternatíva:** nullable `Listing.tradingCurrency`. Elvetve, mert a pozíciószámításnál a pénznem nem hiányozhat.
- **Következmények:** a pénznemet egy árforrás tölti ki (PHASE 04B, EODHD). US részvénynél az ISIN-kérés csak kompozit sort ad (KI-21).

### D-043 – SEC companyfacts normalizálási szabályok
- **Dátum:** 2026-11-21 · **Státusz:** Elfogadva (12 valós cég fixture-ján igazolva; részletek: DATA_DICTIONARY 4.4)
- **Döntés:**
  1. **Pénznem:** a pénzösszeg-tények leggyakoribb egysége (TSM: TWD, mert az USD csak kényelmi átszámítás). Eltérő pénznemű tény nem kerül be.
  2. **Időszak:** a `start`/`end`-ből (D-021). FY 350–380, negyedév 80–100 nap. A D-037 sávja megerősítve: a 6/9 hónapos (YTD) tények kiesnek.
  3. **Címke** (`fiscalYear`, `fp`): annak a filingnek a mezőiből, amelynek ez a **saját** (legkésőbbi) időszaka. Ha nincs saját filing: évnél a záródátum éve (január 1–7. → előző év, `[FELTÉTELEZÉS]`); negyedévnél kihagyás + megjegyzés.
  4. **Érték:** tag-prioritási lista; időszakonként az első tag, amelynek pontos ténye van; ezen belül a legkésőbb beadott érték (restatement). Tagek értékei soha nem adódnak össze.
  5. **Valós adat alapján:** a `Revenues` az első, mert a BRK-B-nél és a WMT-nél a `RevenueFromContract…` csak részösszeg. A `…BeforeIncomeTaxesDomestic` kimarad, mert csak a belföldi rész.
  6. **`totalDebt`:** szándékosan `MISSING`, indoklással (dupla számolás veszélye; a PHASE 05/06 dönt).
  7. **Részvényszám:** `CommonStockSharesOutstanding` az időszak végén. Tartalékként a címlap (dei) adata, **csak az időszak saját filingjéből**; ekkor az `asOf` a címlap dátuma (valós lelet: JNJ).
  8. **Kiáramlás negatív értékkel** → `INVALID_INPUT` (nem fordítjuk meg az előjelet).
  9. **Méretkorlát:** legfeljebb 15 éves vagy 20 negyedéves időszak.
  10. **CIK:** számként és szövegként is elfogadott (valós lelet: az XOM új CIK-jénél string).
- **Következmények:** negyedéves Q2/Q3 cash flow és Q4 nincs. A YTD-különbség `calculated` lenne, ez a PHASE 06 feladata (KI-18, KI-19).

### D-044 – Proxy hibamodell, kimenet-önellenőrzés, cache nélkül
- **Dátum:** 2026-11-21 · **Státusz:** Elfogadva
- **Döntés:**
  - A szerver is az `AppError`-t használja, nincs külön szerver-hibatípus. Az `appErrorToResponse` képezi HTTP-státuszra és API-kódra; a kliens `apiErrorToAppError`-ja a párja.
  - **Új API-kód:** `CAPABILITY_UNAVAILABLE` (501) = nincs bekötött forrás a képességhez (pl. árfolyam a 04B-ig, vagy hiányzó `SEC_USER_AGENT`). A kliensen: `MISSING_DATA(['source'])`.
  - **Leképezés:** VALIDATION → 400; NOT_FOUND → 404; RATE_LIMITED → 429 + `Retry-After`; TIMEOUT → 504; NETWORK és HTTP_ERROR → 502 `UPSTREAM_ERROR`; INVALID_RESPONSE → 502 `UPSTREAM_INVALID`; MISSING_DATA(market) → 422 `UNSUPPORTED_MARKET`.
  - **Felfelé:** a 402 (kvóta) → `RATE_LIMITED` (`retryAfterSec: null`). A hálózati hiba eredeti üzenete (benne URL) nem jut a kliensig.
  - **Kimenet-önellenőrzés:** minden sikeres választ a kliensével KÖZÖS contract-sémán is átfuttatunk; eltérés esetén 500 `INTERNAL` + napló. A tesztekben ez két valós eltérést fogott meg (listing-mezőnév, quote-alak → `quoteToDto`).
  - **`Cache-Control: no-store`:** a 04A-ban nincs proxy cache, minden kérés friss (a kézi frissítés egyszerűen új kérés). TTL-cache: PHASE 13.
- **Következmények:** a SEC companyfacts kérésenként több MB (KI-24).

### D-045 – Proxy adatmód: live XOR mock
- **Dátum:** 2026-11-21 · **Státusz:** Elfogadva
- **Döntés:**
  - `PROXY_DATA_MODE=live|mock` (alapértelmezés: live).
  - A regiszter (`createProviderRegistry`) programozási hibát dob, ha élő módban mock, vagy mock módban élő szolgáltatót kapna.
  - Minden mock kimenet `kind: 'mock'`; demóból számolt FX-ráta is `mock` marad.
- **Következmények:** demó és éles adat nem keveredhet észrevétlenül; a health végpont kiírja az adatmódot.

### D-046 – FX: EUR-pivot a szerveren, keresztárfolyam a domainben, elavultság-szabály
- **Dátum:** 2026-11-21 · **Státusz:** Elfogadva (a D-017 megvalósítása)
- **Döntés:**
  - A proxy csak ECB-rátát ad, EUR bázissal. A keresztárfolyamot a domain számolja (`deriveFxRate`: közvetlen → inverz → EUR-on át), `calculated` provenance-szel, képlettel és bemenetekkel. Eltérő dátumú bemeneteknél a régebbi dátum lesz az `asOf`.
  - `FxConversion`: az `original` (natív) és a `converted` (kijelzési) összeg külön; a `rate` (dátum, forrás) mindig a kimenetben.
  - **Frissesség** `[FELTÉTELEZÉS – PHASE 13]`: 4 napig FRESH; 10 napig STALE (átvált, de jelölve); utána EXPIRED → `MISSING_DATA`, becslés nincs. Történeti átváltásnál a kért naphoz mérjük.
  - **Penny:** `GBX` → GBP explicit /100. A `parseCurrencyCode` a `GBp`-t `GBX`-re képezi (a sima nagybetűsítés 100-szoros hibát okozna).
  - **Kijelzési pénznemek:** HUF, EUR, USD, GBP, CHF, JPY (`DISPLAY_CURRENCIES`). Az ECB-listán kívüli deviza `missing` lesz (R-27).
- **Új port:** `FxGateway`, a D-040 szerint az első használójával (`convertMoney` use case) együtt.

### D-047 – Valós, megvágott fixture-ök és rögzítő script
- **Dátum:** 2026-11-21 · **Státusz:** Elfogadva
- **Döntés:**
  - Fixture-ök helye: `src/server/providers/<adapter>/__fixtures__/`. Valós válaszokból készülnek, `_fixture` fejléccel (forrás, URL, dátum, megjegyzés). SEC: 12 cég, csak a használt tagek, `filed ≥ 2021-01-01` (~2 MB).
  - Rögzítő: `scripts/record-sec-fixtures.mjs`. A `SEC_USER_AGENT`-et a `.env.local`-ból olvassa; nem írja ki és nem menti. A tag-listát a `sec-tags.ts`-ből importálja (függőség nélküli fájl, Node 26 type-stripping).
  - A fixture-öket a Prettier nem formázza újra (`.prettierignore`).
  - A tesztek `jest.requireActual`-lal töltik be a fixture-öket, így nem kell `@types/node`, és a kliens kód sem kap Node-típusokat.
- **Alternatíva:** kézzel írt fixture. Elvetve: a valós adat két normalizálási hibát és két formátum-meglepetést (CIK stringként, JNJ címlap) mutatott meg.

### D-048 – Kimutatás-készlet frissessége
- **Dátum:** 2026-11-21 · **Státusz:** Feltételezés (a PHASE 13 véglegesíti)
- **Döntés:** a legutolsó felhasznált filing dátumától (`provenance.asOf`) mérjük:
  - negyedéves: 120 napig FRESH, 400 napig STALE;
  - éves: 400 napig FRESH, 800 napig STALE;
  - utána EXPIRED.
  - Az OpenFIGI-jegyzésnek nincs `asOf`-ja, ezért UNKNOWN.


## PHASE 04B – FMP, EODHD, routing és kvóta (2026-11-21)

### D-049 – ProviderRouter és a véglegesített routing-tábla
- **Dátum:** 2026-11-21 · **Státusz:** Elfogadva (a D-024 és a DATA_SOURCES 5.2–5.3 megvalósítása)
- **Döntés:**
  - A 04A `findProvider` (első találat) helyett `ProviderRouter` (`src/server/routing/provider-router.ts`): képesség × piac (`US` | `EU` | `GLOBAL` | `ANY`, a MIC-ből) → szolgáltató-lánc.
  - Tábla: quote / ártörténet / osztalék: US `fmp → eodhd`, EU és globális `eodhd`; profil: US `fmp`, máshol `PLAN_LIMIT`; kimutatás: US `sec-edgar`, máshol `PLAN_LIMIT`; jegyzések: `openfigi → eodhd`; keresés: `fmp → eodhd`; FX: `ecb-fx`; ETF-metaadat/holdings: sehol (`PLAN_LIMIT`).
  - Fallback: NOT_FOUND, RATE_LIMITED, TIMEOUT, NETWORK, UPSTREAM (a hibás válasz is, naplózva), UNAVAILABLE esetén. VALIDATION esetén nem.
  - A nem konfigurált és a jegyzést nem lefedő (`covers`) szolgáltatót hálózati hívás nélkül átugorja.
  - A válasz `warnings` mezője megmondja, ha tartalék forrás adott választ; a napló `fallbackFrom` mezője rögzíti a sikertelen kísérleteket. A provenance mindig a ténylegesen használt forrás. Egy válasz = egy forrás (nincs összefésülés).
- **Viselkedésváltozás (contract):** nem US kimutatás eddig `422 UNSUPPORTED_MARKET` volt, most `501 CAPABILITY_UNAVAILABLE` + `unavailableReason: PLAN_LIMIT` (fizetős EODHD Fundamentals-szel elérhető volna, D-027).
- **Indok:** a `sec-edgar` ticker → CIK leképezése nem US jegyzésnél hamis céget adhat (pl. `SAP@XETR` vs. a US `SAP` ADR), ezért csak US-re route-olunk.

### D-050 – Ártörténet-korrekció: explicit fajta (`NONE` | `SPLIT` | `SPLIT_DIVIDEND`)
- **Dátum:** 2026-11-21 · **Státusz:** Elfogadva
- **Döntés:** a `PriceSeries.adjusted: boolean` helyett `adjustment: PriceAdjustment`, és a sorozat `notes` mezőt kap.
  - Élő próba (NVDA 10:1 split, 2024-06-10): FMP `full` `close` = split-korrigált (120.89), `non-split-adjusted` `adjClose` = nyers (1208.9), `dividend-adjusted` = split + osztalék (120.55). EODHD: `close` nyers (doksi, KI-33), `adjusted_close` split + osztalék (ASML-en igazolt eltérés).
  - Az EODHD a `SPLIT` fajtát nem adja → `UNAVAILABLE / NOT_COVERED` (a router továbbléphet).
  - A végpont alapértelmezése: `split_dividend` (mindkét élő forrás adja).
- **Alternatíva:** a bool megtartása. Elvetve: a két forrás „adjusted” értéke más jelentésű, csendes keverést okozna (R-21).

### D-051 – Csomagmátrix env-ből; napi kvóta-költségvetés
- **Dátum:** 2026-11-21 · **Státusz:** Elfogadva (a D-027 megvalósítása)
- **Döntés:**
  - `FMP_PLAN` (`free` | `starter`) és `EODHD_PLAN` (`free` | `eod-all-world`) → `PlanSpec` (`src/server/routing/plans.ts`): bekapcsolt képességek, lefedettség, napi kvóta, ártörténet-ablak. Ismeretlen érték → `free` + figyelmeztetés; nem igazolt (fizetős) sor → figyelmeztetés.
  - A free sorok élő próbával igazoltak: EODHD 20/nap, 365 napos ablak; FMP csak US, 250/nap `[HARMADIK FÉL]`.
  - Kvóta (`src/server/routing/quota.ts`): szolgáltatónként, UTC-napra; minden elindított hívást számol (konzervatív); a keresés (`low`) a keret 75%-áig fogyaszthat, a maradék az árfolyamé. Túllépésnél NEM indít hívást (`QUOTA_EXHAUSTED`).
  - A számláló memóriabeli, folyamatonként (KI-23, KI-32), a `providers/status` `scope: "instance"`-ként jelzi.
- **Igazolás:** teszt mutatja, hogy az `EODHD_PLAN` átírása (kód nélkül) megszünteti az 1 éves levágást.

### D-052 – A jegyzés pénzneme: forrásból vagy helyszíni szabályból, soha nem kitalálva
- **Dátum:** 2026-11-21 · **Státusz:** Elfogadva
- **Döntés:** sem az FMP quote, sem az EODHD `real-time`/`eod` válasza nem közöl pénznemet. Sorrend:
  1. **Helyszíni szabály** csak egypénznemű tőzsdére: US tőzsdék → USD; Xetra → EUR (a Xetra EUR-ban kereskedik; a keresőben is minden XETRA-jegyzés EUR).
  2. Egyébként az **EODHD kereső** (`/api/search/{kód}?exchange=…`, `Code` + `Exchange` pontos egyezés), 24 órás memóval.
  3. Ha egyik sem ad pénznemet: `NOT_FOUND` – nem találjuk ki.
- **Indok:** az LSE-n ugyanaz az ETF GBX-ben, GBP-ben és USD-ben is jegyzett (ISF/ISFU, VWRP/VWRA – élő keresés), így tőzsdéből nem következtethető.
- **Osztalék:** az EODHD soronként adja a pénznemet (ISF: ár GBX, osztalék GBP) – megtartjuk, és eltérés esetén megjegyzést adunk; az FMP osztaléknál (csak US) USD a helyszíni szabály, a `notes` kimondja.

### D-053 – `UNAVAILABLE` hibafajta és `unavailableReason` a szerződésben
- **Dátum:** 2026-11-21 · **Státusz:** Elfogadva
- **Döntés:**
  - Új `AppError` fajta: `UNAVAILABLE` + `reason: PLAN_LIMIT | NOT_COVERED | QUOTA_EXHAUSTED`. Nem újrapróbálható (`isRetryable: false`).
  - HTTP: `CAPABILITY_UNAVAILABLE` + opcionális `unavailableReason` (visszafelé kompatibilis); kvótánál 503, egyébként 501. A kliens ok nélküli `CAPABILITY_UNAVAILABLE`-t a 04A szerint `MISSING_DATA(source)`-ként kezel.
  - A közös `requestJson` 402-je: `RATE_LIMITED` helyett `UNAVAILABLE / QUOTA_EXHAUSTED` (EODHD-doksi: napi keret). Az FMP 402-je saját leképezéssel `PLAN_LIMIT` (élő próba; ismeretlen tickerre is ezt adja, KI-30). EODHD 403 → `PLAN_LIMIT`, 401 → kulcshiba (kulcs nélküli üzenettel).

### D-054 – Új domain-típusok és végpontok; szerverkontextus a `globalThis`-en
- **Dátum:** 2026-11-21 · **Státusz:** Elfogadva
- **Döntés:**
  - Domain: `DividendEvent`/`DividendHistory` (eseményenkénti `Money`, 0 vagy negatív összeg nem esemény), `InstrumentProfile` (lapos, forrásközeli, hiány = `null`, ETF-metaadat nélkül), `InstrumentSearchHit`/`InstrumentSearchResult` (csak igazolt MIC, a kihagyások okonként megszámolva, `truncated` is).
  - Végpontok: `GET /api/v1/instruments/{id}/prices`, `/profile`, `/dividends`, `GET /api/v1/search?q=`, `GET /api/v1/providers/status`. A tervezett `corporate-actions` helyett `dividends` (split-végpont nincs bekötve – a név ne ígérjen többet).
  - Kliens: `MarketDataGateway` + 4 use case (`getPriceHistory` saját frissesség-szabállyal: 4 nap FRESH, 14 nap STALE `[FELTÉTELEZÉS – PHASE 13]`; `getInstrumentProfile`; `getDividendHistory`; `searchInstruments`).
  - A szerverkontextus singletonja a `globalThis`-en él, mert az Expo route-onként külön bundle-t fordít (KI-31).
