# PHASE 14 – Összehasonlítás, figyelőlista, screener és riasztások (kezdőbarát útmutató)

> Dátum: 2026-11-24 · Állapot: **KÉSZ** (Jest – valódi route-fa és SQLite – és `expo export` igazolva; eszközön még nem futott – KI-129) · Átadás: [../handoffs/phase-14-handoff.md](../handoffs/phase-14-handoff.md)
> Döntések: **D-085, D-086, D-087, D-088** – [../DECISIONS.md](../DECISIONS.md)

Ez az útmutató lépésenként bemutatja, mi készült a PHASE 14-ben, miért, és hogyan ellenőrizheted.
- A **teljes, aktuális kód a repóban van** a megadott útvonalakon. Itt a lényeget és a kulcsrészleteket mutatjuk; a fájlt a VS Code-ban nyisd meg (Ctrl+P, majd a fájlnév).
- **Új csomag nincs.** (Értesítéshez sem telepítettünk semmit – lásd 9. lépés.)

> **A legfontosabb szabályok:**
> 1. Csak **összehasonlítható** mutató kerül egymás mellé (P/E csak részvénynél, TER csak ETF-nél; pénzösszeg csak azonos pénznemben; ETF-hozam csak azonos alapon és ablakon).
> 2. A hiányzó adat **soha nem 0**: a screener „nem értékelhető”-nek, a tábla N/A-nak mutatja, okkal.
> 3. Minden screener-találat és riasztás megmutatja, **melyik értékből** (forrás, dátum, frissesség) született.
> 4. **Nincs push-értesítés** és nincs háttérben futó ellenőrzés – a riasztás csak az appban értékelődik ki.

## Tartalom
0. Szakszavak röviden
1. Indulóállapot ellenőrzése
2. Áttekintés: mi készült és hol van
3. 1. lépés – A közös „pillanatkép” (nincs duplikált számolás)
4. 2. lépés – Napi változás az ártörténetből
5. 3. lépés – Összehasonlítás: mikor hasonlítható egy mutató?
6. 4. lépés – ETF-átfedés: dátumok és a dupla számolás elkerülése
7. 5. lépés – Figyelőlista: ár, változás, frissesség, score kérésre
8. 6. lépés – Screener: mezők, validáció, bizonyíték
9. 7. lépés – Riasztás: szabályok, tárolás (2. migráció), élváltás
10. 8. lépés – Képernyők és útvonalak
11. 9. lépés – Értesítések: mit tud és mit NEM tud az app (platformkorlátok)
12. Tesztek és ellenőrzés
13. Kézi ellenőrzés emulátoron (a tulajdonos teendője – KI-129)
14. Gyakori hibák és javításuk
15. Befejezési feltételek

## 0. Szakszavak röviden

| Szó | Jelentés |
|---|---|
| **Figyelőlista (watchlist)** | Az általad megjelölt instrumentumok listája. Csak azonosítót, nevet és típust tárol; az árat mindig frissen (vagy a gyorsítótárból, jelölve) kéri. |
| **Screener** | Szűrő: „mutasd azokat, ahol P/E ≤ 20 és ROIC ≥ 15%”. |
| **Pillanatkép (snapshot)** | Egy instrumentum összes mutatója egy helyen, a már meglévő elemzésekből összegyűjtve. |
| **Holdings** | Egy ETF összetétele: mely cégek, milyen súllyal (pl. Apple 6%). |
| **Átfedés (overlap)** | Mennyire tartják ugyanazt a két ETF-ben: Σ min(súly A-ban, súly B-ben). |
| **Élváltás** | Egy riasztás akkor „újonnan teljesült”, ha előző ellenőrzéskor még nem teljesült – így nem jelez újra és újra ugyanarra. |
| **Push-értesítés** | Szerverről küldött üzenet a telefonra, akkor is, ha az app zárva van. **Ez nincs** az appban. |
| **Migráció** | Az adatbázis szerkezetének verziózott módosítása (itt: új `alert_rules` tábla). |
| **Provenance** | Egy érték „származási lapja”: forrás, lekérés ideje, adatnap, frissesség. |

## 1. Indulóállapot ellenőrzése

**Cél:** tudni, hogy jó helyről indulsz. **Hol:** VS Code terminál (Ctrl+ö), a projekt gyökerében (`stock-etf-analyzer`).

