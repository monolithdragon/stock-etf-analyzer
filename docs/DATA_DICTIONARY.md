# Adatszótár – Stock & ETF Analyzer

> Állapot: **kiinduló definíciók** (PHASE 01) + **domain típusok a kódban** (PHASE 03, 2026-11-21). A mezők és a kód közti leképezés: [10. fejezet](#10-kód-leképezés-phase-03).
> - A képletdefiníciókat a **PHASE 05** véglegesíti, a DCF-et a **PHASE 07**, az ETF-mutatókat a **PHASE 08**, a portfóliót a **PHASE 09**.
> - Definíció csak dokumentált indokkal változtatható (DECISIONS.md-be bejegyzés kell).
> - Az XBRL tag-nevek a 4.1–4.2-ben **jelöltek** (PHASE 01). A ténylegesen használt, 12 valós cégen igazolt prioritási lista: **4.4** és `src/server/providers/sec-edgar/sec-tags.ts` (PHASE 04A).
> - PHASE 04A (2026-11-21): új fejezetek 3.3 (jegyzés-jelölt), 4.4 (SEC-normalizálás), 8. (FX, megvalósítva), 11. (API-szerződés v1).
> - PHASE 04B (2026-11-21): új fejezetek 3.4 (profil), 3.5 (keresés), 3.6 (ár, ártörténet-korrekció), 3.7 (osztalék); a 11. fejezet bővítve (új végpontok, `unavailableReason`).
> - **PHASE 05 (2026-11-22): az 5. fejezet képletdefiníciói VÉGLEGESEK** (D-056…D-058), mindegyik mellett a megvalósító függvény (`src/calculations`). Új 12. fejezet: a számítási motor konvenciói (`CalcResult`, `Metric`-adapter). A 10. fejezet bővítve.
> - **PHASE 06 (2026-11-22):** a `totalDebt` összerakva (4.2, 4.4, 5.2; D-059); `InstrumentProfile.beta` (3.4); új **13. fejezet**: a részvény fundamentális elemzés eredmény-modellje (eredet-címke, kimutatás-nézetek, Q4/TTM, időszaki mutatók, trend/CAGR, értékelés, minőségi modell; D-060…D-063).
> - **PHASE 07 (2026-11-22):** DCF véglegesítve (5.4), új 14. fejezet (értékelés és DCF kimenete).
> - **PHASE 08 (2026-11-22):** az 5.5 kockázati sorai véglegesek (D-066); a 6. fejezet a 15.-re mutat; új **15. fejezet**: ETF-elemzés (profil, kategóriák, holdings, deviza, hozam, kockázat, költség, tracking, feature-modell; D-066…D-069).

## 1. Általános konvenciók

| Téma | Konvenció | Döntés |
|---|---|---|
| Szám | JS `number` (float64). Kerekítés csak a megjelenítésnél. A tesztekben tűréssel hasonlítunk. | D-009 |
| Százalék | Belül **tizedes tört**: `0.15` = 15%. A `%` jel és a ×100 csak a formatterben. | D-009 |
| Pénzösszeg | `Money = { amount: number, currency: CurrencyCode }`, fő egységben (USD-ben, nem centben). Különböző pénznemek **soha** nem adhatók össze konverzió nélkül. | D-009, D-017 |
| Egység | Alapegység: darab, pénznem-egység. A szolgáltatói „ezerben/millióban” adatot a normalizáló átváltja. | – |
| Pénznem | ISO 4217 (`USD`, `EUR`, `HUF`, `GBP`, `CHF`, `JPY` …). A GBX/GBp (penny) jegyzést külön kell kezelni: `GBP = GBX / 100`. | D-018 |
| Dátum | Napi adat: `YYYY-MM-DD` a tőzsde helyi kereskedési napja. Időbélyeg: ISO 8601 UTC (`2026-11-21T15:04:05Z`). | D-018 |
| Időszak | `{ fiscalYear, fiscalPeriod: 'FY'\|'Q1'\|'Q2'\|'Q3'\|'Q4', start, end, durationDays }`. A periódust a **start/end dátumokból** határozzuk meg (4.3). A `durationDays` mindkét végpontot beleszámolja (2025-01-01..2025-12-31 = 365). | D-021 |
| Hiányzó metaadat | Egyszerű metaadatnál (pl. `sector`, `cik`) explicit `null`, nem üres string és nem opcionális mező. Forrásfüggő, gyakran hiányos adatnál (ETF-mezők, kimutatás-tételek) `Metric<T>` nem-OK státusszal. | D-035 |
| Azonosító-típusok | „Márkázott” (branded) típusok: `Isin`, `Mic`, `TickerSymbol`, `ListingId`, `SecurityId`, `Cik`, `PortfolioId`, `TransactionId`, `CurrencyCode`, `IsoDate`, `IsoTimestamp`. Csak a validáló `parse…` függvénnyel állíthatók elő. | D-035 |
| Előjel | Kiáramlások (CapEx, osztalékfizetés, adósságtörlesztés) **pozitív nagyságként** tárolva, a képlet vonja le őket. | – |
| Szorzó | Mértékegység nélküli szám, `x` megjelöléssel (pl. P/E `18.4x`). | – |
| Évesítés | Két dátum közti időszak: napok / 365,25 (PHASE 05). Napi hozamsor (volatilitás): 252 kereskedési nap/év `[FELTÉTELEZÉS – PHASE 08 véglegesíti]`. | D-058 |
| Lebegőpontos zaj | A motor nem kerekít. Ahol az előjel jelentést hordoz (drawdown), a ±1e-12 alatti eredmény 0. Tesztben `toBeCloseTo`. | D-009, D-058 |

## 2. Állapotok és provenance

### 2.1 `MetricStatus` – miért nincs (vagy van) érték

| Státusz | UI-jelölés | Jelentés | Példa |
|---|---|---|---|
| `OK` | érték | Érvényes, kiszámolt vagy jelentett érték | Net margin = 0.21 |
| `MISSING` | „Hiányzó adat” | A szükséges bemenet nem érkezett meg | A forrás nem adott CapEx-et |
| `NOT_APPLICABLE` | **N/A** | A mutató erre az instrumentumra nem értelmezett | P/E egy ETF-re |
| `NOT_MEANINGFUL` | **N/M** | Matematikailag számolható, de félrevezető | P/E negatív EPS mellett |
| `INSUFFICIENT_DATA` | „Kevés adat” | Nincs elég időszak vagy minta | 5 éves CAGR 3 év adattal |
| `INVALID_INPUT` | „Érvénytelen bemenet” | A bemenet validációja elbukott | DCF: diszkontráta ≤ terminális növekedés |
| `UNAVAILABLE` | „Nem elérhető” | A forrás vagy az aktuális adatcsomag ezt nem szolgáltatja. Ok-kód: `PLAN_LIMIT` (csak fizetős csomagban), `NOT_COVERED` (a piac/instrumentum nincs lefedve), `QUOTA_EXHAUSTED` (a mai keret elfogyott) | Nem US fundamentum free EODHD-vel → `PLAN_LIMIT` |
| `ERROR` | „Hiba” | Technikai hiba (hálózat, tároló) | timeout |

Szabály: a `0` csak `OK` státusszal létezhet. A `null`/`undefined` soha nem alakul `0`-vá.

Kód (PHASE 03): az `UNAVAILABLE` státusz külön, kötelező `unavailableReason` mezőben hordozza az ok-kódot (`PLAN_LIMIT` | `NOT_COVERED` | `QUOTA_EXHAUSTED`), a szöveges `reason` mellett. Nem véges szám (NaN, ±Infinity) soha nem lehet `OK`: a `metricOk()` ilyenkor `INVALID_INPUT` státuszt ad.

### 2.2 `Freshness` – mennyire friss
`FRESH` (TTL-en belül), `STALE` (TTL lejárt, de még megjeleníthető jelöléssel), `EXPIRED` (nem használható számításhoz jelölés nélkül), `UNKNOWN` (nincs időbélyeg). A TTL-ek: ARCHITECTURE 11.

Kód (PHASE 03): `assessFreshness(reference, now, { freshForMs, expiresAfterMs })`. Az életkor az `asOf`-tól számít, a saját (injektált) óránk szerint; a forrás által állított frissességet felülírjuk. **Jövőbeli** időpont → `UNKNOWN` (óraeltérés vagy hibás adat gyanúja). Árfolyamra a kiinduló szabály: 15 perc `FRESH`, 3 nap után `EXPIRED` (`QUOTE_FRESHNESS_POLICY`, `[FELTÉTELEZÉS – PHASE 13]`).

### 2.3 `ProvenanceKind` – honnan jön az érték

| Kind | Jelentés | UI-címke |
|---|---|---|
| `reported` | A forrás által jelentett érték (pl. 10-K-ban szereplő) | „Jelentett” |
| `calculated` | A saját motorunk számolta jelentett értékekből | „Számított” |
| `estimated` | Feltevésen alapuló becslés (DCF, alapértelmezett adókulcs, származtatott hiány) | „Becslés” |
| `ai_interpretation` | LLM által írt értelmezés | „AI-értelmezés” |
| `user_input` | A felhasználó adta meg (pl. kézi TER, DCF feltevés) | „Felhasználói adat” |
| `mock` | Teszt-/demóadat | „DEMO ADAT” (mindig feltűnően) |

### 2.4 `DataProvenance` mezők
`sourceId` (pl. `sec-edgar`), `sourceName`, `kind`, `fetchedAt` (UTC), `asOf` (az adat tényleges időpontja: `IsoDate | IsoTimestamp | null`; `null`, ha a forrás nem közölte), `period?`, `currency?`, `unit?` (`money` | `money_per_share` | `shares` | `ratio` | `multiple` | `count`), `freshness`, `reference?` (pl. SEC accession number, XBRL tag, filing dátum), `inputs?` (calculated-nél a felhasznált metrikák azonosítói).

### 2.5 `Metric<T>` (megvalósítva: `src/domain/shared/metric.ts`)
```ts
type Metric<T> =
  | { status: 'OK'; value: T; provenance: DataProvenance }
  | { status: 'UNAVAILABLE'; unavailableReason: UnavailableReason; reason: string; provenance?: DataProvenance }
  | { status: Exclude<MetricStatus, 'OK' | 'UNAVAILABLE'>; reason: string; provenance?: DataProvenance };
```
Konstruktorok: `metricOk`, `metricMissing`, `metricNotApplicable`, `metricNotMeaningful`, `metricInsufficientData`, `metricInvalidInput`, `metricUnavailable`, `metricError`; segédek: `isMetricOk`, `mapMetric`.

## 3. Azonosítók: Security és Listing (D-025)

Egy értékpapír (pl. egy UCITS ETF, egy ISIN) több tőzsdén és több devizában forog. Ezért két szintet különböztetünk meg:
- **Security**: maga az értékpapír. Ehhez tartozik a fundamentum és az ETF-metaadat.
- **Listing**: egy konkrét tőzsdei jegyzés. Ehhez tartozik az ár, az ártörténet és a pozíció.

> **Elnevezés a kódban (D-035):** a „Security” fogalom típusneve `Instrument` (`Instrument = Stock | Etf`, diszkriminátor: `kind`). Az azonosító mezője továbbra is `securityId`. A `Listing` neve változatlan.

### 3.1 `Security` (kódban: `Instrument`)

| Mező | Típus | Leírás |
|---|---|---|
| `securityId` | string | ISIN, ha van; egyébként forrásspecifikus azonosító, jelölve (`sourceId:code`) |
| `isin` | string? | ISO 6166 |
| `kind` | `'stock' \| 'etf'` | Diszkriminátor |
| `name`, `country` | string | `country` = székhely (részvény) vagy domicil (ETF) |
| `cik` | string? | SEC Central Index Key (10 jegyű, vezető nullákkal), csak SEC-filerekre |
| `figi` | string? | OpenFIGI (share class szintű) |
| `reportingCurrency` | CurrencyCode? | Részvénynél a pénzügyi kimutatás pénzneme |
| `sector`, `industry` | string? | A forrás besorolása (forrásonként eltérhet) |

### 3.2 `Listing`

| Mező | Típus | Leírás |
|---|---|---|
| `listingId` | string | `{symbol}@{MIC}` (pl. `AAPL@XNAS`, `VWCE@XETR`) |
| `securityId` | string | Hivatkozás a Security-re |
| `symbol` | string | Tőzsdei ticker (a szolgáltatói ticker-formátum, pl. `VWCE.XETRA`, csak az adapterben él) |
| `mic` | string | ISO 10383 tőzsdekód |
| `exchangeName` | string | |
| `tradingCurrency` | CurrencyCode | A jegyzés pénzneme (≠ a beszámoló pénzneme!). GBX → GBP konverzió explicit |
| `isPrimary` | bool? | Elsődleges listing, ha a forrás megadja |
| `figi` | string? | Listing szintű FIGI, ha elérhető |

### 3.3 `ListingCandidate` és `SecurityListings` (PHASE 04A, D-042)

Az azonosító-forrás (OpenFIGI) a jegyzés pénznemét nem közli, ezért a jegyzés-jelölt külön típus. A `Listing` szigorú marad.

| Mező | Típus | Leírás |
|---|---|---|
| `listingId` | ListingId | `{symbol}@{üzemeltetői MIC}` (pl. `VWCE@XETR`, `AAPL@XNAS`) |
| `securityId` | SecurityId | mindig az ISIN |
| `symbol`, `mic`, `exchangeName` | | a MIC az igazolt `exchCode` táblából (DATA_SOURCES 10.3) |
| `tradingCurrency` | CurrencyCode \| **null** | `null` = a forrás nem közölte (OpenFIGI); **nem találjuk ki**. Az EODHD ISIN-keresése kitölti (PHASE 04B, KI-22) |
| `figi`, `compositeFigi` | string \| null | listing- és ország-szintű FIGI |
| `kindHint` | `'stock' \| 'etf' \| null` | a forrás besorolásából (`ETP` → etf, `Common Stock` → stock) |
| `sourceName` | string \| null | a forrás (gyakran rövidített) neve, pl. „VANG FTSE AW USDA” |

`SecurityListings = { isin, securityId, listings[], omitted: { unmappedVenue, composite, invalidSymbol }, provenance }`. Az `omitted` számlálók biztosítják, hogy a kihagyott sorok ne tűnjenek el szó nélkül.

### 3.4 `InstrumentProfile` (PHASE 04B, D-054)

Lapos, forrásközeli profil egy jegyzéshez. Free csomagban **csak US** (FMP); nem US → `UNAVAILABLE / PLAN_LIMIT`. Nem `Instrument`: az ETF-metaadat (TER, AUM…) a free forrásokban nem érhető el.

| Mező | Típus | Leírás |
|---|---|---|
| `listingId` | ListingId | a kért jegyzés (az FMP `exchange` mezőjével ellenőrizve: eltérő tőzsde → `NOT_FOUND`) |
| `name` | string | kötelező |
| `kindHint` | `'stock' \| 'etf' \| null` | FMP `isEtf` → etf; `isFund` → null; egyébként stock |
| `isin`, `cik` | Isin \| null, Cik \| null | nem szabványos forrásérték → `null` (nem hibás adat a domainben) |
| `country` | string \| null | ISO 3166-1 alpha-2 |
| `sector`, `industry`, `exchangeName`, `website` | string \| null | a forrás `""`-je `null` lesz |
| `tradingCurrency` | CurrencyCode \| null | a profil-forrás szerint |
| `description` | string \| null | megbízhatatlan szöveg, legfeljebb 4000 karakter |
| `beta` | number \| null | **PHASE 06:** szolgáltatói (FMP) béta, `reported`, tájékoztató (a módszertan nem közölt); nem szám → `null`. Opcionális bemenet (a régi proxy-válasz is érvényes). Saját béta: PHASE 08 |

### 3.5 `InstrumentSearchResult` (PHASE 04B, D-054)

`{ query, hits[], omitted: { unmappedVenue, invalidSymbol, unsupportedType, truncated }, provenance }`. Egy találat (`InstrumentSearchHit`): `listingId` (a domain számolja a `symbol` + `mic` párból), `symbol`, `mic`, `name`, `kindHint`, `isin` (EODHD adja, FMP nem), `tradingCurrency` (`GBp` → `GBX`), `exchangeName`. Csak igazolt tőzsdekód → MIC találat kerül be (DATA_SOURCES 11.1–11.2); legfeljebb 100 találat, a többi a `truncated` számlálóba. Keresőkifejezés: 1–64 karakter.

### 3.6 Ár és ártörténet (PHASE 04B, D-050, D-052)

| Mező | Típus | Leírás |
|---|---|---|
| `Quote.price` | Money | a jegyzés **natív** pénznemében (pl. `GBX`); a kijelzési pénznemre váltás a `convertMoney` dolga (8.) |
| `Quote.asOf` | IsoTimestamp | az ár tényleges időpontja (FMP/EODHD Unix-időbélyegből) |
| `Quote.delayMinutes` | number \| null | `null`: egyik forrás sem ad pontos számot (EODHD: „15–20 perc”, a provenance `reference` mezője jelzi) |
| `PriceSeries.currency` | CurrencyCode | natív pénznem; forrása: helyszíni szabály (US → USD, Xetra → EUR) vagy az EODHD kereső – soha nem kitalált |
| `PriceSeries.adjustment` | `NONE \| SPLIT \| SPLIT_DIVIDEND` | `NONE` = nyers; `SPLIT` = split-korrigált, osztalék nélkül (csak FMP); `SPLIT_DIVIDEND` = split + osztalék (FMP `dividend-adjusted`, EODHD `adjusted_close`). Alapértelmezés: `SPLIT_DIVIDEND` |
| `PriceSeries.points` | `{ date, close }[]` | szigorúan növekvő dátum; `close > 0`; a hiányzó záróár kimarad (nem 0), és a `notes` jelzi |
| `PriceSeries.notes` | string[] | pl. free ablak miatti levágás, eldobott szolgáltatói figyelmeztető sor |

### 3.7 Osztalék (PHASE 04B, D-054)

`DividendHistory = { listingId, events[], notes[], provenance }`, ex-dátum szerint növekvő (azonos nap megengedett).

| Mező | Típus | Leírás |
|---|---|---|
| `exDate` | IsoDate | ex-dátum |
| `paymentDate`, `recordDate`, `declarationDate` | IsoDate \| null | Európán kívül gyakran hiányzik (EODHD) |
| `amount` | Money | részvényenként **ténylegesen fizetett, nem split-korrigált** összeg, az osztalék SAJÁT pénznemében (ISF@XLON: ár GBX, osztalék **GBP**) |
| `splitAdjustedAmount` | number \| null | ugyanabban a pénznemben |
| `frequency` | string \| null | a forrás szövege szó szerint (`Quarterly`, `Final`…) |

Szabály: 0 vagy negatív összegű sor **nem esemény** – kihagyjuk és a `notes` megszámolja (nem tároljuk 0-ként). Pénznem nélküli sor szintén kimarad. Hozamszámításhoz (PHASE 05) az osztalék és az ár pénznemét explicit egyeztetni kell.

## 4. Fundamentális mezők (jelentett, `reported`)

### 4.1 Eredménykimutatás (időszaki, „duration”)

| Mező | Definíció | Jelölt US-GAAP XBRL tag(ek) `[NEM IGAZOLT]` |
|---|---|---|
| `revenue` | Árbevétel | `Revenues`, `RevenueFromContractWithCustomerExcludingAssessedTax`, régebbi: `SalesRevenueNet` |
| `costOfRevenue` | Közvetlen költség (COGS) | `CostOfRevenue`, `CostOfGoodsAndServicesSold` |
| `grossProfit` | Bruttó eredmény (ha jelentett) | `GrossProfit` |
| `operatingIncome` | Üzemi eredmény (EBIT-közelítés) | `OperatingIncomeLoss` |
| `pretaxIncome` | Adózás előtti eredmény | `IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest` (és változatai) |
| `incomeTaxExpense` | Társasági adó | `IncomeTaxExpenseBenefit` |
| `netIncome` | Az anyavállalat részvényeseinek jutó nettó eredmény | `NetIncomeLoss` |
| `epsBasic`, `epsDiluted` | Alap és hígított EPS (jelentett, preferált) | `EarningsPerShareBasic`, `EarningsPerShareDiluted` |
| `weightedSharesDiluted` | Hígított súlyozott átlagos részvényszám | `WeightedAverageNumberOfDilutedSharesOutstanding` |
| `depreciationAmortization` | Értékcsökkenés és amortizáció (CF-ből) | `DepreciationDepletionAndAmortization`, `DepreciationAndAmortization` |
| `interestExpense` | Kamatráfordítás | `InterestExpense` |

### 4.2 Mérleg (időpontra, „instant”) és cash flow

| Mező | Definíció | Jelölt tag(ek) `[NEM IGAZOLT]` |
|---|---|---|
| `cashAndEquivalents` | Pénz és pénzeszköz-egyenérték | `CashAndCashEquivalentsAtCarryingValue` |
| `shortTermInvestments` | Rövid távú befektetések (külön, NEM része a `cash`-nek alapból) | `ShortTermInvestments`, `MarketableSecuritiesCurrent` |
| `totalDebt` | Rövid lejáratú hitelek + hosszú lejáratú adósság rövid része + hosszú lejáratú adósság. **Operatív lízing kötelezettség nélkül** az MVP-ben `[FELTÉTELEZÉS – PHASE 05]` | `ShortTermBorrowings`, `LongTermDebtCurrent`, `LongTermDebtNoncurrent`, `LongTermDebt` (dupla számolás veszélye!) |
| `totalAssets` | Összes eszköz | `Assets` |
| `totalLiabilities` | Összes kötelezettség | `Liabilities` |
| `shareholdersEquity` | Az anyavállalat saját tőkéje | `StockholdersEquity` |
| `sharesOutstanding` | Kint lévő részvények **egy adott napon** (címlap), `asOf` dátummal | `dei:EntityCommonStockSharesOutstanding` |
| `operatingCashFlow` | Működési cash flow | `NetCashProvidedByUsedInOperatingActivities` |
| `capitalExpenditure` | Tárgyi eszköz beszerzés (pozitív nagyság) | `PaymentsToAcquirePropertyPlantAndEquipment` |
| `dividendsPaid` | Fizetett osztalék (pozitív nagyság) | `PaymentsOfDividends`, `PaymentsOfDividendsCommonStock` |
| `debtRepayment` | Adósságtörlesztés (pozitív nagyság) | `RepaymentsOfLongTermDebt` (és változatai) |

### 4.3 Időszak-, restatement- és split-szabályok (D-021)

1. **Az időszakot a fact `start`/`end` dátumaiból határozzuk meg**, nem a filing `fy`/`fp` mezőjéből. Egy 10-K az előző évek összehasonlító adatait is tartalmazza a saját `fy` értékével. `[FELTÉTELEZÉS – fixture-rel igazolandó]`
2. Időszaki adat (`duration`): FY ≈ 350–380 nap, negyedév ≈ **80–100** nap. (A PHASE 01-es 85–95 nap kizárta volna a 14 hetes, 98 napos negyedévet, ami 53 hetes üzleti évben előfordul, ezért módosítottuk: D-037.) Időpontra szóló adat (`instant`): mérlegtétel; a kódban a mérleg tételei a `period.end` napra vonatkoznak.
3. **Restatement:** ha egy időszakra több filingből több érték van, a **legkésőbb beadott** filing értéke számít. A provenance-ben szerepel a filing dátuma és az accession number.
4. **Q4 származtatás:** a 10-K nem ad külön Q4-et. Időszaki tételnél `Q4 = FY − (Q1+Q2+Q3)`, ha mind a négy azonos konvenció szerinti. Ez `calculated`, és csak időszaki tételre érvényes; mérlegtételre nem.
5. **TTM** (utolsó 12 hónap): az utolsó 4 egymást követő negyedév összege (időszaki tételnél). Ha nincs meg mind a négy: `INSUFFICIENT_DATA`. Mérlegtételnél a legutolsó instant érték.
6. **Részvényfelosztás:** részvényenkénti adat (EPS, DPS) és részvényszám csak **azonos split-bázison** hasonlítható össze. Forrás: a legutolsó filing (amely visszamenőleg korrigál), vagy a split-események alapján korrigálunk. Ha nem biztosítható: `NOT_MEANINGFUL` + magyarázat.
7. **Eltérő pénzügyi év vége:** a `fiscalYear` a FY záródátumának éve. Cégek közti összehasonlításnál jelezni kell az eltérő záródátumot.
8. **Beszámoló ≠ jegyzési pénznem** (pl. ADR): árfolyam alapú szorzónál (P/E, P/S, EV/…) a beszámolói értéket FX-szel a jegyzési pénznemre váltjuk, az FX dátumát és forrását rögzítjük. FX hiányában `MISSING`.

### 4.4 SEC companyfacts normalizálás (megvalósítva, PHASE 04A, D-043)

Kód: `src/server/providers/sec-edgar/sec-normalizer.ts`. Kimenet: `FinancialStatementSet` (időszakonként income + balance + cashflow kimutatás, egy forrásból).

| Lépés | Szabály | Miért (valós lelet) |
|---|---|---|
| Pénznem | a pénzösszeg-tények leggyakoribb egysége; eltérő pénznemű tény kimarad | TSM: TWD és USD is van, az USD csak kényelmi átszámítás |
| Időszak | `start`/`end`; FY 350–380, Q 80–100 nap (D-037) | a 10-Q 6/9 hónapos YTD tényei kiesnek |
| Címke | a SAJÁT filing (`end` = a filing legkésőbbi dátuma) `fy`/`fp`-je | összehasonlító adatnál a `fy` a beadó filing éve (AAPL 2023 → `fy: 2026`) |
| Címke-tartalék | évnél a záródátum éve (jan. 1–7. → előző év) `[FELTÉTELEZÉS]`; negyedévnél kihagyás + megjegyzés | a megvágott fixture legrégebbi évei csak összehasonlító adatként szerepelnek |
| Érték | prioritási lista első tagje, amelynek pontos ténye van; azon belül a legkésőbb beadott | restatement (4.3/3); a provenance `reference`: `tag accn form filed` |
| Részvényszám | `CommonStockSharesOutstanding` az időszak végén; tartalék: a SAJÁT filing címlapja (dei), `asOf` = címlap dátuma | JNJ: nincs `CommonStockSharesOutstanding`; egy későbbi 10-Q címlapja hibás napot adott volna |
| Kiáramlás < 0 | `INVALID_INPUT` | nem fordítunk előjelet csendben |
| Hiány | `MISSING`, a keresett tagek felsorolásával; **soha nem 0** | BRK-B EPS, JPM negyedéves árbevétel |
| `totalDebt` | **PHASE 06 (D-059):** `nem rövid rész + rövid rész`, lejárat szerinti bontásból (`sec-debt.ts`); `calculated`, vagy `estimated`, ha egy rövid lejáratú komponensnek nincs ténye (0-nak véve, megnevezve); nem rövid rész nélkül `MISSING` | a `LongTermDebt` már tartalmazza a rövid részt; a JNJ `ShortTermBorrowings`-a ≈ `DebtCurrent` → a naiv összeadás dupla számolás |
| Nincs adat | üres készlet + megjegyzés | XOM új CIK (nincs még 10-K); TSM negyedéves (20-F filer) |
| Méret | max. 15 év / 20 negyedév | válaszméret |

**Használt tag-prioritás** (`us-gaap` → `ifrs-full`; teljes lista: `sec-tags.ts`):

| Tétel | Tagek sorrendben |
|---|---|
| `revenue` | `Revenues`, `RevenueFromContractWithCustomerExcludingAssessedTax`, `SalesRevenueNet`, `RevenueFromContractWithCustomerIncludingAssessedTax`, `ifrs:Revenue` |
| `costOfRevenue` | `CostOfRevenue`, `CostOfGoodsAndServicesSold`, `ifrs:CostOfSales` |
| `pretaxIncome` | `…BeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest`, `…BeforeIncomeTaxesMinorityInterestAndIncomeLossFromEquityMethodInvestments`, `ifrs:ProfitLossBeforeTax` (a `…Domestic` NEM: csak belföldi rész) |
| `netIncome` | `NetIncomeLoss`, `ifrs:ProfitLossAttributableToOwnersOfParent` |
| `depreciationAmortization` | `DepreciationDepletionAndAmortization`, `DepreciationAndAmortization`, `DepreciationAmortizationAndAccretionNet`, `ifrs:DepreciationAndAmortisationExpense` |
| `capitalExpenditure` | `PaymentsToAcquirePropertyPlantAndEquipment`, `PaymentsToAcquireProductiveAssets`, `ifrs:PurchaseOfPropertyPlantAndEquipment…` |
| `dividendsPaid` | `PaymentsOfDividends`, `PaymentsOfDividendsCommonStock`, `ifrs:DividendsPaidClassifiedAsFinancingActivities` |
| `debtRepayment` | `RepaymentsOfLongTermDebt`, `RepaymentsOfDebt`, `ifrs:RepaymentsOfBorrowings…` |

**`totalDebt` komponensei (D-059, `SEC_DEBT_COMPONENT_TAGS`):** nem rövid rész: `LongTermDebtNoncurrent` → `LongTermDebtAndCapitalLeaseObligations` (lízinggel együtt, megjegyzés); rövid rész: `DebtCurrent`, vagy `LongTermDebtCurrent` / `LongTermDebtAndCapitalLeaseObligationsCurrent` + (`ShortTermBorrowings`, vagy `CommercialPaper` + `OtherShortTermBorrowings`). IFRS-tagek szándékosan nincsenek.

**Ismert korlátok:** negyedéves Q2/Q3 cash flow hiányzik (a 10-Q YTD-t ad; a különbségképzés a normalizáló bővítését igényli – KI-18, nyitott). A Q4-et a PHASE 06 elemző rétege származtatja (13.3), nem a normalizáló. Részletek: KNOWN_ISSUES KI-18…KI-20.

## 5. Számított mutatók (`calculated`) – VÉGLEGES (PHASE 05, D-055…D-058)

> Kód: `src/calculations/` (`@/calculations`). Minden képlet tiszta függvény, a bemenete nevesített objektum (`number | null`; `null` = **hiányzó**, `0` = **tényleges nulla**), a kimenete `CalcResult` (12. fejezet). A `Metric<number>` bemenetekre a `calculateMetric` emeli (12.3).
> Közös szabályok: minden pénzösszeg ugyanabban a pénznemben és egységben érkezik (a hívó biztosítja; a `Metric`-adapter ellenőrzi). Arány, hozam és ráta **tizedes tört**. A motor nem kerekít. A „Hiány” oszlop minden sorra igaz: hiányzó kötelező bemenet → `MISSING` (a bemenet nevével), nem véges szám (NaN, ±Infinity) → `INVALID_INPUT`.
> Jelölés: `Δ` = előző időszakhoz képest; „avg” = a nyitó és a záró érték átlaga (nyitó hiányában a záró, megjegyzéssel).

### 5.1 Jövedelmezőség és növekedés

| Mutató | Függvény | Képlet | Egység | Érvénytelen / speciális eset |
|---|---|---|---|---|
| Gross Profit | `grossProfit` | `revenue − costOfRevenue` (a jelentett `grossProfit` elsőbbséget élvez: `preferReported`) | pénz | COGS < 0 → `INVALID_INPUT` |
| Gross Margin | `grossMargin` | `grossProfit / revenue` | tört | `revenue ≤ 0` → `NOT_MEANINGFUL` |
| Operating Income | (jelentett) / `operatingIncome` | jelentett US GAAP `OperatingIncomeLoss`; saját: `grossProfit − operatingExpenses`. **Nem** „NI + kamat + adó” EBIT (D-056/3) | pénz | működési költség < 0 → `INVALID_INPUT` |
| Operating Margin | `operatingMargin` | `operatingIncome / revenue` | tört | `revenue ≤ 0` → `NOT_MEANINGFUL` |
| Net Margin | `netMargin` | `netIncome / revenue` | tört | `revenue ≤ 0` → `NOT_MEANINGFUL` |
| EPS | `selectEps`, `calculateEps` | 1) jelentett `epsDiluted` → 2) jelentett `epsBasic` (megjegyzés) → 3) `netIncome / weightedSharesDiluted` (megjegyzés: elsőbbségi osztalék levonása nélkül). Kimenet: `{ eps, basis }` | pénz/részvény | részvényszám ≤ 0 → `INVALID_INPUT`; negatív EPS `OK` |
| Növekedés (revenue, NI, EPS) | `growthRate` | `(X_t − X_{t−1}) / X_{t−1}` | tört | `X_{t−1} = 0` vagy `< 0` → `NOT_MEANINGFUL` (nincs abszolútérték-trükk); pozitívból negatívba `OK` (pl. −150%) |
| CAGR | `cagr`, `cagrOverYears` | `(X_end / X_start)^(1/évek) − 1`; idősorból: utolsó év és az N évvel korábbi év | tört | végpont ≤ 0 → `NOT_MEANINGFUL`; évek ≤ 0 → `INVALID_INPUT`; hiányzó végpont-év → `INSUFFICIENT_DATA`; ismétlődő év → `INVALID_INPUT` |
| Effective tax rate | `effectiveTaxRate` | `incomeTaxExpense / pretaxIncome` | tört | `pretaxIncome ≤ 0` vagy eredmény ∉ [0, 1] → `NOT_MEANINGFUL` |
| NOPAT-kulcs | `resolveNopatTaxRate` | az effektív kulcs, ha `OK`; különben a hívó **explicit** tartalék kulcsa (`basis: 'fallback'`, az eredmény `estimated`) | tört | tartalék ∉ [0, 1] → `INVALID_INPUT`; tartalék nélkül az effektív hiba megy tovább |
| NOPAT | `nopat` | `operatingIncome × (1 − taxRate)` | pénz | `taxRate ∉ [0, 1]` → `INVALID_INPUT` (pl. 21 a 0.21 helyett) |
| Invested Capital | `investedCapital` | `shareholdersEquity + totalDebt − cashAndEquivalents` (lízing, kisebbségi részesedés nélkül) | pénz | adósság vagy pénz < 0 → `INVALID_INPUT`; az eredmény lehet ≤ 0 |
| ROE | `roe` | `netIncome / avg(shareholdersEquity)` | tört | **bármelyik** felhasznált saját tőke ≤ 0 → `NOT_MEANINGFUL` |
| ROA | `roa` | `netIncome / avg(totalAssets)` | tört | eszköz ≤ 0 → `INVALID_INPUT` (adathiba) |
| ROIC | `roic` | `NOPAT / avg(investedCapital)` | tört | bármelyik IC ≤ 0 → `NOT_MEANINGFUL` |
| DOL | `degreeOfOperatingLeverage` | `%Δ operatingIncome / %Δ revenue` (két egymást követő időszak) | x | bázis ≤ 0 → `NOT_MEANINGFUL`; \|%Δ revenue\| < 1% → `NOT_MEANINGFUL` |

