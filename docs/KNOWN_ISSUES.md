# Ismert problémák, kockázatok, ismeretlenek – Stock & ETF Analyzer

> Frissítve: 2026-11-22 (PHASE 08 vége). Valószínűség (V) és hatás (H) skálája: **A** = Alacsony, **K** = Közepes, **M** = Magas.

## Blokkolók

**Nincs blokkoló a PHASE 09 indításához.** A PHASE 09 (portfólió) a PHASE 05 portfólió-képleteire, a 04A FX-rétegére és a PHASE 08 kockázati függvényeire (`risk.ts`) építhet; az ETF-holdings-alapú look-through csak holdings-forrással működik (KI-65, KI-66).

## PHASE 08 – ismert problémák és leletek (2026-11-22)

| ID | Leírás | Hatás | Állapot / teendő | Fázis |
|---|---|---|---|---|
| KI-65 | **Nincs ETF-metaadat forrás a free csomagban** (TER, AUM, replikáció, benchmark, acc/dist, UCITS, fedezés, kategóriák): az ETF-elemzés ezeket csak kézi bevitelből (`user_input`) kapja; nélküle a mezők `UNAVAILABLE / PLAN_LIMIT`. | M | Tudatos (D-069/3). Bővítés: fizetős EODHD Fundamentals (ETF) – holdings és metaadat `[NEM IGAZOLT]`; DP-05. A kézi bevitel UI-ja a PHASE 12. | 12, 15 |
| KI-66 | **SEC N-PORT adapter nincs** (alacsony prioritás, D-071): a forrás igazoltan ad teljes holdings-listát (súly %, ország, ISIN, deviza) US-regisztrált alapokra, de negyedévente, ~60 napos késleltetéssel, szektor nélkül, UCITS-ra nem. | K | D-069/9. Teendő: XML-feldolgozó (kompatibilitás-ellenőrzéssel) vagy saját szűk parser a szerveren, ticker → CIK/series leképezés (`company_tickers_mf.json`; a SPY UIT nincs benne), valós megvágott fixture, súly = `pctVal / 100`. **D-071: nem készül** – US-only, az EU-s lakossági befektető jellemzően nem vehet US székhelyű ETF-et; helyette KI-74. | – |
| KI-67 | **A likviditás-feature mindig `MISSING`**, hacsak kézzel meg nem adják: a normalizált ártörténet (`PricePoint`) nem tartalmaz volument, pedig az EODHD `eod` válasza igen. | K | Teendő: `volume` mező a `PricePoint`-ba (szerződés + normalizálók + fixture-ök), majd medián napi forgalom. Bid-ask spread free forrásból nem elérhető. | 13 |
| KI-68 | **Kvótaköltség:** egy ETF-elemzés 4–5 szolgáltatói hívás (árfolyam, 2–3 ártörténet, osztalék, profil); a free EODHD napi 20 hívásából ~4 ETF-elemzés fér ki. | K | Elfogadva az MVP-ben; a proxy-cache a PHASE 13 feladata. Az EODHD `SPLIT` kérés hívás nélkül `NOT_COVERED`. | 13 |
| KI-69 | **Indexsor nincs:** a tracking difference, a tracking error és a béta csak a hívó által adott total return indexsorral számol; free forrásból TR index nem igazolt. | K | Tudatos (D-069/5). Lehetőség: egy azonos indexet követő összehasonlító ETF sora – ez NEM tracking, ezért külön mutató kellene. | 15 |
| KI-70 | A **free EODHD 1 éves ártörténete** miatt nem US ETF-nél a kockázati mutatók legfeljebb ~1 éves ablakon készülnek (a szokásos összevetés 3 év); a 3 éves mutatók ma nem számolhatók. | K | Jelölve (megjegyzés + `coverage.limitations` + D-070 `reliability` címke). Fizetős EODHD-vel 30+ év (DP-05). | 13, 15 |
| KI-71 | A **disztribúciós total return** (korrigált sor hiányában) újrabefektetés nélküli közelítés; hosszú ablakon kissé alulbecsül. Az EODHD `adjusted_close` (korrigált sor) elérhető, így ez csak tartalék-út. | A | Dokumentált (D-069/4, megjegyzés a kimenetben). | – |
| KI-72 | A **régió-levezetés** heurisztika (80% / 5% / 3 régió, MSCI EM lista); határesetben (pl. fejlett ex-US) `OTHER`. A fedezett osztály devizakockázata a teljes fedezés feltevésével 0. | A | Dokumentált (D-067/5, D-068/3); a megadott régió elsőbbséget élvez. | – |
| KI-74 | **Kibocsátói holdings-fájl import még nincs** (D-071): a UCITS ETF-ek holdingsa ma csak kézi `EtfHoldingsSnapshot`-ként adható meg. | K | Tervezett: kibocsátónként formátum-adapter (iShares, Vanguard, Xtrackers), valós megvágott fixture, a meglévő `createEtfHoldingsSnapshot` validáció; ismeretlen formátum → hiba. | 13 |
| KI-75 | A **rövid ablakos kockázati mutatók** (126–239 napi hozam) elkészülnek, de zajosabbak; a free EODHD-vel nem US ETF-nél jellemzően ez az eset. | A | Kezelve (D-070): `reliability = 'short_window'` címke + megjegyzés; a PHASE 10 ennek alapján súlyozhat. | 09, 10 |
| KI-73 | A **kategória-validáció** (régió, méret, stílus, súlyozás) csak enum-tagságot ellenőriz; azt, hogy a kategória illik-e a benchmarkhoz, forrás nélkül nem lehet ellenőrizni. | A | Elfogadva; a forrás és a dátum a provenance-ben látszik. | 12 |

## PHASE 07 – ismert problémák és leletek (2026-11-22)

