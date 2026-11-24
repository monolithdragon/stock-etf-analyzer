# PHASE 12 – UI/UX, navigáció és elemzési képernyők (kezdőbarát útmutató)

> Dátum: 2026-11-23 · Állapot: **KÉSZ** (Jest + Metro bundle igazolva; emulátoron még nem futott – KI-100) · Átadás: [../handoffs/phase-12-handoff.md](../handoffs/phase-12-handoff.md)
> Döntések: **D-079, D-080, D-081** ([../DECISIONS.md](../DECISIONS.md)) · Struktúra: [../ARCHITECTURE.md](../ARCHITECTURE.md) 5.2

Ez az útmutató lépésenként bemutatja, mi készült a PHASE 12-ben, miért, és hogyan ellenőrizheted.
- A **teljes, aktuális kód a repóban van** a megadott útvonalakon (kb. 5 900 új sor a `src`-ben, ebből ~850 teszt). Itt a lényeges részeket mutatjuk; a kód soronkénti másolása helyett a fájlt nyisd meg a VS Code-ban (Ctrl+P, majd a fájlnév).
- Új npm-csomag **nem** került be.

> **A legfontosabb szabályok a UI-ban:**
> 1. A képernyő **nem számol** és **nem dönt**: minden szám és címke a use case-ekből jön (`useAppServices()`).
> 2. A hiányzó adat **N/A** / **N/M**, soha nem 0 – és koppintásra látszik az oka.
> 3. A szín soha nem az egyetlen jelzés: mellette előjel (`+`/`-`), ikon (▲ ▼ ⚠ ℹ) vagy szöveg.
> 4. Buy/Sell címke csak akkor jelenik meg, ha a döntési motor adta; adathiánynál „○ Nem értékelhető”.

## Tartalom
0. Szakszavak röviden
1. Indulóállapot ellenőrzése
2. Áttekintés: mi készült és hol van
3. 1. lépés – Navigáció: tabok + Stack
4. 2. lépés – Közös formázók (`format/`)
5. 3. lépés – Téma: kontraszt, érintési méret, betűméret, sötét mód
6. 4. lépés – Lekérési állapotok (`useAsyncResult` + állapotkomponensek)
7. 5. lépés – Mutatósor provenance-nézettel (`MetricRow`)
8. 6. lépés – View-modelek: részvény, ETF, portfólió KÜLÖN
9. 7. lépés – Képernyők
10. 8. lépés – Magyarázat-szekció (szabályalapú + AI kérésre)
11. 9. lépés – Portfólió létrehozása: új use case
12. 10. lépés – Grafikon: miért nincs könyvtár
13. Tesztek és ellenőrzés
14. Kézi ellenőrzés emulátoron (a tulajdonos teendője)
15. Gyakori hibák és javításuk
16. Befejezési feltételek

---

## 0. Szakszavak röviden

| Szó | Jelentés |
|---|---|
| **Route** | Egy útvonal (pl. `/search`), amelyhez egy fájl tartozik az `src/app` mappában. Az Expo Router a fájlnévből készíti a navigációt. |
| **Tab** | Alsó fül a képernyő alján (Kezdőlap, Keresés …). |
| **Stack** | „Egymásra rakott” képernyők: az új képernyő ráúszik a régire, és van **vissza** gomb. |
| **`(tabs)` mappa** | A zárójeles mappanév csoport: nem kerül bele az URL-be (a `(tabs)/search.tsx` útvonala `/search`). |
| **`[listingId]`** | Dinamikus útvonal-paraméter: a `/stock/DEMO@XNAS` címben a `listingId` = `DEMO@XNAS`. |
| **View-model** | Tiszta függvény, amely a use case eredményéből „megjeleníthető” adatot készít (szöveg, státusz, részletek). React nélkül tesztelhető. |
| **Provenance** | Az adat eredete: forrás, lekérés ideje, adatnap, frissesség, időszak, pénznem. |
| **N/A, N/M** | *Not Available* (nincs adat / nem alkalmazható), *Not Meaningful* (nem értelmezhető, pl. negatív nevező). |
| **Kontraszt (WCAG AA)** | Szöveg és háttér fényerő-aránya. Normál szövegnél legalább 4,5:1 kell, hogy gyengénlátók is olvassák. |
| **Smoke teszt** | Gyors „füstpróba”: elindul-e, és eljut-e a fő folyamat a végéig. |