### 5.2 Mérleg és cash flow

| Mutató | Függvény | Képlet | Érvénytelen / speciális eset |
|---|---|---|---|
| Net Debt | `netDebt` | `totalDebt − cashAndEquivalents` (negatív = nettó készpénz; a `cash` rövid távú befektetések nélkül) | adósság vagy pénz < 0 → `INVALID_INPUT` |
| Net Cash | `netCash` | `cashAndEquivalents − totalDebt` | ua. |
| Debt/Equity | `debtToEquity` | `totalDebt / shareholdersEquity` (x) | equity ≤ 0 → `NOT_MEANINGFUL` |
| FCF | `freeCashFlow` | `operatingCashFlow − capitalExpenditure` | CapEx < 0 → `INVALID_INPUT`; negatív FCF `OK`. Nem tiszta FCFF (D-022) |
| FCF Margin | `fcfMargin` | `FCF / revenue` | `revenue ≤ 0` → `NOT_MEANINGFUL` |
| FCF Conversion | `fcfConversion` | `FCF / netIncome` (1.0 = a nyereség 100%-a pénzben) | `netIncome ≤ 0` → `NOT_MEANINGFUL` |
| FCF after Dividend | `fcfAfterDividend` | `FCF − dividendsPaid` | hiányzó osztalék → `MISSING`; jelentett 0 → `OK`; osztalék < 0 → `INVALID_INPUT` |
| FCF after Dividend & Debt Repayment | `fcfAfterDividendAndDebtRepayment` | `FCF − dividendsPaid − debtRepayment` | ua. |
| EBITDA (számított) | `ebitda` | `operatingIncome + depreciationAmortization` | D&A < 0 → `INVALID_INPUT`; eltérhet a szolgáltató EBITDA-jától |

