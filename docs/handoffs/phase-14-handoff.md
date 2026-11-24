# Handoff – PHASE 14 → PHASE 15

> Dátum: 2026-11-24 · Elkészült: **PHASE 14 – Compare, watchlist, screener, alerts** · Következik: **PHASE 15 – Integráció, QA, biztonság**
> Kezdőbarát útmutató: [../phases/phase-14-compare-watchlist-screener-alerts.md](../phases/phase-14-compare-watchlist-screener-alerts.md) · Előző handoff: [phase-13-handoff.md](phase-13-handoff.md)

## 1. Készültség
**PHASE 14: KÉSZ** – egy megszorítással: **eszközön (emulátor/telefon) nem futott** (KI-129). Igazolás: Jest (valódi route-fa `renderRouter`-rel, valódi SQLite `node:sqlite`-tal), `expo export -p android`.

| Elfogadási feltétel | Állapot | Bizonyíték |
|---|---|---|
| A comparison csak összehasonlítható mutatókat jelenít meg | ✅ | `compareInstruments` szabályai (típus, pénznem, hozam-alap, ablak, score-rendszer, ≥ 2 érték); `compare.test.ts` (14), route-teszt: részvény+ETF → csak `dayChange`, P/E és TER nincs a táblában |
| Watchlist elemek tartósan menthetők | ✅ | PHASE 13 SQLite + PHASE 14 route-tesztek (újraindítás után a sor és a score-betöltés) |
| Nincs nem dokumentált push/alert képesség | ✅ | Nincs `expo-notifications`/`expo-background-task`; `ALERT_PLATFORM_LIMITATIONS` a UI-n és tesztben; D-088 az Expo SDK 58 (és 57) docs idézeteivel |
| Screener találatok visszavezethetők | ✅ | feltételenkénti `CriterionEvidence` a használt `Metric`-kel (provenance); `screener.test.ts`, integrációs teszt: a bizonyíték = a pillanatkép értéke |
| Kötelező kimenetek | ✅ | logika (`src/application/insights/`), 4 képernyő, unit + integrációs tesztek, phase-14 útmutató, ez a handoff |

## 2. Mi készült (röviden)
- **Közös pillanatkép (D-085):** a meglévő `evaluateStock`/`evaluateEtf` kimenetéből, új képlet nélkül; ár + számított napi változás (utolsó két záróár, split-korrigált); ismeretlen típusnál hiba.
- **Összehasonlítás (D-086):** 2–4 elem; vegyes módban csak közös piaci adat + részvény súlya az ETF-ben; kizárt mutatók okkal; mobilon mutatónként függőleges cellák.
- **ETF-átfedés (D-086):** ≤ 31 nap eltérésű holdings-dátumok; Σ min; közös súly A/B külön, összeadásuk tiltva; 50/50 keverék cégenként egyszer; részleges = alsó becslés.
- **Figyelőlista:** ár, napi változás, frissesség, „Frissítve: … · adatnap: …”; score + értékelési státusz gombra.
- **Screener (D-087):** 8 kategória, lokális univerzum (figyelőlista + portfólió), validáció (nem szám, tartomány, pénznem, duplikátum, ellentmondás), PASS/FAIL/NOT_EVALUABLE, kiinduló szűrők.
- **Riasztás (D-088):** ár / Base MOS / P/E / TER; SQLite 2. migráció (`alert_rules`); élváltás; csak az appban („Ellenőrzés most”); export v2 és teljes törlés kiterjesztve.
- **Új csomag nincs.**

## 3. Módosított / új fájlok
- **Új – application:** `src/application/insights/{instrument-snapshot,load-snapshot,compare,etf-overlap,screener,alerts,insight-services,testing}.ts` (+ 4 teszt).
- **Új – infrastructure:** `src/infrastructure/storage/sqlite-alert-rule-repository.ts`.
- **Új – presentation/app:** `view-models/insights-view-model.ts` (+ teszt), `screens/screener-screen.tsx`, `screens/alerts-screen.tsx`, `src/app/screener.tsx`, `src/app/alerts.tsx`.
- **Új – tesztek:** `src/__tests__/insight-services.test.ts`, `src/__tests__/insights-integration.test.ts`.
- **Módosított:** `src/application/{index,ports/index}.ts` (`AppServices` + 5 szolgáltatás, `AlertRuleRepository`), `use-cases/local-data.ts` (export v2, törlés), `src/config/container.ts`, `src/infrastructure/storage/{migrations,in-memory-stores,local-storage,default-storage}.ts`, `src/app/_layout.tsx`, `src/presentation/screens/{watchlist,compare}-screen.tsx` (teljes újraírás), `screens/portfolio-forms.tsx` + `format/formatters.ts` (`parseDecimalInput` áthelyezve, visszaexportálva), `strings/hu.ts`; tesztek: `routes.test.tsx` (+4, export v2), `storage.test.ts` (+2, migrációs tesztek az 1. migrációra rögzítve), `local-data.test.ts` (v2), `offline-storage-integration.test.ts`, `app-services-context.test.tsx`.
- **Docs:** új: ez a handoff, `docs/phases/phase-14-compare-watchlist-screener-alerts.md`; módosítva: `DECISIONS` (D-085…D-088), `KNOWN_ISSUES` (PHASE 14: KI-122…KI-131), `ROADMAP`, `PROJECT_STATE`, `ARCHITECTURE` (5.1 PHASE 14 kiegészítés).

## 4. Parancsok és tényleges eredmények (2026-11-24, a projekt gyökerében)