| ID | Probléma / lelet | Hatás | Állapot / teendő | Felelős fázis |
|---|---|---|---|---|
| KI-58 | A **kiinduló DCF-feltevések általánosak** (Bear 2%/10%/1,5%, Base 5%/9%/2,5%, Bull 8%/8%/3%), nem a cégre kalibráltak; egy nagy, lassan növő és egy kis, gyorsan növő cég ugyanazt kapja. | K | Tudatos (D-064/7): `source: 'default'` jelölés, mind felülírható, a történeti kontextus (FCF/árbevétel CAGR, FCF-árrés) mellettük látszik. A UI-nak (PHASE 12) a feltevéseket szerkeszthetően, az eredmény mellett kell mutatnia. | 12 |
| KI-59 | **Diszkontráta = felhasználói feltevés**, WACC/CAPM nincs (nincs forrásolt kockázatmentes hozam és piaci kockázati prémium; a béta szolgáltatói és tájékoztató). | K | Tudatos (D-064/8). Lehetőség: ECB/FRED hozamgörbe-adapter + saját béta (PHASE 08 hozammotor) után opcionális CAPM-javaslat, `estimated` címkével. | 13+ |
| KI-60 | A **kiinduló FCF egyetlen FY** értéke, nem normalizált (egyszeri tételek, ciklikusság, működőtőke-ingadozás nincs kiszűrve); ciklikus cégnél félrevezető lehet. | K | Dokumentált a konvenciókban; felhasználói felülírással normalizálható (`inputOverrides.baseFcf`). Lehetőség: többéves átlag-javaslat a kontextusban. | 10, 12 |
| KI-61 | A DCF **nem hígított** kint lévő részvényszámmal oszt (opciók, RSU, átváltható kötvények nélkül) → erős részvényalapú javadalmazásnál a belső érték/részvény felülbecsülhet. | A | Dokumentált (konvenciók). Bővítés: hígított részvényszám SEC-tagből, valós fixture-rel igazolva. | 15 |
| KI-62 | A **Forward P/E mindig `MISSING`**: nincs bekötött, forrásolt elemzői EPS-előrejelzés (a free csomagokban nem igazolt ilyen végpont). | A | Tudatos (D-065/2); a motor kész (`ValuationInput.forwardEps`). Bekötés csak igazolt forrással és licenccel (DP-05). | 15 |
| KI-63 | A MOS az **aktuális (gyakran `stale`) árral** számol; kereskedési időn kívül az ár szinte mindig elavult (KI-54), ezért a figyelmeztetésben szinte mindig megjelenik az „Elavult bemenet: Piaci ár”. | A | Őszinte, de zajos; a piaci naptár a PHASE 13 feladata. | 13 |
| KI-64 | A **valuation-integrációs teszt** szélsőeseteit (negatív FCF, eltérő pénznem, frissebb negyedéves mérleg) a valós AAPL-elemzés módosított másolatán szimuláljuk, nem külön fixture-ön. | A | Elfogadva: a bemenet-kiválasztás és a motor ugyanaz; valós szélsőeset (BRK-B hiányzó adósság/pénz/részvényszám, MSFT becsült adósság, XOM FY nélkül) valós fixture-ön is tesztelt. | – |

## PHASE 06 – ismert problémák és leletek (2026-11-22)

| ID | Probléma / lelet | Hatás | Állapot / teendő | Felelős fázis |
|---|---|---|---|---|
| KI-50 | **Eltérő jegyzési és beszámolói pénznem** (ADR, pl. TSM: TWD kimutatás, USD ár) esetén az ár-alapú szorzók (P/E, P/S, P/B, P/FCF, FCF-hozam, EV/EBITDA, PEG) `MISSING`. | K | Tudatos (D-062/4): nincs csendes FX. **PHASE 07 (D-065/4):** nem került be; a DCF a beszámolói pénznemben számol, eltérő jegyzési pénznemnél a MOS `MISSING` (ár felülírással megadható). **Teendő:** a `convertMoney` bekötése (aszinkron FX-lekérés, dátum + forrás rögzítve) a többdevizás értékeléssel együtt. | 09 |
| KI-51 | **Becsült `totalDebt`:** ha egy rövid lejáratú komponensnek nincs ténye, 0-nak vesszük (`estimated`, megnevezve) – pl. MSFT FY2026, KO Q3 2026. **Bankoknál, biztosítóknál és IFRS-filereknél** (JPM, BRK-B, TSM) a `totalDebt` `MISSING`. | K | Dokumentált (D-059). Bővítés: további tagek (pl. `NotesPayable`, `LongTermDebtAndFinanceLeaseObligations`, IFRS `Bonds…`) valós fixture-rel igazolva. | 07, 15 |
| KI-52 | **TTM EPS** gyakorlatilag mindig `MISSING`: a származtatott Q4 EPS nem additív (D-060/2), és a 10-K nem ad Q4 EPS-t. | K | Tudatos. A szorzók ezért a legutóbbi FY EPS-ével számolnak (D-062/1). **PHASE 07 döntés (D-065/3):** nem vezetjük be (vegyes alapú szorzót adna, a TTM cash flow is hiányos – KI-18); a szorzók FY-alapúak maradnak. | 13, 15 |
| KI-53 | A **split-gyanú heurisztika** (részvényszám > 1,5× változás, D-061/2) nagy akvizíciós kibocsátásnál téves riasztást adhat (az EPS-növekedés / CAGR ekkor `NOT_MEANINGFUL`, nem hibás szám). | A | Elfogadva (konzervatív: inkább nincs érték, mint vegyes bázisú). Javítás: split-események forrásból (FMP `splits`) – PHASE 07/13. | 07, 13 |
| KI-54 | A jegyzés frissességi szabálya (15 perc FRESH, `QUOTE_FRESHNESS_POLICY`) miatt az ár – és minden belőle számolt szorzó – a kereskedési időn kívül szinte mindig `stale` eredetű. | A | Őszinte, de zajos. A piaci naptárt figyelembe vevő szabály a PHASE 13 feladata (ARCHITECTURE 11.). | 13 |
| KI-55 | **Osztalékhozam nem fizető cégnél `MISSING`, nem 0%:** a free források osztaléktörténetének lefedettsége nem ismert, ezért esemény nélkül nem mondhatjuk, hogy 0 (D-062/5). | A | Tudatos. Javítás: a forrás lefedettségének igazolása, vagy a SEC `PaymentsOfDividends` jelentett 0-ja alapján – PHASE 07/08. | 07 |
| KI-56 | A **Q4 származtatás restatement-kockázata:** az FY és a Q1–Q3 eltérő filingből jöhet; utólagos korrekciónál a Q4 torzulhat (nemnegatív tételnél a negatív Q4 `INVALID_INPUT`-ot ad, de a kisebb torzulás nem látszik). | A | Dokumentált (a tábla megjegyzése kimondja). | – |
| KI-57 | A SEC-fixture-ök csak a **2021 óta beadott** filingeket tartalmazzák (megvágás) → a fixture-ökön a 10 éves CAGR mindig `INSUFFICIENT_DATA`. Élő adattal (max. 15 év) a 10 éves CAGR számolható. | A | Tesztelési korlát, nem termékhiba. | – |

