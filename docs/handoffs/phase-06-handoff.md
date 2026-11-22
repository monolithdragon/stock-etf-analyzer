# Handoff – PHASE 06 → PHASE 07

> Dátum: 2026-11-22 · Elkészült: **PHASE 06 – Részvény fundamentális elemzés** · Következik: **PHASE 07 – Értékelés és DCF**
> Kezdőbarát útmutató: [../phases/phase-06-stock-fundamental-analysis.md](../phases/phase-06-stock-fundamental-analysis.md) · Előző handoff: [phase-05-handoff.md](phase-05-handoff.md)

## 1. Készültség
**PHASE 06: KÉSZ.** A 06-os prompt elfogadási feltételei:

| Feltétel | Állapot | Bizonyíték |
|---|---|---|
| A mutatók pontos definícióval számolódnak | ✅ | minden képlet a PHASE 05 motorjából; DATA_DICTIONARY 13.4/13.6; golden értékek valós fixture-ön (AAPL piaci érték = FMP által közölt érték) |
| Nincs fiktív adatpótlás | ✅ | hiány → nem-OK `Metric` indokkal; az egyetlen feltevés (hiányzó rövid lejáratú adósság-komponens = 0) `estimated` címkével látszik (D-059) |
| Kvalitatív és numerikus elemzés külön | ✅ | `quality` külön szerkezet, csak hivatkozik a mutatókra; `scoring: 'NOT_SCORED'`; MOAT/MANAGEMENT csak forrásolt lelettel (D-063) |
| Adathiány és elavulás látható és tesztelt | ✅ | `MetricOrigin` (`stale`, `missing`, `unavailable`), `dataQuality.sources/warnings`; tesztek: elavult készlet, teljes kiesés, kvóta, rövid ártörténet |
| Tesztek: hiányos történet, negatív EPS, missing fields, eltérő időszakok | ✅ | `period-metrics.test.ts`, `trends.test.ts`, `statement-periods.test.ts`, integrációs teszt (BRK-B, XOM, TSM, NVDA) |

**Nem készült el (tudatosan):** Q2/Q3 YTD cash flow különbségképzés (KI-18 – a SEC-normalizáló bővítését igényli), FX-átváltás a szorzókhoz (KI-50), TTM-alapú szorzók (KI-52), UI (PHASE 12), pontozás (PHASE 10), DCF (PHASE 07).

## 2. Mi készült
- **`totalDebt` (KI-42 megoldva, D-059):** `src/server/providers/sec-edgar/sec-debt.ts` – lejárat szerinti bontás (nem rövid + rövid rész); élő SEC-próbával kiválasztott tagek; dupla számolás ellen védett (JNJ); hiányzó rövid komponens → `estimated`; bank/biztosító/IFRS → `MISSING`. Fixture-ök csak új tagekkel bővítve (`scripts/record-sec-fixtures.mjs --add-new-tags`).
- **Béta:** `InstrumentProfile.beta` (FMP, `reported`, tájékoztató; opcionális a szerződésben).
- **Domain:** `src/domain/analysis/stock-fundamentals.ts` – `MetricOrigin`/`classifyMetricOrigin`, `FundamentalMetric`, `StockOverview`, `StatementTable`, `PeriodMetricTable`/`PeriodColumn`, `TrendSeries`, `QualityAnalysis`, `QualitativeFinding` (+ validáló konstruktor), `StockDataQuality`, `STOCK_ANALYSIS_DISCLAIMER`.
- **Application:** `src/application/stock-analysis/` – `statement-periods.ts` (csoportosítás, Q4, TTM, táblák), `period-metrics.ts` (30 sor), `trends.ts` (CAGR összehasonlíthatósági ellenőrzéssel), `valuation.ts` (ár, piaci érték, béta, 52 hetes tartomány, szorzók, osztalékhozam), `quality.ts`, `metric-helpers.ts`, `testing.ts` (csak tesztekhez).
- **Use case:** `src/application/use-cases/analyze-stock-fundamentals.ts` → `AppServices.analyzeStockFundamentals(listingId, { qualitativeFindings? })`.
- **Számítási motor:** `priceRange` (`src/calculations/returns/price-range.ts`).

## 3. Módosított / új fájlok
- **Új (21):** `src/server/providers/sec-edgar/sec-debt.ts` (+ teszt), `src/domain/analysis/stock-fundamentals.ts` (+ teszt), `src/application/stock-analysis/{metric-helpers,statement-periods,period-metrics,trends,valuation,quality,testing}.ts` (+ 5 teszt), `src/application/use-cases/analyze-stock-fundamentals.ts` (+ teszt), `src/calculations/returns/price-range.ts` (+ teszt), `src/__tests__/stock-fundamentals-integration.test.ts`; `docs/phases/phase-06-stock-fundamental-analysis.md`, `docs/handoffs/phase-06-handoff.md`.
- **Módosított:** `sec-tags.ts`, `sec-normalizer.ts`, `sec-edgar.test.ts`, 10 SEC-fixture (csak új tagek), `fmp-normalizer.ts`, `fmp.test.ts`, `contracts/market.ts`, `domain/instrument/instrument-profile.ts`, `domain/index.ts`, `calculations/index.ts`, `application/index.ts`, `config/container.ts`, `presentation/di/app-services-context.test.tsx`, `scripts/record-sec-fixtures.mjs`; docs: `DATA_DICTIONARY` (3.4, 4.4, 5.2, 12.4, új 13.), `DECISIONS` (D-059…D-063; D-043 részben felváltva), `KNOWN_ISSUES` (KI-50…KI-57; KI-18/19/42/49 frissítve), `ROADMAP`, `PROJECT_STATE`, `ARCHITECTURE`, `DATA_SOURCES` (12.).
- Új csomag **nem** került be.