```bash
git status
git branch --show-current
npm run check
```

**Elvárt:** a branch `phase-14`; a `npm run check` vége `Tests: 1628 passed, 1628 total`, és a parancs hibakód nélkül tér vissza (exit 0).

## 2. Áttekintés: mi készült és hol van

| Terület | Fájl(ok) |
|---|---|
| Közös pillanatkép + betöltők | `src/application/insights/instrument-snapshot.ts`, `load-snapshot.ts` |
| Összehasonlítás | `src/application/insights/compare.ts` |
| ETF-átfedés, részvény súlya ETF-ben | `src/application/insights/etf-overlap.ts` |
| Screener | `src/application/insights/screener.ts` |
| Riasztás (szabály, kiértékelés, korlátok) | `src/application/insights/alerts.ts` |
| Use case-ek (szolgáltatások) | `src/application/insights/insight-services.ts`; bekötés: `src/config/container.ts` |
| Riasztás tárolása | port: `src/application/ports/index.ts` (`AlertRuleRepository`); SQLite: `src/infrastructure/storage/sqlite-alert-rule-repository.ts`; migráció: `migrations.ts` (2. verzió); memória: `in-memory-stores.ts` |
| Export / teljes törlés | `src/application/use-cases/local-data.ts` (export formátum **v2**, benne a riasztások) |
| UI | `src/presentation/view-models/insights-view-model.ts`; `screens/{watchlist,compare,screener,alerts}-screen.tsx`; route-ok: `src/app/screener.tsx`, `src/app/alerts.tsx`; szövegek: `strings/hu.ts` |
| Tesztek | `src/application/insights/*.test.ts`, `src/__tests__/{insight-services,insights-integration}.test.ts`, `src/presentation/view-models/insights-view-model.test.ts`, `routes.test.tsx` (+4), `storage.test.ts` (+2) |

**Adatfolyam:** képernyő → use case (`services.compareListings`, `runScreen`, `alerts.checkNow`, `getWatchlistOverview`) → `loadInstrumentSnapshot` → a meglévő `evaluateStock` / `evaluateEtf` (a PHASE 13 gyorsítótáron át) → tiszta szabályfüggvény → view-model → képernyő.

## 3. 1. lépés – A közös „pillanatkép” (nincs duplikált számolás)

**Cél és ok:** a négy új funkció ugyanazokat a számokat lássa, mint az elemzőképernyő. Ha mindegyik maga számolna, eltérhetnének (CLAUDE.md: „ne duplikáld a business logicot”).

**Fájl:** `src/application/insights/instrument-snapshot.ts`

Lényeg: a pillanatkép a PHASE 10 értékelés **feature-listájából** készül, a `Metric`-eket változatlanul átveszi:

```ts
function featureMetrics(evaluation: InstrumentEvaluation): Record<string, SnapshotMetric> {
  const metrics: Record<string, SnapshotMetric> = {};
  for (const feature of evaluation.features) {
    if (feature.kind !== 'numeric') continue;
    metrics[feature.id] = { id: feature.id, label: feature.label, unit: feature.unit, value: feature.value, window: null };
  }
  return metrics;
}
```

- Részvénynél ehhez jön az osztalékhozam és a piaci kapitalizáció, és a **Base DCF MOS-kategória** („Diszkont / közel / prémium a modellértékhez”).
- ETF-nél a hozam-, kockázati és tracking-mutatók az **ablakukkal** (kezdő és záró dátum), a holdings és a hozam-alap.
- **Ismeretlen típus** (a figyelőlistán „Ismeretlen típus”) → hiba, nem találgatunk.

**Ellenőrzés:** `npx jest src/__tests__/insights-integration` – az első teszt bizonyítja, hogy minden mutató **azonos** az értékelés feature-jével.

## 4. 2. lépés – Napi változás az ártörténetből

**Cél és ok:** a figyelőlista mutassa a napi változást. A szolgáltatói „quote” végpont **nem ad előző záróárat**, ezért ezt mi számoljuk, és ezt jelöljük is.

**Fájl:** `instrument-snapshot.ts` → `dayChangeMetric`; lekérés: `load-snapshot.ts` (utolsó 10 nap, split-korrigált sor – egy split napján ne látsszon hamis −50%).