| Parancs | Eredmény |
|---|---|
| `git status` / `git log` (kiinduláskor) | `main` tiszta, a PHASE 13 merge-ölve (PR #8, `9385f7e`) → `git switch -c phase-14` |
| `npx jest` (bekötés után, új tesztek előtt) | 1540/1541 – a migrációs teszt az új 2. migráció miatt (javítva: a teszt az 1. migrációra rögzítve) |
| Expo docs ellenőrzés (web) | SDK 58 notifications + background-task, push „what you need to know” + setup, SDK 57 notifications – idézetek: D-088 |
| `CI=1 npx expo start --port 8093` (typed routes) | az első, `timeout`-tal megszakított futás `/` nélküli fájlt hagyott (KI-121 ismét) → törlés + teljes lefutás → rendben |
| `npm run check` (a fázis végén) | **exit 0**: typecheck ✅, lint (`--max-warnings 0`) ✅, Prettier ✅, **1628/1628 teszt, 95 suite** ✅ (+87; ebből a tisztasági őrtesztek +10 automatikusan az új fájlokra) |
| Alap összevetése (`main` ideiglenes worktree-ben, `npx jest --json`) | `main`: 1541 teszt / 88 suite – a +87 suite-onként ellenőrizve |
| `npx jest --coverage` (új modulok) | 95,0% utasítás / 83,8% ág / 98,1% függvény / 97,6% sor |
| `npx expo export -p android` (scratch mappába) | exit 0, Hermes bundle 4,7 MB; tartalmazza az `alert_rules` migrációt |
| Értékvak titokszkenner (`.env.local` értékei a bundle-ben) | 3 ellenőrzött érték, **0** találat; az export-mappa törölve |

## 5. Ismert hibák / korlátok
Részletek: [../KNOWN_ISSUES.md](../KNOWN_ISSUES.md), „PHASE 14” szakasz.
- **KI-129 (K):** eszközön nem futott (az új képernyők).
- **KI-123 (K):** az ETF-átfedés a valós appban ma „Nincs holdings-adat” (free forrás + nincs holdings-bevitel a UI-ban).
- **KI-122 (K):** nincs push / rendszerértesítés / háttér-ellenőrzés (dokumentált, szándékos).
- **KI-124, KI-125 (K):** kvótaterhelés (napi változás +1 hívás/elem; tömeges elemzés sorban, haladásjelző és megszakítás nélkül).
- KI-126 (részvényosztályok), KI-127 (nincs FX a compare/screenerben), KI-128 (csak lokális univerzum), KI-130 (SDK 57 vs 58 – ellenőrizve), KI-131 (hosszú screener-űrlap).
- **Átütemezve a PHASE 14-ből:** proxy-cache (KI-114), holdings-import (KI-74), ETF-metaadat űrlap (KI-101), több portfólió (KI-105), KI-106, KI-91, KI-102, KI-98, KI-108.

## 6. Nyitott kérdések (a tulajdonos dönt)
- **Commit:** tulajdonosi kérésre commitolva a `phase-14` branchen (`27a1144`); a push, a PR és a merge a tulajdonos döntése. Commit-üzenet:
  `feat: PHASE 14 – összehasonlítás, figyelőlista, screener és riasztások (közös pillanatkép a meglévő értékelésekből, csak összehasonlítható mutatók, ETF-átfedés kompatibilis holdings-dátumokra, szabályalapú screener bizonyítékkal, alkalmazáson belüli riasztás SQLite-ban, push nélkül)`
- **Értesítés:** kell-e helyi értesítés (Expo Go-ban működik) vagy valódi push (development build + backend)? (D-088 bővítési út.)
- **Holdings-adat:** fájlimport (D-071) vagy kézi űrlap legyen az első? Ez nyitja meg az ETF-átfedést a valós appban.
- **Proxy-cache** (KI-114) a PHASE 15-ben? A PHASE 14 funkciói (score-betöltés, screener) a kvótát jobban terhelik.
- A korábbi nyitott pontok (LLM bekapcsolása, EAS-próba, FMP ToS, DP-05, vonaldiagram) változatlanok.

## 7. Indulási útmutató a PHASE 15-höz
1. **Olvasnivaló:** `docs/PROJECT_STATE.md`, ez a handoff, ROADMAP PHASE 14 „kapcsolódási pontok” és PHASE 15, D-085…D-088, KNOWN_ISSUES PHASE 13–14.
2. **Ellenőrzés:** `git status`, `git branch --show-current`, majd `npm run check`. Elvárt: exit 0, **1628 teszt**. Typed routes hibánál: útmutató 14. fejezet.
3. **Kapcsolódási pontok:**
   - Eszközös QA: a PHASE 13 (15. fejezet) és PHASE 14 (13. fejezet) kézi listája.
   - Riasztás: `services.alerts.checkNow()` egy esetleges háttérfeladatból is hívható; a korlátlistát (`ALERT_PLATFORM_LIMITATIONS`) együtt kell frissíteni a képességgel.
   - Kvóta: `loadInstrumentSnapshots` sorban dolgozik – haladásjelzőhöz/megszakításhoz ide kell callback.
   - Új tárolt adat: új migráció a `MIGRATIONS` végére (`version: 3`), meglévőt soha ne módosíts.
4. **Tilos (marad):** titok a kliensben; régi adat jelölés nélkül; hiány 0-ként; automatikus LLM-hívás; nem dokumentált értesítési képesség; FX-feltevés rejtetten a compare/screenerben.
