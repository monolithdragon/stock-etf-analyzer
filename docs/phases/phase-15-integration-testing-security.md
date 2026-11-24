# PHASE 15 – Integráció, tesztelés és biztonság (kezdőbarát útmutató)

> Dátum: 2026-11-24 · Állapot: **KÉSZ** (eszközön részlegesen igazolva – KI-132) · Átadás: [../handoffs/phase-15-handoff.md](../handoffs/phase-15-handoff.md)
> Döntések: **D-089, D-090, D-091** – [../DECISIONS.md](../DECISIONS.md) · Riportok: [../QA_REPORT.md](../QA_REPORT.md), [../SECURITY.md](../SECURITY.md)

Ez a fázis nem új funkciót épít, hanem **ellenőriz**: lefut-e minden teszt, végigmegy-e az alkalmazás fő folyamata, a képletek azt számolják-e, amit a dokumentáció ír, és nem szivárog-e titok vagy személyes adat.
- A **teljes, aktuális kód a repóban van** a megadott útvonalakon; itt a lényeget mutatjuk. Fájl megnyitása VS Code-ban: Ctrl+P, majd a fájlnév.
- **Új csomag nincs.**

> **A legfontosabb szabály:** egy ellenőrzés csak akkor **PASS**, ha ténylegesen lefutott és az eredmény igazolja. Ami nem futott, az **NOT RUN** (indokkal) vagy **BLOCKED** (ha kulcs, eszköz vagy fiók hiányzik).

## Tartalom
0. Szakszavak röviden
1. Indulóállapot ellenőrzése
2. A teljes ellenőrzési készlet futtatása
3. Végponttól végpontig tartó tesztek (E2E)
4. Javítás: a kliens HTTP-hibái (429, hoszt-hibaoldal)
5. Javítás: az AI-kérés méretkorlátja
6. Képlet-ellenőrzőlista
7. Biztonsági ellenőrzés (titkok, bundle, audit)
8. CI – automatikus ellenőrzés a GitHubon
9. Kézi ellenőrzés emulátoron (a tulajdonos teendője)
10. Gyakori hibák és javításuk
11. Befejezési feltételek

## 0. Szakszavak röviden

| Szó | Jelentés |
|---|---|
| **E2E (end-to-end)** | „Végponttól végpontig” teszt: a folyamatot az elejétől a végéig futtatja (keresés → adat → számítás → döntés → magyarázat), nem egy-egy darabot. |
| **Proxy** | A saját kis szerverünk; ő tárolja a titkos API-kulcsokat, az app csak vele beszél. |
| **Bizalmi határ** | Ahol „idegen” adat lép be (pl. a szerver válasza az appba). Itt mindent ellenőrizni kell. |
| **HTTP-státusz** | A szerver válaszának kódja: 200 = rendben, 429 = túl sok kérés, 5xx = szerverhiba. |
| **Retry-After** | Fejléc a 429-es válaszban: hány másodperc múlva érdemes újrapróbálni. |
| **CI** | Continuous Integration: minden feltöltésnél a GitHub automatikusan lefuttatja a teszteket. |
| **`npm audit`** | Az npm ismert biztonsági hibákat keres a telepített csomagokban. |
| **Bundle** | Az app lefordított kódja, ami a telefonra kerül. Bárki kiolvashatja – ezért nem lehet benne titok. |
| **Prompt injection** | Kísérlet arra, hogy az AI-nak adott adatba rejtett „utasítással” átvegyék az irányítást. |

## 1. Indulóállapot ellenőrzése

**Cél:** tudni, hogy jó helyről indulsz. **Hol:** VS Code terminál (Ctrl+ö), a projekt gyökerében (`stock-etf-analyzer`).

```bash
git status
git branch --show-current
```

**Elvárt:** a branch `phase-15` (vagy a `main`, ha már merge-ölték).

## 2. A teljes ellenőrzési készlet futtatása

**Cél:** egyetlen paranccsal minden automatikus ellenőrzés. **Hol:** a projekt gyökere.

```bash
npm run check
```

Ez sorban fut: TypeScript-ellenőrzés (`tsc`), lint (`expo lint`, 0 figyelmeztetés megengedett), formázás (`prettier --check`), tesztek (`jest`).

