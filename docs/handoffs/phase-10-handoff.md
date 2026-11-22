# Handoff – PHASE 10 → PHASE 11

> Dátum: 2026-11-22 · Elkészült: **PHASE 10 – Score és döntési engine** (M3 „Elemzőmotor kész”) · Következik: **PHASE 11 – AI-magyarázó engine**
> Kezdőbarát útmutató: [../phases/phase-10-scoring-decision-engine.md](../phases/phase-10-scoring-decision-engine.md) · Előző handoff: [phase-09-handoff.md](phase-09-handoff.md)

## 1. Készültség
**PHASE 10: KÉSZ.** A 10-es prompt elfogadási feltételei:

| Feltétel | Állapot | Bizonyíték |
|---|---|---|
| A pontszám részletei és az indoklás visszakövethető | ✅ | `CategoryScore` (mutatónként érték, pont, szabály, eredet, frissesség, `rationale`, `missing`), `DecisionResult.ruleTrace` / `appliedCaps` / `drivers`, konfiguráció-azonosító és -verzió; teszt: a kategória- és összpontszám a kiírt számokból visszaszámolható (`score-engine.test.ts`), az indoklássor szó szerint ellenőrzött (`etf-evaluation.test.ts`) |
| A hiányzó adat nem okoz észrevétlen pontozást | ✅ | D-074: kimarad + újranormalizálás minimális lefedettséggel + confidence-csökkentés; soha nem 0; valós fixture-ök: MSFT `PARTIAL`, NVDA Menedzsment `INSUFFICIENT_DATA` (N/M), JPM `NOT_RATED`, AAPL piaci adat nélkül Hold / MEDIUM |
| Az AI nem hoz saját, ellenőrizetlen döntést | ✅ | `aiInvolvement: 'none'`; a `src/scoring` nem hivatkozik AI-ra; a UI nem hív pontozó függvényt (`scoring-purity.test.ts`) |
| A score és a decision tesztelhető, determinisztikus és konfigurálható | ✅ | nincs óra/véletlen/mutáció; tesztek: 100 ismétlés, fagyasztott bemenet, fordított sorrend, JSON oda-vissza, duplikált azonosító → hiba; konfigurálható súly, horgony, szabály, plafon, címke – validációval |

Feladatlista (1–10): mind kész. A Moat-kategória szándékosan 0 súlyú (indokkal, D-073/8).

## 2. Mi készült
- **Új réteg `src/scoring/`** (csak `domain` + `calculations`; ESLint-zóna + őrteszt): `types`, `score-math`, `config-validation`, `score-engine`, `confidence`, `decision-engine`, `thesis`, `evaluate` (`evaluateScoring`), `config/` (`shared-defaults`, `stock-config`, `etf-config`), `testing.ts` (csak teszt).
- **Alkalmazás `src/application/scoring/`:** `stock-evaluation` (06 + 07 [+ 09] → feature-ök, jelzések, DCF-árszint; `buildStockEvaluation`), `etf-evaluation` (08 [+ 09]; `buildEtfEvaluation`), `portfolio-context`, `types` (`InstrumentEvaluation`, `EvaluationOptions`).
- **Use case-ek:** `evaluateStock`, `evaluateEtf` (`src/application/use-cases/evaluate-instrument.ts`) → `AppServices`, bekötve a `container.ts`-ben.
- **Motor-kiegészítés:** `netDebtToEbitda` (`calculations/fundamentals/balance-cashflow.ts`), `priceAtMarginOfSafety` (`calculations/valuation/multiples.ts`).

## 3. Módosított / új fájlok
- **Új kód (20):** `src/scoring/{types,score-math,config-validation,score-engine,confidence,decision-engine,thesis,evaluate,index,testing}.ts`, `src/scoring/config/{shared-defaults,stock-config,etf-config}.ts`, `src/application/scoring/{types,stock-evaluation,etf-evaluation,portfolio-context}.ts`, `src/application/use-cases/evaluate-instrument.ts`.
- **Új tesztek (6):** `src/scoring/{score-engine,decision-engine,config-validation}.test.ts`, `src/application/scoring/etf-evaluation.test.ts`, `src/__tests__/{stock-evaluation-integration,scoring-purity}.test.ts`. Összesen kb. 4 900 új sor, ebből ~1 500 teszt és tesztsegéd.
- **Módosított kód:** `eslint.config.js` (scoring-zóna), `src/application/index.ts`, `src/config/container.ts`, `src/calculations/{fundamentals/balance-cashflow,valuation/multiples}.ts` (+ tesztjeik), `src/config/container.test.ts`, `src/presentation/di/app-services-context.test.tsx`.
- **Docs:** új `docs/phases/phase-10-scoring-decision-engine.md`, `docs/handoffs/phase-10-handoff.md`; módosítva `DECISIONS` (D-073…D-075), `DATA_DICTIONARY` (fejléc, 9. sorok, 10. leképezés, **új 16. fejezet**), `KNOWN_ISSUES` (blokkolók, KI-83…KI-88, KI-50, R-10), `ARCHITECTURE` (5.1), `ROADMAP`, `PROJECT_STATE`.
- Új csomag **nem** került be.

## 4. Parancsok és tényleges eredmények (2026-11-22, a projekt gyökerében)

