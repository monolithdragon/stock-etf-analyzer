# Handoff – PHASE 13 → PHASE 14

> Dátum: 2026-11-24 · Elkészült: **PHASE 13 – Tárolás, cache és offline** · Következik: **PHASE 14 – Compare, watchlist, screener, alerts**
> Kezdőbarát útmutató: [../phases/phase-13-storage-cache-offline.md](../phases/phase-13-storage-cache-offline.md) · Előző handoff: [phase-12-handoff.md](phase-12-handoff.md)

## 1. Készültség
**PHASE 13: KÉSZ** – egy megszorítással: **eszközön (emulátor/telefon) nem futott** (KI-117). Igazolás: Jest valódi SQLite-tal (`node:sqlite`), a valódi route-fa (`renderRouter`), `expo export` Android + web.

| Elfogadási feltétel | Állapot | Bizonyíték |
|---|---|---|
| Offline állapotban nem mutat régi adatot frissként | ✅ | `capFreshnessForCache` + cache-jelölés; `market-data-cache.test.ts` („soha nem FRESH”, EXPIRED offline), `offline-storage-integration.test.ts` (offline újraindítás: `freshness ≠ FRESH`, „Offline adat – elavult lehet” jelzés) |
| Cache-elt adat provenance-e és timestampje megmarad | ✅ | rekord-oszlopok (forrás, `fetchedAt`, `asOf`, időszak, minőség, érvényesség); tesztek: eredeti `fetchedAt`/`sourceId` offline, SQLite-roundtrip minden mezőre |
| A portfólió mentése és visszaolvasása tesztelt | ✅ | `storage.test.ts` (minden tranzakciótípus, újranyitás), integráció (új app-példány elemzi), route-teszt (újraindítás után összesítés) |
| Nincs titok vagy API-kulcs nem biztonságos helyen | ✅ | a kliensnek nincs titka (nincs `expo-secure-store` sem); export titok nélkül (teszt); bundle-szkennelés: 0 találat |
| Kötelező kimenetek | ✅ | adapterek + repository-k (`src/infrastructure/storage/`), migrációs terv (D-083, útmutató 4. lépés), tesztek, phase-13 útmutató, ez a handoff |

## 2. Mi készült (röviden)
- **Tárolás (D-082, D-083):** `expo-sqlite` (portfólió, tranzakció, figyelőlista, cache; `PRAGMA user_version` migráció tranzakcióban) + `expo-sqlite/kv-store` (beállítások; v1 → v2 migráció); weben memória (`default-storage.web.ts`). Lusta adatbázis-nyitás, újrapróbálással.
- **Cache:** `createMarketDataCache` (gateway-dekorátor + `CacheControl`), 11 adatfajta saját TTL-lel (`CACHE_POLICIES`), contract-séma validáció visszaolvasáskor, kérés-összevonás, `provenance.cache` jelölés, offline tartalék legalább `STALE`.
- **Három külön mechanizmus:** kézi frissítés (jelölés, tartalék marad), invalidálás (törlés), háttérfrissítés (hálózat-visszatéréskor, beállítható, korlátozott).
- **Use case-ek:** `services.preferences`, `services.watchlist`, `services.localData` (állapot, kézi frissítés, cache törlése, statisztika, export, teljes törlés, háttérfrissítés).
- **UI:** a `useSettings`/`useWatchlist` interfész változatlan, de tartós; `useDataStatus` (jelzés + kézi frissítés) a részvény-, ETF- és portfólióképernyőn; Beállítások: „Frissítés” és „Helyi adatok” kártya.
- **Új csomagok:** `expo-sqlite ~58.0.18`, `expo-network ~58.0.5` (`npx expo install`); `app.json`: `expo-sqlite` plugin.

