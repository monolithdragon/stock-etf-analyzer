# Handoff – PHASE 05 → PHASE 06

> Dátum: 2026-11-22 · Elkészült: **PHASE 05 – Pénzügyi calculation engine** · Következik: **PHASE 06 – Részvény fundamentális elemzés**
> Kezdőbarát útmutató: [../phases/phase-05-financial-calculation-engine.md](../phases/phase-05-financial-calculation-engine.md) · Előző handoff: [phase-04-handoff.md](phase-04-handoff.md)

## 1. Készültség
**PHASE 05: KÉSZ.** A 05-ös prompt elfogadási feltételei:

| Feltétel | Állapot | Bizonyíték |
|---|---|---|
| Minden implementált képletet teszt fed le normál és hibás bemenettel | ✅ | 12 tesztfájl, 187 teszt a `src/calculations`-ben + 29 tisztasági teszt (összesen +216) |
| A definíciók és mértékegységek dokumentáltak | ✅ | DATA_DICTIONARY 5. (végleges, függvénynevekkel) és 12. fejezet; JSDoc minden függvényen; D-055…D-058 |
| A modul nem függ RN-től, UI-tól, hálózattól | ✅ | ESLint-zóna + `no-restricted-imports` + `no-restricted-globals`; `src/__tests__/calculations-purity.test.ts` (óra és véletlen sem) |
| Lefedettség ≥ 90% (ROADMAP) | ✅ | **99,56% sor, 97,91% ág, 100% függvény** (`src/calculations`, a `testing.ts` és az `index.ts` is beleszámolva) |
| DCF csak közös konvenciókkal | ✅ | `discountFactor`, `presentValue`, `gordonTerminalValue` (D-057); a teljes DCF a PHASE 07-é |

**Nem készült el (szándékosan, nem ennek a fázisnak a feladata):** use case-bekötés és élő adaton futás (06), teljes DCF (07), volatilitás/Sharpe/Sortino (08), UI-formázás (12).

## 2. Mi készült
- **`src/calculations/`** (D-055) – két szint:
  1. **Képletek:** tiszta függvények nevesített bemenettel (`number | null`; `null` = hiány, `0` = érték) → `CalcResult<T>` (`OK` + `notes[]`, vagy `MISSING` / `NOT_MEANINGFUL` / `INSUFFICIENT_DATA` / `INVALID_INPUT` / `NOT_APPLICABLE` + indok).
  2. **`Metric`-adapter:** `calculateMetric(required, optional, formula, context)` → `{ metric: Metric<number>, notes }` – státusz-továbbadás, pénznem-őr, `calculated`/`estimated`/`mock` provenance; `preferReported`; `METRIC_DEFINITIONS` + `toFinancialMetric`.
- **Képletek** (a prompt teljes listája):
  - `fundamentals/profitability.ts`: `grossProfit`, `operatingIncome`, `grossMargin`, `operatingMargin`, `netMargin`, `calculateEps`, `selectEps`, `effectiveTaxRate`, `resolveNopatTaxRate`, `nopat`, `investedCapital`, `roe`, `roa`, `roic`
  - `fundamentals/growth.ts`: `growthRate`, `cagr`, `cagrOverYears`, `degreeOfOperatingLeverage`
  - `fundamentals/balance-cashflow.ts`: `netDebt`, `netCash`, `debtToEquity`, `freeCashFlow`, `fcfMargin`, `fcfConversion`, `fcfAfterDividend`, `fcfAfterDividendAndDebtRepayment`, `ebitda`
  - `valuation/multiples.ts`: `marketCap`, `enterpriseValue`, `priceToEarnings`, `priceToFreeCashFlow`, `priceToSales`, `priceToBook`, `evToEbitda`, `pegRatio`, `fcfYield`, `dividendYield`, `dividendYieldFromMoney`, `trailingDividendPerShare`, `marginOfSafety`
  - `valuation/dcf-conventions.ts`: `discountFactor`, `presentValue`, `gordonTerminalValue`
  - `returns/returns.ts`: `simpleReturn`, `totalReturnFromPrices`, `seriesReturn`, `yearsBetween`, `annualizeReturn`, `realReturn`, `priceChangeFromEpsAndMultiple`, `decomposePriceReturn`, `annualizedMultipleChange`, `expectedReturnBreakdown`
  - `returns/drawdown.ts`: `drawdownSeries`, `maxDrawdown`, `requiredRecovery`; `returns/future-value.ts`: `futureValueOfContributions`
  - `etf/costs-tracking.ts`: `annualTerCost`, `terLongTermImpact`, `trackingDifference`, `trackingError`
  - `portfolio/portfolio-basics.ts`: `portfolioWeights`, `weightedReturn`
- **Edge case-ek** (mind tesztelve): nullával osztás, nullás bázisév, negatív EPS/FCF/equity, hiányzó adat, NaN/Infinity (a `calcOk` biztonsági hálója is), lebegőpontos zaj (`snapToZero`), százalék vs. tört (józansági határok + tippek), eltérő pénznem, GBX/GBP.