> **`totalDebt` (PHASE 06, D-059):** a SEC-adapter összerakja (4.4). Becsült (`estimated`) adósságnál a nettó adósság, az EV, a D/E és a ROIC is `estimated` eredetű; bankoknál, biztosítóknál és IFRS-filereknél `MISSING` marad.

### 5.3 Piaci és értékelési mutatók

| Mutató | Függvény | Képlet | Érvénytelen / speciális eset |
|---|---|---|---|
| Market Cap | `marketCap` | `price × sharesOutstanding` | ár vagy részvényszám ≤ 0 → `INVALID_INPUT`; eltérő `priceAsOf`/`sharesAsOf` → `OK` + megjegyzés (napok száma) |
| Enterprise Value | `enterpriseValue` | `marketCap + totalDebt − cashAndEquivalents` (kisebbségi részesedés, elsőbbségi részvény, lízing nélkül) | piaci érték ≤ 0 → `INVALID_INPUT`; negatív EV `OK` |
| P/E | `priceToEarnings` | `price / eps` (TTM vagy utolsó FY – a hívó címkézi) | EPS ≤ 0 → **`NOT_MEANINGFUL`**; ár ≤ 0 → `INVALID_INPUT` |
| Forward P/E (PHASE 07, D-065) | `priceToEarnings` | `price / forwardEps` – **csak forrásolt elemzői EPS-előrejelzésből** | forrás nélkül `MISSING` indokkal (ma mindig); saját becslés nincs; forward EPS ≤ 0 → `NOT_MEANINGFUL` |
| P/FCF | `priceToFreeCashFlow` | `marketCap / FCF` | FCF ≤ 0 → `NOT_MEANINGFUL` |
| P/S | `priceToSales` | `marketCap / revenue` | revenue ≤ 0 → `NOT_MEANINGFUL` |
| P/B | `priceToBook` | `marketCap / shareholdersEquity` | equity ≤ 0 → `NOT_MEANINGFUL` |
| EV/EBITDA | `evToEbitda` | `EV / EBITDA` | EBITDA ≤ 0 vagy EV ≤ 0 → `NOT_MEANINGFUL` |
| PEG | `pegRatio` | `P/E / (epsGrowth × 100)`; a növekedés **tizedes tört** (0.10 → P/E 20 mellett PEG 2.0) | növekedés ≤ 0 vagy P/E ≤ 0 → `NOT_MEANINGFUL` |
| Dividend Yield | `dividendYield`, `dividendYieldFromMoney` | `TTM részvényenkénti osztalék / price` | hiány → `MISSING` (nem 0!); jelentett 0 → `OK` 0; GBX ár + GBP osztalék → fő egységre váltva; más eltérő pénznem → `INVALID_INPUT` (FX kell) |
| TTM osztalék/részvény | `trailingDividendPerShare` | ex-dátum ∈ `(asOf − 365 nap, asOf]`; a split-korrigált összeg az elsődleges (hiányában nyers + megjegyzés); fő pénznemben | lefedettség az ablaknál később kezdődik → `INSUFFICIENT_DATA`; nincs esemény + ismeretlen lefedettség → `MISSING`; ismert lefedettség → `OK` 0; vegyes pénznem → `INVALID_INPUT` |
| FCF Yield | `fcfYield` | `FCF / marketCap` | negatív FCF → negatív hozam, `OK`; piaci érték ≤ 0 → `INVALID_INPUT` |
| Margin of Safety | `marginOfSafety` | `(intrinsicValue − price) / intrinsicValue` (negatív = drágább a belső értéknél) | `intrinsicValue ≤ 0` vagy ár ≤ 0 → `INVALID_INPUT` (a DCF-modul az IV ≤ 0 esetet előtte `NOT_MEANINGFUL`-ként kezeli, D-064/5) |
| Real Return | `realReturn` | `(1 + nominal) / (1 + inflation) − 1` (pontos Fisher) | `inflation ≤ −1` vagy `nominal < −1` → `INVALID_INPUT` |
| Árváltozás EPS × P/E | `priceChangeFromEpsAndMultiple` | `(1 + g_EPS)(1 + Δ_P/E) − 1` (pl. +10% és −10% → −1%) | bármelyik ≤ −1 → `INVALID_INPUT` |
| Múltbeli árfelbontás | `decomposePriceReturn` | `priceReturn = epsGrowth + multipleChange + epsGrowth × multipleChange` | EPS ≤ 0 → `NOT_MEANINGFUL` |
| Évesített P/E-változás | `annualizedMultipleChange` | `(PE_end / PE_start)^(1/évek) − 1` | P/E ≤ 0 → `NOT_MEANINGFUL` |
| Elvárt hozam (mentális modell) | `expectedReturnBreakdown` | `osztalékhozam + (1 + EPS-növekedés)(1 + évesített P/E-változás) − 1` – **becslés, nem előrejelzés** (a megjegyzés kimondja) | osztalékhozam < 0 vagy növekedés ≤ −1 → `INVALID_INPUT` |

