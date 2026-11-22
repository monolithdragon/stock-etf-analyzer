# PHASE 05 – Pénzügyi számítási motor (kezdőbarát útmutató)

> Dátum: 2026-11-22 · Állapot: **KÉSZ** · Átadás: [../handoffs/phase-05-handoff.md](../handoffs/phase-05-handoff.md)
> Döntések: D-055…D-058 ([../DECISIONS.md](../DECISIONS.md)) · Képletdefiníciók: [../DATA_DICTIONARY.md](../DATA_DICTIONARY.md) 5. és 12. fejezet

Ez az útmutató lépésenként leírja, mi készült a PHASE 05-ben, miért, és hogyan ellenőrizheted. A **teljes, aktuális kód a repóban van**, a megadott útvonalakon (kb. 4100 sor, ennek több mint fele teszt). Itt a lényeges részleteket, a konfigurációs változást teljes terjedelmében, és számpéldákat mutatunk.

## Tartalom
0. Szakszavak röviden
1. Indulóállapot ellenőrzése
2. Mit és miért építettünk (áttekintés)
3. A közös mag: `CalcResult` és a bemenetek
4. Numerikus konvenciók (tört, kerekítés, százalék-hiba)
5. A képletek modulonként, számpéldákkal
6. A `Metric`-adapter: képlet + domain-adat összekötése
7. Rétegszabály: a motor tisztaságának kikényszerítése
8. Tesztek és lefedettség
9. Próbáld ki magad: saját teszt egy képletre
10. Gyakori hibák és javításuk
11. Befejezési feltételek

---

## 0. Szakszavak röviden

| Szó | Jelentés |
|---|---|
| **Tiszta függvény** | Ugyanarra a bemenetre mindig ugyanazt adja, és nincs mellékhatása (nem hív hálózatot, nem olvas órát, nem ír fájlt). Ezért könnyű tesztelni. |
| **Calculation engine / számítási motor** | Az a kódrész, amely a pénzügyi mutatókat kiszámolja. Nálunk: `src/calculations/`. |
| **`CalcResult`** | Egy képlet eredménye: vagy `OK` + érték, vagy egy állapot (pl. `NOT_MEANINGFUL`) + magyarázat. |
| **N/M (`NOT_MEANINGFUL`)** | „Nem értelmezhető”: kiszámolható volna, de félrevezető (pl. P/E negatív EPS mellett). |
| **N/A (`NOT_APPLICABLE`)** | „Nem alkalmazható”: az adott instrumentumra a mutató nem létezik (pl. P/E egy ETF-re). |
| **`MISSING`** | Hiányzó bemenet. **Nem nulla!** |
| **Tizedes tört** | `0.15` = 15%. A motor belül mindig így számol; a `%` jel csak a képernyőn jelenik meg. |
| **Provenance** | Az érték „származási lapja”: honnan jött, mikor, milyen pénznemben, jelentett vagy számított. |
| **Lefedettség (coverage)** | A kód hány százalékát futtatják le a tesztek. |
| **ESLint-zóna** | Szabály, amely megtiltja, hogy egy mappa bizonyos más mappákból importáljon. |
| **TTM** | Trailing Twelve Months – az utolsó 12 hónap. |

## 1. Indulóállapot ellenőrzése

**Cél:** meggyőződni, hogy a PHASE 04 vége zöld, mielőtt bármit hozzáteszünk.
**Hol:** a projekt gyökérmappájában (`C:\Users\…\stock-etf-analyzer`), VS Code-ban: *Terminal → New Terminal*.

```bash
git status          # mi változott a legutóbbi commit óta
npm run typecheck   # TypeScript-ellenőrzés
npx jest            # összes teszt
```

**Elvárt (2026-11-22 kiinduláskor):** `typecheck` hiba nélkül; `Tests: 337 passed, 337 total`.

## 2. Mit és miért építettünk (áttekintés)

