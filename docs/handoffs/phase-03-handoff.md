# Handoff – PHASE 03 → PHASE 04A

> Dátum: 2026-11-21 · Előző fázis: PHASE 03 (Architektúra, domain modellek és alkalmazási rétegek) · Következő: **PHASE 04A – Proxy váz és ingyenes alapforrások** (D-028)
> Kezdőbarát részletek: [../phases/phase-03-architecture-domain-model.md](../phases/phase-03-architecture-domain-model.md)

## 1. Készültség
**PHASE 03: KÉSZ.** Minden elfogadási feltétel teljesült:
- **Domain modellek, szigorú típussal és validált konstruktorral:** `Instrument` (= `Stock` | `Etf`), `Listing`, `Quote`, `PriceSeries`, `FinancialStatement` (Income | Balance | CashFlow), `FinancialMetric`, `FxRate`, `Portfolio`, `Transaction` (BUY/SELL | DIVIDEND/FEE | SPLIT), `Position` (csak típus), `AnalysisResult`, `DataProvenance`, `Metric<T>`.
- **Hibakezelés:** `Result`/`AppError` (VALIDATION, NETWORK, TIMEOUT, RATE_LIMITED, NOT_FOUND, UPSTREAM, MISSING_DATA, CALCULATION_INVALID, STORAGE, AI) + `isRetryable`.
- **Rétegek:** domain → contracts (zod 4.6.7) → application (4 port, 2 use case) → infrastructure (mock, memória, óra) → config (composition root) → presentation (`AppServicesProvider`).
- **Rétegszabályok:** ESLinttel kikényszerítve. 8 szándékos hibával igazolva; a képernyőkben `fetch` tiltott.
- **Minimális application ↔ repository példa:** `recordTransaction` + `InMemoryPortfolioRepository`; `getListingQuote` + mock gateway. Mindkettő tesztelt.
- **Nem készült (szándékosan):** valós API, képletek, proxy, képernyők.

## 2. Létrehozott / módosított fájlok
**Új (kód):**
- `src/domain/index.ts`
- `src/domain/shared/{brand,currency,dates,errors,ids,metric,money,period,provenance,result,validation,index}.ts` + `shared.test.ts`
- `src/domain/instrument/instrument.ts`, `src/domain/market/quote.ts`
- `src/domain/fundamentals/{financial-statement,financial-metric}.ts`
- `src/domain/fx/fx-rate.ts`, `src/domain/portfolio/portfolio.ts`, `src/domain/analysis/analysis-result.ts`
- `src/domain/entities.test.ts`
- `src/contracts/{shared,quote,api-envelope,index}.ts` + `contracts.test.ts`
- `src/application/index.ts`, `src/application/ports/index.ts`
- `src/application/use-cases/{get-listing-quote,record-transaction}.ts` + `use-cases.test.ts`
- `src/infrastructure/system/system-clock.ts`
- `src/infrastructure/mock/{in-memory-portfolio-repository,mock-market-data-gateway}.ts`
- `src/infrastructure/api-client/not-implemented-market-data-gateway.ts`
- `src/config/container.ts` + `container.test.ts`
- `src/presentation/di/app-services-context.tsx` + `app-services-context.test.tsx`
- `jest.config.js`

**Módosított (kód/konfig):**
- `eslint.config.js` (rétegszabályok);
- `package.json` (+`zod`; a `jest` kulcs → `jest.config.js`), `package-lock.json`;
- `src/app/_layout.tsx` (`AppServicesProvider`).

**Docs:**
- új: `docs/phases/phase-03-architecture-domain-model.md`, ez a handoff;
- frissítve: `ARCHITECTURE.md` (3., 4.4, 5., 7., 14.), `DATA_DICTIONARY.md` (1., 2., 3., 4.3, 7., 9., új 10.), `DECISIONS.md` (D-014/D-025 státusz, új D-035…D-041), `PROJECT_STATE.md`, `ROADMAP.md`, `KNOWN_ISSUES.md` (KI-11…KI-16, PI-07, PI-08, R-26), `README.md` (mappaszerkezet).

## 3. Futtatott parancsok és tényleges eredmények (2026-11-21)

