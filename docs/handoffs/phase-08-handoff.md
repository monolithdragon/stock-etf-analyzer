# Handoff – PHASE 08 → PHASE 09

> Dátum: 2026-11-22 · Elkészült: **PHASE 08 – ETF-elemzés** · Következik: **PHASE 09 – Portfólió és kockázat**
> Kezdőbarát útmutató: [../phases/phase-08-etf-analysis.md](../phases/phase-08-etf-analysis.md) · Előző handoff: [phase-07-handoff.md](phase-07-handoff.md)

## 1. Készültség
**PHASE 08: KÉSZ.** A 08-as prompt elfogadási feltételei:

| Feltétel | Állapot | Bizonyíték |
|---|---|---|
| ETF- és részvény-elemzési logika külön van választva | ✅ | `src/application/etf-analysis/` + `analyzeEtf`; őrteszt `src/__tests__/etf-stock-separation.test.ts` (kétirányú importtilalom + DCF/P/E-szimbólumok); részvénynek jelölt jegyzésre `VALIDATION`; P/E, Forward P/E, DCF, minőség `notApplicable` indokkal |
| Adatlefedettségi korlátok láthatók | ✅ | `EtfAnalysis.coverage`: mezőnként státusz + eredet + ok, `available/total`, `limitations` (free: nincs metaadat, nincs holdings, nincs index, nincs volumen, 1 éves történet); metaadat nélkül `UNAVAILABLE / PLAN_LIMIT` |
| Tracking és total return definíciója dokumentált | ✅ | DATA_DICTIONARY 15.6, 15.8; D-069/4–5; a kimenetben `formula`, `tracking.definitions`, `returns.totalReturnMethod`, `comparisonBasis` |
| Kockázati számítás csak megfelelő inputtal | ✅ | min. 126 napi hozam (D-066/6), különben `INSUFFICIENT_DATA` okkal; Sharpe/Sortino rf nélkül `MISSING`; béta/tracking csak indexsorral, azonos fő pénznemben, közös dátumokon |

Feladatlista (1–10): mind kész. Kötelező tesztesetek (részleges holdings, hiányzó TER, eltérő időszak, dist/acc, hedged/unhedged): `src/application/etf-analysis/etf-analysis.test.ts`.

## 2. Mi készült
- **Domain (`src/domain/etf/`):** `EtfClassification` (6 dimenzió, futásidejű értéklistákkal), `EtfHoldingsSnapshot` + `createEtfHoldingsSnapshot` (validált; részleges/teljes), `EtfProfile` (jegyzés-szintű, minden forrásfüggő mező `Metric`). `instrument.ts`: `ETF_REPLICATIONS`, `ETF_DISTRIBUTIONS`.
- **Motor:** `src/calculations/returns/risk.ts` (`periodicReturns`, `alignByDate`, `annualizedVolatility`, `downsideDeviation`, `sharpeRatio`, `sortinoRatio`, `beta`, `TRADING_DAYS_PER_YEAR`); `src/calculations/etf/holdings.ts` (`topNWeight`, `holdingsConcentration`, `exposureBreakdown`); `src/calculations/etf/exposure.ts` (`deriveRegion`, `regionOfCountry`, `currencyRisk`).
- **Alkalmazás (`src/application/etf-analysis/`):** `types`, `etf-metric`, `etf-profile-builder` (validált kézi metaadat, forrás-elsőbbség, UCITS/hedge-szabályok, frissesség), `etf-returns`, `etf-risk` (kockázat + tracking), `etf-costs`, `etf-holdings-analysis` (holdings + deviza), `etf-features` (súlyozás nélkül), `etf-analysis` (`buildEtfAnalysis`, tiszta), `testing.ts` (csak teszt).
- **Közös:** `src/application/shared/app-error-metric.ts` (a `stock-analysis/metric-helpers.ts`-ből kiemelve, ott továbbexportálva).
- **Use case:** `analyzeEtf` → `AppServices` (container bekötve; a `convertMoney` közös példány).
- **SEC N-PORT:** élő próbával vizsgálva és dokumentálva (DATA_SOURCES 13.2); adapter NEM készült (D-069/9, KI-66).

