# QA-riport – Stock & ETF Analyzer (PHASE 15)

> Dátum: **2026-11-24** · Branch: `phase-15` (a `main` `1687c4a`-ból) · Környezet: Windows 11, Node 26.10.0, npm 12.2.0, Expo SDK 58.
> Státuszok: **PASS** = lefutott és az eredmény igazolja · **FAIL** = lefutott, hibás · **PARTIAL** = részben futott, a hiányzó rész megnevezve · **BLOCKED** = külső feltétel (kulcs, eszköz, fiók) hiányzik · **NOT RUN** = nem futtattuk, indokkal.
> Biztonsági részletek: [SECURITY.md](SECURITY.md). Döntések: D-089…D-091.

## 1. Összefoglaló

| Ellenőrzés | Státusz | Eredmény |
|---|---|---|
| TypeScript typecheck (`tsc --noEmit`) | **PASS** | exit 0 (helyben és tiszta checkouton is) |
| Lint (`expo lint --max-warnings 0`) | **PASS** | exit 0, 0 figyelmeztetés |
| Formázás (`prettier --check .`) | **PASS** | „All matched files use Prettier code style!” |
| Unit + integrációs + E2E (Jest) | **PASS** | **1699/1699**, 98 suite (kiinduláskor 1628/95) |
| Alap üzleti folyamatok E2E (élő mód, valódi HTTP-kliens + valódi proxy-handlerek) | **PASS** | `e2e-business-flows.test.ts` 9/9 |
| Képlet-ellenőrzőlista (dokumentáció ↔ kód) | **PASS** | `formula-checklist.test.ts` 36/36 – eltérés nincs |
| Tiszta checkout (worktree, `.env.local`/`.expo` nélkül): typecheck, lint, Prettier, Jest | **PASS** | mind exit 0; 1628/1628 (a `main` HEAD-en) |
| `expo export -p android` | **PASS** | exit 0, Hermes bundle 4,7 MB |
| Titokszkennelés (git-történet, fa, bundle) | **PASS** | 0 találat |
| `npm audit` | **PASS (high-küszöbbel)** | 0 high/critical; 22 moderate (eszközlánc) – 8. |
| Eszközös smoke (Android emulátor, Expo Go, demó mód) | **PARTIAL** | 4 képernyő + tartós tárolás force-stop után igazolva; repülőgép-mód, portfólió-űrlap, screener/riasztás-űrlap kézi bevitele nem – 6. |
| Maestro E2E (Android) | **BLOCKED** | Maestro nincs telepítve, nincs flow a repóban – 6. |
| CI (GitHub Actions) | **NOT RUN** | a workflow elkészült; GitHubon csak push/PR után fut – 7. |
| Élő szolgáltatók (FMP/EODHD/SEC) élő hívással | **NOT RUN** | szándékosan: kvótakímélés (EODHD 20/nap); a PHASE 04B rögzített fixture-ei fedik |
| Élő LLM (Anthropic) | **BLOCKED** | `AI_ENABLED=false`, a bekapcsolás a tulajdonos döntése (DP-04, költség) |

## 2. Futtatott parancsok és tényleges kimenetek

Minden parancs a projekt gyökerében (`stock-etf-analyzer`) futott.

