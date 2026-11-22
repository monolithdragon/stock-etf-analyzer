# Handoff – PHASE 09 → PHASE 10

> Dátum: 2026-11-22 · Elkészült: **PHASE 09 – Portfólió és kockázat** · Következik: **PHASE 10 – Score és döntési engine**
> Kezdőbarát útmutató: [../phases/phase-09-portfolio-risk.md](../phases/phase-09-portfolio-risk.md) · Előző handoff: [phase-08-handoff.md](phase-08-handoff.md)

## 1. Készültség
**PHASE 09: KÉSZ.** A 09-es prompt elfogadási feltételei:

| Feltétel | Állapot | Bizonyíték |
|---|---|---|
| Minden összesítés visszavezethető a pozíciókra/tranzakciókra | ✅ | `PortfolioTotal.components` + `missing` + `availableSum`; `PositionAnalysis.ledger` (tranzakciónként mennyiség, bekerülés, átlagár, realizált delta, használt FX-ráta); teszt: „minden összesítés = a pozíciók összege” (`src/application/portfolio/portfolio-analysis.test.ts`) |
| A hiányzó árfolyam/FX adat egyértelmű állapot | ✅ | hiányzó ár → `UNAVAILABLE`/`MISSING` okkal, súly `MISSING` (nem 0), az összeg `MISSING` + részösszeg; hiányzó mai FX → a natív nézet OK, a bázis `MISSING`; hiányzó ügyleti napi FX → a bázis könyvelés `MISSING` (soha nem a mai rátával); többdevizás historikus FX-idősor nélkül → `MISSING` (KI-77) |
| Az ETF mögöttes kitettség és a közvetlen pozíció külön kezelhető | ✅ | `PortfolioExposure.method`: `direct` vs. `look_through` (+ `methodNote`); egyedi részvénykitettség `directWeight` / `viaEtfWeight` bontásban |
| A tesztek lefedik a vegyes devizát, súlyszámítást és hiányzó adatokat | ✅ | EUR bázis + USD részvény + EUR ETF + GBX ETF (rögzített bróker-rátával), kézzel ellenőrzött számokkal; súlyok Σ = 1; hiányzó ár, mai FX, ügyleti napi FX, pénznem-ellentmondás |

Feladatlista (1–10): mind kész; a 8. (ETF-átfedés) adatmodell + alapképlet szinten, a 10. szerint új tároló nem készült.

## 2. Mi készült
- **Domain (`src/domain/portfolio/`):** `validateTransactionLedger` + `orderTransactions` (`ledger-validation.ts`; 10 hibakód, 2 blokkoló); `PortfolioAssetMetadata` + `createPortfolioAssetMetadata` (`portfolio-asset.ts`). A régi, használatlan `Position` interfész törölve (a pozíció számított kimenet: `PositionAnalysis`).
- **Motor:** `averageCostLedger` (`calculations/portfolio/average-cost.ts`), `timeWeightedReturn` (`calculations/portfolio/time-weighted-return.ts`), `holdingsOverlap` (`calculations/etf/overlap.ts`). A kockázat a meglévő `risk.ts`, `drawdown.ts`, `holdings.ts`, `portfolio-basics.ts` függvényeivel – nincs másolat.
- **Alkalmazás (`src/application/portfolio/`):** `types`, `fx-lookup` (ráta-elsőbbség), `portfolio-positions` (két P/L-nézet, FX-felbontás), `portfolio-totals` (súly, összesítés), `portfolio-exposure` (kitettség, koncentráció, átfedés), `portfolio-history` (TWR + kockázat + korreláció), `portfolio-metric`, `portfolio-analysis` (`buildPortfolioAnalysis`, tiszta), `testing.ts` (csak teszt).
- **Közös:** `src/application/shared/engine-provenance.ts` (az `etf-analysis/etf-metric.ts`-ből kiemelve, ott továbbexportálva).
- **Use case:** `analyzePortfolio` → `AppServices` (container bekötve). A `recordTransaction` a meglévő naplóval együtt validál és elutasítja az új hibát (túladás, ellentmondó deviza, rossz FX-irány).

## 3. Módosított / új fájlok
- **Új kód (20):** `src/domain/portfolio/{ledger-validation,portfolio-asset}.ts` (+ `ledger-validation.test.ts`); `src/calculations/portfolio/{average-cost,time-weighted-return}.ts` (+ 2 teszt); `src/calculations/etf/overlap.ts` (+ teszt); `src/application/shared/engine-provenance.ts`; `src/application/portfolio/{types,fx-lookup,portfolio-positions,portfolio-totals,portfolio-exposure,portfolio-history,portfolio-metric,portfolio-analysis,testing}.ts` (+ `portfolio-analysis.test.ts`, `portfolio-history.test.ts`); `src/application/use-cases/analyze-portfolio.ts` (+ teszt). Kb. 5 450 sor, ebből ~1 800 teszt.
- **Módosított kód:** `src/domain/{index,portfolio/portfolio}.ts`, `src/calculations/index.ts`, `src/application/{index,etf-analysis/etf-metric,use-cases/record-transaction,use-cases/use-cases.test}.ts`, `src/config/{container,container.test}.ts`, `src/presentation/di/app-services-context.test.tsx`.
- **Docs:** új `docs/phases/phase-09-portfolio-risk.md`, `docs/handoffs/phase-09-handoff.md`; módosítva `DECISIONS` (D-072; D-012 → Elfogadva), `DATA_DICTIONARY` (fejléc, 5.5 új sorok, **7. fejezet újraírva: 7.1–7.6**, 10. leképezés), `KNOWN_ISSUES` (KI-76…KI-82, KI-50 és KI-75 frissítve, blokkolók), `ROADMAP`, `ARCHITECTURE` (5.1), `PROJECT_STATE`.
- Új csomag **nem** került be.