### 5.4 DCF – VÉGLEGES (PHASE 07, D-064; közös konvenciók: D-057, D-022)

> Kód: `src/calculations/valuation/dcf.ts` (`runDcf`), `dcf-scenarios.ts` (`runDcfScenarios`, `dcfSensitivityTable`, `sensitivityAxis`), `dcf-conventions.ts` (PHASE 05: `discountFactor`, `presentValue`, `gordonTerminalValue`, `checkDiscountRate`).

**Bemenet (`DcfInput`)** – minden pénzösszeg ugyanabban a pénznemben, minden ráta tizedes tört:

| Mező | Jelentés | Érvénytelen / speciális eset |
|---|---|---|
| `baseFcf` | kiinduló (0. évi) FCF | hiány → `MISSING`; **≤ 0 → `NOT_MEANINGFUL`** (csak felhasználói, normalizált felülírással fut) |
| `growthRates[]` | éves FCF-növekedés az explicit évekre; a hossz = időtáv (**alapeset 5**, 1–10, a 3 tesztelt) | hossz ∉ [1, 10] → `INVALID_INPUT`; elem hiány → `MISSING` (`growthRate_k`); `≤ −1` vagy `> 1` → `INVALID_INPUT` (százalék-tipp) |
| `discountRate` (r) | diszkontráta (felhasználói feltevés; nincs WACC/CAPM) | `∉ (0, 1]` → `INVALID_INPUT` |
| `terminalGrowth` (g) | terminális növekedés | `≤ −1` → `INVALID_INPUT`; **`r ≤ g` → `INVALID_INPUT` emberi magyarázattal** |
| `totalDebt`, `cash` | EV → equity híd | hiány → `MISSING` („a hiány nem 0”); `< 0` → `INVALID_INPUT` |
| `sharesOutstanding` | kint lévő részvények | hiány → `MISSING`; `≤ 0` → `INVALID_INPUT` |
| `marketPrice` (opcionális) | azonos pénznemű ár a MOS-hoz | hiány → csak a MOS `MISSING` |

Ellenőrzési sorrend: időtáv → hiány / nem véges → ráták → `r > g` → mérlegtételek → részvényszám → kiinduló FCF.

**Képletek és kimenet (`DcfResult`):**

| Mező | Képlet |
|---|---|
| `years[t]` | `fcf_t = fcf_{t−1} × (1 + g_t)`; `discountFactor_t = 1 / (1 + r)^t`; `presentValue_t = fcf_t × discountFactor_t` (év végi, `t = 1..n`) |
| `sumPvExplicit` | `Σ presentValue_t` |
| `terminalValue` | `fcf_n × (1 + g) / (r − g)` (az n. év végére) |
| `pvTerminalValue` | `terminalValue / (1 + r)^n` |
| `terminalValueShare` | `pvTerminalValue / enterpriseValue` |
| `enterpriseValue` | `sumPvExplicit + pvTerminalValue` |
| `equityValue` | `enterpriseValue − totalDebt + cash` (lehet ≤ 0 → megjegyzés) |
| `intrinsicValuePerShare` | `equityValue / sharesOutstanding` |
| `marginOfSafety` | külön `CalcResult`: `(IV − ár) / IV`; IV ≤ 0 → `NOT_MEANINGFUL`; nincs ár → `MISSING`; ár ≤ 0 vagy nem véges → `INVALID_INPUT` |

Megjegyzések (`notes`, nem érvénytelenítenek): TV-arány > 75%; `g > 4%`; `r − g < 2 pp`; equity ≤ 0. Küszöbök: `DCF_NOTE_THRESHOLDS`.

**Forgatókönyvek:** `runDcfScenarios(company, { bear, base, bull })` – mindhárom `runDcf` ugyanazokkal a cégadatokkal; a feltevések a kimenetben; nem monoton Bear ≤ Base ≤ Bull → megjegyzés; részleges hiba → megjegyzés.

**Szenzitivitási tábla:** `dcfSensitivityTable({ base, discountRates, terminalGrowthRates })` – sor = r, oszlop = g; **minden cella `runDcf({ ...base, discountRate, terminalGrowth })`** belső érték/részvény eredménye vagy nem-OK státusza (pl. `r ≤ g`). Tengely: 1–11 véges, egyedi érték, különben a tábla `INVALID_INPUT`. `sensitivityAxis(center, step, n)` szimmetrikus tengelyt ad (a lebegőpontos zaj levágva).

- **Ismert egyszerűsítés:** az FCF (`OCF − CapEx`) US GAAP szerint a kamat után értendő, tehát nem tiszta FCFF; EV-ként kezelve torzíthat (D-022). Az EV → equity híd kisebbségi részesedés, elsőbbségi részvény és lízing nélkül (KI-44). A részvényszám nem hígított.

### 5.5 Hozam, kockázat, ETF, portfólió

| Mutató | Függvény | Képlet | Megjegyzés / érvénytelen eset |
|---|---|---|---|
| Egyszerű hozam | `simpleReturn` | `P_t / P_{t−1} − 1` | nyitó ≤ 0 vagy záró < 0 → `INVALID_INPUT` |
| Hozam ártörténetből | `seriesReturn` | első és utolsó záróár; `basis`: `SPLIT_DIVIDEND` → `total_return`, `SPLIT` → `price_return`, `NONE` → `raw_price_return` (split-figyelmeztetés) | < 2 pont → `INSUFFICIENT_DATA` |
| Total return árakból | `totalReturnFromPrices` | `(P_end + osztalék/részvény) / P_start − 1`, **újrabefektetés nélkül** (megjegyzés) | hiányzó osztalék → `MISSING` (árhozamhoz a `simpleReturn` való) |
| Évek két dátum között | `yearsBetween` | `napok / 365.25` (`DAYS_PER_YEAR`) | záró ≤ nyitó → `INVALID_INPUT` |
| Évesített hozam | `annualizeReturn` | `(1 + R)^(1/évek) − 1` | R < −1 vagy évek ≤ 0 → `INVALID_INPUT`; < 1 év → `OK` + figyelmeztetés |
| Drawdown | `drawdownSeries`, `maxDrawdown` | `DD_t = P_t / max(P_0..P_t) − 1` (≤ 0); Max DD = min(DD_t) + csúcs, mélypont és helyreállás dátuma (`recoveryDate: null`, ha még nincs) | < 2 pont → `INSUFFICIENT_DATA`; ár ≤ 0 → `INVALID_INPUT`; ±1e-12 alatti zaj → 0 |
| Szükséges recovery | `requiredRecovery` | `1 / (1 + DD) − 1` (pl. −50% → +100%) | DD > 0 → `INVALID_INPUT`; DD ≤ −1 → `NOT_MEANINGFUL` |
| Periódushozamok | `periodicReturns` | `r_t = P_t / P_{t−1} − 1` (egyszerű, nem log) | < 2 ár → `INSUFFICIENT_DATA`; ár ≤ 0 → `INVALID_INPUT` |
| Dátum-igazítás | `alignByDate` | két sor közös dátumai (metszet) | eltérő ünnepnapok kimaradnak |
| Évesített volatilitás | `annualizedVolatility` | `stdev(napi egyszerű hozam, minta) × √252` (`TRADING_DAYS_PER_YEAR`, D-066) | < `minObservations` → `INSUFFICIENT_DATA` (alkalmazás: 126) |
| Downside deviation | `downsideDeviation` | `√(Σ min(0, r_t − MAR_p)² / N) × √m`, N = összes megfigyelés, `MAR_p = (1 + MAR)^(1/m) − 1` | MAR ≤ −1 → `INVALID_INPUT` |
| Sharpe / Sortino | `sharpeRatio`, `sortinoRatio` | `(évesített hozam − rf) / volatilitás`; Sortino: `/ downside deviation` | az `rf` felhasználói beállítás (hiány → `MISSING`); kockázat = 0 → `NOT_MEANINGFUL` |
| Béta | `beta` | `cov_minta(r_a, r_b) / var_minta(r_b)` + korreláció | eltérő hossz → `INVALID_INPUT`; var_b = 0 → `NOT_MEANINGFUL` |
| Top N súly | `topNWeight` | a legnagyobb N pozitív súly összege | részleges lista < N → `INSUFFICIENT_DATA` (15.4) |
| Koncentráció | `holdingsConcentration` | HHI = Σ (wᵢ/Σw⁺)²; effektív N = 1/HHI | csak teljes lista |
| Kitettség-bontás | `exposureBreakdown` | Σ súly kulcsonként + `unclassifiedWeight` + `uncoveredWeight` | üres → `INSUFFICIENT_DATA` |
| Régió | `deriveRegion` | domináns ≥ 80%; `GLOBAL`: USA ≥ 5% és ≥ 3 régió ≥ 5% (D-067) | ismert súly < 50% → `INSUFFICIENT_DATA` |
| Devizakockázat | `currencyRisk` | fedezetlen idegen mögöttes kitettség aránya (D-068) | nincs ismert kitettség → `INSUFFICIENT_DATA` |
| TER költség | `annualTerCost` | `befektetett összeg × TER` / év | TER ∉ [0, 0.10] → `INVALID_INPUT` (pl. 0.22 = 22%!) |
| TER hosszú távú hatás | `terLongTermImpact` | FV `P(1 + r − TER)^n` vs `P(1 + r)^n`; kimenet: mindkét FV, `costAmount`, `costShare` | közelítés: a `(1 + r)(1 − TER)` alaktól `r × TER` nagyságrendben tér el; `1 + r − TER ≤ 0` → `INVALID_INPUT` |
| Tracking difference | `trackingDifference` | `ETF total return − index total return`, azonos időszakra | hozam < −1 → `INVALID_INPUT`; indexadat kell |
| Tracking error | `trackingError` | `minta stdev(ETF_t − index_t) × √periodsPerYear` (a hívó adja: 252 / 52 / 12) | eltérő hossz → `INVALID_INPUT`; < 2 periódus → `INSUFFICIENT_DATA` |
| Rendszeres befizetés FV | `futureValueOfContributions` | `i = (1 + r_éves)^(1/m) − 1` (effektív, m = 12 alapból); időszak **végén**: `PMT × ((1+i)^n − 1) / i`; időszak **elején**: `× (1 + i)`; `i = 0` → `PMT × n`; + `PV × (1+i)^n` | `n = évek × m` nem egész → `INVALID_INPUT`; `r ∉ (−1, 1]` → `INVALID_INPUT` (százalék-hiba) |
| Portfóliósúly | `portfolioWeights` | `pozícióérték (kijelzési pénznemben) / árazott összérték` | ár nélküli pozíció az `unpriced` listába, **nem 0 súllyal**; eltérő pénznem → `INVALID_INPUT`; negatív érték → `INVALID_INPUT` |
| Súlyozott hozam | `weightedReturn` | `Σ w_i × r_i` | Σw ≠ 1 (±1e-6) → `INVALID_INPUT` (≈100 → „százalék?” tipp); hiányzó hozam → `MISSING` |