| Parancs | Eredmény |
|---|---|
| `git status` (kiinduláskor) | `main`, clean; a PHASE 09 már merge-ölve (PR #5, `296eeba`) |
| `npm test` (kiinduláskor) | 1011/1011, 66 suite |
| `git switch -c phase-10` | új munkaág |
| `npm run check` (a fázis végén) | **exit 0**: typecheck ✅, lint (`--max-warnings 0`) ✅, Prettier ✅, **1186/1186 teszt, 72 suite** ✅ (+175) |
| lefedettség (új modulok) | `src/scoring` 98,9% sor / 91,1% ág (konfiguráció 100%); `src/application/scoring` 92,1% sor; `evaluate-instrument.ts` 100% sor |

Élő API-hívás **nem** volt: a fázis tisztán számítási. A regressziós tesztek valós, megvágott SEC-/FMP-fixture-ökön futnak hamis gatewayjel, egy végponttól végpontig teszt pedig mock adatmóddal a valódi composition rooton át.

**Fejlesztés közbeni leletek:** (1) duplikált feature-azonosítónál az „első nyer” szabály miatt a sorrend befolyásolta az eredményt – a determinizmus-teszt kimutatta, ezért a duplikátum mostantól `VALIDATION` hiba. (2) Az eredeti HIGH confidence-küszöb (70, majd 75) mellett az AAPL értékelési adat nélkül is HIGH lett volna (0,75 × 1,0 = 75) → a küszöb 80 lett (D-074/4). (3) A valós cégek (AAPL, MSFT, NVDA) mind „minőségi, de drága” képet adnak: az alapszabály Watch, a DCF-prémium plafon miatt Hold. Ez a kiinduló, iparág-független horgonyok következménye, nem hiba (KI-85).

**Valós fixture-eredmények (golden, `stock-default` 2026-11-22.1):** AAPL 67,5 / HIGH / Hold (alap: Watch); MSFT 71,9 / MEDIUM / Hold; NVDA 69,4 / HIGH / Hold; JPM – / INSUFFICIENT / Nem értékelhető.

## 5. Ismert hibák / korlátok
Részletek: [../KNOWN_ISSUES.md](../KNOWN_ISSUES.md) „PHASE 10” szakasz.
- **KI-83 (K):** a portfólió-túlsúly csak a közvetlen súlyból számol (ETF-en át meglévő kitettség nélkül).
- **KI-84 (K):** a Moat nem pontozott; a Menedzsment csak részvényszám-proxy.
- **KI-85 (K):** iparág-független horgonyok (bank → `NOT_RATED`); nincs szektor szerinti konfiguráció.
- **KI-86 (M):** nincs kalibráció vagy visszateszt; a címkéknek nincs igazolt előrejelző ereje, és ilyet a rendszer nem is állít.
- **KI-87 (A):** az ETF pénzösszeg-küszöbök csak EUR/USD/GBP pénznemben működnek.
- **KI-88 (A):** a béta szolgáltatói érték; nem US részvénynél free csomagban hiányzik.
- **KI-50 (nyitott):** az ADR-ek ár-alapú szorzói `MISSING` → az Értékelés kategória hiányos; a PHASE 12-vel.

## 6. Nyitott kérdések
- **Commit:** tulajdonosi jóváhagyással commitolva a `phase-10` branchen (`6721be3`); a PR és a merge a tulajdonos döntése. Üzenet:
  `feat: PHASE 10 – score és döntési engine (src/scoring réteg, külön részvény/ETF-score konfigurált súlyokkal, hiányzó adat D-074, determinisztikus döntés plafonokkal, AnalysisConfidence, thesis risks és érvénytelenítés)`
- **Súlyok és küszöbök:** a kiinduló értékek szakmai konvenciók. Ha a tulajdonos más hangsúlyt szeretne (pl. kisebb súlyt az Értékelésnek, más P/E-horgonyt), azt a konfigurációban kell módosítani. Ilyenkor a golden teszteket frissíteni kell, és a változást a DECISIONS-ben dokumentálni.
- A régebbi nyitott pontok (EAS-próbatelepítés, FMP-keret és ToS, DP-05) változatlanok, és nem blokkolják a PHASE 11-et.

## 7. Indulási útmutató a PHASE 11-hez
1. Olvasd el: `docs/PROJECT_STATE.md`, ezt a handoffot, a ROADMAP PHASE 11 szakaszát, a DATA_DICTIONARY **9.** és **16.** fejezetét, valamint a D-026, D-073…D-075 döntéseket.
2. Ellenőrzés: `git status`, majd `npm run check`. Elvárt: exit 0, **1186 teszt** (ha a PHASE 10 már merge-ölve van).
3. Az AI bemenete az `InstrumentEvaluation`: `score.categories[]` (`rationale`, `missing`, `dataQuality`), `decision` (`labelText`, `drivers`, `ruleTrace`, `appliedCaps`), `confidence` (`level`, `reasons`, `meaning`), `thesis` (`risks`, `invalidation`), `disclaimer`. A `template` provider (D-026) ezekből determinisztikusan építhet szöveget.
4. **Tilos:** a pont, a címke vagy a confidence módosítása, saját „ajánlás” hozzáadása, a `NOT_RATED` negatív ítéletként tálalása, a confidence valószínűségként értelmezése. Az AI-kimenet `basedOn` mezője csak létező feature- vagy szabályazonosítóra hivatkozhat.
5. Belépési pontok: `AppServices.evaluateStock(listingId, options)`, `AppServices.evaluateEtf(listingId, options)`; hálózat nélkül: `buildStockEvaluation`, `buildEtfEvaluation`.