## 3. Módosított / új fájlok
- **Új kód (21):** `src/domain/etf/{etf-classification,etf-holdings,etf-profile}.ts` (+ `etf-holdings.test.ts`); `src/calculations/returns/risk.ts` (+ teszt); `src/calculations/etf/{holdings,exposure}.ts` (+ 2 teszt); `src/application/shared/app-error-metric.ts`; `src/application/etf-analysis/{types,etf-metric,etf-profile-builder,etf-returns,etf-risk,etf-costs,etf-holdings-analysis,etf-features,etf-analysis,testing}.ts` (+ `etf-analysis.test.ts`); `src/application/use-cases/analyze-etf.ts`; `src/__tests__/{etf-analysis-integration,etf-stock-separation}.test.ts`.
- **Módosított kód:** `src/domain/{index,instrument/instrument}.ts`, `src/calculations/index.ts`, `src/application/{index,stock-analysis/metric-helpers}.ts`, `src/config/container.ts`, `src/presentation/di/app-services-context.test.tsx`.
- **Docs:** új `docs/phases/phase-08-etf-analysis.md`, `docs/handoffs/phase-08-handoff.md`; módosítva `DECISIONS` (D-066…D-069), `DATA_DICTIONARY` (fejléc, 5.5, 6., új 15.), `DATA_SOURCES` (fejléc, táblák, új 13.), `KNOWN_ISSUES` (KI-65…KI-73, U-08 lezárva, KI-45/46 frissítve), `ROADMAP`, `ARCHITECTURE`, `PROJECT_STATE`.
- Új csomag **nem** került be.

## 4. Parancsok és tényleges eredmények (2026-11-22, a projekt gyökerében)

| Parancs | Eredmény |
|---|---|
| `git status` (kiinduláskor) | `main`, clean; a PHASE 07 már merge-ölve (`aee88fc`, merge `3fc0258`) |
| `git switch -c phase-08` | új munkaág |
| `npm run check` (kiinduláskor) | exit 0, 783/783 teszt, 52 suite |
| SEC próba (scratchpad-szkript, `.env.local` User-Agent, 3 kérés) | `submissions` (iShares Trust, SPDR S&P 500 ETF Trust) 200; `NPORT-P` `primary_doc.xml` 200; `company_tickers_mf.json` 200 – részletek: DATA_SOURCES 13.2. EODHD/FMP élő hívás **nem** volt. |
| `npm run check` (a fázis végén) | **exit 0**: typecheck ✅, lint (`--max-warnings 0`) ✅, Prettier ✅, **923/923 teszt, 59 suite** ✅ |
| `npm run check` (D-070 után, ugyanaznap) | **exit 0**: typecheck ✅, lint ✅, Prettier ✅, **927/927 teszt, 59 suite** ✅ |
| lefedettség (új modulok) | összesen 99,0% sor / 92,2% ág; `risk.ts`, `holdings.ts`, `exposure.ts`, `costs-tracking.ts` 100%; `etf-analysis/*` 97,9–100% sor; `analyze-etf.ts` 100% sor |

**Fejlesztés közbeni leletek:** (1) lebegőpontos küszöbhiba: 8 × 0,1 = 0,7999… < 0,8 → a régió-küszöb 1e-9 tűréssel (teszt rögzíti); (2) az FMP-profil normalizáló ellenőrzi a tőzsdét, ezért a „részvény” elutasítás tesztje `AAPL@XNAS`-szal normalizál; (3) a rétegszabály tiltja szerverkód importját `application` alatti tesztből → az integrációs teszt a `src/__tests__/`-ben van; (4) a SPY (UIT) is ad N-PORT-ot, de nincs a `company_tickers_mf.json`-ban.