## 6. ETF-mezők

`issuer`, `isin`, `domicile`, `ter` (tört, pl. 0.0007), `aum` (Money + asOf), `inceptionDate`, `replication` (`physical_full` \| `physical_sampling` \| `synthetic`), `benchmark`, `distribution` (`accumulating` \| `distributing`), `ucits` (bool?), `currencyHedged` (bool?), `tradingCurrency`, `holdings[]` (`{ name, isin?, weight, country?, sector? }` + `holdingsAsOf`), `holdingsCount`, `topNWeight`. Minden mező `Metric<T>`, mert a forrás gyakran hiányos. Kézi bevitel esetén `user_input`.

**PHASE 08:** a megvalósított, végleges modell és a mutatók a **[15. fejezetben](#15-etf-elemzés-phase-08-d-066d-069)** vannak (`EtfProfile`, `EtfHoldingsSnapshot`, `EtfClassification`, `EtfAnalysis`). A `domain/instrument` `Etf` entitás az értékpapír-szintű metaadat; az `EtfProfile` a jegyzés-szintű elemzési bemenet.

## 7. Portfólió-mezők

| Entitás | Mezők |
|---|---|
| `Portfolio` | `id`, `name`, `baseCurrency` (kijelzési), `createdAt` |
| `Transaction` | Diszkriminált unió a `type` szerint (PHASE 03). Közös: `id`, `portfolioId`, `listingId` (D-025: a konkrét tőzsdei jegyzés), `tradeDate` (nem lehet jövőbeli a felhasználó helyi napja szerint), `note` (≤ 500 karakter vagy `null`), `fxRateToBase` (`FxRate` dátummal és forrással, vagy `null`). **`BUY` / `SELL`:** `quantity` (> 0, tört megengedett), `price` (Money, > 0), `fees` (Money, ≥ 0; pénzneme eltérhet az árétól). **`DIVIDEND` / `FEE`:** `amount` (Money, > 0). **`SPLIT`:** `ratioFrom`, `ratioTo` (> 0, nem egyenlők; pl. 1 → 4). Az „eladás ≤ birtokolt mennyiség” szabály pozíciót igényel → PHASE 09. |
| `Position` (származtatott) | `listingId`, `quantity`, `averageCost` (Money, instrumentum pénznemben), `costBasis`, `marketValue` (Metric), `unrealizedPL`, `realizedPL`, `weight` |

- **P/L két nézetben:** (a) instrumentum pénznemében, FX-hatás nélkül; (b) kijelzési pénznemben = jelenlegi érték mai FX-szel − bekerülés tranzakciós napi FX-szel (FX-hatással). Mindkettő megjeleníthető, és jelölve van.
- **Könyvelési módszer:** átlagár (MVP, D-012). FIFO később. Adózási célra nem alkalmas (ezt jelezni kell).

## 8. FX-mezők

`FxRate = { base, quote, rate, asOf (dátum), source ('ecb'), fetchedAt, kind: 'reported' }`. Keresztárfolyam EUR-on át számolva: `HUF/USD = (EUR/USD) / (EUR/HUF)` → `calculated`. Hétvégén/ünnepnapon az utolsó elérhető ECB nap rátája érvényes, az `asOf` jelzi.

**Megvalósítás (PHASE 04A, D-046):**

| Fogalom | Definíció |
|---|---|
| `FxRate` | 1 `base` = `rate` `quote`; `provenance` (ECB: `sourceId: 'ecb-fx'`, `kind: 'reported'`, `asOf` = ECB-nap) |
| `FxRateSet` | egy lekérés rátái, mind ugyanabból a pivotból (EUR); `missing[]` = kért, de a forrásban nem szereplő devizák (nincs ráta, nem 0) |
| Ráta-levezetés (`deriveFxRate`) | 1) közvetlen (`reported`); 2) inverz `1/r` (`calculated`, képlet: `1 / (to→from)`); 3) kereszt `r(EUR→to) / r(EUR→from)` (`calculated`, `inputs: ['EUR/USD@2026-11-20', …]`); eltérő dátumoknál a **régebbi** az `asOf`; különben `MISSING_DATA` |
| `FxConversion` | `original` (natív összeg, változatlan), `converted` (kijelzési összeg), `rate` (vagy `null`, ha nem kellett átváltani), `minorUnitDivisor` (GBX: 100) |
| Penny | `GBX` → GBP: `/100` explicit; a `GBp` bemenet `GBX`-re normalizálódik (nem `GBP`-re) |
| Kijelzési pénznemek | `DISPLAY_CURRENCIES = HUF, EUR, USD, GBP, CHF, JPY` |
| Frissesség (`FX_FRESHNESS_POLICY`) | ≤ 4 nap FRESH, ≤ 10 nap STALE (átvált, jelölve), utána EXPIRED → hiba `[FELTÉTELEZÉS – PHASE 13]` |
| Demó | demóból számolt ráta `kind: 'mock'` marad |

Példa (valós ECB 2026-11-20, számítással ellenőrizve): 100 USD → HUF = 100 / 1,099 × 373,55 = **33 989,99 HUF**; a `rate` = 339,8999… (USD→HUF, `calculated`), `asOf: 2026-11-20`. (Ugyanezt a képletet teszteli a `proxy-integration.test.ts`.)

## 9. Elemzési és AI-mezők (kiinduló)

| Entitás | Mezők |
|---|---|
| `ScoreBreakdown` | `category`, `score` (Metric), `weight`, `appliedMetrics[]`, `rule`, `missingInputs[]`, `dataQuality`, `freshness` |
| `Decision` | `label` (konfigurálható: Strong Buy … Strong Sell / Watch / Insufficient Data), `drivers[]`, `thesisRisks[]`, `invalidationConditions[]`, `confidence` (AnalysisConfidence = adatteljesség, NEM valószínűség) |
| `AiInputDto` | csak számított metrikák (érték + státusz + provenance kivonat), feltevések, score, döntés, időbélyegek. **Nincs** benne szabad szöveg a felhasználótól; a szolgáltatói szöveg hosszkorlátos |
| `AnalysisResult` (PHASE 03 váz) | `subject` (`stock`/`etf`: `securityId` + `listingId`; `portfolio`: `portfolioId`), `generatedAt`, `metrics[]` (`FinancialMetric`), `completeness` (`COMPLETE` \| `PARTIAL` \| `INSUFFICIENT` – adatteljesség, NEM valószínűség; a `NOT_APPLICABLE` nem hiány), `dataGaps[]` (`metricId`, `status`, `reason`). A score és a döntés a PHASE 10-ben, a magyarázat a PHASE 11-ben kerül mellé. |
| `FinancialMetric` (PHASE 03) | `id` (a 5. fejezet mutatói, `FINANCIAL_METRIC_IDS`), `unit`, `value` (`Metric<number>`), `formula` (olvasható képlet), `period` (vagy `null` piaci mutatónál), `inputs[]`. **Szabály:** `OK` értékű mutató provenance-e nem lehet `ai_interpretation`. |
| `AiAnalysis` | `summary`, `positives[]`, `negatives[]`, `keyRisks[]`, `valuationExplanation`, `dcfAssumptionsNote`, `dataGaps[]`, `reviewTriggers[]`, `thesisInvalidators[]`, `claims[]` (`{ text, basedOn: metricId[] }`), `provider` (`template` \| `anthropic` \| `local` …), `model?`, `generatedAt`, `inputHash`, `kind`: `calculated` a szabályalapú `template` providernél, `ai_interpretation` LLM-nél (D-026) |

## 10. Kód-leképezés (PHASE 03)

Minden domain típus az `@/domain` modulból importálható. Ahol konstruktor van, ott az **egyetlen** érvényes létrehozási mód a konstruktor: `Result`-ot ad, és az összes hibás mezőt egyszerre jelzi.

| Fogalom (ez a dokumentum) | Típus | Konstruktor / segéd | Fájl |
|---|---|---|---|
| `Metric<T>`, `MetricStatus` (2.1, 2.5) | `Metric<T>` | `metricOk`, `metricMissing`, … | `src/domain/shared/metric.ts` |
| `Freshness`, `ProvenanceKind`, `DataProvenance` (2.2–2.4) | `DataProvenance` | `assessFreshness` | `src/domain/shared/provenance.ts` |
| Pénznem, pénzösszeg (1.) | `CurrencyCode`, `Money` | `parseCurrencyCode`, `createMoney`, `addMoney` | `currency.ts`, `money.ts` |
| Dátum, időbélyeg (1.) | `IsoDate`, `IsoTimestamp` | `parseIsoDate`, `parseIsoTimestamp`, `toLocalIsoDate` | `dates.ts` |
| Időszak (1., 4.3) | `FiscalPeriod` | `createFiscalPeriod` | `period.ts` |
| Azonosítók (3.) | `Isin`, `Mic`, `TickerSymbol`, `ListingId`, `SecurityId`, `Cik`, `PortfolioId`, `TransactionId` | `parseIsin` (ellenőrző jeggyel), `parseListingId`, `createListingId`, … | `ids.ts` |
| Hibák | `AppError`, `Result<T, E>` | `AppErrors.*`, `ok`, `err`, `isRetryable` | `errors.ts`, `result.ts` |
| Security (3.1) | `Instrument = Stock \| Etf` | `createStock`, `createEtf` | `src/domain/instrument/instrument.ts` |
| Listing (3.2) | `Listing` | `createListing` | ugyanott |
| Ár (3.6) | `Quote`, `PriceSeries`, `PriceAdjustment` | `createQuote`, `createPriceSeries` | `src/domain/market/quote.ts` |
| Kimutatások (4.1–4.2) | `FinancialStatement = IncomeStatement \| BalanceSheet \| CashFlowStatement` | `createFinancialStatement` (a meg nem adott tétel → `MISSING`) | `src/domain/fundamentals/financial-statement.ts` |
| Számított mutató (5.) | `FinancialMetric`, `FinancialMetricId` | `createFinancialMetric` | `src/domain/fundamentals/financial-metric.ts` |
| FX (8.) | `FxRate` (1 `base` = `rate` `quote`) | `createFxRate` | `src/domain/fx/fx-rate.ts` |
| Portfólió (7.) | `Portfolio`, `Transaction`, `Position` (csak típus) | `createPortfolio`, `createTransaction` | `src/domain/portfolio/portfolio.ts` |
| Elemzés (9.) | `AnalysisResult`, `AnalysisSubject` | `createAnalysisResult`, `summarizeCompleteness` | `src/domain/analysis/analysis-result.ts` |
| Contract (hálózat) | `QuoteDto`, `metricSchema`, `dataProvenanceSchema` | `parseApiResponse`, `quoteFromDto`, `apiErrorToAppError` | `src/contracts/*` |
| Jegyzés-jelölt (3.3) — 04A | `ListingCandidate`, `SecurityListings` | `createListingCandidate` | `src/domain/instrument/listing-candidate.ts` |
| Kimutatás-készlet (4.4) — 04A | `FinancialStatementSet`, `StatementFrequency` | `createFinancialStatementSet` (egy forrás, gyakoriság-egyezés) | `src/domain/fundamentals/financial-statement-set.ts` |
| FX-átváltás (8.) — 04A | `FxRateSet`, `FxConversion`, `DisplayCurrency` | `createFxRateSet`, `deriveFxRate`, `convertMoney`, `toMajor` | `src/domain/fx/fx-conversion.ts` |
| Contract v1 (11.) — 04A | `FxRateSetDto`, `SecurityListingsDto`, `FinancialStatementSetDto`, `HealthDto` | `withDomain`, `fiscalPeriodSchema`, `quoteToDto` | `src/contracts/{fx,listings,financials,health}.ts` |
| Profil (3.4) — 04B | `InstrumentProfile` | `createInstrumentProfile` | `src/domain/instrument/instrument-profile.ts` |
| Keresés (3.5) — 04B | `InstrumentSearchHit`, `InstrumentSearchResult` | `createInstrumentSearchHit`, `parseSearchQuery` | `src/domain/instrument/instrument-search.ts` |
| Osztalék (3.7) — 04B | `DividendEvent`, `DividendHistory` | `createDividendEvent`, `createDividendHistory` | `src/domain/market/dividend.ts` |
| Nem elérhető adat — 04B | `AppError` `UNAVAILABLE` (`reason: UnavailableReason`) | `AppErrors.unavailable` | `src/domain/shared/errors.ts` |
| Contract v1 (11.) — 04B | `PriceSeriesDto`, `DividendHistoryDto`, `InstrumentProfileDto`, `InstrumentSearchResultDto`, `ProviderStatusDto` | `priceSeriesDtoSchema`, … | `src/contracts/{market,search,provider-status}.ts` |
| Képlet-eredmény (12.) — 05 | `CalcResult<T>`, `CalcFailureStatus`, `NumericInput` | `calcOk`, `requireInputs`, `chainCalc`, `mapCalc` | `src/calculations/core/calc-result.ts` |
| Számítási konvenciók (1., 12.) — 05 | – | `snapToZero`, `percentToDecimal`, `sampleStandardDeviation`, `mustBe…` őrök | `src/calculations/core/numeric.ts` |
| `Metric`-adapter (12.3) — 05 | `CalculationContext`, `MetricCalculation` | `calculateMetric`, `preferReported` | `src/calculations/core/to-metric.ts` |
| Mutató-definíciók (5.) — 05 | `MetricDefinition` | `METRIC_DEFINITIONS`, `toFinancialMetric` | `src/calculations/definitions.ts` |
| Jövedelmezőség, növekedés (5.1) — 05 | `EpsSelection`, `NopatTaxRate`, `AnnualValue` | `grossProfit` … `roic`, `growthRate`, `cagr`, `cagrOverYears`, `degreeOfOperatingLeverage` | `src/calculations/fundamentals/{profitability,growth}.ts` |
| Mérleg, cash flow (5.2) — 05 | – | `netDebt`, `netCash`, `debtToEquity`, `freeCashFlow`, `fcf…`, `ebitda` | `src/calculations/fundamentals/balance-cashflow.ts` |
| Értékelés (5.3, 5.4) — 05 | – | `marketCap`, `enterpriseValue`, `priceTo…`, `evToEbitda`, `pegRatio`, `dividendYield…`, `trailingDividendPerShare`, `fcfYield`, `marginOfSafety`; DCF: `discountFactor`, `presentValue`, `gordonTerminalValue` | `src/calculations/valuation/{multiples,dcf-conventions}.ts` |
| Hozam (5.3, 5.5) — 05 | `SeriesReturn`, `PriceReturnDecomposition`, `ExpectedReturnBreakdown`, `MaxDrawdown`, `FutureValueResult` | `simpleReturn`, `seriesReturn`, `realReturn`, `annualizeReturn`, `maxDrawdown`, `requiredRecovery`, `futureValueOfContributions`, … | `src/calculations/returns/*.ts` |
| ETF-költség, követés (5.5) — 05 | `TerImpact` | `annualTerCost`, `terLongTermImpact`, `trackingDifference`, `trackingError` | `src/calculations/etf/costs-tracking.ts` |
| Portfólió-alapok (5.5) — 05 | `PortfolioWeights` | `portfolioWeights`, `weightedReturn` | `src/calculations/portfolio/portfolio-basics.ts` |