**Elvárt eredmény:**
```
Test Suites: 98 passed, 98 total
Tests:       1699 passed, 1699 total
```
és a parancs hibakód nélkül tér vissza.

Függőség-audit külön:
```bash
npm audit --omit=dev --audit-level=high
```
**Elvárt:** exit 0, a kiírt „20 moderate” lelet ismert és elfogadott (KI-133, SECURITY.md 8.).

## 3. Végponttól végpontig tartó tesztek (E2E)

**Cél és ok:** eddig minden szakasz külön volt tesztelve; most egy tesztben fut végig a teljes lánc **élő módban** – a valódi HTTP-kliensen és a valódi szerver-handlereken át (a szolgáltató és az AI demó, így kulcs és internet nem kell).

**Fájl:** `src/__tests__/e2e-business-flows.test.ts`

A lényeg: a teszt egy „híd” `fetch`-függvényt ad az appnak, amely a kéréseket közvetlenül a szerver handlereinek továbbítja:

```ts
const services = createAppServices({ dataMode: 'live', apiBaseUrl: BASE }, { clock, fetchImpl });
```

| Teszt | Mit ellenőriz |
|---|---|
| E2E 1 – részvény | keresés → `evaluateStock` → AI-bemenet → szabályalapú + LLM-magyarázat; a döntés címkéje változatlan; a szerver naplójában nincs adat |
| E2E 2 – ETF | ugyanez ETF-re, DCF nélkül |
| E2E 3 – portfólió | két tranzakció (USD és EUR) → `analyzePortfolio` → FX, kitettség, koncentráció → AI csak beleegyezéssel, pénzösszeg nélkül |
| Teljesítmény | egy elemzés egy URL-t sem kér kétszer; ismétléskor 0 hívás (cache) |
| Hibautak | 429, a hoszt HTML-hibalapja, érvénytelen JSON, offline, AI-kiesés |

**Futtatás:**
```bash
npx jest src/__tests__/e2e-business-flows.test.ts
```
**Elvárt:** `Tests: 9 passed`.

> **Tanulság (offline):** hálózat és cache nélkül az értékelés nem hibát, hanem „Nem értékelhető” eredményt ad, az ár mellett az okkal („Nincs kapcsolat…”). Ez szándékos: a hiány nem nulla, és nem találunk ki adatot.

## 4. Javítás: a kliens HTTP-hibái (429, hoszt-hibaoldal) – D-090

**Ok:** ha a tárhely (pl. EAS Hosting) „Too Many Requests” vagy HTML-hibaoldalt küldött, az app azt írta: „A szerver válasza nem JSON” – ebből nem derült ki, hogy elég később próbálkozni.

**Fájl:** `src/infrastructure/api-client/proxy-http-client.ts`

A válasz státuszát és a `Retry-After` fejlécet most elmentjük, és ha a válasz nem a mi formátumunk:

```ts
function nonJsonError(status: number, retryAfter: string | null): AppError {
  if (status === 429) return AppErrors.rateLimited('Túl sok kérés a szerver felé (HTTP 429). Próbáld újra később.', parseRetryAfterSeconds(retryAfter));
  if (status === 504 || status === 408) return AppErrors.timeout(`A szerver átjárója időtúllépést jelzett (HTTP ${status}).`);
  if (status >= 400) return AppErrors.upstream('HTTP_ERROR', `A szerver hibát adott (HTTP ${status}), …`, 'proxy');
  return AppErrors.upstream('CONTRACT_MISMATCH', 'A szerver válasza nem JSON.', 'proxy');
}
```

A `parseRetryAfterSeconds` csak egész másodpercet fogad el (max. 1 nap); dátum alakú vagy hibás értéknél `null` – nem találunk ki várakozási időt.

**Teszt:** `src/infrastructure/api-client/proxy-http-client.test.ts` (24 teszt, 100% lefedettség).
```bash
npx jest src/infrastructure/api-client
```
**Elvárt:** `Tests: 24 passed`.

## 5. Javítás: az AI-kérés méretkorlátja – D-091