## PHASE 05 – ismert problémák és leletek (2026-11-22)

| ID | Probléma / lelet | Hatás | Állapot / teendő | Felelős fázis |
|---|---|---|---|---|
| KI-42 | A **`totalDebt` forrásoldalon `MISSING`** (D-043), így a nettó adósság, nettó készpénz, EV, D/E, Invested Capital, ROIC és EV/EBITDA élő adattal ma mindig `MISSING`. A képletek készen és tesztelve állnak. | M (06–07) | **MEGOLDVA (PHASE 06, D-059):** lejárat szerinti bontásból összerakva, valós fixture-rel igazolva (a naiv összeadás a JNJ-nél dupla számolás lett volna). Maradék: KI-51. | 06 |
| KI-43 | A **saját EPS** (`netIncome / weightedSharesDiluted`) az elsőbbségi osztalék levonása nélkül számol → elsőbbségi részvényes cégnél felülbecsülhet. | A | Kezelve: a jelentett EPS az elsődleges; a saját számítás csak tartalék, megjegyzéssel (D-056/4). | 06 |
| KI-44 | Az **EV egyszerűsített**: kisebbségi részesedés, elsőbbségi részvény és lízing nélkül → nagy lízingállományú vagy kisebbségi részesedésű cégnél alulbecsülhet. | K | Dokumentált (D-056/10). **PHASE 07 (D-065/5):** változatlan; a DCF EV → equity hídja is csak adósság és pénz (a konvenciók kimondják). Bővítés valós fixture-rel igazolt tagekkel. | 15 |
| KI-45 | A **TTM osztalék** 365 napos ex-dátum-ablaka szabálytalan ütemezésnél (eltolódó félévi/éves kifizetés) a határon egy kifizetést kihagyhat vagy kettőt számolhat. | K | Elfogadva az MVP-ben (D-056/12). Javítási lehetőség: a forrás `frequency` mezője alapján évesítés. PHASE 06: változatlan (az osztalékhozam ezt a függvényt használja). PHASE 08: az ETF TTM osztalékhozama is ezt használja – változatlan. | 13 |
| KI-46 | A **TER hosszú távú hatása** a `(1 + r − TER)^n` közelítéssel számol (DATA_DICTIONARY 5.5); a pontosabb `(1 + r)(1 − TER)` alaktól `r × TER` nagyságrendben tér el (7% hozam, 0,2% TER mellett évente ~0,014 százalékpont). | A | Dokumentált (D-058). PHASE 08: megtartva (a hatás `estimated`, a feltevések a kimenetben); pontosabb alakra a PHASE 12 megjelenítésénél lehet váltani. | 12 |
| KI-47 | A **tracking error** egyforma hosszú, dátum szerint igazított hozamsorokat vár; a dátum-igazítás (hiányzó kereskedési napok, eltérő tőzsdei naptár) a hívó dolga. | K (08) | Tudatos: a PHASE 08 végzi az igazítást (indexadat is kell). | 08 |
| KI-48 | A `src/__tests__/calculations-purity.test.ts` a Node-típusokat a Jest tranzitív függőségeként telepített `@types/node`-ból kapja (`/// <reference types="node" />`); közvetlen függőség nincs. | A | Elfogadva (új csomag nem kellett). Ha egy Jest-frissítés elhagyná, a `@types/node` közvetlen dev-függőségként felvehető. | – |
| KI-49 | A számítási motort **még nem hívja use case** és UI; élő adaton még nem futott. | A | **MEGOLDVA (PHASE 06):** az `analyzeStockFundamentals` use case használja; valós SEC/FMP fixture-ön integrációs teszttel igazolva. Élő hálózati futás a UI-val (PHASE 12) jön. | 06 |

## PHASE 04B – ismert problémák és leletek (2026-11-21)