## 1. Indulóállapot ellenőrzése

**Hol:** a projekt gyökerében (`c:\Users\lujzi\Documents\stock-etf-analyzer`), VS Code terminálban (*Terminal → New Terminal*).

```bash
git status            # elvárt: a phase-12 branchen vagy (ha a tulajdonos commitolta) tiszta munkafa
git branch --show-current
npm run check         # typecheck + lint + Prettier + tesztek
```

**Elvárt eredmény:** `npm run check` exit 0, a végén `Tests: 1447 passed, 1447 total` (81 suite).

## 2. Áttekintés: mi készült és hol van

```
src/app/                         VÉKONY route-fájlok (paraméter → képernyő)
├─ _layout.tsx                   gyökér: szolgáltatók (AppServices, Settings, Watchlist) + téma + Stack
├─ (tabs)/_layout.tsx            alsó fülek
├─ (tabs)/index.tsx              Kezdőlap
├─ (tabs)/search.tsx             Keresés
├─ (tabs)/portfolio.tsx          Portfólió
├─ (tabs)/watchlist.tsx          Figyelő
├─ (tabs)/settings.tsx           Beállítások
├─ stock/[listingId].tsx         Részvényelemzés
├─ etf/[listingId].tsx           ETF-elemzés
├─ compare.tsx                   Összehasonlítás (váz)
└─ about.tsx, +not-found.tsx     (változatlan)

src/presentation/
├─ format/        formázók: pénz, %, szorzó, nagy szám, dátum, N/A/N/M, hibaüzenet
├─ theme/         + contrast.ts, téma-preferencia (rendszer/világos/sötét), érintési méret
├─ hooks/         use-async-result.ts (betöltés / hiba / siker / újratöltés)
├─ components/    + MetricRow, Section, StatusBadge, állapotok, WeightBars, ListItem, TextField, gombok
├─ view-models/   stock-, etf-, portfolio-, evaluation-view-model, metric-row
├─ analysis/      döntéskártya, score-részletek, magyarázat-szekció, fejléc
├─ screens/       a képernyők (home, search, stock-analysis, etf-analysis, portfolio, watchlist, compare, settings)
├─ state/         beállítások és figyelőlista (memóriában)
└─ navigation.ts  útvonal-építők

src/application/use-cases/create-portfolio.ts   ÚJ use case
```

**Miért ilyen a bontás?** A prompt azt kéri, hogy a részvény-, ETF- és portfólió-képernyő **külön logikát** használjon, és ne legyenek óriás komponensek. A logika (mit és hogyan mutatunk) a view-modelekben van, és tesztelhető; a képernyő csak elrendez.

## 3. 1. lépés – Navigáció: tabok + Stack

**Cél:** a fő funkciók egy koppintásra elérhetők legyenek (alsó fülek), az elemzések pedig „ráússzanak” vissza gombbal.
**Előfeltétel:** Expo Router (már telepítve). Új csomag nem kell.
**Fájlok:** [`src/app/_layout.tsx`](../../src/app/_layout.tsx), [`src/app/(tabs)/_layout.tsx`](<../../src/app/(tabs)/_layout.tsx>).

A tabok importja SDK 58-ban (a régi `import { Tabs } from 'expo-router'` elavult – a csomag típusdefiníciója szerint):

```tsx
import { Tabs } from 'expo-router/js-tabs';
```

A gyökér-Stack (részlet):

```tsx
<Stack.Screen name="(tabs)" options={{ headerShown: false }} />
<Stack.Screen name="stock/[listingId]" options={{ title: strings.stock.title }} />
<Stack.Screen name="etf/[listingId]" options={{ title: strings.etf.title }} />
<Stack.Screen name="compare" options={{ title: strings.compare.title }} />
<Stack.Screen name="about" options={{ title: strings.about.title }} />
```