- Képlet: `utolsó záró / előző záró − 1` (a calculations-motor `simpleReturn` függvényével).
- Provenance: `calculated` (demóban `mock`), bemenetek: `close@2026-11-19`, `close@2026-11-20`.
- Kevesebb mint két záróár → `N/A` okkal.

**Kvóta:** üres gyorsítótárnál jegyzésenként +1 hívás (KI-124).

## 5. 3. lépés – Összehasonlítás: mikor hasonlítható egy mutató?

**Fájl:** `src/application/insights/compare.ts` (`COMPARISON_METRICS`, `compareInstruments`).

A szabályok sorrendben (bármelyik bukik → a mutató a „Kimaradt mutatók és okuk” listába kerül):

| Szabály | Példa |
|---|---|
| Típus: minden kiválasztott típusra értelmezett? | Részvény + ETF → P/E és TER kimarad |
| Legalább 2 instrumentumnál van értéke? | Csak az egyiknél van ROIC → kimarad |
| Pénzösszegnél azonos pénznem? | USD és EUR ár → kimarad („átváltás nélkül nem hasonlítható”) |
| ETF-hozamnál total return alap? | Egyik csak árhozam → kimarad (D-069) |
| Időszakos mutatónál azonos ablak (±7 nap)? | 2025-01 vs 2025-11 kezdet → kimarad |
| Score-nál azonos score-rendszer? | Részvény- vs ETF-score → kimarad |

- **Vegyes** (részvény + ETF): csak ár, napi változás és **a részvény súlya az ETF-ben** (ha az ETF holdings ismert és a részvény ISIN-je is).
- Eltérő pénzügyi év (FY2024 vs FY2025): a sor marad, **megjegyzéssel**.
- „★ kedvezőbb”: csak a mutató iránya szerint (alacsonyabb P/E, magasabb ROIC), ceteris paribus – **nem ajánlás**.

**Képernyő:** Figyelő tab → „Összehasonlítás” → jelölj be 2–4 elemet → „Összehasonlítás”. Mobilon mutatónként egymás alatt jelennek meg az értékek (nincs széles, oldalra görgetős tábla). Egy értékre koppintva látszik a forrás és a hiány oka.

## 6. 4. lépés – ETF-átfedés: dátumok és a dupla számolás elkerülése

**Fájl:** `src/application/insights/etf-overlap.ts`

1. **Dátum:** csak azonos napi vagy legfeljebb **31 nap** eltérésű holdings-pillanatképekre számolunk. Különben „Nem számolható – … 123 nappal tér el” (nincs szám). Mindkét adatdátum mindig látszik.
2. **Átfedés = Σ min(w_A, w_B)** – ugyanazt a céget egyszer számolja.
3. Külön látszik: „közös súly A-ban” és „B-ben”. **Ezeket nem szabad összeadni** – az kétszer számolná ugyanazt a céget; a kimenet ezt szövegesen is kiírja.
4. „50/50 keverék közös kitettsége” = Σ (w_A + w_B)/2 – cégenként egyszer.
5. Részleges lista → „alsó becslés”; ISIN nélküli tétel nem párosítható.

Példa (a tesztből): A: Apple 6%, Microsoft 5%, Nvidia 4%; B: Apple 10%, Microsoft 2% → átfedés 6% + 2% = **8%**; közös súly A-ban 11%, B-ben 12%; 50/50 keverék: (6+10)/2 + (5+2)/2 = **11,5%** (nem 23%).

> **Fontos korlát (KI-123):** a free adatforrás nem ad holdings-adatot, és a UI-ban még nincs holdings-bevitel. A valós appban ezért az átfedés ma jellemzően „Nem számolható – Nincs holdings-adat”. A logika kész és tesztelt.

## 7. 5. lépés – Figyelőlista: ár, változás, frissesség, score kérésre

**Fájl:** `src/presentation/screens/watchlist-screen.tsx`, view-model: `buildWatchlistRow`.

- Megnyitáskor soronként: **árfolyam**, **napi változás** (előjellel, pl. „+1,01%”), **frissesség** („Frissesség: Friss/Elavult”, „Offline adat – elavult lehet”, demóban „Demóadat”), **„Frissítve: … · adatnap: …”**.
- **„Score és értékelés betöltése”** gomb: jegyzésenként teljes elemzést tölt be (sok hívás lehet), ezért csak kérésre. Utána: „Score: 62,5 / 100 · Tartás” és „Értékelés: Modellérték közelében (Base DCF MOS +5,0%)”; ETF-nél „Nem alkalmazható (ETF)”.
- A lista tartósan tárolt (PHASE 13): újraindítás után is megmarad.
- Lehúzás = **kézi frissítés** (PHASE 13 szabály: a jegyzések gyorsítótár-rekordjai jelölve, a következő lekérés a hálózatot próbálja; offline a tartalék megmarad).