| ID | Probléma / lelet | Hatás | Állapot / teendő | Felelős fázis |
|---|---|---|---|---|
| KI-30 | Az **FMP az ismeretlen tickerre is HTTP 402-t ad** (élő próba: `ZZZZQX`), ugyanazzal a „Premium Query Parameter” szöveggel, mint a csomagkorlátra. A kettő nem különböztethető meg. | K | **Kezelve (D-053):** `UNAVAILABLE / PLAN_LIMIT`, az üzenet kimondja a kétértelműséget; US-nél a router az EODHD-re vált, amely 404-gyel vagy „NA”-val jelzi a hibás tickert. | – |
| KI-31 | Az Expo **minden `+api.ts` route-ot külön bundle-be fordít** (web-export: 10 route, 10 bundle): a modul-szintű singleton route-onként külön példány volt, így a kvóta-számláló nem látta a más route-ok hívásait (élő füstpróbán derült ki: 0/250 több FMP-hívás után). | K | **Javítva:** a szerverkontextus a `globalThis`-en él (teszt + élő próba: 2/250). Több folyamat/példány között továbbra sem közös (KI-23). | – |
| KI-32 | A **kvóta-számláló memóriabeli**: újraindításkor nullázódik, és nem látja a szolgáltatónál máshonnan (pl. kézi próbahívásból) elhasznált keretet. 2026-11-21-én a fázis próbahívásai az EODHD napi 20-as keretét elhasználták (+ néhány hívás a bónuszkeretből). | K | Elfogadva (D-008, D-051). Javítási lehetőség: az EODHD `/api/user` (0 hívás) induláskori szinkronja; tartós számláló: PHASE 13/15. Ha a keret elfogy, a szolgáltató 402-t ad → `QUOTA_EXHAUSTED` (nem csendes hiba). | 13 |
| KI-33 | Az EODHD `close` mező **nyers** (nem split-korrigált) jellege csak a **dokumentációból** igazolt; élő split-próba nem volt (a free csomag 1 éves ablakában nem volt ismert split a próbált instrumentumokon). | K | `[IGAZOLT – doksi]`. Teendő: egy ismert split-napon ellenőrizni (`close` vs `adjusted_close`). | 06 |
| KI-34 | Az FMP **ártörténet és osztalék** válasza nem tartalmaz tőzsdét, ezért ott a kért MIC-et nem tudjuk ellenőrizni (a quote és a profil igen). Pl. `AAPL@XNYS` ártörténete az AAPL (Nasdaq) adatát adja. | A | Elfogadva (US-ben egy ticker = egy jegyzés a gyakorlatban). A UI a keresésből vagy a quote-ból származó listing-azonosítót használja. | 12 |
| KI-35 | Az EODHD jegyzés-pénzneme (ahol nincs helyszíni szabály: LSE, Amszterdam, SIX, Frankfurt, Budapest) **+1 keresési hívás** jegyzésenként és naponta (24 órás memó, folyamatonként). A free 20/nap mellett ez érezhető. | K | Elfogadva (D-052). Enyhítés: a PHASE 13 tartós cache-e a pénznemet is megtarthatja. | 13 |
| KI-36 | Az EODHD keresőben az US jegyzések `Exchange: "US"` (ország-szint) → nem képezzük MIC-re (kihagyva, megszámolva). | A | Tudatos. US-keresés az FMP-n megy (NASDAQ/NYSE → MIC). | – |
| KI-37 | Az **FMP free a US szimbólumoknak is csak egy részét** fedi le (pl. `BRK-B` → 402). | K | Kezelve: a router ilyenkor az EODHD-re vált (teszt), a válasz `warnings` mezője jelzi. | – |
| KI-38 | A **fizetős csomag-sorok** (`FMP_PLAN=starter`, `EODHD_PLAN=eod-all-world`) paraméterei élő próbával **nem igazoltak**. | K | A proxy induláskor figyelmeztet; váltás előtt a `/api/v1/providers/status` és egy próbahívás kell. | DP-05 |
| KI-39 | Az FMP hivatalos árlista/ToS oldalai a mi eszközeinkkel **HTTP 403**-at adnak; a 250/nap keret `[HARMADIK FÉL]`. | K | A képességeket élő próbával igazoltuk; a napi keretet és a ToS-t a tulajdonos a fiók-dashboardon ellenőrizze. | tulajdonos |
| KI-40 | Az FMP/EODHD fixture-ök egyszeri próbaszkripttel készültek; **nincs a repóban rögzítő script** (a SEC-é van, D-047). | A | Új fixture-höz a DATA_SOURCES 11.6 eljárása; a script pótolható (EODHD-kvótát fogyaszt!). | 13 |
| KI-41 | A futó dev szerverek: a 8081-es (valószínűleg a tulajdonosé) és egy **8082-es** folyamat (egy korábbi ellenőrzésből, régi szerverkóddal) még fut. A 04B füstpróbája a 8083-as porton, saját, utána leállított szerveren futott. | A | **Teendő:** a régi szervereket le kell állítani / újraindítani (KI-27), különben a 04B végpontjai nem látszanak rajtuk. | tulajdonos |

## PHASE 04A – ismert problémák és leletek (2026-11-21)

| ID | Probléma / lelet | Hatás | Állapot / teendő | Felelős fázis |
|---|---|---|---|---|
| KI-17 | A spike idején a **8081-es porton már futott egy Expo dev szerver** (valószínűleg a tulajdonosé), amely a `.env.local` létrehozása előtt indult, ezért nem látta a `SEC_USER_AGENT`-et (health: `sec-edgar configured: false`). A saját ellenőrzés a 8082-es porton futott. | A | **Teendő:** env-változás után a dev szervert újra kell indítani (Ctrl+C, majd `npm start`). A futó folyamatot nem állítottuk le. | tulajdonos |
| KI-18 | Negyedéves SEC-adatnál a **Q2/Q3 cash flow tételek hiányoznak**: a 10-Q halmozott (YTD) cash flow-t ad, és a 3 hónapos időszak csak különbségképzéssel állna elő (`calculated`). | K (06) | **Tudatos (D-043):** `MISSING` + megjegyzés. **PHASE 06: NEM készült el** (D-060/4): a normalizáló eldobja a 6/9 hónapos tényeket, a különbségképzés a SEC-adapter bővítését igényli. Következmény: negyedéves FCF és TTM cash flow jellemzően `MISSING`; a szorzók ezért FY-alapúak (D-062). | 13, 15 |
| KI-19 | **Q4 nincs** a negyedéves készletben (a 10-K nem ad 3 hónapos Q4-et). | K (06) | **MEGOLDVA (PHASE 06, D-060/2):** az elemző réteg származtatja (`deriveQ4`), additív tételre, hézagmentes negyedévekkel; EPS a Q4-ben `MISSING`. Maradék: KI-52, KI-56. | 06 |
| KI-20 | Tag-lefedettség: a **JPM negyedéves árbevétele** és a **BRK-B EPS-e** `MISSING` (a cégek más tageket használnak, pl. bankoknál „RevenuesNetOfInterestExpense”). | A | **Őszintén `MISSING`.** Új tag felvétele csak valós fixture-rel igazolva (R-05), a PHASE 06-ban. | 06 |
| KI-21 | **US részvény tőzsdéje ISIN-ből nem határozható meg** az OpenFIGI-vel: ISIN-kérésre csak a kompozit `US` sor jön. | K | **04B: továbbra is nyitott.** Az EODHD is csak ország-szintű `US`-t ad, az FMP ISIN-keresése free-ben 402. Megkerülés: ticker-keresés (`/search?q=AAPL` → `AAPL@XNAS`) vagy FMP-profil. | 12 / DP-05 |
| KI-22 | Az OpenFIGI **nem ad jegyzési pénznemet** → `ListingCandidate.tradingCurrency: null`. | K | **04B: részben megoldva.** Az EODHD ISIN-keresése pénznemmel adja a jegyzéseket (`/search?q=ISIN`, és a `listings` tartaléka). A `listings` végpont elsődlegesen továbbra is az ingyenes OpenFIGI (pénznem nélkül), hogy ne fogyassza az EODHD 20/nap keretét. Az ár-végpontok mindig ismert pénznemet adnak (D-052). | 12 |
| KI-23 | A rate limiter (SEC 110 ms) és a ticker-memo **memóriabeli, példányonkénti**; az EAS Hosting / Workers példányai nem osztanak memóriát (U-03). | A (saját használat) | Elfogadva a D-008 mellett. Tartós/globális limiter: PHASE 13/15 (vagy Cloudflare KV, D-004 tartalék). | 13, 15 |
| KI-24 | **Nincs proxy cache:** minden kimutatás-kérés egy teljes SEC companyfacts letöltés (több MB). | K (költség, sebesség) | **Tudatos (D-044):** `no-store`. TTL-cache: PHASE 13 (ARCHITECTURE 11.: kimutatás 7 nap). | 13 |
| KI-25 | A **ticker → CIK leképezés változhat** (valós lelet: az XOM ticker új holding-CIK-re mutat, amely alatt még nincs 10-K → az éves készlet üres). | A | Kezelve: üres készlet + megjegyzés. A ticker-lista 24 órás memóban van. | – |
| KI-26 | A csak összehasonlító adatként szereplő éves időszakok címkéje a záródátum évéből jön (január 1–7. → előző év) `[FELTÉTELEZÉS]`. | A | Megjegyzés jelzi a kimenetben. A PHASE 06 felülvizsgálja (pl. 52/53 hetes, januári év végű cégek). | 06 |
| KI-27 | A dev szerver az API-route (szerver) kód változását **nem töltötte újra** (gyorsítótárazott szerver-bundle). | A | Szerverkód módosítása után a dev szervert újra kell indítani. | – |
| KI-28 | A címlapról (dei) vett részvényszám dátuma (`asOf`) **eltér** az időszak végétől (pl. JNJ: 2025-12-28 mérleg, 2026-02-06 címlap). | A | Az `asOf` és a `reference` jelzi (R-16). A PHASE 06 dönt a market cap-számításnál. | 06 |
| KI-29 | Az **EAS Hosting nem telepít „secret” típusú env-változót**, csak „plain text”/„sensitive”-et (Expo docs). Az EAS-próbatelepítés nem készült el. | K (kulcsok) | A D-004 Ideiglenes marad; a 04B-ben sem telepítettünk (tulajdonosi döntés, Expo-fiók kell). A kulcsokat „sensitive” változóként kell kezelni, vagy a Cloudflare Workers tartalék. Döntés: legkésőbb a PHASE 16 előtt. | 16 |