| Parancs | Eredmény |
|---|---|
| `npm run check` (indulóállapot, `c:\…` munkakönyvtár) | **piros:** 5/15 route-teszt „Invalid hook call” → KI-11 |
| `npx jest src/__tests__` PowerShellből (`C:\…`) | 5/5 zöld → az ok a meghajtóbetű kis/nagybetűs alakja |
| `jest.config.js` (kanonikus `rootDir` + `chdir`) után `npx jest` (`c:\…`) | 15/15 zöld |
| `npx expo install zod` | `zod ^4.6.7` a `dependencies`-ben |
| `npx tsc --noEmit` | exit 0 (fejlesztés közben 3 + 1 típushiba, mind javítva) |
| negatív lint-próba (4 ideiglenes fájl) | **8 várt hiba** (`no-restricted-paths`, `no-restricted-imports`, `no-restricted-globals`); a fájlok törölve |
| negatív typecheck-próba (séma ↔ domain illeszkedés) | a hibás típusnál a `tsc` hibát ad; az ideiglenes fájl törölve |
| `npx jest` (első teljes futás) | 95/97 – **2 valódi hiba** (összegyűjtött validáció a `createStock`-ban; az óra nem jutott el a mock gateway-hez) → javítva |
| `npm run check` (végső) | **exit 0**; `Test Suites: 9 passed`, `Tests: 98 passed` |
| `npx expo install --check` | `Dependencies are up to date` |
| `npx expo-doctor@latest` | `20/20 checks passed` |
| `npx expo export --platform android --output-dir <scratchpad>` | Hermes bundle `entry-….hbc (2.9MB)` – sikeres |

## 4. Ismert hibák és korlátok
Részletek: KNOWN_ISSUES „PHASE 03”.
- **KI-11 (megoldva):** a PHASE 02 „15/15” eredménye csak `C:\…` munkakönyvtárból volt igaz; a javítás a D-041.
- **KI-12:** emulátoron nem futtattuk a PHASE 03-at (csak export/bundle és tesztek).
- **KI-13:** a portfólió memóriában él (PHASE 13: SQLite).
- **KI-14:** `live` módban az árfolyam `NOT_IMPLEMENTED` (PHASE 04A).
- **KI-15:** az ID-generátor nem kriptográfiai.
- **KI-16:** `Logger`, `FxGateway`, `AiGateway` még nincs (D-040).
- A PHASE 02-es KI-01…KI-08 változatlanul nyitott (lásd ott).

## 5. Nyitott kérdések
- **Commit:** a PHASE 03 változásai nincsenek commitolva. A tulajdonos dönt, vagy kéri a commitot (javasolt üzenet: `feat: PHASE 03 – domain modell, rétegek, Result/AppError, rétegszabályok`).
- DP-05, U-13: változatlanul nyitott (PHASE 04B).
- KI-04: opcionális `ANDROID_HOME`/`Path`-javítás (nem blokkoló).

## 6. Útmutató a PHASE 04A indításához
1. **Olvasd el:**
   - `CLAUDE.md`, `docs/PROJECT_STATE.md`, ez a handoff;
   - `docs/ARCHITECTURE.md` 3. (rétegszabályok + kikényszerítés), 4.4 (adatút), 6. (proxy terv), 7. (`AppError`);
   - `docs/DECISIONS.md` D-004, D-005, D-024, D-028, D-035…D-041;
   - `docs/DATA_SOURCES.md`; a ROADMAP „04A” szakasza és a „PHASE 04A kapcsolódási pontjai”.
2. **Indulóállapot:** `git status`, `npm run check` (elvárt: exit 0, 98 teszt), `npm run deps:check`.
3. **Kapcsolódási pontok a kódban:**
   - `MarketDataGateway` port (`src/application/ports/index.ts`) → új `ProxyMarketDataGateway` az `src/infrastructure/api-client/`-ben; a `src/config/container.ts`-ben a `live` ágon a `notImplementedMarketDataGateway` helyére kerül.
   - Proxyválasz validálása: `parseApiResponse(json, quoteDtoSchema)` → `quoteFromDto` (`src/contracts`). A proxy ugyanazt a contract sémát használja a kimenetéhez.
   - A HTTP-hibák leképezése: `AppErrors.network/timeout/rateLimited/upstream`. A proxy oldali hibakódokat az `API_ERROR_CODES` és az `apiErrorToAppError` rögzíti.
   - Szolgáltatói DTO sémák: `src/server/providers/*` (D-014). A normalizált kimenet a domain konstruktorain megy át (pl. `createQuote`, `createFxRate`, `createFinancialStatement`; a meg nem adott tétel → `MISSING`).
   - `FxGateway` portot az első use case-ével együtt vezesd be (D-040).
4. **ESLint teendő:**
   - új zóna a `src/server`-nek: nem importálhat `presentation`, `infrastructure`, `config` réteget, és kliensoldali kód sem importálhatja;
   - a `src/app/api/**` route-ok importálhassák a `src/server`-t (a jelenlegi `src/app` zóna ezt tiltja → kivétel kell);
   - a `no-restricted-globals` már kihagyja a `src/app/api/**`-t.
5. **Ne építsd meg a 04A-ban:** FMP/EODHD adaptert, ProviderRoutert (04B), képleteket (05), képernyőket (12).
6. **Tesztek:** élő API-t teszt nem hívhat. A fixture-ök `mock`/`fixture` jelölésűek. A `jest.config.js`-t ne olvaszd vissza a `package.json`-ba (D-041).