Egy route-fájl teljes tartalma (ilyen vékony mind):

```tsx
// src/app/stock/[listingId].tsx
import { Stack, useLocalSearchParams } from 'expo-router';

import { StockAnalysisScreen } from '@/presentation/screens/stock-analysis-screen';
import { strings } from '@/presentation/strings/hu';

export default function StockRoute() {
  const { listingId } = useLocalSearchParams<{ listingId: string }>();
  const id = typeof listingId === 'string' ? listingId : '';
  return (
    <>
      <Stack.Screen options={{ title: id === '' ? strings.stock.title : id }} />
      <StockAnalysisScreen listingId={id} />
    </>
  );
}
```

**Ellenőrzés:** `npm run typecheck` hibátlan. Ha „Type '"/search"' is not assignable …” hibát kapsz, lásd a 15. fejezetet (typed routes).

## 4. 2. lépés – Közös formázók (`format/`)

**Cél:** minden képernyő ugyanúgy írja ki a pénzt, a százalékot, a nagy számokat, a dátumot és a hiányt.
**Miért kézzel, `Intl` nélkül?** A telefon JavaScript-motorja (Hermes) és a tesztkörnyezet (Node) magyar formázási adatai eltérhetnek. Így a kimenet mindenhol azonos és tesztelt (D-080/1).
**Fájl:** [`src/presentation/format/formatters.ts`](../../src/presentation/format/formatters.ts), hibákhoz [`errors.ts`](../../src/presentation/format/errors.ts).

| Függvény | Példa bemenet | Kimenet |
|---|---|---|
| `formatNumber(1234567.891)` | | `1 234 567,89` |
| `formatPercent(0.153)` | tört! (0.153 = 15,3%) | `15,3%` |
| `formatPercent(0.023, { signed: true })` | | `+2,3%` |
| `formatMoney(1234.5, 'USD')` | | `1 234,50 USD` |
| `formatMoney(1234.5, 'HUF')` | HUF egészre | `1 235 HUF` |
| `formatLargeNumber(1_234_000_000)` | | `1,23 Mrd` |
| `formatMultiple(18.43)` | | `18,4x` |
| `formatDate('2026-11-23')` | | `2026. 11. 23.` |
| `formatMetric({ status: 'NOT_MEANINGFUL', reason: '…' }, 'ratio')` | | `N/M` (+ az ok külön mezőben) |

A hiányzó adat jelölései: `N/A` (hiányzik / nem alkalmazható), `N/M` (nem értelmezhető), „Kevés adat”, „Nem elérhető” (pl. free csomag), „Hibás bemenet”, „Hiba”. **Soha nem „0”.**

**Ellenőrzés:** `npx jest src/presentation/format` → `Tests: 23 passed`.

## 5. 3. lépés – Téma: kontraszt, érintési méret, betűméret, sötét mód

**Cél:** jól olvasható legyen világos és sötét módban, nagy betűmérettel is, és a gombok könnyen eltalálhatók.
**Fájlok:** [`theme/colors.ts`](../../src/presentation/theme/colors.ts), [`theme/tokens.ts`](../../src/presentation/theme/tokens.ts), [`theme/contrast.ts`](../../src/presentation/theme/contrast.ts), [`theme/use-theme.ts`](../../src/presentation/theme/use-theme.ts).