## PHASE 03 – ismert problémák és leletek (2026-11-21)

| ID | Probléma / lelet | Hatás | Állapot / teendő | Felelős fázis |
|---|---|---|---|---|
| KI-11 | **A PHASE 02 route-tesztjei kisbetűs meghajtójú munkakönyvtárból (`c:\…`, pl. VS Code terminál, Git Bash) pirosak voltak** (5/15: „Invalid hook call”). Ok: a Jest a modulokat `c:\` és `C:\` kulccsal kétszer töltötte be, így két React-példány keletkezett. PowerShellből (`C:\…`) zöldek voltak, ezért a PHASE 02 „15/15” eredménye csak onnan igaz. | K: hamis piros teszt a VS Code-ban | **Megoldva:** `jest.config.js` kanonikus `rootDir`-rel (D-041). Igazolva: kisbetűs útvonalról 98/98 zöld. | – |
| KI-12 | A PHASE 03-ban az appot **nem** indítottuk el emulátoron. Ellenőrizve: typecheck, lint, tesztek (a route-tesztek a valódi `_layout`-ot renderelik a Providerrel), `npx expo export --platform android` (Hermes bundle sikeres). Látható UI-változás nem történt. | A | **Nyitott.** A PHASE 04A-ban sem futtattuk emulátoron (nincs UI-változás); ellenőrizve: `npx expo export --platform android` (Hermes bundle, 3,6 MB) és a route-tesztek. Következő UI-változásnál: `npm run android`. | 12 |
| KI-13 | A portfólió-tároló memóriában él (`InMemoryPortfolioRepository`): az app újraindításakor az adatok elvesznek. | A most (nincs portfólió-UI) | **Tudatos (D-040).** SQLite: PHASE 13. | 13 |
| KI-14 | `live` adatmódban az árfolyam-lekérés `UPSTREAM / NOT_IMPLEMENTED` hibát ad. | A | **Megoldva (04B):** élő árfolyam FMP-ből (US) és EODHD-ből (US tartalék, Európa); proxy URL nélkül továbbra is őszinte `NOT_IMPLEMENTED`. Korábban (04A): `live` módban a proxy gateway-ek futnak (kimutatás, jegyzés, FX). Az árfolyamhoz nincs még élő forrás: `CAPABILITY_UNAVAILABLE` → `MISSING_DATA(['source'])`; proxy URL nélkül `NOT_IMPLEMENTED`. Árforrás: PHASE 04B. | 04B |
| KI-15 | A lokális ID-generátor `Math.random`-ot és időbélyeget használ (nem kriptográfiai UUID). Egy eszközön belül egyedi, eszközök között nem garantáltan. | A | **Nyitott.** Tartós tárolásnál felülvizsgálandó (pl. `expo-crypto` `randomUUID`). | 13 |
| KI-16 | Az ARCHITECTURE 7. tervében szereplő `Logger` port és az ARCHITECTURE 10. naplózás még nincs megvalósítva; az `FxGateway` és az `AiGateway` sem. | A | **Részben megoldva (04A):** `FxGateway` kész (`convertMoney`); szerveroldali JSON-napló kész (`src/server/logging.ts`). Kliensoldali `Logger` port még nincs (nincs használója); `AiGateway`: PHASE 11. | 11, 12 |

## PHASE 02 – ismert problémák és leletek (2026-11-21)

| ID | Probléma / lelet | Hatás | Állapot / teendő | Felelős fázis |
|---|---|---|---|---|
| KI-01 | `npm audit`: 22 közepes (moderate) súlyosságú sérülékenység, mind tranzitív, a fejlesztői eszközláncban (fő ok: `glob` 9.0.0–14.0.1 a Jest-függőségekben). Az `npm audit fix --force` törné az SDK 58-hoz pinnelt verziókat. | A: csak fejlesztői/teszt eszköz, nem kerül az appba | **Nyitott, tudatosan nem javítva.** Újraellenőrzés Expo/Jest patch-frissítéskor és a PHASE 15-ben. | 15 |
| KI-02 | Az npm 12 `allowScripts` alapból blokkolja a `@parcel/watcher` install-scriptjét (a Jest fájlfigyelőjéhez kell). Az előre fordított `@parcel/watcher-win32-x64` települt és betölthető. | A | **Nincs teendő.** Ha a `npm run test:watch` mégis hibát adna: `npm install-scripts approve @parcel/watcher`. | – |
| KI-03 | Az Expo docs szerinti `npx expo install … -- --dev` npm 12.2.0-val hatástalan, a csomag a `dependencies`-be kerül. `--save-dev`-vel sem került át minden csomag (`jest`, `jest-expo`, `@types/jest`, `eslint-config-expo`). | A | **Kerülőút:** `-- --save-dev`, és utána mindig ellenőrizni kell a `package.json`-t; ha kell, kézi áthelyezés + `npm install`. Rögzítve a README-ben és a fázisútmutatóban. | minden fázis |
| KI-04 | A felhasználói `Path` hivatkozik a `%ANDROID_HOME%`-ra és a `%JAVA_HOME%`-ra, de ezek nincsenek definiálva, és a `Path` registry-típusa `REG_SZ` (nem `REG_EXPAND_SZ`), így a hivatkozások nem oldódnak fel. Az `adb` nincs a PATH-ban. | A: az Expo CLI `ANDROID_HOME` nélkül is megtalálja az SDK-t az alapértelmezett helyen | **Nyitott (opcionális).** A javítás leírása: `docs/phases/phase-02-project-setup.md` 13.2. Gépbeállítást módosít, ezért a tulajdonos dönt róla; a PHASE 02-ben nem futtattuk. | tulajdonos |
| KI-05 | A JDK az Android Studio JBR-je (OpenJDK 25.0.3), a `JAVA_HOME` nincs beállítva. A helyi natív build (`npx expo run:android`, development build) JDK-követelménye RN 0.88 / Gradle mellett nincs igazolva. | A most (Expo Go) / K dev buildnél | **Nyitott.** Akkor kell ellenőrizni, amikor development buildre váltunk (D-002). | dev build döntéskor |
| KI-06 | A sablon néhány SDK 58-as függősége jelenleg nincs használva (`@expo/ui`, `expo-glass-effect`, `expo-device`, `expo-symbols`, `expo-web-browser`, `expo-image`, `react-native-reanimated`/`worklets`, `react-native-gesture-handler`). | A: Expo Go-ban nincs költsége, natív buildben méretet növel | **Nyitott.** A PHASE 12 a UI-döntések után eltávolíthatja a feleslegeseket (D-029). | 12 |
| KI-07 | A web platform (`npm run web`, `web.output: "server"`) nincs tesztelve. Nem célplatform, de az API route-ok (proxy) ugyanerre a szerverkimenetre épülnek. | A | **Nyitott.** A PHASE 04A spike ellenőrzi az API route-okat. **04A:** az API route-ok lokálisan működnek (`npx expo start`), a `npx expo export --platform web` szerver-bundle elkészül; a web UI továbbra sem tesztelt. | 04A |
| KI-08 | Az SDK 58-as Expo Go **store-verziójának** elérhetőségét nem ellenőriztük. Emulátoron az Expo CLI maga telepítette az Expo Go 58.0.5-öt. | A emulátoron / K saját telefonon | **Nyitott.** Saját telefonos teszt előtt a store-verziót ellenőrizni kell; tartalék: USB + `npm run android` vagy development build. | 12 vagy 16 |
| KI-09 | Az RNTL 14 `render`/`fireEvent` aszinkron. `await` nélkül átfedő `act()` hívások keletkeznek, és a *következő* tesztek véletlenszerűen buknak. | – | **Megoldva:** `await` + `@typescript-eslint/no-floating-promises` lint-szabály (D-030, D-032). | – |
| KI-10 | A `<Link asChild>` + függvény formájú `Pressable` `style` miatt a gomb háttere eltűnt (emulátoron észlelve). | – | **Megoldva:** statikus style a `PrimaryButton`-ban + regressziós teszt (D-034). | – |

A DP-01…DP-04 döntési pontokra 2026-11-21-én megjött a válasz. A DP-05 tudatosan nyitva marad; a terv ehhez igazodik (D-027).

## Döntési pontok

| ID | Kérdés | Válasz (2026-11-21) | Hatás |
|---|---|---|---|
| **DP-01** | Milyen piacokat akarsz elemezni? | US részvények és ETF-ek, európai UCITS ETF-ek és részvények, globális ETF-ek és részvények | D-023, D-025 |
| **DP-02** | Saját használat vagy nyilvános kiadás? | Csak saját használat | D-008 Elfogadva |
| **DP-03** | Melyik árfolyam-szolgáltató? | FMP és EODHD kulcs megvan. Ha más is ajánlott, ahhoz is legyen adapter. | D-024: + SEC EDGAR, ECB/Frankfurter, OpenFIGI adapter (ingyenesek, kiegészítők) |
| **DP-04** | AI-költség, modell | Lehetőleg ingyenes, de maradjon más lehetőség | D-026: szabályalapú összefoglaló az alap, LLM opcionális |
| **DP-05** | Fizetős adatforrás a nem US lefedettségért? | **Nyitott**, később dönt; ne legyen kizárva | D-027: csomagszint konfigurációból, appkiadás nélkül bekapcsolható |

**Megválaszolva (04B, U-13):** mindkét kulcs **free** csomagú (EODHD `/api/user`: `subscriptionType: free`, `dailyRateLimit: 20`; FMP: élő próbák – nem US szimbólum és ETF-végpontok 402).

## Kockázatok

| ID | Kockázat | V | H | Mitigáció | Felelős fázis |
|---|---|---|---|---|---|
| R-01 | **A nem US lefedettség ingyenesen erősen korlátozott:** EODHD free 20 hívás/nap és 1 év történet; nem US fundamentum free-ben nincs. A célpiac viszont US + Európa + globális (D-023). | M | M | Kvóta-költségvetés és prioritás (DATA_SOURCES 5.3); inkrementális frissítés; cache; ár alapú elemzés; őszinte `PLAN_LIMIT` jelölés; fizetős bővítés konfigurációval (D-027) | 04B |
| R-02 | Az ingyenes csomagok „personal/internal use” feltételűek. **Megoldva:** csak saját használat (D-008). A feltételeket így is be kell tartani (pl. az adat nem osztható meg másokkal). | A | A | D-008; DATA_SOURCES 7.6 | 04 |
| R-03 | **Nincs igazolt ingyenes ETF holdings forrás.** | M | K | Holdings az MVP-n kívül; SEC N-PORT vizsgálat (csak US alapok); kézi metaadat | 08 |
| R-04 | Rate limitek (SEC 10/mp; Tiingo 50/óra; FMP 250/nap; AV 25/nap). | K | K | Proxy cache; deduplikált kérések; adattípusonkénti TTL; 429-kezelés `retryAfter`-rel | 04, 13 |
| R-05 | **A SEC XBRL tagek heterogének** (pl. több árbevétel-tag, adósság-komponensek duplázása), ami hibás mutatókat okozhat. | M | M | Tag-fallback lista; 10+ valós cég fixture-tesztje; a provenance-ben a használt tag; `MISSING`, ha bizonytalan **04A:** 12 valós cég fixture-je, tag-prioritás valós adaton javítva (Revenues elöl, Domestic kizárva), a `reference` a használt taget mutatja, a totalDebt szándékosan MISSING (D-043). | 04, 06 |
| R-06 | Az SDK 58-as Expo Go store-elérhetősége nem igazolt; a `create-expo-app` alapból SDK 57-et adhat. **PHASE 02: kezelve.** Explicit `--template default@sdk-58`; emulátoron az Expo CLI telepítette az Expo Go 58.0.5-öt. Saját telefonhoz lásd KI-08. | A | K | Explicit SDK 58 sablon; Expo Go CLI-ből Android emulátorra; szükség esetén development build | 02 ✅ |
| R-07 | **Proxy visszaélés:** fiók nélkül bárki hívhatja a végpontot, aki ismeri az URL-t. | K | K | Allowlist, validáció, rate limit, cache, AI kill switch és napi keret; később app attestation | 04, 11, 15 |
| R-08 | Az EAS Hosting rate-limit/KV képessége nem ismert (U-03). | K | K | Spike a 04-ben; tartalék: Cloudflare Workers (D-004) **04A:** U-03 megválaszolva: nincs KV/rate-limit primitív → memóriabeli limiter (KI-23); a Cloudflare-tartalék indoka erősödött. | 04 |
| R-09 | AI-költség és hallucináció. | K | M | Strukturált kimenet + zod; `basedOn`; csak számított bemenet; cache; költségkorlát; az AI opcionális | 11 |
| R-10 | Jogi: a BUY/SELL címkék nyilvános kiadásnál befektetési ajánlásnak minősülhetnének (MiFID II / MAR, jogi ellenőrzés kellene). **Saját használatnál nem releváns** (D-008); csak akkor, ha a DP-02 megváltozik. | A | A | Jogi nyilatkozat; konfigurálható címkék | 10 |
| R-11 | Késői integráció: a UI csak a 12-ben jön, így a hibák későn derülnek ki. | K | K | Use case-integrációs tesztek a 04-től; opcionális dev-diagnosztika képernyő (ROADMAP kiegészítések 2.) | 04–11 |
| R-12 | Lebegőpontos kerekítési hiba. | A | K | Kerekítés csak a megjelenítésnél; tűréses tesztek; D-009 felülvizsgálata a 09-ben | 05, 09 |
| R-13 | Adatvédelem: a portfólió összetétele AI-hívással az LLM-szolgáltatóhoz kerül. | K | K | Explicit, egyszeri beleegyezés; minimális DTO (súlyok és típusok, összegek nélkül, ha elég) | 11 |
| R-14 | Strict TypeScript API (RN 0.87+): harmadik fél csomagjai típushibát okozhatnak. | K | A | Csak kompatibilis csomag; a `customConditions` opt-out csak végső esetben, dokumentálva (RN 0.89 után megszűnik) | 02, 12 |
| R-15 | Windows környezet: az `ANDROID_HOME` nincs beállítva, az `adb` nincs a PATH-ban. **PHASE 02: az Expo CLI nélküle is működik** (alapértelmezett SDK-hely); az opcionális javítás dokumentálva (KI-04). | A | A | Lépésenkénti útmutató a 02-ben (fázisútmutató 13.2) | 02 ✅ |
| R-16 | A `sharesOutstanding` (címlap) dátuma eltér az ár dátumától, ami torzítja a market capet. | K | A | `asOf` megjelenítése; a dátumeltérés jelzése | 06 |
| R-17 | ADR / külföldi filer: a beszámoló pénzneme eltér a jegyzés pénznemétől. | K | K | DATA_DICTIONARY 4.3/8: FX-konverzió dátummal; hiányában `MISSING` | 06, 07 |
| R-18 | DCF egyszerűsítés: az FCF (OCF − CapEx) nem tiszta FCFF. | M | K | Jelölés a UI-ban; a 07 dönthet FCFF-közelítésről (D-022) | 07 |
| R-19 | A szolgáltatói feltételek és keretek változnak (az ellenőrzés 2026-11-21-i). | K | K | Újraellenőrzés minden adatfázisban; adapter-minta a cseréhez | 04, 16 |
| R-20 | Az app-szintű adatbázis-titkosítás nem elérhető Expo Go-ban (SQLCipher). | M | A | OS szintű eszköztitkosítás; O-05 opcionális dev builddel | 13 |
| R-21 | Több szolgáltató, eltérő definíciókkal (pl. FMP vs SEC árbevétel), ami inkonzisztens mutatókat okozhat. | K | M | „Egy adatsor = egy forrás”; nincs csendes keverés; provenance a ténylegesen használt forrással; contract tesztek szolgáltatónként | 04B |
| R-22 | EODHD free kvóta: 20 hívás/nap. Egy fundamentum-kérés 10, egy bulk 100 hívás, így free-ben gyakorlatilag nincs fundamentum és bulk; kb. 15–18 nem US instrumentum frissíthető naponta. | M | K | Kvóta-költségvetés; prioritás (portfólió > watchlist > keresés); `/api/user` (0 hívás); a 402/429 kezelése | 04B |
| R-23 | Az FMP free lefedettsége és feltételei hivatalos forrásból nem igazoltak (két hivatalos URL is 403). | K | K | **04B:** a lefedettség élő próbával igazolva (csak US, annak is egy része); a ToS és a keret a dashboardon ellenőrizendő (KI-39) | tulajdonos |
| R-24 | API-kulcs szivárgása (chatbe illesztés, véletlen commit). **PHASE 02:** `.gitignore` → `.env*` + `!.env.example`, `git check-ignore` ellenőrizve. | K | M | Kulcs csak `.env.local`-ba (gitignore), soha chatbe; a PHASE 02 `.gitignore`-ja; secret-scan a PHASE 15-ben | 02 ✅, 04, 15 |
| R-25 | A PHASE 04 túl nagy egy chathez. | M | K | D-028: 04A + 04B **04A:** a 04A egy chatben elkészült (D-028 Elfogadva). | 04 |
| R-26 | Ugyanaz az ETF több tőzsdén és devizában forog, ami rossz listing választásához és téves P/L-hez vezethet. **PHASE 03:** az `Instrument`/`Listing` modell és a listinghez kötött `Transaction` elkészült. | K | K | D-025 Security/Listing; a pozíció listinghez kötött; a keresés listinget kínál | 03 ✅, 09 |
| R-27 | Az ECB kb. 30 devizát közöl. Globális listingeknél lehet olyan deviza, ami nincs benne. | K | K | `MISSING` státusz; opcionálisan a Frankfurter más központi banki forrása, külön provenance-szel **04A:** megvalósítva: az ECB-n kívüli deviza `missing` listába kerül, átváltáskor `MISSING_DATA` (D-046). | 04A |

## Ismeretlenek (ellenőrizendő)

| ID | Kérdés | Ki ellenőrzi |
|---|---|---|
| ~~U-01~~ | **Lezárva (PHASE 02):** React **19.3.0**, RN 0.88.1 (sablon + `npm ls` + `expo install --check`) | – |
| U-02 | Az SDK 58-as Expo Go store-verziója megjelent-e. **PHASE 02 részeredmény:** emulátorra a CLI telepíti (Expo Go 58.0.5); a store-t nem ellenőriztük → KI-08 | saját telefonos teszt előtt |
| U-03 | Van-e az EAS Hostingon tartós rate-limit/KV primitív, vagy elég-e a memóriabeli | **Megválaszolva (04A):** nincs ilyen primitív (Expo docs); a memóriabeli limiter példányonkénti (KI-23). |
| U-04 | Az FMP free keretei és licence hivatalos forrásból (most `[HARMADIK FÉL]`) | **Részben (04B):** képességek élő próbával igazolva; a keret és a ToS oldala 403 → a tulajdonos dashboardja (KI-39) |
| U-05 | ~~Alpha Vantage ToS~~ – nem releváns, nincs adapter (D-024) | – |
| U-06 | ~~Tiingo lefedettség~~ – nem releváns, amíg nincs Tiingo adapter (D-024) | – |
| U-07 | SEC `company_tickers.json` (ticker → CIK) elérhetősége és formátuma | **Lezárva (04A):** elérhető, `{ "0": { cik_str, ticker, title } }`, 10 399 sor; User-Agent nélkül 403. |
| ~~U-08~~ | A SEC N-PORT használhatósága US ETF holdingsra | **Megválaszolva (PHASE 08, élő próba):** használható; negyedéves (nyilvános a negyedév-végi hónap), ~60 nap késleltetés, teljes lista súllyal, országgal, ISIN-nel, devizával; szektor nincs; UCITS nincs (DATA_SOURCES 13.) |
| U-09 | A `@anthropic-ai/sdk` futása az EAS Hosting runtime-on | PHASE 11 |
| U-10 | `Intl` (hu-HU) támogatás Hermesen mindkét platformon | PHASE 12 |
| U-11 | Grafikonkönyvtár kompatibilitása SDK 58 / RN 0.88 / New Architecture mellett | PHASE 12 |
| ~~U-12~~ | **Lezárva (PHASE 02):** `npx create-expo-app@5.0.0 <név> --template default@sdk-58` (SDK 58 changelog; `expo-template-default` `sdk-58` = 58.0.35) | – |
| U-13 | A meglévő FMP és EODHD kulcs csomagszintje (free vagy fizetős) | **Megválaszolva (04B):** mindkettő free (DATA_SOURCES 11.) |
| U-14 | EODHD free: mely végpontok érhetők el (fundamentum? live/delayed?), történetmélység | **Megválaszolva (04B):** EOD (1 év), késleltetett live, osztalék, keresés igen; fundamentum 403 (DATA_SOURCES 11.2) |
| U-15 | FMP free: van-e nem US lefedettség, ETF-adat | **Megválaszolva (04B):** nincs (402); a keresés viszont nem US jegyzéseket is listáz (DATA_SOURCES 11.1) |
| U-16 | Ingyenes LLM-lehetőségek (lokális modell, más szolgáltatók free kerete) | PHASE 11 |

## Promptcsomag-ellentmondások (feloldva: D-020)

| ID | Ellentmondás | Feloldás | Javaslat a tulajdonosnak |
|---|---|---|---|
| PI-01 | A `00_KEZDES_ES_HASZNALAT.md` a PHASE 02-höz „Expo SDK 57”-et ír; a 12, 13, 14 és 16-os prompt is SDK 57-et említ. A CLAUDE.md és a 01/02 SDK 58-at. | **SDK 58** (a CLAUDE.md az irányadó) | Javítsd a promptokban az „SDK 57”-et „SDK 58”-ra |
| PI-02 | A 02, 03 és 04-es prompt „Equity Analyst” néven hivatkozik a projektre. | Ugyanaz a projekt: Stock & ETF Analyzer | Névcsere a promptokban |
| PI-03 | A 02-es prompt a `docs/00_PROJECT_INSTRUCTION.md`-t kéri. | A valós fájl a gyökérben lévő `CLAUDE.md` (tartalma azonos a `00_PROJECT_INSTRUCTIONS.md`-vel) | Útvonal javítása a 02-es promptban |
| PI-04 | A 02-es prompt a `docs/phase-01-handoff.md`-t kéri. | A valós hely: `docs/handoffs/phase-01-handoff.md` (a CLAUDE.md konvenciója) | Útvonal javítása a 02-es promptban |
| PI-05 | Egyik prompt sem rendeli fázishoz a backend/proxy építését. | ROADMAP „kiegészítések” 1. pont | – |
| PI-06 | A 02-es prompt (aktuális változat) a `docs/handoffd/phase-01-handoff.md`-t kéri (elírás: „handoffd”). | A valós hely: `docs/handoffs/phase-01-handoff.md` | Elírás javítása a 02-es promptban |
| PI-07 | A 03-as prompt a `docs/phases/phase-02-handoff.md`-t kéri, és „Equity Analyst” néven hivatkozik a projektre. | A valós hely: `docs/handoffs/phase-02-handoff.md`; a név: Stock & ETF Analyzer (PI-02) | Útvonal javítása a 03-as promptban |
| PI-08 | A 03-as prompt `Instrument`, `Stock`, `Etf` modelleket kér, a D-025 `Security`/`Listing` fogalmakat használ. | `Instrument = Stock \| Etf` a Security típusneve, a `Listing` külön (D-035) | – |
