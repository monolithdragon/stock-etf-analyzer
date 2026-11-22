# Handoff – PHASE 07 → PHASE 08

> Dátum: 2026-11-22 · Elkészült: **PHASE 07 – Értékelés és DCF** · Következik: **PHASE 08 – ETF-elemzés**
> Kezdőbarát útmutató: [../phases/phase-07-valuation-dcf.md](../phases/phase-07-valuation-dcf.md) · Előző handoff: [phase-06-handoff.md](phase-06-handoff.md)

## 1. Készültség
**PHASE 07: KÉSZ.** A 07-es prompt elfogadási feltételei:

| Feltétel | Állapot | Bizonyíték |
|---|---|---|
| A DCF képletek teszteltek és magyarázhatók | ✅ | `dcf.test.ts`: kézzel számolt golden eset (IV = 154,5), örökjáradék-azonosság, minden boundary/invalid ág; integrációs teszt: AAPL Base IV = zárt alakú kézi képlet; `explanation.formulas` + `conventions` a kimenetben |
| A szenzitivitási tábla minden cellája ugyanazt az engine-t használja | ✅ | `dcfSensitivityTable` cellánként `runDcf`; teszt cellánként összeveti a közvetlen hívással; a középső cella = Base IV |
| Nincs hamis pontosság; a feltevések láthatók | ✅ | minden forgatókönyv mellett `assumptions` (`source: default/user`); `display` (IV 3 értékes jegy, MOS egész %); a motor nem kerekít; TV-arány/g/r−g megjegyzések; `DCF_DISCLAIMER` |
| Nincs DCF-számítás a UI komponensben | ✅ | UI nincs; őrteszt (`calculations-purity.test.ts`): `src/app` és `src/presentation` nem hív DCF-függvényt; a UI-nak szánt belépő: `recalculateStockValuation` |

Feladatlista (1–10): mind kész. Forward P/E: a motor kész, forrás nincs → ma mindig `MISSING` indokkal (D-065/2).

## 2. Mi készült
- **Motor (`src/calculations/valuation/`):** `dcf.ts` – `runDcf` (évenkénti FCF/PV, Gordon TV, PV_TV, EV, equity, IV/részvény, MOS; teljes bemenet-validálás; megjegyzés-küszöbök), `constantGrowthRates`, `describeRate`, `terminalGrowthNotBelowDiscountRate`; `dcf-scenarios.ts` – `runDcfScenarios`, `dcfSensitivityTable`, `sensitivityAxis`; `valuation-bands.ts` – `classifyMarginOfSafety`, `classifyMultipleBand`, `DEFAULT_MOS_THRESHOLDS`, `DEFAULT_MULTIPLE_BANDS`, `VALUATION_THRESHOLD_DISCLAIMER`. `dcf-conventions.ts`: a `checkDiscountRate` exportálva.
- **Alkalmazás (`src/application/valuation/`):** `types.ts` (kimenet), `defaults.ts` (kiinduló Bear/Base/Bull, szenzitivitási lépések, `roundToSignificant`, `DCF_DISCLAIMER`), `dcf-inputs.ts` (`buildDcfInputModel`: forrás, időszak, eredet, pénznem-őr, felülírás), `stock-valuation.ts` (`buildStockValuation`: forgatókönyvek, kategóriák, tábla, szorzó-sávok, magyarázat, figyelmeztetések).
- **Use case-ek:** `analyzeStockValuation`, `recalculateStockValuation` → `AppServices` (container bekötve).
- **Forward P/E:** új `FinancialMetricId` (`forwardPe`) + definíció; `computeValuation` opcionális `forwardEps` bemenete.
- **Tesztsegéd:** `src/testing/stock-analysis-fixtures.ts` (a PHASE 06 integrációs teszt beállítása kiemelve, mindkét integrációs teszt használja).

## 3. Módosított / új fájlok
- **Új (15):** `src/calculations/valuation/{dcf,dcf-scenarios,valuation-bands}.ts` (+ 3 teszt), `src/application/valuation/{types,defaults,dcf-inputs,stock-valuation}.ts`, `src/application/use-cases/analyze-stock-valuation.ts`, `src/testing/stock-analysis-fixtures.ts`, `src/__tests__/stock-valuation-integration.test.ts`; `docs/phases/phase-07-valuation-dcf.md`, `docs/handoffs/phase-07-handoff.md`.
- **Módosított:** `src/calculations/{index,definitions}.ts`, `src/calculations/valuation/dcf-conventions.ts`, `src/domain/fundamentals/financial-metric.ts`, `src/application/index.ts`, `src/application/stock-analysis/valuation.ts` (+ teszt), `src/config/container.ts`, `src/presentation/di/app-services-context.test.tsx`, `src/__tests__/{calculations-purity,stock-fundamentals-integration}.test.ts`; docs: `DECISIONS` (D-064, D-065; D-022 → Elfogadva), `DATA_DICTIONARY` (5.3, 5.4 végleges, 13.6, új 14.), `KNOWN_ISSUES` (KI-58…KI-64; KI-44/50/52 frissítve), `ROADMAP`, `PROJECT_STATE`, `ARCHITECTURE`.
- Új csomag **nem** került be. Szolgáltatói API-t a fázis nem hívott (minden teszt fixture-ön fut).

