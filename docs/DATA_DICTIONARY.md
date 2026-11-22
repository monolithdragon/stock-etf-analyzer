# Adatszótár – Stock & ETF Analyzer

> Állapot: **kiinduló definíciók** (PHASE 01) + **domain típusok a kódban** (PHASE 03, 2026-11-21). A mezők és a kód közti leképezés: [10. fejezet](#10-kód-leképezés-phase-03).
> - A képletdefiníciókat a **PHASE 05** véglegesíti, a DCF-et a **PHASE 07**, az ETF-mutatókat a **PHASE 08**, a portfóliót a **PHASE 09**.
> - Definíció csak dokumentált indokkal változtatható (DECISIONS.md-be bejegyzés kell).
> - Az XBRL tag-nevek a 4.1–4.2-ben **jelöltek** (PHASE 01). A ténylegesen használt, 12 valós cégen igazolt prioritási lista: **4.4** és `src/server/providers/sec-edgar/sec-tags.ts` (PHASE 04A).
> - PHASE 04A (2026-11-21): új fejezetek 3.3 (jegyzés-jelölt), 4.4 (SEC-normalizálás), 8. (FX, megvalósítva), 11. (API-szerződés v1).
> - PHASE 04B (2026-11-21): új fejezetek 3.4 (profil), 3.5 (keresés), 3.6 (ár, ártörténet-korrekció), 3.7 (osztalék); a 11. fejezet bővítve (új végpontok, `unavailableReason`).

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
| Évesítés | Napi adatnál 252 kereskedési nap/év `[FELTÉTELEZÉS – PHASE 08 véglegesíti]`. | – |

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
| `totalDebt` | szándékosan `MISSING` (összetett tétel, dupla számolás veszélye) | PHASE 05/06 dönt |
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

**Ismert korlátok:** negyedéves Q2/Q3 cash flow hiányzik (a 10-Q YTD-t ad; a különbségképzés `calculated` → PHASE 06), Q4 nincs (D-021). Részletek: KNOWN_ISSUES KI-18…KI-20.

## 5. Számított mutatók (`calculated`) – kiinduló definíciók (a PHASE 05 véglegesíti)

Jelölés: `Δ` = előző időszakhoz képest. „avg” = az időszak eleji és végi érték átlaga. Ha csak a záró érték van meg, azt használjuk, és a provenance-ben jelezzük.

### 5.1 Jövedelmezőség és növekedés

| Mutató | Képlet | Egység | Érvénytelen / speciális eset |
|---|---|---|---|
| Gross Profit | `revenue − costOfRevenue` (ha nincs jelentett `grossProfit`) | pénz | hiányzó bemenet → `MISSING` |
| Gross Margin | `grossProfit / revenue` | tört | `revenue ≤ 0` → `NOT_MEANINGFUL` |
| Operating Margin | `operatingIncome / revenue` | tört | ua. |
| Net Margin | `netIncome / revenue` | tört | ua. |
| EPS | jelentett `epsDiluted` preferált; saját: `netIncome / weightedSharesDiluted` | pénz/részvény | részvényszám ≤ 0 → `INVALID_INPUT` |
| Növekedés (revenue, NI, EPS) | `(X_t − X_{t−1}) / X_{t−1}` | tört | `X_{t−1} ≤ 0` → `NOT_MEANINGFUL` (nincs abszolútérték-trükk) |
| CAGR | `(X_end / X_start)^(1/évek) − 1` | tört | `X_start ≤ 0` vagy `X_end ≤ 0` → `NOT_MEANINGFUL`; kevés év → `INSUFFICIENT_DATA` |
| ROE | `netIncome / avg(shareholdersEquity)` | tört | equity ≤ 0 → `NOT_MEANINGFUL` |
| ROA | `netIncome / avg(totalAssets)` | tört | assets ≤ 0 → `INVALID_INPUT` |
| NOPAT | `operatingIncome × (1 − effectiveTaxRate)` | pénz | adókulcs: lásd lent |
| Effective tax rate | `incomeTaxExpense / pretaxIncome` | tört | `pretaxIncome ≤ 0` vagy az eredmény a [0, 1] tartományon kívül esik → a PHASE 05 dönt: N/M vagy konfigurált alapkulcs `estimated` jelöléssel |
| Invested Capital | `shareholdersEquity + totalDebt − cashAndEquivalents` | pénz | ≤ 0 → ROIC `NOT_MEANINGFUL` |
| ROIC | `NOPAT / avg(investedCapital)` | tört | ua. |
| DOL | `%Δ operatingIncome / %Δ revenue` | x | `%Δ revenue = 0` vagy bázis ≤ 0 → `NOT_MEANINGFUL` |

### 5.2 Mérleg és cash flow

| Mutató | Képlet | Érvénytelen / speciális eset |
|---|---|---|
| Net Debt | `totalDebt − cashAndEquivalents` (negatív = nettó készpénz) | – |
| Net Cash | `cashAndEquivalents − totalDebt` | – |
| Debt/Equity | `totalDebt / shareholdersEquity` | equity ≤ 0 → `NOT_MEANINGFUL` |
| FCF | `operatingCashFlow − capitalExpenditure` | bármelyik hiányzik → `MISSING` |
| FCF Margin | `FCF / revenue` | `revenue ≤ 0` → N/M |
| FCF Conversion | `FCF / netIncome` | `netIncome ≤ 0` → N/M |
| FCF after Dividend | `FCF − dividendsPaid` | hiányzó osztalék ≠ 0: `MISSING`, kivéve ha a forrás explicit 0-t jelent |
| FCF after Dividend & Debt Repayment | `FCF − dividendsPaid − debtRepayment` | ua. |
| EBITDA (számított) | `operatingIncome + depreciationAmortization` | `calculated`; eltérhet a szolgáltató EBITDA-jától |

### 5.3 Piaci és értékelési mutatók

| Mutató | Képlet | Érvénytelen / speciális eset |
|---|---|---|
| Market Cap | `price × sharesOutstanding` | a `sharesOutstanding` dátuma és az ár dátuma eltérhet → jelezni |
| Enterprise Value | `marketCap + totalDebt − cashAndEquivalents` | – |
| P/E | `price / epsDiluted` (TTM preferált, egyébként utolsó FY; a címke jelzi, melyik) | EPS ≤ 0 → **N/M** |
| P/FCF | `marketCap / FCF` | FCF ≤ 0 → N/M |
| P/S | `marketCap / revenue` | revenue ≤ 0 → N/M |
| P/B | `marketCap / shareholdersEquity` | equity ≤ 0 → N/M |
| EV/EBITDA | `EV / EBITDA` | EBITDA ≤ 0 → N/M |
| PEG | `P/E / (EPS növekedés százalékpontban)`; pl. P/E 20, növekedés 10% → 2.0. Az MVP-ben a növekedés a történeti EPS CAGR (`calculated`), a címke jelzi | növekedés ≤ 0 vagy P/E nem `OK` → N/M |
| Dividend Yield | `TTM részvényenkénti osztalék / price` | nincs osztalékadat → `MISSING` (nem 0!) |
| FCF Yield | `FCF / marketCap` | – |
| Margin of Safety | `(intrinsicValue − price) / intrinsicValue` | `intrinsicValue ≤ 0` → nem számítható (`INVALID_INPUT`) |
| Real Return | `(1 + nominal) / (1 + inflation) − 1` | `inflation ≤ −1` → `INVALID_INPUT` |

### 5.4 DCF (kiinduló terv – a PHASE 07 véglegesíti, D-022)

- Bemenetek: `baseFcf`, `growthRates[]` (explicit évekre), `discountRate`, `terminalGrowth`, `totalDebt`, `cash`, `sharesOutstanding`, `price`, `years` (javasolt alapeset: 5; 3 támogatott; max. 10).
- `PV_t = FCF_t / (1 + r)^t`
- `TV = FCF_n × (1 + g) / (r − g)` csak ha `r > g`, egyébként `INVALID_INPUT` emberi magyarázattal.
- `PV_TV = TV / (1 + r)^n`
- `EV_dcf = Σ PV_t + PV_TV`; `Equity = EV_dcf − totalDebt + cash`; `IV/share = Equity / sharesOutstanding`
- **Ismert egyszerűsítés:** az FCF (`OCF − CapEx`) US GAAP szerint már levonja a kamatot, tehát nem tiszta FCFF. Ezért ha az eredményt WACC-cal diszkontáljuk és EV-ként kezeljük, az torzíthat. A UI-ban jelölni kell; a PHASE 07 dönthet FCFF-közelítésről.
- `baseFcf ≤ 0` → az alapértelmezett DCF nem futtatható (`INVALID_INPUT`), csak felhasználói felülírással, `user_input` jelöléssel.
- Az érzékenységi tábla minden cellája ugyanazt az engine-függvényt hívja.

### 5.5 Hozam, kockázat, ETF, portfólió (kiinduló)

| Mutató | Képlet | Megjegyzés |
|---|---|---|
| Egyszerű hozam | `P_t / P_{t−1} − 1` | split-korrigált árral; total returnhöz osztalék kell |
| Total return | árfolyamhozam + újrabefektetett osztalék | ha csak árfolyamhozam van: a címke „csak árfolyamhozam” |
| Drawdown | `DD_t = P_t / max(P_0..P_t) − 1` (≤ 0) | Max DD = min(DD_t) |
| Szükséges recovery | `1 / (1 + DD) − 1` | pl. −50% → +100% |
| Évesített volatilitás | `stdev(napi egyszerű hozam, minta) × √252` | konvenció: PHASE 08 |
| Sharpe | `(évesített hozam − rf) / évesített volatilitás` | az `rf` felhasználói beállítás (`user_input`) |
| Sortino | `(évesített hozam − cél) / downside deviation` | |
| TER költség | `befektetett összeg × TER` évente | hosszú távú hatás: FV `(1+r−TER)` vs `(1+r)` |
| Tracking difference | `ETF total return − index total return` azonos időszakra | indexadat kell |
| Tracking error | `stdev(ETF hozam − index hozam) évesítve` | ua. |
| Rendszeres befizetés FV | időszak végén: `PMT × ((1+i)^n − 1) / i`; időszak elején: `× (1+i)` | havi `i = (1+r_éves)^(1/12) − 1` (effektív) `[FELTÉTELEZÉS – PHASE 05]` |
| Portfóliósúly | `pozícióérték (kijelzési pénznemben) / összérték` | hiányzó árú pozíció külön, nem 0 súllyal |
| Súlyozott hozam | `Σ w_i × r_i` | |

## 6. ETF-mezők

`issuer`, `isin`, `domicile`, `ter` (tört, pl. 0.0007), `aum` (Money + asOf), `inceptionDate`, `replication` (`physical_full` \| `physical_sampling` \| `synthetic`), `benchmark`, `distribution` (`accumulating` \| `distributing`), `ucits` (bool?), `currencyHedged` (bool?), `tradingCurrency`, `holdings[]` (`{ name, isin?, weight, country?, sector? }` + `holdingsAsOf`), `holdingsCount`, `topNWeight`. Minden mező `Metric<T>`, mert a forrás gyakran hiányos. Kézi bevitel esetén `user_input`.

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