| # | Parancs | Kimenet (rövidítve) |
|---|---|---|
| 1 | `git status`, `git switch -c phase-15` | `main` tiszta, up to date → új branch |
| 2 | `npm run check` (kiinduló állapot) | exit 0 · `Tests: 1628 passed, 1628 total` · `Test Suites: 95 passed` |
| 3 | `npm audit --json` | `moderate: 22, high: 0, critical: 0` (1412 csomag) |
| 4 | `npm audit --omit=dev --audit-level=high` | exit 0 · „20 moderate severity vulnerabilities” |
| 5 | Értékvak git-történet keresés (`git log --all -p -S<érték>`, `git grep -F`) a `.env.local` értékeire | „checked 3 values, hits 0” |
| 6 | Mintakeresés (`sk-ant-…`, `AKIA…`, `api_token=`, `apikey=`) | csak tesztbeli hamis értékek (`sk-ant-titok`, `sk-ant-xyz`, `sk-ant-secret`) |
| 7 | `npx jest src/__tests__/e2e-business-flows.test.ts` (javítás előtt) | 4 FAIL / 4 PASS – 2 várt (hiányzó javítás), 1 URL-kódolás a tesztben, 1 téves feltevés (lásd 3.) |
| 8 | `npx jest src/infrastructure/api-client src/__tests__/e2e-business-flows.test.ts` (javítás után) | 32/32 PASS |
| 9 | `npx jest src/__tests__/formula-checklist.test.ts` | 36/36 PASS |
| 10 | `npm run check` (javítások után, 1. kör) | exit 1 · 1 FAIL: `proxy-integration` „nem JSON → CONTRACT_MISMATCH” (a régi viselkedést rögzítette, D-090) |
| 11 | `npm run check` (teszt frissítve) | **exit 0** · `Tests: 1699 passed, 1699 total` · `Test Suites: 98 passed, 98 total` |
| 12 | Lefedettség a módosított modulokra (`jest --coverage`) | `proxy-http-client.ts` 100/100/100/100 · `ai-handler.ts` 100% sor, 95% ág |
| 13 | Tiszta worktree (`git worktree add … HEAD`, junction `node_modules`): `tsc`, `expo lint`, `prettier --check`, `jest --ci` | mind exit 0; 1628/1628 (a `main` HEAD) |
| 14 | `CI=1 npx expo export -p android --output-dir <scratch>` | exit 0 · `entry-….hbc (4.7MB)` |
| 15 | Bundle-szkennelés (titkos változók értékei; `@anthropic-ai/sdk`, `api.anthropic.com`, kulcsnevek, szolgáltatói hostok) | „secret vars with value: 3 hits: 0”; minden minta „absent” |
| 16 | Emulátor (`Medium_Phone_API_37.0`, `-no-window`) + `npx expo start --android --port 8093` (`EXPO_PUBLIC_DATA_MODE=mock`) | boot OK; „Android Bundled 3264ms (1810 modules)”; Metro-naplóban 0 hiba/figyelmeztetés |
| 17 | `.expo/types/router.d.ts` + `tsc` a dev szerver leállítása után (KI-121) | a `/` route megvan; tsc exit 0 |

## 3. Talált hibák és javítások