## 4. Parancsok és tényleges eredmények (2026-11-22, a projekt gyökerében)

| Parancs | Eredmény |
|---|---|
| `git status` (kiinduláskor) | `main`, clean; a PHASE 06 már merge-ölve (`de201be`) |
| `git switch -c phase-07` | új munkaág |
| `npm run check` (kiinduláskor) | exit 0, 661/661 teszt, 48 suite |
| `npm run check` (a fázis végén) | **exit 0**: typecheck ✅, lint (`--max-warnings 0`) ✅, Prettier ✅, **783/783 teszt, 52 suite** ✅ |
| lefedettség (új modulok) | `src/calculations/valuation/*` 100% sor (98,8% utasítás, 95,9% ág); `src/application/valuation/*` ~97% sor; `analyze-stock-valuation.ts` 100% |

**Fejlesztés közbeni leletek:** (1) BRK-B-nél nemcsak az adósság, hanem a pénzeszköz és a részvényszám is hiányzik a SEC-fixture-ben – a DCF mindig a következő hiányzó bemenetet nevezi meg, mindhárom felülírásával lefut (teszt rögzíti); (2) az AAPL-en az általános kiinduló feltevésekkel mindhárom forgatókönyv a piaci ár alatt van (Base IV ≈ 161 USD vs. 342,56 USD ár) – ez a feltevések általánosságát mutatja, nem értékítélet (KI-58); (3) folyamat: Windows alatt a Python-alapú szerkesztés CRLF-et írt → Prettierrel javítva (a lint jelezte).

## 5. Ismert hibák / korlátok
Részletek: [../KNOWN_ISSUES.md](../KNOWN_ISSUES.md) „PHASE 07” szakasz.
- **KI-58 (K):** a kiinduló feltevések általánosak, nem a cégre kalibráltak (jelölve, felülírhatók).
- **KI-59 (K):** diszkontráta = felhasználói feltevés; nincs WACC/CAPM.
- **KI-60 (K):** a kiinduló FCF egyetlen, nem normalizált FY.
- KI-61: nem hígított részvényszám. KI-62: Forward P/E mindig `MISSING`. KI-63: a MOS gyakran `stale` árral. KI-64: a szélsőesetek egy része módosított valós elemzésen szimulált.
- Döntéssel lezárva/áttéve: KI-50 (FX → PHASE 09), KI-52 (TTM-szorzó elvetve), KI-44 (EV-egyszerűsítés marad).

## 6. Nyitott kérdések
- **Commit:** a PHASE 07 változásai a `phase-07` branchen vannak, **commit nélkül** (a tulajdonos dönt). Javasolt üzenet:
  `feat: PHASE 07 – értékelés és DCF (runDcf, Bear/Base/Bull, szenzitivitás, küszöbök, Forward P/E, magyarázható kimenet)`
- **Ellentmondás (javítva):** a PHASE 06 handoff és a PROJECT_STATE „commitra vár” állapotot írt, de a PHASE 06 már a `main`-en volt (`70569f1`, merge `de201be`). A PROJECT_STATE frissítve.
- **Tulajdonosi döntés (nem blokkoló):** kell-e a kiinduló feltevéseket a cég történeti adataihoz kötni (pl. Base növekedés = FCF 5 éves CAGR, korlátok közé szorítva)? Ma szándékosan nem (rejtett feltevés lenne); a kontextus látszik. A PHASE 12 UI-tervezésénél érdemes eldönteni.
- A régebbi nyitott pontok (EAS próbatelepítés, FMP keret/ToS, DP-05) változatlanok, a PHASE 08-at nem blokkolják.

## 7. Indulási útmutató a PHASE 08-hoz
1. Olvasd el: `docs/PROJECT_STATE.md`, ezt a handoffot, a ROADMAP PHASE 08 szakaszát, a DATA_DICTIONARY **5.5 és 6.** fejezetét, a D-050, D-051, D-058 döntéseket, valamint a KI-45/46 és a 04B ETF-lefedettségi korlátokat (free csomagban nincs ETF-metaadat/holdings → `UNAVAILABLE / PLAN_LIMIT`).
2. Ellenőrzés: `git status`, majd `npm run check` – elvárt: exit 0, **783 teszt**.
3. A PHASE 07 modulja részvény-specifikus; az ETF-elemzés **ne** használja a DCF-et. Újrahasznosítható: `src/testing/stock-analysis-fixtures.ts` mintája (valós fixture → hamis gateway → valódi use case-ek) egy ETF-fixture-beállításhoz; a `valuation-bands.ts` mintája (küszöb + nyilatkozat a kimenetben) az ETF feature-modellhez.
4. Ne írd át a PHASE 07 definícióit dokumentált indok és DECISIONS-bejegyzés nélkül. Az értékelés belépési pontjai a későbbi fázisoknak: `AppServices.analyzeStockValuation`, `AppServices.recalculateStockValuation`; a score (PHASE 10) a `dcf.scenarios[].category`-t és a `multiples.bands`-t küszöbbel együtt kapja.