**Cél:** minden pénzügyi mutató egyetlen, tesztelt helyen legyen, a képernyőtől és a hálózattól függetlenül. Így:
- a szám **reprodukálható** (ugyanaz az adat → ugyanaz az eredmény),
- a UI és az AI **nem számol**, csak megjelenít/magyaráz (ARCHITECTURE 1. alapelv),
- egy hiba egy helyen javítható.

**Mappaszerkezet** (`src/calculations/`):

```
src/calculations/
├─ index.ts                     nyilvános felület (import: '@/calculations')
├─ definitions.ts               mutató-azonosító → képlet szövege + egység
├─ core/
│  ├─ calc-result.ts            CalcResult típus, calcOk, requireInputs, chainCalc
│  ├─ numeric.ts                tört/százalék, kerekítési zaj, ellenőrző „őrök”, szórás
│  ├─ to-metric.ts              Metric-adapter (calculateMetric, preferReported)
│  └─ testing.ts                teszt-segéd (okValue, failureReason) – csak tesztekhez
├─ fundamentals/                profitability.ts, growth.ts, balance-cashflow.ts
├─ valuation/                   multiples.ts, dcf-conventions.ts
├─ returns/                     returns.ts, drawdown.ts, future-value.ts
├─ etf/                         costs-tracking.ts
└─ portfolio/                   portfolio-basics.ts
```

Minden `.ts` mellett ott a `.test.ts` párja.

## 3. A közös mag: `CalcResult` és a bemenetek

**Fájl:** `src/calculations/core/calc-result.ts`

**Miért kell?** Egy pénzügyi mutatónál nem elég egy szám. Ha az árbevétel 0, a marzs nem „0” és nem „Infinity”, hanem *nem értelmezhető*. Ezt a típus kikényszeríti:

```ts
export type CalcResult<T> =
  | { status: 'OK'; value: T; notes: readonly string[] }
  | { status: 'MISSING' | 'NOT_APPLICABLE' | 'NOT_MEANINGFUL'
            | 'INSUFFICIENT_DATA' | 'INVALID_INPUT'; reason: string };
```

**Bemenet:** minden képlet *nevesített objektumot* kap, a mezők típusa `number | null | undefined`:

```ts
grossMargin({ grossProfit: 40, revenue: 100 });   // → OK, 0.4
grossMargin({ grossProfit: null, revenue: 100 }); // → MISSING: „Hiányzó bemenet: grossProfit.”
grossMargin({ grossProfit: 40, revenue: 0 });     // → NOT_MEANINGFUL (nullával osztás)
```

**Két fontos segéd:**
- `requireInputs({ … })` – ha bármelyik bemenet NaN/Infinity → `INVALID_INPUT`; ha hiányzik → `MISSING` (az összes hiányzó nevével).
- `calcOk(érték)` – **biztonsági háló**: ha az eredményben bárhol NaN vagy Infinity van, nem ad `OK`-t, hanem `INVALID_INPUT`-ot.

## 4. Numerikus konvenciók

**Fájl:** `src/calculations/core/numeric.ts` · Döntés: D-009, D-058

| Szabály | Miért |
|---|---|
| Arány, hozam, ráta = **tizedes tört** (`0.07` = 7%) | Egy közös formátum; a ×100 és a `%` jel a képernyő dolga (PHASE 12). |
| A motor **nem kerekít** | A kerekítés csak megjelenítéskor történik; különben a hibák halmozódnak. |
| `snapToZero`: ±1e-12 alatti szám → 0 | A gép `0.1 + 0.2`-t `0.30000000000000004`-nek számolja; drawdownnál ez hamis „−0.00000000000000011” visszaesést adna. |
| Józansági határok (`mustBeInRange`) | A „százalék a tört helyett” hiba elkapása: ha valaki TER-nek `0.22`-t ír (= 22%!), `INVALID_INPUT` jön ezzel a tippel: „A ráták tizedes törtként értendők (0.05 = 5%)”. |
| `percentToDecimal(15)` → `0.15` | Ha egy forrás százalékot ad, a hívó ezzel váltja át. |