**Ok:** a proxy nyilvános címen fut. Eddig egy hatalmas kérést előbb teljesen beolvasott a memóriába, és csak utána utasította el.

**Fájl:** `src/server/handlers/ai-handler.ts` – a beolvasás előtt:

```ts
const declared = Number(request.headers.get('Content-Length') ?? '');
if (Number.isFinite(declared) && declared > AI_LIMITS.requestBytes) {
  log(413, 'VALIDATION');
  return errorResponse('VALIDATION_FAILED', 413, 'A kérés túl nagy.');
}
```

**Teszt:** `src/__tests__/ai-proxy-integration.test.ts` – „túl nagy Content-Length (a törzs beolvasása előtt) → 413”.

## 6. Képlet-ellenőrzőlista

**Cél:** bizonyítani, hogy a kód azt számolja, amit a `docs/DATA_DICTIONARY.md` 5. fejezete leír.

**Fájl:** `src/__tests__/formula-checklist.test.ts` – 36 pont. Mindegyik egy **kézzel számolt** példa (a kommentben a számolás) és egy dokumentált speciális eset. Példa:

```ts
it('P/E = ár / EPS (100 / 5 = 20); EPS ≤ 0 → NOT_MEANINGFUL (nem negatív P/E)', () => {
  expect(value(priceToEarnings({ price: 100, eps: 5 }))).toBeCloseTo(20, 12);
  expect(priceToEarnings({ price: 100, eps: -1 }).status).toBe('NOT_MEANINGFUL');
});
```

Lefedett csoportok: jövedelmezőség és növekedés (marzsok, növekedés, CAGR, adókulcs, NOPAT, ROE, ROIC), mérleg és cash flow (nettó adósság, D/E, FCF, FCF-konverzió), piaci mutatók (piaci érték, EV, P/E, EV/EBITDA, PEG, FCF-hozam, MOS, reálhozam), DCF (minden kimeneti mező, r ≤ g, hiányzó adósság), hozam és kockázat (drawdown, volatilitás, HHI, ETF-átfedés, súlyozott hozam, rendszeres befizetés, TER).

**Eredmény:** 36/36 – a dokumentáció és a kód között **eltérés nincs**.

## 7. Biztonsági ellenőrzés

Teljes leírás: [../SECURITY.md](../SECURITY.md). Amit ebben a fázisban ténylegesen futtattunk:

1. **Követett env-fájlok:** `git ls-files | grep -i env` → csak `.env.example`.
2. **Titok a git-történetben:** a `.env.local` titkos értékeit (az értékek kiírása nélkül) kerestük minden commitban → 0 találat.
3. **Titok a telefonra kerülő bundle-ben:**
   ```bash
   npx expo export -p android --output-dir <egy ideiglenes mappa>
   ```
   majd a `.hbc` fájlban kerestük a titkos értékeket és a szerverkód nyomait (`@anthropic-ai/sdk`, kulcsnevek, szolgáltatói címek) → 0 találat. Az export mappát utána töröld (ne kerüljön gitbe).
4. **Csomagok:** `npm audit` → 0 high/critical; a 22 „moderate” a teszt- és build-eszközökben van (nem az app futásában), a javasolt „fix” visszaléptetné az Expót → nem alkalmazzuk.
5. **Napló:** a szerver csak útvonalat, státuszt, időt naplóz – tesztek őrzik, hogy portfólióadat és kulcs nem kerül bele.

> **Fő nyitott kockázat (KI-135):** a proxynak nincs bejelentkezése; aki ismeri a címét, fogyaszthatja a napi kereteket. A PHASE 16 éles telepítése előtt erről dönteni kell.

## 8. CI – automatikus ellenőrzés a GitHubon (D-089)

**Fájl:** `.github/workflows/ci.yml`. Minden push a `main`-re és minden pull request esetén lefut: `npm ci` → typecheck → lint → Prettier → Jest → `npm audit --omit=dev --audit-level=high`. Titkot nem használ.

**Ellenőrzés (push után):** GitHubon a repó → **Actions** fül → „CI” → zöld pipa. Ha piros: kattints a hibás lépésre, a napló megmutatja, melyik parancs bukott el; helyben ugyanazt a parancsot futtasd.