**Validációs józansági határok.** Ezek nem üzleti definíciók; a hibás bemenet kiszűrésére szolgálnak.

| Mező | Határ | Ok |
|---|---|---|
| ETF `ter` (`OK` érték) | 0 … 0.10 | Kiszűri a „százalék vs. tört” hibát (pl. 7 a 0.07 helyett). |
| `Quote.price`, `PricePoint.close`, `FxRate.rate` | > 0 | A 0 vagy negatív ár érvénytelen adat, nem „hiányzó”. |
| `fiscalYear` | 1900 … 2200, egész | Elírás elleni védelem. |
| Portfólió neve | 1 … 80 karakter | UI-korlát. |
| Tranzakció megjegyzése | ≤ 500 karakter | Méretkorlát (tárolás, megjelenítés). |
| Pénznemkód | 3 nagybetű (csak formátum) | Teljes ISO-lista nincs; a `GBX` jegyzési kód is átmegy (1. fejezet). A kisbetűs `GBp` → `GBX` (PHASE 04A). |
| FX-kérés devizái | 1 … 30 | Proxy-bemenet korlátja. |

## 11. API-szerződés v1 (PHASE 04A + 04B)

Boríték: siker `{ apiVersion: "1", data, warnings[] }`, hiba `{ apiVersion: "1", error: { code, message, retryAfterSec, unavailableReason? } }`. A szerver minden sikeres választ a kliensével közös zod-sémán is ellenőriz (D-044). Cache: `no-store` (PHASE 13-ig). A `warnings` a PHASE 04B-től jelzi, ha tartalék forrás adott választ (pl. `fmp: … csomagkorlát`, `Az adat forrása: eodhd (tartalék forrás).`).

**`CAPABILITY_UNAVAILABLE` + `unavailableReason`** (D-053): `PLAN_LIMIT` (csomagkorlát, HTTP 501), `NOT_COVERED` (a forrás/beállítás nem fedi le, pl. hiányzó kulcs, nem igazolt tőzsde; 501), `QUOTA_EXHAUSTED` (napi keret, 503). A kliensen `AppError { kind: 'UNAVAILABLE', reason }`.

| Végpont | `data` séma | Hibakódok (HTTP) |
|---|---|---|
| `GET /api/v1/health` | `healthDtoSchema`: `status`, `serverTime`, `dataMode`, `providers[]` (`id`, `name`, `kind`, `capabilities[]`, `configured`, `note`), `unavailableCapabilities[]` | – |
| `GET /api/v1/providers/status` — 04B | `providerStatusDtoSchema`: `providers[]` (+ `plan`, `coverage`, `quota: { dailyLimit, usedToday, remainingToday, resetsAt, scope: "instance" } \| null`), `routing[]` (`capability`, `market`, `chain[]`, `unavailableReason`) – kulcs nélkül | – |
| `GET /api/v1/fx?base=EUR&quotes=…&date=` | `fxRateSetDtoSchema` | 400, 429, 502, 504 |
| `GET /api/v1/securities/{isin}/listings` | `securityListingsDtoSchema` (OpenFIGI → tartalék: EODHD, pénznemmel) | 400, 404, 429, 501/503, 502, 504 |
| `GET /api/v1/search?q=` — 04B | `instrumentSearchResultDtoSchema` (szöveg: FMP → EODHD; ISIN: EODHD) | 400 (üres / >64 karakter), 501/503, 429, 502, 504 |
| `GET /api/v1/stocks/{listingId}/financials?period=annual\|quarterly` | `financialStatementSetDtoSchema` | 400, 404, **501 `PLAN_LIMIT`: nem US** (04A-ban 422 volt), 501 `NOT_COVERED`: nincs `SEC_USER_AGENT`, 502, 504 |
| `GET /api/v1/instruments/{listingId}/quote` | `quoteDtoSchema` (US: FMP → EODHD; EU: EODHD) | 400, 404, 501/503, 429, 502, 504 |
| `GET /api/v1/instruments/{listingId}/prices?from&to&adjustment=none\|split\|split_dividend` — 04B | `priceSeriesDtoSchema`; alapértelmezés: `to` = ma, `from` = `to` − 365 nap, `split_dividend` | 400 (hibás dátum, `from > to`, jövő, > 40 év, hibás korrekció), 404, 501 (pl. EODHD + `split`; free ablak előtti időszak), 503, 502, 504 |
| `GET /api/v1/instruments/{listingId}/profile` — 04B | `instrumentProfileDtoSchema` (csak US, FMP) | 400, 404, 501 `PLAN_LIMIT` (nem US), 502, 504 |
| `GET /api/v1/instruments/{listingId}/dividends?from&to` — 04B | `dividendHistoryDtoSchema`; alapértelmezés: 5 év | 400, 404, 501/503, 502, 504 |

Képességek (`PROVIDER_CAPABILITIES`): `quote`, `priceHistory`, `profile`, `financialStatements`, `dividends`, `etfMetadata`, `etfHoldings`, `listings`, `fxRates`, `search` (04B). Free csomagokkal élőben **nem elérhető**: `etfMetadata`, `etfHoldings` (PHASE 08), valamint nem US jegyzésre a `profile` és a `financialStatements`.

## 12. Számítási motor konvenciói (PHASE 05, D-055)

### 12.1 Bemenet
- Minden képlet **nevesített objektumot** kap (pl. `grossMargin({ grossProfit, revenue })`), így a hívásból látszik, melyik szám mi.
- Bemeneti típus: `NumericInput = number | null | undefined`. `null`/`undefined` = **hiányzó** adat; `0` = **tényleges nulla**. A kettő soha nem keveredik.
- Arány, hozam, ráta: tizedes tört. Ha egy forrás vagy a felhasználó százalékot ad, a hívó a `percentToDecimal`-lal váltja át. A józansági határok (TER ≤ 0.10, adókulcs ∈ [0, 1], éves ráta ≤ 1, diszkontráta ≤ 1, súlyok összege = 1) a tipikus „százalék a tört helyett” hibát `INVALID_INPUT`-tá teszik, érthető tippel.

### 12.2 Kimenet – `CalcResult<T>`

| Státusz | Mikor | Példa |
|---|---|---|
| `OK` + `value` + `notes[]` | érvényes eredmény; a `notes` átláthatósági megjegyzés | ROE csak záró saját tőkével: „…nem átlag” |
| `MISSING` | kötelező bemenet hiányzik (a nevével) | FCF CapEx nélkül |
| `NOT_MEANINGFUL` (N/M) | számolható, de félrevezető volna | P/E negatív EPS-sel; növekedés 0 bázisról |
| `INSUFFICIENT_DATA` | kevés időszak/pont | 5 éves CAGR 3 év adattal; drawdown 1 árponttal |
| `INVALID_INPUT` | érvénytelen bemenet vagy NaN/Infinity | negatív CapEx; TER = 0.22; `r ≤ g` |
| `NOT_APPLICABLE` (N/A) | az instrumentumra nem értelmezett (a hívó adja, pl. P/E ETF-re) | – |

Az `UNAVAILABLE` és az `ERROR` forrásoldali státusz: a motor nem állítja elő, de a `Metric`-adapter továbbadja. Biztonsági háló: `OK` eredményben soha nincs nem véges szám (objektumon és tömbön belül sem).

### 12.3 `Metric`-adapter – `calculateMetric(required, optional, formula, context)`

| Lépés | Szabály |
|---|---|
| Kötelező bemenet nem `OK` | a képlet nem fut; a legsúlyosabb státusz megy tovább: `ERROR` > `INVALID_INPUT` > `UNAVAILABLE` (ok-kóddal) > `MISSING` > `INSUFFICIENT_DATA` > `NOT_APPLICABLE` > `NOT_MEANINGFUL`; az indok megnevezi a bemenetet |
| Opcionális bemenet nem `OK` | `null`-ként jut a képlethez (pl. nyitó saját tőke) |
| Pénznem-őr | `money`/`money_per_share` egységű bemenetek eltérő pénzneme → `INVALID_INPUT` (FX előbb, `convertMoney`) |
| Provenance | `sourceId: 'engine'`, `sourceName: 'Számítási motor'`; `kind`: `mock` (ha bármelyik bemenet mock) > `estimated` (becsült bemenet vagy `context.kind`) > `calculated`; `fetchedAt` = `context.calculatedAt` (injektált óra); `asOf` = legrégebbi bemenet; `freshness` = legrosszabb; `unit`, `currency` (megadott vagy a bemenetek közös pénzneme), `period` (ha megadott); `inputs` = a felhasznált bemenetek nevei |
| Jelentett elsőbbség | `preferReported(reported, compute)`: jelentett `OK` → változatlanul; különben a saját számítás (ha az is `MISSING`, az informatívabb jelentett státusz) |
| `FinancialMetric` | `toFinancialMetric(id, calculation, period)`: képlet és egység a `METRIC_DEFINITIONS`-ből |

### 12.4 Tisztaság
A `src/calculations` csak a `@/domain`-t importálhatja; nincs hálózat, óra (`Date.now`), véletlen, React/RN/Expo. Kikényszerítés: ESLint és a `src/__tests__/calculations-purity.test.ts`. Ugyanarra a bemenetre mindig ugyanaz a kimenet.

**PHASE 06 bővítés:** `priceRange(points, asOf, options)` (`returns/price-range.ts`) – időszaki csúcs/mélypont napi záróárakból; az 52 hetes alapbeállítás `WEEK52_RANGE_OPTIONS` (365 nap, ≤ 10 nap rés az elején, ≥ 200 pont), különben `INSUFFICIENT_DATA` (D-061).

## 13. Részvény fundamentális elemzés (PHASE 06, D-059…D-063)

> Kód: domain-típusok `src/domain/analysis/stock-fundamentals.ts`; logika `src/application/stock-analysis/`; use case `src/application/use-cases/analyze-stock-fundamentals.ts` (`AppServices.analyzeStockFundamentals`). Minden képlet az 5. fejezet függvénye – itt csak a bemenetek kiválasztása és az időszak-konvenciók vannak.

### 13.1 Eredet-címke (`MetricOrigin`, D-063)