## 5. A képletek modulonként, számpéldákkal

A pontos definíciók és az összes speciális eset: **DATA_DICTIONARY 5. fejezet**. Itt a legfontosabbak, ellenőrizhető számokkal (mind szerepel a tesztekben is).

### 5.1 Jövedelmezőség – `fundamentals/profitability.ts`
| Hívás | Eredmény | Megjegyzés |
|---|---|---|
| `grossProfit({ revenue: 100, costOfRevenue: 60 })` | 40 | COGS < 0 → `INVALID_INPUT` (előjelhiba) |
| `netMargin({ netIncome: 21, revenue: 100 })` | 0.21 | árbevétel ≤ 0 → N/M |
| `selectEps({ reportedDiluted: 2.4, reportedBasic: 2.5, … })` | `{ eps: 2.4, basis: 'reported_diluted' }` | sorrend: jelentett hígított → jelentett alap → saját számítás |
| `nopat({ operatingIncome: 100, taxRate: 0.21 })` | 79 | `taxRate: 21` → `INVALID_INPUT` |
| `roe({ netIncome: 100, equityStart: 400, equityEnd: 600 })` | 0.2 | átlagos saját tőke = 500; ha bármelyik ≤ 0 → N/M |
| `roe({ netIncome: 100, equityEnd: 500 })` | 0.2 + megjegyzés | „…a záró értékkel számolva (nem átlag)” |

**Adókulcs NOPAT-hoz:** ha az effektív kulcs nem értelmezhető (veszteség), a motor **nem talál ki** 21%-ot. Csak akkor számol tartalék kulccsal, ha a hívó kifejezetten megadja (`resolveNopatTaxRate({ …, fallbackTaxRate: 0.21 })`), és ilyenkor az eredmény *becslés*.

### 5.2 Növekedés – `fundamentals/growth.ts`
| Hívás | Eredmény |
|---|---|
| `growthRate({ current: 110, previous: 100 })` | 0.1 |
| `growthRate({ current: 10, previous: 0 })` | N/M – „nullás bázisév” |
| `growthRate({ current: 1, previous: -1 })` | N/M – nincs abszolútérték-trükk |
| `cagr({ startValue: 100, endValue: 121, years: 2 })` | 0.1 |
| `cagrOverYears(idősor, 5)` | a 2025-ös és a 2020-as évből; ha bármelyik hiányzik → `INSUFFICIENT_DATA` |
| `degreeOfOperatingLeverage(…)` +20% üzemi eredmény / +10% árbevétel | 2.0; ha az árbevétel 1%-nál kevesebbet változik → N/M |

### 5.3 Mérleg és cash flow – `fundamentals/balance-cashflow.ts`
| Hívás | Eredmény |
|---|---|
| `freeCashFlow({ operatingCashFlow: 500, capitalExpenditure: 200 })` | 300 |
| `fcfAfterDividend({ freeCashFlow: 300, dividendsPaid: null })` | **MISSING** (a hiányzó osztalék nem 0!) |
| `fcfAfterDividend({ freeCashFlow: 300, dividendsPaid: 0 })` | 300 (jelentett 0 osztalék) |
| `debtToEquity({ totalDebt: 200, shareholdersEquity: -100 })` | N/M (negatív saját tőke) |

### 5.4 Értékelés – `valuation/multiples.ts`
| Hívás | Eredmény |
|---|---|
| `priceToEarnings({ price: 100, eps: 5 })` | 20 |
| `priceToEarnings({ price: 100, eps: -2 })` | **N/M** – soha nem „−50x” |
| `pegRatio({ priceToEarnings: 20, epsGrowthRate: 0.10 })` | 2.0 |
| `dividendYieldFromMoney({ annualDividendPerShare: 0.50 GBP, price: 2500 GBX })` | 0.02 (a 2500 penny = 25 font) |
| `dividendYieldFromMoney({ 1 USD, 50 EUR })` | `INVALID_INPUT` – előbb FX-átváltás kell |
| `marginOfSafety({ intrinsicValue: 100, price: 80 })` | 0.2 |