| # | Lelet | Súly | Javítás | Teszt |
|---|---|---|---|---|
| H-1 | **A hoszt nem-JSON 429/5xx válasza „nem JSON / szerződéssértés” hibaként jelent meg** (pl. EAS Hosting rate limit, átjáró HTML-hibalapja). A felhasználó nem tudta, hogy elég később újrapróbálni; az `isRetryable` sem ismerte fel. | Közepes | `proxy-http-client.ts`: státusz szerinti leképezés (429 → `RATE_LIMITED` + `Retry-After` mp, 408/504 → `TIMEOUT`, egyéb ≥ 400 → `HTTP_ERROR`); 2xx nem-JSON marad `CONTRACT_MISMATCH` (D-090) | `proxy-http-client.test.ts` (24), `e2e-business-flows` (3 hibaút), `proxy-integration` (frissítve + 1 új) |
| H-2 | **A kliens HTTP-rétege (bizalmi határ) nem volt közvetlenül tesztelve** (timeout, offline, nem-JSON, POST saját timeout). | Közepes (tesztrés) | új unit tesztfájl | `proxy-http-client.test.ts` – 100% lefedettség |
| H-3 | **Az AI-végpont a teljes törzset beolvasta a méretellenőrzés előtt** (memória-DoS a nyilvános proxyn). | Alacsony | `Content-Length` alapú korai 413 (D-091) | `ai-proxy-integration.test.ts` +1 |
| H-4 | **Nem volt a teljes üzleti folyamatot egy láncban, élő módban lefedő teszt** (a szakaszok külön-külön igen). | Közepes (tesztrés) | `e2e-business-flows.test.ts` | 9 teszt |
| H-5 | **Nem volt CI.** | Közepes | `.github/workflows/ci.yml` (D-089) | tiszta checkouton helyben igazolva (2. #13) |

**Nem hiba (ellenőrizve):** offline + üres cache mellett az értékelés `ok` eredményt ad – `NOT_RATED`, `INSUFFICIENT` confidence, az ár `ERROR` az okkal („Nincs kapcsolat… Korábban letöltött (offline) adat sincs”), név `null`. Ez a dokumentált viselkedés (hiány ≠ 0, nincs kitalált adat); az E2E teszt ezt rögzíti.

## 4. Alap üzleti folyamatok – lefedettség

| Folyamat | Automatikus teszt | Mit igazol |
|---|---|---|
| Részvény: keresés → lekérés/validálás → mutatók → score/döntés → AI | `e2e-business-flows` E2E 1 | élő mód, valódi `ProxyHttpClient` + contract-séma, valódi proxy-handlerek (mock provider); a hívott végpontok; a döntés címkéje az AI-bemenetben változatlan; template (`calculated`) + LLM (mock, proxyn át); a proxy napló adatmentes |
| ETF ugyanez | E2E 2 | ETF-értékelés, `dcf: null` az AI-bemenetben, LLM a proxyn át |
| Portfólió: pozíció → értékelés → kitettség → AI | E2E 3 | USD részvény + EUR ETF EUR bázissal; FX a proxyn át, `fxRatesUsed` kitöltve; kitettség és koncentráció; pénzösszeg nincs az AI-bemenetben; beleegyezés nélkül nincs LLM |
| Navigáció (keresés → elemzés megnyitása), képernyők | `routes.test.tsx` (meglévő, 24+) | valódi route-fa |
| Offline, cache, újraindítás | `offline-storage-integration`, `market-data-cache` (meglévő) | valódi SQLite (`node:sqlite`) |
| Valós adatokon (fixture) | `stock-*-integration`, `etf-analysis-integration`, `ai-explanation-integration` (meglévő) | SEC/FMP/EODHD rögzített válaszok |

## 5. Hibaforgatókönyvek (PHASE 15 / 4. pont)

| Forgatókönyv | Státusz | Bizonyíték (példák) |
|---|---|---|
| Adathiány (hiány ≠ 0) | PASS | `formula-checklist` (FCF, DCF adósság, súlyozott hozam `MISSING`), `etf-evaluation.test.ts` „a hiányzó … nem 0 pont”, E2E offline |
| Elavult adat | PASS | `market-data-cache.test.ts` (TTL, offline tartalék nem FRESH), `offline-storage-integration`; eszközön a „Elavult adat (STALE)” kártya látszik |
| Invalid JSON | PASS | `proxy-http-client.test.ts`, E2E „érvénytelen JSON 200-zal”, `ai-proxy-integration` (kérés-törzs) |
| Timeout | PASS | `proxy-http-client.test.ts` (AbortSignal, AI saját timeout), `http.test.ts` (szerver) |
| Rate limit | PASS | `proxy-http-client.test.ts` (saját boríték és hoszt 429), E2E, `routing.test.ts` (kvótaőr), `ai-proxy-integration` (AI 429) |
| FX hiány | PASS | `portfolio-analysis.test.ts` „hiányzó mai/ügyleti napi FX → MISSING”, `portfolio-history.test.ts`, `to-metric.test.ts` „nincs csendes FX” |
| Nullával osztás | PASS | `profitability.test.ts` „árbevétel = 0 → NOT_MEANINGFUL”, `future-value.test.ts`, `risk.test.ts`, `formula-checklist` |
| Negatív EPS / FCF | PASS | `valuation.test.ts`, `period-metrics.test.ts`, `balance-cashflow.test.ts`, `dcf.test.ts` (FCF ≤ 0 → N/M), `formula-checklist` |
| DCF invalid feltételek | PASS | `dcf.test.ts` (r ≤ g, ráta százalékként, időtáv, részvényszám), `formula-checklist` 5.4 |
| Storage hibák | PASS | `storage.test.ts` (hibás migráció visszagörget, ismeretlen sémaverzió, sérült rekord, DB-hiba → STORAGE), `local-data.test.ts`, `create-portfolio.test.ts` |
| Valós hálózat-kiesés eszközön (repülőgép-mód) | NOT RUN | demó módban nincs hálózati forgalom; élő módban a proxy + kvóta kellene – tulajdonosi kézi lépés (6.) |

## 6. Eszközös ellenőrzés (Android emulátor) – PARTIAL

Környezet: Android SDK a `%LOCALAPPDATA%\Android\Sdk`-ban (a PATH-ban `%ANDROID_HOME%` szó szerint, a változó nincs beállítva – a parancsok teljes úttal futottak), AVD `Medium_Phone_API_37.0`, Expo Go 58.0.6 (az `expo start` frissítette 58.0.5-ről), demó adatmód.

| Lépés | Eredmény |
|---|---|
| App indul, Kezdőlap + „Demó mód” jelzés | ✅ képernyőkép |
| Részvény (`/stock/DEMO@XNAS`): ár, „Demóadat”, „Elavult adat (STALE)”, „Részleges adat”, „Nem értékelhető”, N/A | ✅ |
| ETF (`/etf/DEMOETF@XETR`): „2/22 mező”, adatmegbízhatóság „elégtelen”, jogi szöveg | ✅ |
| Figyelőlistához adás → `am force-stop` → újranyitás: az elem megvan (valódi `expo-sqlite`, KI-117/KI-129 részben) | ✅ |
| Figyelő sor: ár, napi változás (+2,04% = 49 → 50), frissítve/adatnap | ✅ |
| Metro-napló / logcat JS-hibák | 0 |
| Repülőgép-mód, élő mód, portfólió-űrlap, screener- és riasztás-űrlap, kis képernyő (KI-131) | **NOT RUN** – kézi gépelést és élő proxyt igényel; a tulajdonos listája: [phases/phase-15-integration-testing-security.md](phases/phase-15-integration-testing-security.md) 9. lépés |
| Maestro flow | **BLOCKED** – Maestro nincs telepítve, nincs flow; bevezetése a PHASE 16 release-ellenőrzésének része lehet |

## 7. CI – NOT RUN (GitHubon)

`.github/workflows/ci.yml` (D-089). A GitHub-futás csak push/PR után történik; ebben a fázisban push nem volt (tulajdonosi döntés). Helyben a workflow minden lépése tiszta checkouton lefutott (2. #13), kivéve az `npm ci`-t (helyben a meglévő `node_modules`-t használtuk, junctionnel) és a Node 26 GitHub-runneres telepítését.

## 8. Függőségek

`npm audit` 22 moderate (0 high, 0 critical): `minimatch` (ReDoS-jellegű, „globparts amplification”) és `glob` (AbortSignal-megkerülés) a jest-eszközláncban és az `expo` → `@expo/fingerprint` build-eszközben. A javasolt `npm audit fix --force` visszaminősítene (expo 52, jest 29) → nem alkalmazzuk. Részletek, kockázat: [SECURITY.md](SECURITY.md) 8.

## 9. Teljesítmény

| Vizsgálat | Eredmény |
|---|---|
| Egy részvényértékelés hívásai | 6 kérés (quote, profile, prices, dividends + éves és negyedéves kimutatás); **egyetlen URL sem duplikált** – E2E teszt őrzi |
| Ismételt értékelés TTL-en belül | **0** új hálózati kérés (cache) – E2E teszt őrzi |
| Képernyők újralekérése | a `useAsyncResult` függőséglistái stabilak (`[services, listingId]`; a figyelőlistán összefűzött azonosító-szöveg, nem új tömb) → render nem indít lekérést; versenyhelyzet-védelem van |
| Optimalizáció | **nem végeztünk** – mérhető probléma nem volt; a profilozó (React DevTools) eszközön nem futott. Ismert lassúság: tömeges elemzés sorban (KI-125) – haladásjelző/megszakítás a következő fázisokra |

## 10. Korlátozások

- Élő szolgáltatói és élő LLM-hívás nem futott (kvóta, költség, tulajdonosi döntés) – a szerződést a rögzített fixture-ök és a mock provider ugyanazon a contract-sémán igazolja.
- Eszközön csak demó mód és 4 képernyő; iOS egyáltalán nem (Apple fiók/Mac kell).
- A CI-workflow GitHubon még nem futott.
- A Jest a `node:sqlite`-ot használja az `expo-sqlite` helyett; az eszközös futás egyetlen tartóssági esetet igazolt.