## 8. 6. lépés – Screener: mezők, validáció, bizonyíték

**Fájl:** `src/application/insights/screener.ts`; képernyő: `screener-screen.tsx`.

**Univerzum:** a figyelőlista + a portfólió jegyzései (nem az egész piac). Csak a kiválasztott típus (részvény vagy ETF) töltődik be.

**Kategóriák és mezők:** Értékelés (P/E, P/FCF, EV/EBITDA, FCF-hozam, Base MOS), Növekedés (árbevétel CAGR 3/5 év, EPS CAGR, YoY), Minőség (ROIC, ROE, árrések, tőkeáttétel), Osztalék (osztalékhozam; ETF: kifizetési hozam), ETF TER, AUM, tracking (tracking error, tracking difference), koncentráció (top 10, legnagyobb pozíció, effektív pozíciószám).

**Bevitel:** a százalékos mezőkbe **százalékot** írj: `0,25` = 0,25% (a motor 0.0025-öt kap). Tizedesvessző és pont is jó.

**Érvénytelen szűrő** – a hibaüzenet a mező alatt jelenik meg:
- nincs feltétel; több mint 10 feltétel; ismeretlen mező; ETF-mező részvényszűrőben;
- nem szám (pl. `abc`); tartományon kívül (pl. TER `20` → 20%, ami nyilván elírás);
- AUM-hoz nincs pénznem; ugyanaz a feltétel kétszer; ellentmondás (P/E ≥ 30 és ≤ 10).

**Eredmény:** három csoport – *Találatok*, *Nem értékelhető (hiányzó adat)*, *Nem felel meg* – és *Kimaradt* (más típus, betöltési hiba). Minden feltétel sorára koppintva látszik az érték forrása, dátuma és frissessége (**visszavezethető**). Elavult adatnál „⚠ Elavult vagy offline tartalékból jött adatot is használ.”

A „Kiinduló szűrők” gombjai szemléltető küszöböket töltenek be – **nem ajánlások**.

## 9. 7. lépés – Riasztás: szabályok, tárolás (2. migráció), élváltás

**Fájlok:** `src/application/insights/alerts.ts`, `insight-services.ts` (`createAlertService`), `src/infrastructure/storage/sqlite-alert-rule-repository.ts`, `migrations.ts`.

**Szabályok:**

| Mutató | Típus | Küszöb megadása |
|---|---|---|
| Árfolyam felett / alatt | részvény, ETF | ár + a jegyzés pénzneme (pl. 150 USD) |
| Base DCF MOS felett / alatt | részvény | %-ban (pl. 20) |
| P/E felett / alatt | részvény | szorzó (pl. 25) |
| TER felett / alatt | ETF | %-ban (pl. 0,2) |

- **Szigorú reláció:** pontosan a küszöbnél nem teljesül.
- **Eltérő pénznem** (szabály EUR, ár USD) → „Nem értékelhető” – átváltva nem riasztunk.
- **Élváltás:** „Újonnan teljesült” csak akkor, ha előző ellenőrzéskor még nem teljesült. Adathiány nem „nullázza” az állapotot.
- **Elavult / offline adat:** kiértékel, de jelzi.
- **Kvóta:** ár-szabályhoz csak árlekérés kell; P/E, MOS, TER esetén teljes elemzés (a jelentés kiírja: „Teljes elemzés betöltve: N”).

**Tárolás – 2. migráció** (`src/infrastructure/storage/migrations.ts`, a lista végére fűzve; a meglévő 1. migráció változatlan):

```ts
{
  version: 2,
  description: 'PHASE 14: riasztási szabályok (alert_rules) tábla.',
  up: async (db) => {
    await db.exec(`
      CREATE TABLE alert_rules (
        id TEXT PRIMARY KEY NOT NULL,
        listing_id TEXT NOT NULL,
        json TEXT NOT NULL,
        seq INTEGER NOT NULL
      );
      CREATE INDEX idx_alert_rules_listing ON alert_rules (listing_id);
    `);
  },
},
```