`trailingDividendPerShare` összeadja az utolsó 365 nap osztalékait (ex-dátum szerint). Ha nem tudjuk, mióta teljes az osztaléktörténet, és nincs esemény, akkor `MISSING` – mert nem tudjuk, hogy a cég nem fizetett, vagy csak nincs adatunk.

### 5.5 DCF-konvenciók – `valuation/dcf-conventions.ts`
| Hívás | Eredmény |
|---|---|
| `presentValue({ cashFlow: 110, discountRate: 0.1, period: 1 })` | 100 |
| `gordonTerminalValue({ finalYearCashFlow: 100, discountRate: 0.10, terminalGrowth: 0.02 })` | 1275 |
| `gordonTerminalValue({ …, discountRate: 0.10, terminalGrowth: 0.10 })` | `INVALID_INPUT` – „a diszkontráta nem nagyobb a terminális növekedésnél…” |

A teljes DCF (forgatókönyvek, érzékenységi tábla) a PHASE 07-ben épül ezekre.

### 5.6 Hozamok – `returns/`
| Hívás | Eredmény |
|---|---|
| `realReturn({ nominalReturn: 0.08, inflation: 0.03 })` | ≈ 0.04854 (nem 0.05!) |
| `priceChangeFromEpsAndMultiple({ epsGrowth: 0.1, multipleChange: -0.1 })` | −0.01 (+10% és −10% együtt −1%) |
| `expectedReturnBreakdown({ dividendYield: 0.02, earningsGrowth: 0.05, annualMultipleChange: -0.01 })` | total ≈ 0.0595 + megjegyzés: „nem előrejelzés és nem garantált hozam” |
| `maxDrawdown(árak: 100, 120, 90, 60, 120, 130)` | −0.5; csúcs a 2., mélypont a 4., helyreállás az 5. napon |
| `requiredRecovery({ drawdown: -0.5 })` | 1.0 (−50% után +100% kell) |
| `futureValueOfContributions({ periodicPayment: 100, annualRate: 0.07, years: 10, timing: 'end' })` | ≈ 17 105 (120 befizetés = 12 000 tőke) |

**Rendszeres befizetés:** a havi ráta *effektív* (`(1 + 0.07)^(1/12) − 1`), így 12 havi kamatozás pontosan 7%-ot ad egy év alatt. `timing: 'end'` = a hónap végén fizetsz be; `'begin'` = a hónap elején (egy hónappal több kamat jár rá).

### 5.7 ETF és portfólió – `etf/`, `portfolio/`
| Hívás | Eredmény |
|---|---|
| `annualTerCost({ investedAmount: 10000, ter: 0.0022 })` | 22 / év |
| `terLongTermImpact({ 10000, 7%, TER 0.2%, 30 év })` | költség nélkül ≈ 76 123, költséggel ≈ 71 968 (≈ 5,5%-kal kevesebb) |
| `trackingDifference({ fundReturn: 0.095, indexReturn: 0.10 })` | −0.005 |
| `portfolioWeights([A: 600 EUR, B: 400 EUR, C: nincs ár])` | A 0.6, B 0.4; C az `unpriced` listában (**nem 0 súllyal**) |
| `weightedReturn([0.6 × 10%, 0.4 × 5%])` | 0.08; ha a súlyok 60 és 40 → `INVALID_INPUT` „százalékban adták meg?” |

## 6. A `Metric`-adapter: képlet + domain-adat összekötése

**Fájl:** `src/calculations/core/to-metric.ts` · Döntés: D-055