| Címke | Mikor |
|---|---|
| `reported` | `OK`, a forrás jelentette (pl. 10-K tétel, ár, FMP béta) |
| `calculated` | `OK`, a saját motor számolta jelentett bemenetekből |
| `estimated` | `OK`, de feltevésen alapul (pl. becsült `totalDebt` → nettó adósság, ROIC) |
| `stale` | `OK`, de a forrás frissessége `STALE`/`EXPIRED` (elfedi a fajtát; a `provenance.kind` megmarad) |
| `missing` | bármely nem-OK státusz `UNAVAILABLE` kivételével (`MISSING`, `NOT_MEANINGFUL`, `INSUFFICIENT_DATA`, `INVALID_INPUT`, `ERROR`, `NOT_APPLICABLE`) – a pontos ok a `status`-ban |
| `unavailable` | `UNAVAILABLE` (csomag, kvóta, lefedettség – `unavailableReason`) |
| `mock`, `user_input` | demóadat / felhasználói bevitel |

`FundamentalMetric = { id, unit, formula, period | null, value: Metric<number>, origin, notes[] }`. Az `id` lehet `FinancialMetricId`, kimutatás-tétel vagy piaci azonosító (`price`, `beta`, `week52High`, `week52Low`, `dividendPerShareTtm`).

### 13.2 Áttekintés (`StockOverview`)

| Mező | Forrás / szabály |
|---|---|
| `ticker`, `mic` | a listing-azonosítóból (mindig ismert) |
| `name` | profil; hiányában a kimutatás-készlet `entityName`-je; különben `null` |
| `exchangeName`, `sector`, `industry`, `country` | profil (free: csak US); hiány → `null` |
| `tradingCurrency` / `reportingCurrency` | az ár pénzneme / a legutóbbi FY (vagy mérleg) pénzneme – eltérhetnek (ADR) |
| `latestFiscalYearEnd` | a legutóbbi FY záródátuma (eltérő év végek jelzésére) |
| `price` | `reported`, a jegyzés frissességével (15 perc után `stale`: `QUOTE_FRESHNESS_POLICY`, ARCHITECTURE 11.; KI-54) |
| `marketCap` | `price × sharesOutstanding` (legfrissebb mérlegnap) |
| `sharesOutstanding` | jelentett, a legfrissebb mérlegből |
| `beta` | szolgáltatói, `reported`, tájékoztató |
| `week52High` / `week52Low` | `calculated`, `priceRange` napi záróárakból (D-061) |

### 13.3 Kimutatás-nézetek, Q4 és TTM (D-060)

- `StatementTable = { statementType, frequency, currency | null, periods[], derived[], rows: { item, unit, cells: Metric[] }[], notes }` – éves és negyedéves külön; a cellák az időszakokhoz igazítva; hiány = nem-OK `Metric` (soha nem 0). Több pénznem a készletben → `currency: null` + figyelmeztetés.
- **Q4** = `FY − (Q1+Q2+Q3)` additív időszaki tételre, hézagmentes negyedévekkel, azonos pénznemben; EPS és átlagos részvényszám `MISSING`; negatív nemnegatív tétel → `INVALID_INPUT`; mérleg = FY mérleg. Jelölés: `derived: true`, provenance `calculated`.
- **TTM** = utolsó 4 egymást követő negyedév összege; mérleg = utolsó negyedév; TTM EPS = 4 negyedéves EPS összege (ha bármelyik hiányzik → `MISSING`). `PeriodColumn.kind = 'TTM'`, `period: null`, `constituents` = a 4 negyedév.

### 13.4 Időszaki mutatók (`PeriodMetricTable`, feladat 4.)

Táblák: `annual` (FY-oszlopok), `quarterly` (Q1–Q4, a származtatott Q4-gyel), `ttm` (0 vagy 1 oszlop). Sorok (`PERIOD_METRIC_IDS`):

| Sor | Definíció (5. fejezet) | Megjegyzés |
|---|---|---|
| `revenue`, `operatingIncome`, `netIncome`, `cashAndEquivalents`, `totalAssets`, `totalLiabilities`, `shareholdersEquity`, `operatingCashFlow`, `capitalExpenditure`, `sharesOutstanding` | jelentett tétel | `totalDebt`: összetett (D-059) |
| `grossProfit` | jelentett, különben `revenue − costOfRevenue` | `preferReported` |
| `grossMargin`, `operatingMargin`, `netMargin` | tétel / `revenue` | `revenue ≤ 0` → N/M |
| `eps` | jelentett hígított → jelentett alap → `netIncome / weightedSharesDiluted` | a jelentett `reported` marad |
| `revenueGrowth`, `netIncomeGrowth`, `epsGrowth` | `growthRate`; éves: előző FY; negyedéves: előző év azonos negyedéve | TTM: nincs (`MISSING`); EPS: split-gyanúnál N/M |
| `netDebt`, `netCash`, `debtToEquity` | 5.2 | becsült adósság → `estimated` |
| `fcf`, `fcfMargin`, `fcfConversion`, `ebitda` | 5.2 | |
| `effectiveTaxRate`, `roe`, `roa`, `roic` | 5.1; átlag a nyitó (előző FY) és a záró értékből | csak éves; negyedéves/TTM: `NOT_APPLICABLE` |

### 13.5 Trendek és CAGR (`TrendSeries`, D-061)

Sorozatok: `revenue`, `grossProfit`, `operatingIncome`, `netIncome`, `eps`, `operatingCashFlow`, `fcf`, `sharesOutstanding` – FY-pontok növekvő sorrendben. CAGR horizontok: 1, 3, 5, 10 év; feltételek a D-061 szerint (végpontok megléte, azonos pénznem, azonos év vége ±7 nap, split-bázis). Az 1 éves CAGR = az éves növekedés.

### 13.6 Értékelés (`valuation`, D-062)

`marketCap`, `enterpriseValue`, `pe`, `forwardPe` (PHASE 07: forrás nélkül `MISSING`, D-065), `ps`, `pb`, `pfcf`, `fcfYield`, `evToEbitda`, `peg`, `dividendYield`, `dividendPerShareTtm`. Alap: aktuális ár + legutóbbi FY + legfrissebb mérlegnap (a megjegyzés megnevezi). Eltérő jegyzési/beszámolói pénznem → az ár-alapú szorzók `MISSING` (KI-50). Osztalék: TTM, ismeretlen lefedettséggel → esemény nélkül `MISSING`.

### 13.7 Minőségi modell (`QualityAnalysis`, D-063)

| Téma | Bizonyíték | Állapot forrása |
|---|---|---|
| BUSINESS | név, szektor, iparág, ország (profil) + `revenue` | metaadat + bizonyíték elérhetősége |
| GROWTH | `revenueGrowth`, `netIncomeGrowth`, `epsGrowth`, revenue CAGR 3/5, EPS CAGR 3, FCF CAGR 3 | elérhetőség |
| PROFITABILITY | `grossMargin`, `operatingMargin`, `netMargin`, `roe`, `roic` | elérhetőség |
| BALANCE_SHEET | `cashAndEquivalents`, `totalDebt`, `netDebt`, `debtToEquity`, `shareholdersEquity` | elérhetőség |
| CASH_FLOW | `operatingCashFlow`, `fcf`, `fcfMargin`, `fcfConversion` | elérhetőség |
| MOAT | kontextus: `grossMargin`, `roic` | **csak forrásolt lelet** |
| MANAGEMENT | kontextus: részvényszám 3 éves CAGR | **csak forrásolt lelet** |
| VALUATION | `pe`, `ps`, `pb`, `pfcf`, `evToEbitda`, `fcfYield`, `dividendYield`, `peg` | elérhetőség |

Állapot: `EVIDENCE_AVAILABLE` (minden bizonyíték `OK`; a `NOT_APPLICABLE` nem hiány), `PARTIAL_EVIDENCE`, `INSUFFICIENT_DATA`. `QualitativeFinding = { theme, statement, sourceKind: filing | provider | user, sourceReference (kötelező), verifiableBy (kötelező), asOf, provenanceKind }`. **Nincs pontszám** (`scoring: 'NOT_SCORED'`).

### 13.8 Adatminőség (`StockDataQuality`)

- `completeness`: a fő mutatók (legutóbbi FY: `revenue`, `grossMargin`, `operatingMargin`, `netMargin`, `eps`, `revenueGrowth`, `fcf`, `netDebt`, `debtToEquity`, `roe`; értékelés: `marketCap`, `pe`, `ps`, `pb`, `evToEbitda`, `fcfYield`, `dividendYield`) alapján `COMPLETE` / `PARTIAL` / `INSUFFICIENT`. Nincs FY → az első hiány „Nincs teljes pénzügyi év”.
- `sources[]`: erőforrásonként (`annualStatements`, `quarterlyStatements`, `quote`, `profile`, `prices`, `dividends`) a forrás, `fetchedAt`, `asOf`, frissesség és az esetleges `AppError`.
- `warnings[]`: elavult forrás, elérhetetlen forrás, becsült adósság, eltérő pénznem, nem naptári pénzügyi év.
- `disclaimer`: „Nem befektetési tanács, nem hozamígéret…”.

## 14. Értékelés és DCF – kimenet (PHASE 07, D-064, D-065)

> Kód: típusok `src/application/valuation/types.ts`; bemeneti modell `dcf-inputs.ts`; összerakás `stock-valuation.ts`; kiinduló feltevések `defaults.ts`; use case-ek `src/application/use-cases/analyze-stock-valuation.ts` (`AppServices.analyzeStockValuation`, `AppServices.recalculateStockValuation`). Minden DCF-szám az 5.4 függvényeiből jön.

### 14.1 DCF-bemenet (`DcfInputField`)

| Bemenet | Alapértelmezett forrás | Megjegyzés |
|---|---|---|
| `baseFcf` | éves tábla `fcf`, legutóbbi FY (`basis`: „FY2026 (záró: …)”) | ≤ 0 → a DCF `NOT_MEANINGFUL`; felülírható |
| `totalDebt`, `cash` | a legfrissebb mérlegnap (éves vs. negyedéves tábla első oszlopa; egyezésnél éves) | `estimated` adósság öröklődik + figyelmeztetés (D-059); bank/biztosító: `MISSING` |
| `sharesOutstanding` | `overview.sharesOutstanding` (legfrissebb mérleg) | nem hígított |
| `marketPrice` | `overview.price` | eltérő jegyzési/beszámolói pénznem → `MISSING` (KI-50); a MOS ekkor nem számolható |

Mezők: `value` (`null`, ha nem használható – a hiány nem 0), `status`, `origin` (`MetricOrigin`; felülírásnál `user_input`), `unit`, `currency`, `basis`, `source` (`sourceId`, `sourceName`, `fetchedAt`, `asOf`), `reason`, `notes`, `overridden`. A pénz jellegű bemenet pénzneme eltér a beszámolói pénznemtől → `INVALID_INPUT` (nincs csendes FX). Ha egy kötelező bemenet (FCF, adósság, pénz, részvényszám) nem `OK`, minden forgatókönyv és a tábla ugyanazzal az indokolt hibával tér vissza („… felhasználói értékkel felülírható”).

### 14.2 Forgatókönyvek (`DcfScenarioOutput`)

| Mező | Tartalom |
|---|---|
| `id`, `label` | `bear` / `base` / `bull`; „Bear (óvatos)”, „Base (kiinduló)”, „Bull (kedvező)” – csak elnevezések |
| `assumptions` | `growthRates[]`, `discountRate`, `terminalGrowth`, `explicitYears`, `source: 'default' \| 'user'` |
| `result` | `CalcResult<DcfResult>` (5.4) |
| `category` | `CalcResult<MarginOfSafetyCategory>` (14.4) |
| `display` | megjelenítési javaslat: IV/részvény 3 értékes jegyre, MOS egész %-ra (`null`, ha a DCF nem `OK`) |

Kiinduló feltevések (`DEFAULT_DCF_SCENARIOS`, **nem a cégre kalibrált**): Bear 2% / r 10% / g 1,5%; Base 5% / 9% / 2,5%; Bull 8% / 8% / 3%; 5 év konstans növekedéssel. Beállítás: `explicitYears`, `scenarios.{id}.{growthRates|discountRate|terminalGrowth}`, `inputOverrides.{bemenet}`.

### 14.3 Szenzitivitás (`DcfSensitivityOutput`)

`scenarioId: 'base'`, `table: CalcResult<DcfSensitivityTable>`. Alap tengelyek: Base r ± 2 × 0,01, Base g ± 2 × 0,005 (5 × 5); egyedi: `sensitivity.discountRates`, `sensitivity.terminalGrowthRates`.

### 14.4 Kategóriák és küszöbök (`valuation-bands.ts`, D-065)

| Kategória | Szabály (alap) |
|---|---|
| `DISCOUNT_TO_MODEL` | MOS ≥ `discountAtLeast` (0,25) |
| `NEAR_MODEL` | `premiumBelow` ≤ MOS < `discountAtLeast` |
| `PREMIUM_TO_MODEL` | MOS < `premiumBelow` (−0,10) |
| Szorzó-sáv `LOW` / `MODERATE` / `HIGH` | `< lowBelow` / köztes / `> highAbove`; alap: P/E, Forward P/E, P/FCF 15/25; P/S 2/6; P/B 1,5/4; EV/EBITDA 10/16; PEG 1/2; FCF-hozam 0,03/0,06 (`higherIsCheaper`) |