Egy PHASE 13-as adatbázis az első induláskor automatikusan 1 → 2 verzióra lép; a meglévő portfólió, figyelőlista és cache megmarad. Sérült riasztás-sor kimarad és törlődik. Az export (Beállítások) **v2** formátumú, benne a riasztásokkal; a „Minden helyi adat törlése” a riasztásokat is törli.

## 10. 8. lépés – Képernyők és útvonalak

| Útvonal | Képernyő | Honnan érhető el |
|---|---|---|
| `/watchlist` (tab) | Figyelőlista | alsó „Figyelő” tab |
| `/compare` | Összehasonlítás | Figyelő → „Összehasonlítás” |
| `/screener` | Screener | Figyelő → „Screener” |
| `/alerts` | Riasztások | Figyelő → „Riasztások” |

Az új route-fájlok vékonyak (pl. `src/app/screener.tsx`):

```tsx
import { ScreenerScreen } from '@/presentation/screens/screener-screen';

export default function ScreenerRoute() {
  return <ScreenerScreen />;
}
```

A Stack-be a `src/app/_layout.tsx` két sora vette fel (`screener`, `alerts`, magyar címmel).

**Üres állapotok:** üres figyelőlista (Figyelő, Összehasonlítás), üres univerzum (Screener), nincs riasztás / nincs ismert típusú elem (Riasztások), „Nincs találat”, „Nincs olyan mutató, amely … összehasonlítható”.

## 11. 9. lépés – Értesítések: mit tud és mit NEM tud az app (platformkorlátok)

**Ellenőrzött hivatalos dokumentáció (2026-11-24):** Expo SDK 58 `notifications` és `background-task` oldal, push „What you need to know” és „Setup”; a prompt által említett **SDK 57** notifications-oldal is (Expo Go-ra ugyanazt mondja; a projekt SDK 58 – KI-130).

| Képesség | Expo Go-ban? | Mi kellene hozzá | Az appban |
|---|---|---|---|
| **Távoli push** | **Nem** (Androidon az SDK 53 óta; development build kell) | development build (EAS), FCM (Android) és APNs (iOS, fizetős Apple fiók) hitelesítés, `projectId`, küldő backend | **Nincs** |
| **Helyi (ütemezett) értesítés** | Igen | `expo-notifications`, futásidejű engedély (Android 13+), pontos időzítéshez `SCHEDULE_EXACT_ALARM` (Android 14+ alapból tiltja) | **Nincs** (friss ár nélkül félrevezető lenne) |
| **Háttér-ellenőrzés** | a csomag Expo Go-ban elérhető | `expo-background-task`; Androidon min. 15 perc, iOS-en a rendszer dönt (gyakran éjjel), nem garantált, bezárt appnál leáll, iOS-szimulátoron nem fut | **Nincs** |
| **Kiértékelés az appban** | Igen | – | **Van**: Riasztások képernyő + „Ellenőrzés most” |

A képernyő tetején a „Működési korlátok” szakasz ugyanezt mondja (`ALERT_PLATFORM_LIMITATIONS` – egy helyen van, teszt őrzi). Bővítés csak külön döntéssel (D-088, „Bővítési út”).

## 12. Tesztek és ellenőrzés

**Hol:** a projekt gyökerében.

```bash
npm run check
npx jest src/application/insights
npx jest src/__tests__/insights-integration src/__tests__/insight-services
npx jest src/__tests__/routes
```

**Tényleges eredmény (2026-11-24):** `npm run check` exit 0; **1628/1628 teszt, 95 suite** (+87). Az új modulok lefedettsége: 95,0% utasítás / 83,8% ág / 97,6% sor.

Mit bizonyítanak a tesztek:
- **eltérő adatlefedettség:** csak egy instrumentumnál elérhető mutató kimarad; 3-ból 2 értéknél a sor marad, a hiány N/A (nem 0);
- **hiányzó mutatók:** screener `NOT_EVALUABLE` okkal; riasztás `NOT_EVALUABLE`;
- **ETF holdings dátumeltérés:** ≤ 31 nap számol és jelez, > 31 nap nem számol; dupla számolás tiltva (11,5% vs 23% példa);
- **riasztási szabályok:** felett/alatt, szigorú határ, pénznem-eltérés, elavult adat, élváltás, tartós tárolás újraindítás után (route-teszt);
- **összehasonlíthatóság:** típus, pénznem, hozam-alap, ablak, score-rendszer.