**Miért kell?** A valódi adat (pl. a SEC-kimutatás) nem sima szám, hanem `Metric<number>`: státusszal és forrással. Az adapter:
1. Ha egy kötelező bemenet nem `OK` (pl. `MISSING`), a képlet **le sem fut**, az eredmény is `MISSING`, és az indok megnevezi, melyik bemenet hiányzik.
2. Ha két pénzösszeg pénzneme eltér (USD vs EUR) → `INVALID_INPUT` (nincs csendes átváltás).
3. Az eredményhez provenance-t ír: `kind: 'calculated'` (vagy `mock`/`estimated`), a legrégebbi bemenet dátuma, a legrosszabb frissesség, a felhasznált bemenetek nevei.

```ts
import { calculateMetric, grossMargin } from '@/calculations';

const { metric, notes } = calculateMetric(
  { grossProfit: income.lineItems.grossProfit, revenue: income.lineItems.revenue }, // kötelező
  {},                                                                                // opcionális
  grossMargin,                                                                       // képlet
  { unit: 'ratio', calculatedAt: most, period: income.period },                      // kontextus
);
```

A `toFinancialMetric('grossMargin', eredmény, időszak)` ebből a domain `FinancialMetric`-et építi; a képlet szövegét és az egységet a `definitions.ts` táblája adja. Ha valaki új mutató-azonosítót vesz fel a domainbe, a TypeScript addig hibát jelez, amíg a táblába is be nem írja.

## 7. Rétegszabály: a motor tisztaságának kikényszerítése

**Cél:** a `src/calculations` soha ne importáljon React-et, Expo-t, hálózati kódot vagy más réteget – csak a `domain`-t.
**Fájl:** `eslint.config.js` – három kiegészítés (a teljes patch):

```js
// 1) a layerZones tömbbe, a contracts-zóna után:
  {
    // PHASE 05 (D-055): a számítási motor tiszta – csak a domaint látja.
    target: './src/calculations',
    from: './src',
    except: ['./calculations', './domain'],
    message: 'A calculations csak a domaint importálhatja (tiszta képletek, ARCHITECTURE 3.).',
  },

// 2) új blokk a domain-blokk után: külső csomag tilos
  {
    files: ['src/calculations/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': ['error', { patterns: [{
        regex: '^(?!\\.{1,2}/|@/domain(?:/|$)|@/calculations(?:/|$))',
        message: 'A calculations nem importálhat külső csomagot (React, Expo, zod…) – tiszta TypeScript.',
      }] }],
    },
  },

// 3) a hálózat-tiltó blokk files listájába:
      'src/calculations/**/*.{ts,tsx}',
```

Ezen felül a `src/__tests__/calculations-purity.test.ts` minden fájlt átnéz: tiltott import, `fetch`, `Date.now`, `new Date`, `Math.random` nem lehet benne. (Azért nem a `calculations` mappában van, mert a fájlrendszert olvasó `node:fs`-t ott maga a szabály tiltaná.)

**Ellenőrzés:** `npm run lint` → hiba nélkül. Próbaként írd be egy calculations-fájl elejére: `import { View } from 'react-native';` → a lint hibát ad. (Utána töröld!)

## 8. Tesztek és lefedettség

**Hol:** a projekt gyökerében.

```bash
npm run check                      # typecheck + lint + formázás + összes teszt
npx jest src/calculations          # csak a számítási motor tesztjei
npx jest src/calculations --coverage --collectCoverageFrom='src/calculations/**/*.ts' --collectCoverageFrom='!src/calculations/**/*.test.ts'
```

**Elvárt eredmény (2026-11-22):**
- `npm run check`: exit 0, `Tests: 553 passed, 553 total` (38 suite).
- `npx jest src/calculations`: `Tests: 187 passed` (12 suite).
- Lefedettség: `All files | 99.42 | 97.91 | 100 | 99.56` (utasítás | ág | függvény | sor). A cél ≥ 90%.

**Hogyan teszteltünk?**
- Minden képletre: normál eset, **hiányzó** bemenet, **NaN/Infinity**, nullával osztás, negatív nevező, határértékek.
- Lebegőpontos összevetés `toBeCloseTo(várt, tizedesjegy)`-gyel (a `0.1 + 0.2` miatt).
- Független ellenőrzés: a jövőérték-képletet egy hónapról hónapra szimuláló ciklussal vetjük össze, nem önmagával.
- Élő API-t egyik teszt sem hív; minden szám kézzel számolt, rögzített példa.