## 4. Parancsok és tényleges eredmények (2026-11-22, a projekt gyökerében)

| Parancs | Eredmény |
|---|---|
| `git status` (kiinduláskor) | `main`, clean; a PHASE 08 már merge-ölve (PR #4, `e6f0d02`) |
| `npm test` (kiinduláskor) | 927/927, 59 suite |
| `git switch -c phase-09` | új munkaág |
| `npm run check` (a fázis végén) | **exit 0**: typecheck ✅, lint (`--max-warnings 0`) ✅, Prettier ✅, **1011/1011 teszt, 66 suite** ✅ |
| lefedettség (új/módosított portfólió-modulok) | összesen 97,3% sor / 88,3% ág; `average-cost`, `time-weighted-return`, `overlap`, `portfolio-metric`, `portfolio-asset`, `engine-provenance` 100%; `analyze-portfolio.ts` 93,7% sor |

Élő API-hívás **nem** volt (a fázis tisztán számítási; a tesztek determinisztikus bemenetekkel és hamis gateway-ekkel futnak, egy végponttól végpontig teszt a mock adatmóddal a valódi composition rooton át).

**Fejlesztés közbeni leletek:** (1) a tesztek kétszer is „hibát” jeleztek, ami valójában helyes működés volt: USD-s árfolyam EUR-ban rögzített ügyletekhez → `CURRENCY_CONFLICT`; EUR-ártörténet GBX-ügyletekhez → `INVALID_INPUT` – a validáció tényleg nem vált csendben. (2) Egyetlen jegyzés ártörténet-hézaga nem szakítja meg az ablakot (a naptár az ársorokból jön, így egy hosszabb periódushozam lesz); több jegyzésnél a > 7 napos hézag igen. (3) Az application-teszt nem importálhat infrastruktúra-adaptert (rétegszabály) → saját hamis tároló a tesztben.

## 5. Ismert hibák / korlátok
Részletek: [../KNOWN_ISSUES.md](../KNOWN_ISSUES.md) „PHASE 09” szakasz.
- **KI-76 (K):** hívásköltség (ár + profil + kérésre ártörténet jegyzésenként) → cache: PHASE 13.
- **KI-77 (K):** nincs napi FX-idősor végpont → többdevizás historikus elemzés csak hívó által adott `history.fxSeries`-szel.
- **KI-78 (K):** nincs készpénzszámla, IRR, forrásadó; a FEE nem része a TWR-nek.
- **KI-79 (K):** csak átlagár; FIFO / magyar adószabály nincs (a kimenet figyelmeztet).
- **KI-80 (K):** look-through csak kézi holdings-szal; párosítás csak ISIN szerint.
- KI-81, KI-82 (A): azonos napi sorrend = rögzítési sorrend; unió-naptár √252-vel (enyhe vol-felülbecslés), a korreláció a teljes sorból.
- **KI-50 (frissítve):** a részvény-szorzók FX-e továbbra is nyitott (nem portfólió-feladat) – PHASE 10 előtt vagy a PHASE 12-vel.

## 6. Nyitott kérdések
- **Commit:** a munka a `phase-09` branchen van, **commit nélkül** (a CLAUDE.md szerint commit csak kérésre). Javasolt üzenet:
  `feat: PHASE 09 – portfólió és kockázat (átlagáras könyvelés, két P/L-nézet FX-hatással, kitettség direct/look-through, koncentráció, TWR-historikus, napló-validáció, ETF-átfedés modell)`
- **FX-idősor (KI-77):** a PHASE 13-ban (proxy + cache) vagy egy rövid közbülső lépésben készüljön? Ma a többdevizás historikus elemzés csak kézi FX-idősorral fut.
- A régebbi nyitott pontok (EAS próbatelepítés, FMP keret/ToS, DP-05) változatlanok, a PHASE 10-et nem blokkolják.

## 7. Indulási útmutató a PHASE 10-hez
1. Olvasd el: `docs/PROJECT_STATE.md`, ezt a handoffot, a ROADMAP PHASE 10 szakaszát, a DATA_DICTIONARY **7.** és **15.9** fejezetét, a D-066, D-070, D-072 döntéseket.
2. Ellenőrzés: `git status`, majd `npm run check` – elvárt: exit 0, **1011 teszt** (ha a PHASE 09 már merge-ölve van).
3. Bemenetek a score-hoz: részvény (`analyzeStockFundamentals`, `analyzeStockValuation`), ETF (`EtfAnalysis.features` + `groupCoverage`), portfólió (`PortfolioAnalysis.concentration`, `.exposures`, `.history` – minden kockázati mutatón `reliability`).
4. Hiányzó adat: a `Metric` nem-OK státusza, az `uncoveredWeight` és a `missing` lista **adathiány**, nem 0 – a score-ban dokumentált stratégiával kezeld (pl. kimarad + bizonyosság-csökkentés), ne nullázd.
5. A portfólió-szintű jelzések (pl. túlkoncentráció) küszöbei konfigurációba kerüljenek (mint a D-065 értékelési küszöbei), ne a PHASE 09 kódjába.
6. Ne írd át a D-072 definícióit dokumentált indok és DECISIONS-bejegyzés nélkül. Belépési pont: `AppServices.analyzePortfolio(portfolioId, options)`.