## 13. Kézi ellenőrzés emulátoron (a tulajdonos teendője – KI-129)

1. Indítsd az emulátort (Android Studio → Device Manager), majd a terminálban: `npm run android`.
2. Demó módban keress rá: `DEMO` → „Hozzáadás a figyelőlistához”; majd `DEMOETF` → szintén.
3. **Figyelő tab:** mindkét sornál látszik az ár, a napi változás és a „Demóadat” jelzés. Nyomd meg: „Score és értékelés betöltése” → megjelenik a Score és az Értékelés sor.
4. **Összehasonlítás:** jelöld be mindkettőt → „Összehasonlítás”. Elvárt: csak „Napi változás” sor; lent a „Kimaradt mutatók” között a P/E (részvényre), a TER (ETF-re), az ár (USD vs EUR).
5. **Screener:** írj a Küszöb mezőbe `abc`-t → „Feltétel hozzáadása” → hibaüzenet. Válaszd a „Értékelés: alacsony P/E + DCF-diszkont” szűrőt → „Szűrés futtatása”.
6. **Riasztások:** küszöb `90`, pénznem `USD` → mentés → „Ellenőrzés most” → „Teljesült”, „Újonnan teljesült riasztás: 1”. Zárd be teljesen az appot, nyisd újra: a szabály és az állapot megvan.
7. Nézd meg kis kijelzőn és nagy betűmérettel a screener-űrlapot (KI-131).

Eredményt a következő fázis handoffjába írd.

## 14. Gyakori hibák és javításuk

| Hiba | Ok | Javítás |
|---|---|---|
| `tsc`: `Type '"/"' is not assignable …` a `+not-found.tsx`-ben | A typed routes fájl hiányos (megszakított `expo start`, KI-121) | Töröld a `.expo/types/router.d.ts`-t, majd `CI=1 npx expo start --port 8093`, és várd meg, amíg magától leáll (~100 mp) / kb. 60 mp után Ctrl+C. Utána `npx tsc --noEmit`. |
| `tsc`: `"/screener"` nem ismert útvonal | Új route után a typed routes még régi | Ugyanaz, mint fent. |
| Screener: „tartományon kívül” TER-nél | Tizedes törtet írtál százalék helyett vagy fordítva | A százalékos mezőbe százalékot írj: 0,2 = 0,2%. |
| Riasztás „Nem értékelhető – pénzneme eltér” | A szabály pénzneme nem a jegyzésé | Az ár-riasztáshoz a jegyzés pénznemét add meg (pl. DEMO: USD, DEMOETF: EUR). |
| ETF-átfedés: „Nincs holdings-adat” | A free forrás nem ad holdings-ot (KI-123) | Várható; holdings-import egy következő adatbővítésben. |
| Lassú „Score betöltése” élő módban | Jegyzésenként teljes elemzés, kvótakorlát | Kevesebb elem; a gyorsítótár a második alkalomtól gyorsít (KI-125). |
| Lint: `react-hooks/set-state-in-effect` | Effektben szinkron hívott, állapotot állító függvény | A lekérést az effektben `.then(...)`-ben dolgozd fel (lásd `alerts-screen.tsx`). |

## 15. Befejezési feltételek

- [x] Összehasonlítás csak összehasonlítható mutatókkal (részvény–részvény, ETF–ETF, részvény–ETF), a kimaradtak okkal.
- [x] Figyelőlista több tickerrel, tartósan; ár, napi változás, score, értékelési státusz, utolsó frissítés, frissesség.
- [x] Screener: értékelés, növekedés, minőség, osztalék, TER, AUM, tracking, koncentráció; csak elérhető mezőkön; visszavezethető találatok.
- [x] Riasztási alap: ár, MOS, P/E, TER küszöb; platformkorlátok dokumentálva; nincs nem dokumentált push.
- [x] ETF-átfedés csak kompatibilis snapshotokra, adatdátumokkal, dupla számolás nélkül.
- [x] Üres állapotok, érvénytelen szűrő kezelése, mobilbarát tábla.
- [x] Unit és integrációs tesztek; `npm run check` exit 0.
- [ ] Eszközös ellenőrzés (13. fejezet) – a tulajdonos teendője (KI-129).