## 3. Módosított / új fájlok
- **Új:** `src/calculations/**` (13 forrás- és 12 tesztfájl + `core/testing.ts` teszt-segéd), `src/__tests__/calculations-purity.test.ts`, `docs/handoffs/phase-05-handoff.md`, `docs/phases/phase-05-financial-calculation-engine.md`.
- **Módosított:** `eslint.config.js` (calculations-zóna, importtiltás, hálózat-tiltás), `docs/DATA_DICTIONARY.md` (5. fejezet újraírva, 1., 10. bővítve, új 12.), `docs/DECISIONS.md` (D-055…D-058), `docs/ARCHITECTURE.md`, `docs/PROJECT_STATE.md`, `docs/ROADMAP.md`, `docs/KNOWN_ISSUES.md` (KI-42…KI-49).
- Új csomag **nem** került be.

## 4. Parancsok és tényleges eredmények (2026-11-22, a projekt gyökerében)

| Parancs | Eredmény |
|---|---|
| `npm run typecheck` (kiinduláskor) | exit 0 |
| `npx jest` (kiinduláskor) | 337/337, 25 suite |
| `npm run check` (a fázis végén) | **exit 0**: typecheck ✅, lint (`--max-warnings 0`) ✅, Prettier ✅, **553/553 teszt, 38 suite** ✅ |
| `npx jest src/calculations --coverage --collectCoverageFrom='src/calculations/**/*.ts' --collectCoverageFrom='!src/calculations/**/*.test.ts'` | All files: 99,42% stmt, **97,91% branch**, 100% func, **99,56% lines** |

Fejlesztés közben két valódi hiba derült ki, mindkettő javítva: (1) a teszt fogta meg, hogy a `selectEps` saját számítása a teljes bemeneti objektumot adta tovább, így mindig `MISSING` lett; (2) az átlagos nevező hibás zárójelezését (ROE/ROA/ROIC) még a tesztek előtt, kódátnézéskor javítottam, a tesztek most le is fedik.

## 5. Ismert hibák / korlátok
Részletek: [../KNOWN_ISSUES.md](../KNOWN_ISSUES.md) „PHASE 05” szakasz.
- **KI-42 (M):** a `totalDebt` forrásoldalon `MISSING` → nettó adósság, EV, D/E, IC, ROIC, EV/EBITDA élő adattal `MISSING`. **A PHASE 06 első feladata.**
- KI-43: a saját EPS az elsőbbségi osztalék levonása nélkül számol (a jelentett az elsődleges).
- KI-44: az EV kisebbségi részesedés, elsőbbségi részvény és lízing nélkül (PHASE 07).
- KI-45: a TTM osztalék 365 napos ablaka szabálytalan ütemezésnél pontatlan lehet.
- KI-46: TER-hatás `(1 + r − TER)^n` közelítéssel. KI-47: tracking error dátum-igazítás a hívónál (08).
- KI-48: a tisztasági teszt a tranzitív `@types/node`-ot használja. KI-49: a motort még nem hívja use case.

## 6. Nyitott kérdések
- **Commit:** a PHASE 05 változásai nincsenek commitolva (a tulajdonos dönt). Javasolt üzenet:
  `feat: PHASE 05 – pénzügyi számítási motor (CalcResult, Metric-adapter, képletek, DCF-konvenciók, 99% lefedettség)`
- Nincs új tulajdonosi döntési pont. A régebbiek (EAS próbatelepítés, FMP keret/ToS, DP-05) változatlanok, a PHASE 06-ot nem blokkolják.

## 7. Indulási útmutató a PHASE 06-hoz
1. Olvasd el: `docs/PROJECT_STATE.md`, ezt a handoffot, a DATA_DICTIONARY **4.3–4.4, 5. és 12.** fejezetét, a D-021, D-043, D-055, D-056 döntéseket és a KI-18/19/20/42 bejegyzéseket.
2. Ellenőrzés: `git status`, majd `npm run check` – elvárt: exit 0, 553 teszt.
3. Használat (minta):
   ```ts
   import { calculateMetric, grossMargin, preferReported, grossProfit, toFinancialMetric } from '@/calculations';

   const ctx = { unit: 'ratio' as const, calculatedAt: clock.nowIso(), period: income.period };
   const gp = preferReported(income.lineItems.grossProfit, () =>
     calculateMetric(
       { revenue: income.lineItems.revenue, costOfRevenue: income.lineItems.costOfRevenue },
       {},
       grossProfit,
       { ...ctx, unit: 'money' },
     ),
   );
   const margin = calculateMetric({ grossProfit: gp.metric, revenue: income.lineItems.revenue }, {}, grossMargin, ctx);
   const metric = toFinancialMetric('grossMargin', margin, income.period); // Result<FinancialMetric>
   ```
   (A `clock.nowIso()` csak illusztráció: a use case az injektált `Clock` portból vegye az időt.)
4. Első feladatok: `totalDebt` összerakása valós fixture-rel (KI-42); TTM és Q4 (D-021, KI-18/19); 1/3/5/10 éves trend a `cagrOverYears`-szel; `analyzeStock` use case az `application` rétegben (az application már importálhatja a `calculations`-t – ESLint engedi).
5. Ne írd át a képletdefiníciókat dokumentált indok és DECISIONS-bejegyzés nélkül.