**Állapot:** a GitHubon még **nem futott** (KI-134), mert ebben a fázisban nem volt push.

## 9. Kézi ellenőrzés emulátoron (a tulajdonos teendője – KI-132)

**Amit a PHASE 15-ben már igazoltunk** (Android emulátor `Medium_Phone_API_37.0`, demó mód): a Kezdőlap, a részvény- és ETF-képernyő őszinte állapotai, a figyelőlista megmarad az app teljes leállítása után is.

### 9.1 Egyszeri beállítás: `ANDROID_HOME` (KI-136)
1. Windows Start → „Környezeti változók” → **Rendszer-környezeti változók szerkesztése** → *Környezeti változók…*
2. Felhasználói változók → **Új…** → név: `ANDROID_HOME`, érték: `C:\Users\<felhasználó>\AppData\Local\Android\Sdk`.
3. Zárd be és nyisd újra a VS Code-ot. Ellenőrzés: `adb devices` → kiír egy listát (hibaüzenet nélkül).

### 9.2 Indítás
```bash
npm run android
```
(Elindítja a dev szervert és megnyitja az appot az emulátorban/telefonon Expo Go-ban. Ha az Expo Go frissítését kéri, fogadd el.)

### 9.3 Ellenőrző lista
| # | Lépés | Elvárt |
|---|---|---|
| 1 | Portfólió fül → új tranzakció (DEMO, 2 db, 90 USD) | a pozíció megjelenik, P/L és kitettség látszik |
| 2 | App teljes bezárása (feladatkezelőből kisöpörve), újranyitás | a portfólió és a figyelőlista megvan |
| 3 | Figyelő → Screener → egy kiinduló szűrő | találat vagy „nem értékelhető” okkal |
| 4 | Figyelő → Riasztások → ár-szabály → „Ellenőrzés most” | állapot és bizonyíték látszik |
| 5 | (élő módban, futó proxyval) repülőgép-mód → elemzés megnyitása | „Elavult”/offline jelzés, nem friss adat |
| 6 | Kis kijelzőn a screener-űrlap (KI-131) | görgethető, nem vágódik le |

Az eredményt írd a `docs/QA_REPORT.md` 6. fejezetébe (PASS csak akkor, ha tényleg láttad).

## 10. Gyakori hibák és javításuk

| Hiba | Ok | Javítás |
|---|---|---|
| `npm run check` a `tsc`-nél `+not-found.tsx` hibát ad | megszakított `expo start` hiányos `.expo/types/router.d.ts`-t hagyott (KI-121) | töröld a fájlt, futtasd `CI=1 npx expo start`-ot kb. 60–100 mp-ig, majd állítsd le |
| `adb: command not found` | az `ANDROID_HOME` nincs beállítva | 9.1 |
| Teszt: „expected RATE_LIMITED, received UPSTREAM” | régi kliens-kód (D-090 előtti) | `git pull`, majd újrafuttatás |
| A Prettier hibát jelez `docs/*.md`-ben | a formázás a dokumentációra is vonatkozik | `npx prettier --write docs` |
| `npm audit` „moderate” leleteket ír | ismert, eszközláncbeli (KI-133) | nincs teendő; `npm audit fix --force`-t **ne** futtasd (visszaléptetné az Expót) |

## 11. Befejezési feltételek

- [x] Teljes lint, typecheck, unit-, integrációs és E2E-teszt lefutott, a kimenetek a QA_REPORT-ban.
- [x] A projektkód hibái javítva (D-090, D-091), tesztekkel.
- [x] Az alap üzleti folyamatok automatikusan teszteltek (E2E 1–3).
- [x] Hibaforgatókönyvek átnézve, bizonyítékkal (QA_REPORT 5.).
- [x] Biztonsági felülvizsgálat (SECURITY.md), kulcskezelés ellenőrizve.
- [x] Képlet-ellenőrzőlista: 36/36.
- [x] CI-konfiguráció elkészült.
- [x] Minden nem futtatott ellenőrzés NOT RUN / BLOCKED indokkal.
- [ ] Teljes eszközös kézi lista (9.3) – a tulajdonos teendője.