- **Kontraszt:** a teszt minden szövegszínt minden felületen ellenőriz (≥ 4,5:1). A régi világos `primary` (#1F6FEB) a háttéren csak 4,32 volt, ezért sötétebb lett. Új világos értékek: `primary #1B62D4`, `positive #18723A`, `negative #BF1F2B`, `warning #8A5D00`, `info #0862C8`.
- **Érintési méret:** `minTouchTarget = 48` (dp) – minden gomb és sor legalább ekkora.
- **Betűméret:** az `AppText` követi a telefon betűméret-beállítását, 1,8× felső korláttal (`maxFontSizeMultiplier`).
- **Számok:** `number` és `numberLarge` betűstílus `tabular-nums`-szal (a számjegyek egyforma szélesek → oszlopba rendeződnek).
- **Téma-választás:** Beállítások → Megjelenés: Rendszer / Világos / Sötét. A `useTheme()` a `ThemePreferenceContext`-ből olvassa.

**Ellenőrzés:** `npx jest src/presentation/theme` → minden teszt zöld (köztük „minden szövegszín minden felületen olvasható”).

## 6. 4. lépés – Lekérési állapotok

**Cél:** minden lekérésnél legyen betöltés, hiba + újrapróbálás, üres állapot, és jelezve legyen a demó-, elavult és részleges adat.
**Fájlok:** [`hooks/use-async-result.ts`](../../src/presentation/hooks/use-async-result.ts), [`components/states.tsx`](../../src/presentation/components/states.tsx).

Használat egy képernyőn:

```tsx
const services = useAppServices();
const { state, reload, refreshing } = useAsyncResult(
  () => services.evaluateStock(listingId),
  [services, listingId],
);

if (state.status === 'loading') return <LoadingState />;
if (state.status === 'error') return <ErrorState error={state.error} onRetry={reload} />;
// state.status === 'success' → state.data
```

| Állapot | Mit lát a felhasználó |
|---|---|
| betöltés | forgó jel + „… betöltése” (képernyőolvasó is bemondja) |
| hiba | ⚠ cím (pl. „Nem található”, „Nincs kapcsolat”) + részlet + **Újrapróbálás** gomb |
| üres | szaggatott keretes doboz magyarázattal (pl. „Még nincs portfólió”) |
| demóadat | ℹ „Demóadat – kitalált, nem valós adatok” |
| elavult | ⚠ „Elavult adat” |
| részleges | ⚠ „Részleges adat: X fő mutató hiányzik …” |
| frissítés | lehúzásra: a régi adat látszik „Frissítés folyamatban” jelzéssel |

**Különleges szabály (D-081/3):** ha egy részvénynél **minden** forrás hibás (pl. elírt ticker), nem egy csupa N/A oldal jelenik meg, hanem hibaállapot újrapróbálással.

## 7. 5. lépés – Mutatósor provenance-nézettel

**Cél:** minden számhoz kérésre látható legyen a forrás, az időszak, a pénznem, a frissesség és a hiány oka (CLAUDE.md, adatintegritási szabály 4.).
**Fájlok:** [`view-models/metric-row.ts`](../../src/presentation/view-models/metric-row.ts) (tiszta leképezés), [`components/metric-row.tsx`](../../src/presentation/components/metric-row.tsx) (megjelenítés).

Egy sor: bal oldalon a mutató neve (pl. „P/E”), alatta kiegészítő (pl. „FY2025”, „magas sáv”), jobb oldalon az érték (`18,4x`) vagy dőlt, szürke `N/A`. **Koppintásra** kinyílik:

```
Állapot: hiányzó adat
Ok: A(z) „marketCap” bemenet nem használható (MISSING): …
Eredet: hiányzik
Forrás: SEC EDGAR · Adat típusa: jelentett · Lekérve: 2026. 11. 23. 16:05
Adatnap: 2025. 12. 31. · Frissesség: friss · Időszak: FY2025 (…) · Pénznem: USD
Képlet / definíció: …
```

## 8. 6. lépés – View-modelek: részvény, ETF, portfólió KÜLÖN

**Cél:** az elfogadási feltétel – „Stock, ETF és portfólió képernyő külön logikát használ” – és a tesztelhetőség.

| Fájl | Bemenet (use case) | Szakaszok |
|---|---|---|
| [`stock-view-model.ts`](../../src/presentation/view-models/stock-view-model.ts) | `evaluateStock` | ár és alapadatok, értékeltség (sávval), növekedés (+ CAGR), jövedelmezőség, mérleg, cash flow, kockázat, DCF (bemenetek, Bear/Base/Bull, érzékenységi tábla), adatminőség |
| [`etf-view-model.ts`](../../src/presentation/view-models/etf-view-model.ts) | `evaluateEtf` | alapadatok, TER/AUM, benchmark, holdings, országok, szektorok, súlyozás/stílus, osztalék, követés, kockázat, hozam (+ összehasonlítási alap), nem alkalmazható mutatók, adatkorlátok |
| [`portfolio-view-model.ts`](../../src/presentation/view-models/portfolio-view-model.ts) | `analyzePortfolio` | összérték, P/L bázisban és natívan, pozíciók, allokáció, devizakitettség, koncentráció, ETF-átfedés, historikus kockázat, módszer és adózási figyelmeztetés, FX-ráták |
| [`evaluation-view-model.ts`](../../src/presentation/view-models/evaluation-view-model.ts) | `InstrumentEvaluation` (közös) | döntés, összpont, kategóriák, confidence, tézis |

Két fontos részlet:
- **Ár nélküli pozíció** (portfólió): nem 0%-os sávként jelenik meg az allokációban, hanem külön listában („ár nélkül, súly nem számolható”), és az összérték „≥ … (részösszeg)” lesz, a hiányzó tétel megnevezésével.
- **Döntés:** a címke szövege a motoré (`decision.labelText`); a view-model csak tónust (szín + ikon) rendel hozzá. `NOT_RATED` → semleges „○”.

## 9. 7. lépés – Képernyők

| Képernyő | Fájl | Megjegyzés |
|---|---|---|
| Kezdőlap | [`home-screen.tsx`](../../src/presentation/screens/home-screen.tsx) | szándékosan kevés elem: adatmód, „Ticker keresése”, figyelőlista-előnézet |
| Keresés | [`search-screen.tsx`](../../src/presentation/screens/search-screen.tsx) | csak gombnyomásra keres (kvóta!); találat → elemzés; „Hozzáadás a figyelőlistához” |
| Részvény | [`stock-analysis-screen.tsx`](../../src/presentation/screens/stock-analysis-screen.tsx) | összecsukható szakaszok; az „Ár és alapadatok” alapból nyitva |
| ETF | [`etf-analysis-screen.tsx`](../../src/presentation/screens/etf-analysis-screen.tsx) | az adatkorlátok kártyája mindig látszik |
| Portfólió | [`portfolio-screen.tsx`](../../src/presentation/screens/portfolio-screen.tsx), [`portfolio-forms.tsx`](../../src/presentation/screens/portfolio-forms.tsx) | üres állapot → létrehozás → tranzakció-űrlap; a historikus kockázat csak gombnyomásra (kvóta) |
| Figyelő | [`watchlist-screen.tsx`](../../src/presentation/screens/watchlist-screen.tsx) | memóriában; árat nem tárol |
| Összehasonlítás | [`compare-screen.tsx`](../../src/presentation/screens/compare-screen.tsx) | VÁZ: csak csoportosítás, szám nélkül (PHASE 14) |
| Beállítások | [`settings-screen.tsx`](../../src/presentation/screens/settings-screen.tsx) | bázispénznem, téma, AI-gomb, adatforrás (csak megjelenítés – titok nincs) |

## 10. 8. lépés – Magyarázat-szekció

**Fájl:** [`analysis/explanation-section.tsx`](../../src/presentation/analysis/explanation-section.tsx).

- A képernyő az **alkalmazási rétegben** építi az AI-bemenetet (`buildInstrumentAiInput`, `buildPortfolioAiInput`), a komponens csak megkapja.
- Megnyitáskor automatikusan a **szabályalapú** összefoglaló készül (offline, ingyenes), „Szabályalapú összefoglaló” címkével.
- Az **„AI-magyarázat kérése”** gomb csak akkor látszik, ha a Beállításokban bekapcsoltad (alapból KI). Portfóliónál előbb beleegyezés-panel jelenik meg.
- AI-válasz: „AI-értelmezés” címke + modell + időpont. Hiba esetén (pl. „Az AI-magyarázat ki van kapcsolva” – ez a proxy alapállapota) érthető üzenet, és a szabályalapú szöveg marad.
- Minden állítás alatt: „Alapja: …” (a `basedOn` hivatkozások); a „nincs elég adat” állítások dőlt, szürke betűvel.

## 11. 9. lépés – Portfólió létrehozása: új use case

**Miért kellett?** Tranzakciót csak létező portfólióba lehet rögzíteni, de eddig nem volt use case a létrehozásra.
**Fájl:** [`src/application/use-cases/create-portfolio.ts`](../../src/application/use-cases/create-portfolio.ts), bekötve: `src/config/container.ts`, `AppServices.createPortfolio`.

```ts
const result = await services.createPortfolio({ id: 'main', name: 'Saját portfólió', baseCurrency: 'HUF' });
// meglévő azonosító → VALIDATION hiba (nem írja felül); hibás pénznem → VALIDATION, path: 'baseCurrency'
```

A tranzakció-űrlap a `recordTransaction` use case-t hívja; a validációs hibák **a mező alatt** jelennek meg (pl. „Érvénytelen listing-azonosító … Formátum: TICKER@MIC”).

## 12. 10. lépés – Grafikon: miért nincs könyvtár

A prompt grafikonkönyvtár-ellenőrzést kér. **Döntés (D-080/8, Ideiglenes):** most nincs új csomag.
- Ami kell, az sávdiagram (allokáció, ország, szektor, deviza) – ezt natív `View`-kból rajzoljuk ([`components/weight-bars.tsx`](../../src/presentation/components/weight-bars.tsx)), minden sáv mellett a számmal (képernyőolvasóval is olvasható).
- Vonaldiagram (árfolyam, TWR) nincs: a free forrás 1 év, a demó 2–3 pont. Ha később kell: `npx expo install react-native-svg`, és kompatibilitás-ellenőrzés a PHASE 14-ben (KI-98).

## 13. Tesztek és ellenőrzés

**Hol:** projekt gyökér, terminál.

```bash
npm run check                                  # mindent futtat
npx jest src/__tests__/routes.test.tsx         # 15 navigációs smoke teszt
npx jest src/__tests__/presentation-view-models.test.ts
npx expo export -p android --output-dir dist-android   # Metro-fordítás próbája (utána: törlés)
```

| Teszt | Mit igazol |
|---|---|
| `src/__tests__/routes.test.tsx` (15) | Kezdőlap → Keresés → „DEMO” → találat → részvényelemzés (`/stock/DEMO@XNAS`), „Nem értékelhető”, nincs Buy/Sell, N/A a hiányzó piaci kapitalizációnál; ETF-találat → ETF-képernyő; ismeretlen ticker → hiba + Újrapróbálás; figyelőlista; portfólió létrehozás → tranzakció → összesítés; űrlap-validáció; Beállítások (AI-kapcsoló, sötét téma); Compare váz; „A projektről”; 404 |
| `src/__tests__/presentation-view-models.test.ts` (11) | a valódi use case-kimeneten: hiány ≠ 0, szakaszok, jelzések, DCF N/A okkal, ETF külön szakaszai, portfólió részösszeg ár nélküli pozícióval |
| `src/presentation/format/formatters.test.ts` (23) | formázók, N/A/N/M, hibaüzenetek |
| `src/presentation/theme/theme.test.ts` (10, ebből 7 új) | kontraszt (AA) mindkét témában, téma-preferencia |
| `src/application/use-cases/create-portfolio.test.ts` (5), `src/presentation/screens/portfolio-forms.test.ts` (4) | új use case; tizedesvessző, mezőhibák |

**Tényleges eredmény (2026-11-23):** `npm run check` exit 0 – **1447/1447 teszt, 81 suite**; Android Hermes bundle 4,3 MB; web export 11 API route-tal; a kliens-bundle-ökben 0 találat `ANTHROPIC_API_KEY`/`EODHD_API_KEY`/`FMP_API_KEY` névre.

## 14. Kézi ellenőrzés emulátoron (a tulajdonos teendője – KI-100)

**Előfeltétel:** Android Studio emulátor fut (Device Manager → ▶). **Hol:** projekt gyökér, terminál: `npm run android`.

- [ ] Alul 5 fül látszik felirattal; az ikonok (⌂ ⌕ ◔ ☆ ⚙) megjelennek (ha üres négyzet: KI-99).
- [ ] Keresés → `DEMO` → Keresés → „Demo Corp (kitalált)” → megnyílik, felül „Demóadat” jelzés.
- [ ] A „Piaci kapitalizáció” sorra koppintva kinyílik az ok és a forrás.
- [ ] Vissza gomb visszavisz a keresésre.
- [ ] Portfólió → Létrehozás → tranzakció `DEMO@XNAS`, 10 db, 90, USD → megjelenik az összesítés HUF-ban.
- [ ] A billentyűzet nem takarja el végleg a „Rögzítés” gombot (görgethető).
- [ ] Beállítások → Sötét: minden képernyő sötét; a szövegek olvashatók.
- [ ] Android Beállítások → Kijelző → Betűméret: legnagyobb → az app olvasható, a sorok tördelődnek.
- [ ] TalkBack (Android kisegítő lehetőség) bekapcsolva: a gombok és a mutatósorok értelmes szöveget olvasnak fel.
- [ ] Az elemzés lehúzásra frissül („Frissítés folyamatban”).

Az eredményt (és ha valami nem jó, a képernyőképet) a PHASE 13 handoffba érdemes beírni.

## 15. Gyakori hibák és javításuk

| Hiba | Ok | Javítás |
|---|---|---|
| `Type '"/search"' is not assignable to type …` (typecheck) | A typed routes típusfájl (`.expo/types/router.d.ts`) régi, nem tud az új útvonalakról. | Indítsd el egyszer a dev szervert (`npm start`, majd `Ctrl+C`) – induláskor újragenerálja. |
| Teszt: „You seem to have overlapping act() calls” | RNTL 14-ben minden `fireEvent` aszinkron. | `await fireEvent.press(…)`, `await fireEvent.changeText(…)`. |
| Teszt: „An update to BottomTabView … not wrapped in act” | A tab-navigátor saját aszinkron frissítése. | Csak figyelmeztetés, a teszt zöld (KI-104). |
| Lint: „Cannot update ref during render” | React Compiler szabály: ref-et render közben nem szabad írni. | Ref írása `useEffect`-ben (lásd `use-async-result.ts`). |
| Lint: `import/no-restricted-paths` egy presentation fájlban | A presentation nem importálhat `@/config`, `@/infrastructure`, `@/contracts` modult. | Típusokat az `@/application`-ből vegyél; env-et a route adja propként. |
| A Portfólió fülön mindig „Még nincs portfólió” | Újraindítás után a memória törlődik (KI-97). | Várható viselkedés a PHASE 13-ig. |
| Élő módban minden „Nem elérhető” vagy hiba | Nincs proxy, vagy elfogyott a free kvóta (EODHD 20/nap). | Beállítások → Adatforrás; `npm start` a proxyhoz; másnap újra (KI-109). |
| „Az AI-magyarázat ki van kapcsolva” | A proxyn `AI_ENABLED=false` (alapállapot). | Szándékos; a szabályalapú szöveg látható marad (D-078). |

## 16. Befejezési feltételek

| Feltétel | Állapot |
|---|---|
| A fő folyamat UI-ból: ticker keresése → elemzés megnyitása | ✅ (smoke teszt) |
| Stock, ETF és portfólió külön logika | ✅ (3 view-model + külön képernyők, teszttel) |
| Loading / error / missing-data (+ empty, stale, partial, retry) | ✅ |
| Az app fordul, a navigációs smoke tesztek lefutnak | ✅ (`expo export` Android + web; 15/15) |
| Közös theme/tokens és formatters | ✅ |
| Emulátoron/telefonon megnézve | ❌ **nem történt meg** (KI-100) |