## 5. Ismert hibák / korlátok
Részletek: [../KNOWN_ISSUES.md](../KNOWN_ISSUES.md) „PHASE 08” szakasz.
- **KI-65 (M):** nincs ETF-metaadat forrás a free csomagban → csak kézi bevitel.
- **KI-66 (K):** N-PORT adapter nincs (igazolt forrás, US-only, szektor nélkül).
- **KI-67 (K):** nincs volumen a `PricePoint`-ban → likviditás-feature csak kézi.
- **KI-68 (K):** 4–5 hívás / ETF-elemzés (free EODHD: ~4 elemzés/nap) → cache: PHASE 13.
- **KI-69 (K):** nincs indexforrás → tracking/béta csak hívó által adott sorral.
- **KI-70 (K):** free EODHD 1 év → a kockázat legfeljebb ~1 éves ablakon (nem US).
- KI-71…KI-73 (A): disztribúciós TR újrabefektetés nélkül (tartalék-út), régió-heurisztika és teljes fedezés feltevése, kategória-validáció csak enum.

## 6. Nyitott kérdések
- **Commit:** a PHASE 08 commitolva a `phase-08` branchen (`10bf075`, 2026-11-22); merge a `main`-be PR-rel. Commit-üzenet:
  `feat: PHASE 08 – ETF-elemzés (EtfProfile, holdings, kockázat, tracking, acc/dist total return, deviza, feature-modell)`
- **Ellentmondás (javítva):** a PHASE 07 handoff és a PROJECT_STATE „commit nélkül” állapotot írt, de a PHASE 07 már a `main`-en volt (`aee88fc`, merge `3fc0258`). A PROJECT_STATE frissítve.
- **Eldöntve (2026-11-22, tulajdonosi jóváhagyás):**
  - **D-070** – a kockázati minimum marad 126; új `reliability` címke (`standard` ≥ 240, `short_window` 126–239) minden kiszámolt kockázati/követési mutatón. **Megvalósítva** (`riskReliability` a `risk.ts`-ben, `EtfMetric.reliability`, +4 teszt).
  - **D-071** – SEC N-PORT adapter nem készül (US-only; EU-s lakossági befektető jellemzően nem vehet US ETF-et). Helyette kibocsátói holdings-fájl import a PHASE 13-ban (KI-74).
- A régebbi nyitott pontok (EAS próbatelepítés, FMP keret/ToS, DP-05) változatlanok, a PHASE 09-et nem blokkolják.

## 7. Indulási útmutató a PHASE 09-hez
1. Olvasd el: `docs/PROJECT_STATE.md`, ezt a handoffot, a ROADMAP PHASE 09 szakaszát, a DATA_DICTIONARY **5.5, 7. és 15.7** fejezetét, a D-012, D-058, D-066 döntéseket, valamint a KI-50 (FX a szorzókhoz → 09) pontot.
2. Ellenőrzés: `git status`, majd `npm run check` – elvárt: exit 0, **927 teszt** (ha a PHASE 08 már merge-ölve van a `main`-be).
3. Újrahasznosítható: `risk.ts` (`periodicReturns`, `annualizedVolatility`, `downsideDeviation`, `beta`, `alignByDate`) és `drawdown.ts` a portfólió-idősorhoz; `portfolio-basics.ts` (súlyok, súlyozott hozam); `convertMoney` a többdevizás értékeléshez; `exposureBreakdown` az allokáció-bontáshoz (típus, pénznem, ország, szektor).
4. ETF look-through (portfólió ország-/szektorsúly ETF-eken át) csak `EtfHoldingsSnapshot`-tal működik – forrás nélkül jelöld a hiányt, ne becsüld.
5. A portfólió-kockázati mutatókra is alkalmazd a `riskReliability`-t (D-070), ne vezess be külön küszöböt.
6. Ne írd át a PHASE 08 definícióit dokumentált indok és DECISIONS-bejegyzés nélkül. Belépési pont: `AppServices.analyzeEtf(listingId, options)`; a PHASE 10 a `features`-t kapja (súlyozás ott készül, a hiányzó feature nem 0).