## 9. Próbáld ki magad: saját teszt egy képletre

**Cél:** megérteni, hogyan kell egy képletet hívni és ellenőrizni.

1. Hozd létre: `src/calculations/sajat-proba.test.ts`
2. Tartalma:
   ```ts
   import { okValue } from './core/testing';
   import { priceToEarnings, realReturn } from './index';

   it('P/E: 150 / 6 = 25', () => {
     expect(okValue(priceToEarnings({ price: 150, eps: 6 }))).toBe(25);
   });

   it('negatív EPS → N/M', () => {
     expect(priceToEarnings({ price: 150, eps: -1 }).status).toBe('NOT_MEANINGFUL');
   });

   it('reálhozam: 10% nominális, 4% infláció', () => {
     expect(okValue(realReturn({ nominalReturn: 0.1, inflation: 0.04 }))).toBeCloseTo(0.0577, 4);
   });
   ```
3. Futtasd: `npx jest src/calculations/sajat-proba`
4. **Elvárt:** `Tests: 3 passed`.
5. Ha végeztél, **töröld a fájlt**, hogy ne kerüljön commitba.

## 10. Gyakori hibák és javításuk

| Tünet | Ok | Javítás |
|---|---|---|
| `INVALID_INPUT` „…tizedes törtként értendők…” | Százalékot adtál meg (pl. `7` a `0.07` helyett) | Oszd el 100-zal, vagy használd a `percentToDecimal`-t. |
| `MISSING`, pedig „van adat” | A bemenet `null`/`undefined` (pl. elírt mezőnév) | Nézd meg az indokot: megnevezi a hiányzó bemenetet. |
| `NOT_MEANINGFUL` P/E-re | Az EPS ≤ 0 | Ez szándékos: veszteséges cégre a P/E félrevezető. |
| `INVALID_INPUT` „Eltérő pénznemű…” | USD és EUR (vagy GBX és USD) bemenet keveredett | Előbb váltsd át a `convertMoney`-val (FX, PHASE 04A). |
| Teszt: `expected 0.30000000000000004 to be 0.3` | Lebegőpontos kerekítés | `toBe` helyett `toBeCloseTo(0.3, 12)`. |
| Lint: „A calculations csak a domaint importálhatja” | Más rétegből importáltál a calculations-ben | A képlet csak `@/domain`-t és saját fájlokat használhat; az adatot a hívó (use case) adja át. |
| TS-hiba a `calculateMetric` hívásnál („missing properties”) | A képlet más nevű bemenetet vár, mint amit a `required` objektumban adtál | A kulcsneveknek egyezniük kell a képlet paramétereivel (pl. `grossProfit`, `revenue`). |
| `Invalid hook call` vagy furcsa modul-hiba Windowson | Kisbetűs meghajtó-útvonal (`c:\` vs `C:\`) | Már kezelve a `jest.config.js`-ben (D-041); futtasd a gyökérből: `npx jest`. |

## 11. Befejezési feltételek

- [x] Minden képlet tiszta függvény a `src/calculations`-ben, UI- és hálózatfüggetlenül.
- [x] Minden képletre van normál és hibás bemenetes teszt (187 teszt + 29 tisztasági teszt).
- [x] N/M, MISSING, INSUFFICIENT_DATA, INVALID_INPUT helyesen; a hiányzó adat soha nem 0.
- [x] Lefedettség ≥ 90% (mért: 99,56% sor, 97,91% ág).
- [x] DATA_DICTIONARY 5. fejezet végleges, 12. fejezet új; D-055…D-058 rögzítve.
- [x] `npm run check` exit 0 (553/553).
- [ ] (Következő fázis) a képleteket egy use case használja élő/fixture adaton → **PHASE 06**.