Érvénytelen küszöb (nem véges, fordított határ, `discountAtLeast ≥ 1`) → `INVALID_INPUT`. Nem pozitív szorzó → `NOT_MEANINGFUL` (FCF-hozamnál a negatív érték `LOW`). A kimenet mindig a használt küszöböt és a nyilatkozatot (`VALUATION_THRESHOLD_DISCLAIMER`) adja: **elemzési küszöbök, nem objektív igazságok, nem BUY/HOLD/SELL**.

### 14.5 Teljes kimenet (`StockValuationAnalysis`)

`generatedAt` (a számítás ideje), `fundamentalsGeneratedAt` (a forrásadatok elemzésének ideje), `listingId`, `multiples` (`metrics`: a 13.6 mutatói; `bands`), `dcf` (`provenanceKind: 'estimated'`, `inputs`, `scenarios`, `scenarioNotes`, `sensitivity`), `thresholds`, `explanation` (`formulas[]`, `conventions[]`, `context[]`: FCF CAGR 3/5, árbevétel CAGR 3/5, FCF-árrés, béta – csak viszonyítás, automatikusan nem kerül be), `warnings[]`, `disclaimer` (`DCF_DISCLAIMER`).

## 15. ETF-elemzés (PHASE 08, D-066…D-069)

Kód: `src/domain/etf/` (modellek), `src/calculations/returns/risk.ts`, `src/calculations/etf/{holdings,exposure}.ts` (képletek), `src/application/etf-analysis/` (összerakás), use case: `AppServices.analyzeEtf(listingId, options)`. Az ETF-elemzés a részvénylogikától külön van (őrteszt).

### 15.1 `EtfProfile` (jegyzés-szintű bemeneti modell)

| Mező | Típus | Forrás / szabály |
|---|---|---|
| `listingId`, `ticker`, `exchange` | string | a listing-azonosítóból (TICKER@MIC) |
| `name`, `isin`, `domicile` | `Metric` | szolgáltatói profil (reported) az elsődleges; különben kézi |
| `issuer`, `benchmark` | `Metric<string>` | kézi / későbbi forrás |
| `tradingCurrency` | `Metric<CurrencyCode>` | árfolyam → ártörténet → profil; GBX megmarad |
| `fundBaseCurrency` | `Metric<CurrencyCode>` | az alap könyvelési devizája (≠ jegyzési, ≠ kitettség – D-068) |
| `aum` | `Metric<Money>` | összeg ≥ 0, ISO pénznem, saját `asOf` |
| `inceptionDate` | `Metric<IsoDate>` | |
| `ter` | `Metric<number>` | tizedes tört, 0 … 0.10 (0.22 → `VALIDATION`: „százalék?”) |
| `replication` | `physical_full` \| `physical_sampling` \| `synthetic` | |
| `distribution` | `accumulating` \| `distributing` | |
| `ucits` | `Metric<boolean>` | nem európai domicilnél `NOT_APPLICABLE` |
| `currencyHedged`, `hedgeCurrency` | `Metric` | fedezetlen → `hedgeCurrency` `NOT_APPLICABLE`; fedezett, deviza nélkül → `MISSING` |
| `classification` | 15.2 | |
| `holdings` | `Metric<EtfHoldingsSnapshot>` | 15.3 |

Metaadat (`EtfMetadataInput`) nélkül az ETF-mezők `UNAVAILABLE / PLAN_LIMIT`; metaadattal, de hiányzó mezővel `MISSING`. Frissesség: metaadat 1 évig friss, 3 év után lejárt; holdings 120 napig friss, 400 nap után lejárt `[FELTÉTELEZÉS]`.

### 15.2 Kategóriák (`EtfClassification`)

| Dimenzió | Értékek | Levezethető? |
|---|---|---|
| `region` | `US`, `EUROPE`, `JAPAN`, `EMERGING`, `GLOBAL`, `OTHER` | igen, holdings-országsúlyból (D-067/5), ha nincs megadva |
| `assetClass` | `equity`, `bond`, `commodity`, `multi_asset`, `other` | nem |
| `sizeSegment` | `large`, `mid`, `small`, `large_mid`, `all_cap` | nem (pozíciónkénti piaci érték kellene) |
| `style` | `growth`, `value`, `quality`, `momentum`, `blend` | nem |
| `dividendFocus` | `none`, `dividend`, `dividend_growth` (az index szabálya, NEM a kifizetési mód) | nem |
| `weighting` | `market_cap`, `equal`, `factor`, `fundamental` | nem |

### 15.3 Holdings (`EtfHoldingsSnapshot`, D-067)

`asOf`, `holdings[]` (`name`, `isin?`, `weight` – tört, −1…1, nem normalizált –, `country?`, `sector?`, `currency?`), `declaredComplete`, `reportedHoldingsCount?`, `listedWeight` (Σ súly), `completeness` (`complete`, ha a forrás teljesnek mondja ÉS Σ ≥ 95%), `notes`, `provenance`. Validáció: üres lista, Σ pozitív súly > 150%, jelentett szám < tételszám → `VALIDATION`.

### 15.4 Holdings-mutatók

| Mutató | Képlet | Feltétel / érvénytelen eset |
|---|---|---|
| `holdingsCount` | jelentett pozíciószám; teljes listánál a tételek száma | részleges lista jelentett szám nélkül → `INSUFFICIENT_DATA` |
| `coveredWeight` | Σ súly | – |
| `top5/10/20Weight`, `largestHoldingWeight` | a legnagyobb N pozitív súly összege | részleges listán < N tétel → `INSUFFICIENT_DATA`; ≥ N: `OK` + „a forrás a legnagyobbakat adja” feltevés |
| `herfindahl` | Σ (wᵢ / Σw⁺)² a pozitív súlyokra | csak teljes listán, különben `INSUFFICIENT_DATA` |
| `effectiveHoldings` | 1 / HHI | ua. |
| `countryWeights`, `sectorWeights` | Σ súly kulcsonként, csökkenő | ismeretlen kulcs → `unclassifiedWeight`; le nem fedett → `uncoveredWeight`; szektor egyáltalán nincs → `MISSING` |
| `largestCountryWeight`, `largestSectorWeight` | a legnagyobb csoport súlya | részleges listán alsó becslés (megjegyzés) |

### 15.5 Deviza (`EtfCurrencyAnalysis`, D-068)

| Mező | Jelentés |
|---|---|
| `tradingCurrency`, `fundBaseCurrency`, `hedged`, `hedgeCurrency` | a profilból |
| `underlyingExposure` | holdings-deviza szerinti súlyok (GBX → GBP); holdings-deviza nélkül `MISSING` |
| `unhedgedForeignShare` | a kijelzési devizától eltérő, fedezés utáni mögöttes kitettség aránya; fedezett osztálynál: 0, ha a fedezési deviza = kijelzési, különben 1 (teljes fedezés feltevése) |
| `displayCurrency` | HUF / EUR / USD / GBP / CHF / JPY vagy `null` |
| `aumInDisplayCurrency` | `convertMoney` eredménye (ráta + dátum a provenance-ben); kijelzési deviza nélkül `NOT_APPLICABLE` |

### 15.6 Hozamok (`EtfReturnAnalysis`, D-069/4)

| Mutató | Képlet | Feltétel |
|---|---|---|
| `priceReturn` | `P_vég / P_kezdő − 1` (split-korrigált vagy nyers záróár) | ≥ 2 pont |
| `totalReturn` + `totalReturnMethod` | `adjusted_series`: korrigált záróár hozama; `accumulating_price`: = árhozam; `price_plus_distributions`: `(P_vég + Σ kifizetés) / P_kezdő − 1`, ex-dátum ∈ (kezdő, vég], újrabefektetés nélkül, azonos fő pénznemben | különben `MISSING` |
| `annualizedTotalReturn` | `(1 + R)^(1/évek) − 1`, évek = napok / 365,25 | csak ≥ 1 éves ablak (7 nap tűrés), különben `INSUFFICIENT_DATA` |
| `distributionYieldTtm` | utolsó 12 havi kifizetés / utolsó záróár (GBX → GBP) | akkumulálónál `NOT_APPLICABLE`; esemény nélkül, ismeretlen lefedettséggel `MISSING` |
| `comparisonBasis` | `total_return` \| `price_return_only` \| `none` | két ETF csak `total_return` alapon hasonlítható össze |

### 15.7 Kockázat (`EtfRiskAnalysis`, D-066)

| Mutató | Függvény | Képlet | Feltétel |
|---|---|---|---|
| Évesített volatilitás | `annualizedVolatility` | `stdev_minta(r_napi) × √252` | ≥ 126 napi hozam (felülírható) |
| Max drawdown | `maxDrawdown` | `min_t(P_t / max(P_0..P_t) − 1)` + csúcs/mélypont/helyreállás | ua. |
| Downside deviation | `downsideDeviation` | `√(Σ min(0, r_t − MAR_napi)² / N) × √252`; MAR = rf vagy 0 | ua. |
| Sharpe | `sharpeRatio` | `(évesített hozam − rf) / volatilitás` | rf kell (nincs alapérték); vol = 0 → `NOT_MEANINGFUL` |
| Sortino | `sortinoRatio` | `(évesített hozam − rf) / downside deviation` | rf kell; DD = 0 → `NOT_MEANINGFUL` |
| Béta | `beta` (+ `alignByDate`) | `cov_minta(r_ETF, r_index) / var_minta(r_index)`, közös dátumokon | indexsor kell; eltérő fő pénznem → `INVALID_INPUT`; ≥ 126 közös hozam |

**Megbízhatóság (`EtfMetric.reliability`, D-070):** minden kiszámolt kockázati és követési mutató (a 15.8 TD/TE is) címkét kap a periódushozamok száma (`window.observations`) alapján: `standard` ≥ 240 (`RISK_STANDARD_OBSERVATIONS`, ≈ 1 év ünnepnapokkal), `short_window` 126–239. A 126 (`RISK_MIN_OBSERVATIONS`) alatt nincs címke, a státusz `INSUFFICIENT_DATA`. Nem-OK és nem kockázati mutatónál `null`. Függvény: `riskReliability` (`src/calculations/returns/risk.ts`); a PHASE 09 portfólió-kockázat is ezt használja.

### 15.8 Költség és tracking (`EtfCostAnalysis`, `EtfTrackingAnalysis`)

| Mutató | Képlet | Feltétel |
|---|---|---|
| `ter` | jelentett / kézi érték | 0 … 0.10 |
| `annualCostPer10k` | `10 000 × TER` | TER kell |
| `longTermCostShare` | `1 − (1 + r − TER)^n / (1 + r)^n` | `estimated`; kiinduló r = 6%, n = 10 év (felülírható, jelölve) |
| `trackingDifference` | ETF total return − index total return, a **közös** ablakon | TR index kell (`net_total_return` vagy `gross_total_return`); árindex → `NOT_MEANINGFUL`; eltérő fő pénznem → `INVALID_INPUT`; eltérő ablak → közös ablak + megjegyzés |
| `annualizedTrackingDifference` | évesített ETF-hozam − évesített indexhozam | ≥ 1 éves közös ablak |
| `trackingError` | `stdev_minta(r_ETF,t − r_index,t) × √252` | ≥ 126 közös napi hozam |

UCITS ETF-nél a szokásos viszonyítás a nettó total return index. A TD tipikusan negatív, nagyságrendje ≈ −TER (± értékpapír-kölcsönzési bevétel, adóhatás); a TE a követés egyenletessége, nem a költsége.

### 15.9 Feature-modell (`EtfFeatureModel`, D-069/7)

Súly és pontszám NÉLKÜL. Feature-ök csoportonként (irány: `higher_is_better` / `lower_is_better` / `context`):

| Csoport | Feature-ök |
|---|---|
| diversification | `holdingsCount` ↑, `effectiveHoldings` ↑ |
| concentration | `top10Weight` ↓, `largestHoldingWeight` ↓, `largestCountryWeight` ↓, `largestSectorWeight` ↓ |
| cost | `ter` ↓ |
| tracking | `annualizedTrackingDifference` ↑, `trackingError` ↓ |
| liquidity | `averageDailyTradedValue` ↑ (ma csak kézi, KI-67) |
| size | `aum` ↑, `fundAgeYears` ↑ |
| structure | `replication`, `synthetic`, `distribution`, `ucits`, `domicile` (kategorikus) |
| risk | `volatility` (context), `maxDrawdown` ↑ |
| currency | `unhedgedForeignShare` ↓, `hedged` (kategorikus) |

`groupCoverage`: csoportonként hány feature-nek van értéke (adatteljesség, nem pontszám).

### 15.10 Teljes kimenet (`EtfAnalysis`)

`listingId`, `generatedAt`, `profile`, `coverage` (mezőnkénti státusz + eredet + ok, `available/total`, `limitations`), `currency`, `returns`, `risk`, `costs`, `tracking`, `holdings`, `features`, `notApplicable` (P/E, Forward P/E, DCF, vállalati minőség – indokkal), `warnings`, `disclaimer`. Minden `EtfMetric`: `id`, `label`, `unit`, `formula`, `value` (`Metric`), `origin`, `window` (`start`, `end`, `observations`), `notes`.