## 4. Parancsok és tényleges eredmények (2026-11-22, a projekt gyökerében)

| Parancs | Eredmény |
|---|---|
| `git status` (kiinduláskor) | `main`, clean (a PHASE 05 már merge-ölve: `e66e88e`) |
| élő SEC-próba 12 cégre (scratchpad-szkript, csak olvasás) | adósság-tagek feltérképezve (D-059 kontextus) |
| `node scripts/record-sec-fixtures.mjs --add-new-tags` | 10 fixture bővítve (BRK-B, TSM: 0 új tag); a régi tények bitre változatlanok (szkripttel ellenőrizve) |
| `npm run check` (a fázis végén) | **exit 0**: typecheck ✅, lint (`--max-warnings 0`) ✅, Prettier ✅, **661/661 teszt, 48 suite** ✅ |
| lefedettség (új modulok + `src/calculations`) | All: 98,02% sor, 91,72% ág; `stock-analysis/*` 97,15% sor; `sec-debt.ts`, `price-range.ts`, `quality.ts`, `stock-fundamentals.ts` 100% |

**Fejlesztés közbeni leletek:** (1) a naiv `totalDebt`-képlet a JNJ-nél dupla számolást okozott volna – az élő próba fogta meg; (2) egy teszt kimutatta, hogy a származtatott Q4 csupa-`MISSING` cash flow-oszlopot kapott, ha a negyedéveknek nem volt CF-kimutatása – javítva (`deriveQ4`: csak ha mind a négy időszaknak van ilyen kimutatása); (3) **folyamathiba:** a fixture-rögzítő egyszer véletlenül teljes módban futott (felülírta a fixture-öket) – `git checkout`-tal azonnal visszaállítva, majd a helyes `--add-new-tags` móddal futtatva.

## 5. Ismert hibák / korlátok
Részletek: [../KNOWN_ISSUES.md](../KNOWN_ISSUES.md) „PHASE 06” szakasz.
- **KI-50 (K):** eltérő jegyzési/beszámolói pénznem → ár-alapú szorzók `MISSING` (FX: PHASE 07).
- **KI-51 (K):** becsült adósság (hiányzó rövid komponens); bank/biztosító/IFRS: `MISSING`.
- **KI-52 (K):** TTM EPS gyakorlatilag mindig `MISSING` (Q4 EPS nem származtatható) → a szorzók FY-alapúak.
- KI-53: split-heurisztika téves riasztása nagy kibocsátásnál. KI-54: az ár 15 perc után `stale`. KI-55: nem fizető cégnél az osztalékhozam `MISSING`. KI-56: Q4 restatement-kockázat. KI-57: a fixture-ökön a 10 éves CAGR nem számolható.
- KI-18 (nyitott): a negyedéves Q2/Q3 cash flow továbbra is hiányzik.

## 6. Nyitott kérdések
- **Commit:** a PHASE 06 változásai nincsenek commitolva (a tulajdonos dönt). Javasolt: külön branch (`git switch -c phase-06`), majd:
  `feat: PHASE 06 – részvény fundamentális elemzés (totalDebt, Q4/TTM, mutatók, CAGR, értékelés, minőségi modell)`
- **Ellentmondás (javítva):** a PHASE 05 handoff „commitra vár” állapotot írt, de a PHASE 05 már a `main`-en volt. A PROJECT_STATE frissítve.
- Nincs új tulajdonosi döntési pont. A régebbiek (EAS próbatelepítés, FMP keret/ToS, DP-05) változatlanok, a PHASE 07-et nem blokkolják.

## 7. Indulási útmutató a PHASE 07-hez
1. Olvasd el: `docs/PROJECT_STATE.md`, ezt a handoffot, a DATA_DICTIONARY **5.4 és 13.** fejezetét, a D-022, D-057, D-059, D-062 döntéseket és a KI-44/50/51/52 bejegyzéseket.
2. Ellenőrzés: `git status`, majd `npm run check` – elvárt: exit 0, 661 teszt.
3. Bemenet a DCF-hez (minta):
   ```ts
   const result = await services.analyzeStockFundamentals('AAPL@XNAS');
   if (!result.ok) return result;
   const a = result.value;
   const fy = a.periodMetrics.annual;               // columns[0] = legutóbbi FY
   const row = (id: string) => fy.rows.find((r) => r.id === id)?.cells[0];
   const baseFcf = row('fcf');                        // FundamentalMetric (value + origin)
   const debt = row('totalDebt');                     // origin 'estimated' lehet → öröklődjön!
   const cash = row('cashAndEquivalents');
   const shares = a.overview.sharesOutstanding;
   const price = a.overview.price;
   ```
4. Első feladatok: DCF a D-022/D-057 szerint (`discountFactor`, `presentValue`, `gordonTerminalValue`), Bear/Base/Bull, érzékenységi tábla ugyanazzal az engine-nel; döntés a TTM-alapú szorzókról (KI-52) és az FX-átváltásról (KI-50, `convertMoney`); a becsült bemenetek eredete (`estimated`) jelenjen meg a DCF kimenetében.
5. Ne írd át a PHASE 06 definícióit dokumentált indok és DECISIONS-bejegyzés nélkül; új mutatóhoz a `createFundamentalMetric` / `calculatedMetric` mintát használd.