## 3. Módosított / új fájlok
- **Új – application:** `cache/{cache-policy,cache-keys,cache-codecs,market-data-cache,background-refresh,types}.ts`, `preferences/user-preferences.ts`, `watchlist/types.ts`, `use-cases/local-data.ts`.
- **Új – infrastructure:** `storage/{sql-database,migrations,database-provider,portfolio-codec,sqlite-portfolio-repository,sqlite-watchlist-repository,sqlite-cache-store,kv-preferences-repository,in-memory-stores,local-storage,expo-sqlite-database,default-storage,default-storage.web}.ts`, `system/expo-connectivity.ts`.
- **Új – presentation:** `hooks/use-data-status.ts`, `view-models/data-status-notices.ts`, `screens/local-data-card.tsx`.
- **Új – tesztek/segédek:** `src/__tests__/{market-data-cache,offline-storage-integration}.test.ts`, `src/infrastructure/storage/storage.test.ts`, `src/application/cache/{background-refresh,cache-policy}.test.ts`, `src/application/use-cases/local-data.test.ts`, `src/presentation/view-models/data-status-notices.test.ts`, `src/testing/{node-sqlite-database,jest-setup}.ts`, `src/testing/mocks/{expo-sqlite,expo-sqlite-kv-store,expo-network}.ts`.
- **Módosított:** `src/domain/shared/provenance.ts` (`cache?`, `capFreshnessForCache`), `src/application/ports/index.ts`, `src/application/index.ts` (`AppServices` + 3 szolgáltatás), `use-cases/{get-listing-quote,get-market-data,convert-money}.ts` (plafon), `src/config/container.ts`, `src/app/_layout.tsx` (háttérfrissítés indítása), `src/infrastructure/mock/in-memory-portfolio-repository.ts`, `src/presentation/state/{settings,watchlist}-context.tsx`, `screens/{stock-analysis,etf-analysis,portfolio,settings}-screen.tsx`, `strings/hu.ts`, tesztek: `routes.test.tsx` (+5), 3 use case-teszt (port-bővítés), `app-services-context.test.tsx`; `jest.config.js`, `package.json`, `package-lock.json`, `app.json`.
- **Docs:** új: ez a handoff, `docs/phases/phase-13-storage-cache-offline.md`; módosítva: `DECISIONS` (D-013 lezárva, D-082…D-084), `ARCHITECTURE` (5.1 PHASE 13 struktúra, 11–12. véglegesítve), `KNOWN_ISSUES` (PHASE 13 szakasz KI-110…KI-121, KI-97/KI-109 lezárva, átütemezések), `ROADMAP`, `PROJECT_STATE`, `README`.

## 4. Parancsok és tényleges eredmények (2026-11-24, a projekt gyökerében)

| Parancs | Eredmény |
|---|---|
| `git status` / `git branch` (kiinduláskor) | `main` tiszta; a PHASE 12 a `phase-12`-n (`origin/phase-12` létezik, PR nincs) → `git checkout phase-12 && git switch -c phase-13` |
| `npx expo install expo-sqlite expo-network` | `expo-sqlite ~58.0.18`, `expo-network ~58.0.5`; `app.json` plugin hozzáadva |
| `npx jest` (a meglévő tesztek az új bekötéssel, új tesztek előtt) | **1447/1447** zöld (a route-tesztekben a portfólió már Node-SQLite-on fut) |
| `CI=1 npx expo start --port 8093/8094` (rövid ideig) | typed routes újragenerálása; az első (megszakított) futás hiányos fájlt hagyott → törlés + újragenerálás (KI-121) |
| `npm run check` (a fázis végén) | **exit 0**: typecheck ✅, lint (`--max-warnings 0`) ✅, Prettier ✅, **1541/1541 teszt, 88 suite** ✅ (+94) |
| `npx jest --coverage` (új modulok) | 95,6% sor / 84,2% ág / 92,2% utasítás |
| `npx expo export -p android` (scratch mappába) | exit 0, Hermes bundle 4,5 MB; tartalmazza az `ExpoSQLite`-ot |
| `npx expo export -p web` (scratch mappába) | exit 0; a webes kliensben nincs SQLite (memória-tárolás) |
| Értékvak szkenner (`.env.local` titkai a bundle-ökben) | 3 ellenőrzött titokérték, **0** találat mindkét exportban; kulcsnevek a kliensben: 0; az export-mappák törölve |

**Fejlesztés közbeni leletek:**
1. RNTL 14: az `unmount()` aszinkron – `await` nélkül a következő tesztek routere „beragad” (üres fa, régi útvonal).
2. Az expo-router tesztkörnyezet hamis időzítői miatt a `setTimeout` route-tesztben soha nem fut le → mikrotaszk-ürítés.
3. Egy megszakított `expo start` `/` nélküli typed routes fájlt hagyott (KI-121).
4. A Node 26 beépített `node:sqlite` Jestben gond nélkül használható → valódi SQL-tesztek új függőség nélkül (D-084).

## 5. Ismert hibák / korlátok
Részletek: [../KNOWN_ISSUES.md](../KNOWN_ISSUES.md), „PHASE 13” szakasz.
- **KI-117 (K):** eszközön nem futott (SQLite-fájl, WAL, `expo-network` állapotváltás, újraindítás).
- **KI-114 (K):** nincs proxy-cache (KI-68, KI-76).
- **KI-113 (K):** export csak kijelölhető szöveg, nincs fájl és import.
- **KI-112 (K):** nincs app-szintű DB-titkosítás (OS-titkosítás védi).
- KI-110 (tőzsdei naptár), KI-111 (web memóriában), KI-115 (háttérfrissítés csak előtérben), KI-116 (LLM-magyarázat nincs cache-elve, beleegyezés nincs tárolva), KI-118, KI-119 (offline keresés), KI-120 (demó módban nincs cache), KI-121 (typed routes).
- **Átütemezve a PHASE 13-ból:** holdings-fájl import (KI-74/80), ETF-metaadat űrlap (KI-101), több portfólió (KI-105), ETF forrás-összesítő (KI-106), szerveroldali AI-cache (KI-91).

## 6. Nyitott kérdések (a tulajdonos dönt)
- **Commit:** tulajdonosi kérésre commitolva a `phase-13` branchen (`f40d2cc`); a push, a PR és a merge a tulajdonos döntése. A `phase-13` a `phase-12`-re épül → javasolt sorrend: PHASE 12 PR merge, utána PHASE 13 PR. Commit-üzenet:
  `feat: PHASE 13 – tárolás, cache és offline (expo-sqlite + kv-store, adatfajtánkénti TTL-ű eszköz-cache provenance-szel, offline tartalék soha nem FRESH, kézi frissítés/invalidálás/háttérfrissítés, migrációk, export és törlés)`
- **Eszközös ellenőrzés:** `npm run android` + a fázis-útmutató 15. fejezete (repülőgép-mód, újraindítás).
- **Proxy-cache** a PHASE 14 elején? (KI-114 – a free EODHD 20 hívás/nap miatt hasznos, ha több eszközről vagy újratelepítés után használod.)
- **Export fájlba / import** (`expo-sharing`, `expo-file-system`): PHASE 14 vagy 15?
- A korábbi nyitott pontok (LLM bekapcsolása DP-04, EAS-próba, FMP ToS, DP-05, vonaldiagram) változatlanok.

## 7. Indulási útmutató a PHASE 14-hez
1. **Olvasnivaló:** `docs/PROJECT_STATE.md`, ez a handoff, ROADMAP PHASE 13 „kapcsolódási pontok” és PHASE 14, D-082…D-084, KNOWN_ISSUES PHASE 13.
2. **Ellenőrzés:** `git status`, `git branch --show-current`, majd `npm run check`. Elvárt: exit 0, **1541 teszt** (ha a PHASE 13 commitolva/merge-ölve van). Typed routes hibánál: útmutató 16. fejezet.
3. **Kapcsolódási pontok:**
   - Figyelőlista: `services.watchlist` (tartós) + `useWatchlist()`; riasztás/screener ide kötődik.
   - Cache-elt adat: `services.localData.getStatus(listingIds)` (frissesség, offline), a screener offline is futhat a cache-en (jelölve).
   - Háttérmunka-minta: `createBackgroundRefresher` (ma csak előtérben, KI-115).
   - Proxy-cache: a `CACHE_POLICIES` szerveroldalon is használható (a `src/application/cache/cache-policy.ts` tiszta modul).
   - Új tárolt adat (pl. riasztási szabályok): új migráció a `MIGRATIONS` végére (`version: 2`), soha ne módosíts meglévőt.
4. **Tilos (marad):** titok a kliensben; régi adat jelölés nélkül; hiány 0-ként; automatikus LLM-hívás; lekérés minden renderkor.
