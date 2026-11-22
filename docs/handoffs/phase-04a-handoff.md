# Handoff – PHASE 04A → PHASE 04B

> Dátum: 2026-11-21 · Elkészült: **PHASE 04A – Proxy váz és ingyenes alapforrások** (D-028) · Következik: **PHASE 04B – FMP, EODHD, routing és kvóta**
> Kezdőbarát útmutató: [../phases/phase-04-data-sources-currency.md](../phases/phase-04-data-sources-currency.md)

## 1. Készültség
**PHASE 04A: KÉSZ.** A 04-es prompt elfogadási feltételei a 04A-ra eső részben teljesültek:

| Feltétel | Állapot |
|---|---|
| A külső API-válaszok validálva vannak | ✅ zod-séma minden szolgáltatói válaszra (SEC: lusta, tagenkénti szigorú validálás); hibás JSON, hiányzó mező, hibás pénznem, rate limit, timeout, offline, hibás ticker/ISIN tesztelve |
| Az adatforrások képességei és korlátai dokumentáltak | ✅ DATA_SOURCES 10. (élő próbahívásokkal), a health végpont `unavailableCapabilities` mezője |
| A hiányzó adat nem alakul nullává | ✅ `MISSING` indoklással (SEC normalizáló, contract: minden sortétel-kulcs kötelező); a jelentett 0 `OK` marad – tesztelve |
| A natív és a display currency külön | ✅ `FxConversion.original` vs `converted`, ráta + dátum + forrás; elavult rátánál hiba |
| A tesztek nem függenek élő API-tól | ✅ valós, megvágott fixture-ök + hamis `fetch`; 228/228 |

**A 04A tartalma:**
- `MarketDataProvider` szerződés (`src/server/providers/market-data-provider.ts`), regiszter live XOR mock.
- Adapterek: `sec-edgar` (ticker → CIK, companyfacts, 12 valós cég), `ecb-fx` (Frankfurter v2), `openfigi` (ISIN → jegyzések, igazolt MIC-tábla), `mock`.
- 5 proxy-végpont (`src/app/api/v1/**/+api.ts` → `src/server/handlers`).
- Kliens: proxy HTTP-kliens, proxy-gateway-ek, `FxGateway` port, `convertMoney` (FxService), `getSecurityListings`, `getFinancialStatements`.
- D-004 spike (lokálisan igazolva; EAS: nincs KV/rate-limit, secret helyett „sensitive”).

**Nem készült (szándékosan, 04B vagy később):** árfolyam-, ártörténet-, profil-, osztalék- és ETF-forrás; `/search`, `/providers/status`; ProviderRouter, kvóta; proxy cache (13); EAS-próbatelepítés (tulajdonosi döntés); UI (12).

## 2. Létrehozott / módosított fájlok
**Új – szerver (`src/server/`):** `env.ts`, `server-context.ts`, `logging.ts`; `http/request-json.ts`, `http/request-scheduler.ts`, `http/http.test.ts`; `handlers/api-handlers.ts`, `handlers/http.ts`, `handlers/api-handlers.test.ts`; `providers/market-data-provider.ts`; `providers/sec-edgar/{sec-tags,sec-dto,sec-normalizer,sec-edgar-provider}.ts` + `sec-edgar.test.ts` + `__fixtures__/` (13 fájl); `providers/ecb-fx/ecb-fx-provider.ts` + teszt + `__fixtures__/` (2); `providers/openfigi/{exchange-codes,openfigi-provider}.ts` + teszt + `__fixtures__/` (1); `providers/mock/mock-provider.ts`; `testing/test-helpers.ts`.

**Új – route-ok:** `src/app/api/v1/health+api.ts`, `fx+api.ts`, `securities/[isin]/listings+api.ts`, `stocks/[id]/financials+api.ts`, `instruments/[id]/quote+api.ts`.

**Új – kliens és közös:** `src/domain/instrument/listing-candidate.ts`, `src/domain/fundamentals/financial-statement-set.ts`, `src/domain/fx/fx-conversion.ts` (+ `fx-conversion.test.ts`, `phase04-entities.test.ts`); `src/contracts/{fx,listings,financials,health}.ts` (+ `phase04-contracts.test.ts`); `src/application/use-cases/{convert-money,get-market-reference-data}.ts` (+ `phase04-use-cases.test.ts`); `src/infrastructure/api-client/{proxy-http-client,proxy-gateways}.ts`; `src/infrastructure/mock/mock-fx-gateway.ts`; `src/__tests__/proxy-integration.test.ts`; `scripts/record-sec-fixtures.mjs`.

**Módosított:** `src/domain/index.ts`, `src/domain/shared/currency.ts` (`GBp` → `GBX`), `src/domain/shared/dates.ts` (`toUtcIsoDate`); `src/contracts/{shared,quote,api-envelope,index}.ts`; `src/application/{index,ports/index}.ts`; `src/infrastructure/api-client/not-implemented-market-data-gateway.ts`; `src/infrastructure/mock/mock-market-data-gateway.ts`; `src/config/container.ts` (+ teszt); két meglévő teszt fake-je; `eslint.config.js` (új zónák); `.prettierignore` (fixture-ök); `.env.example` (`PROXY_DATA_MODE`).

**Docs:** új: `docs/phases/phase-04-data-sources-currency.md`, ez a handoff; frissítve: `PROJECT_STATE`, `ROADMAP`, `KNOWN_ISSUES` (KI-17…KI-29; KI-12/14/16, R-05/08/25/27, U-03/07), `DECISIONS` (D-004 spike, D-028, D-037, új D-042…D-048), `DATA_SOURCES` (10. fejezet), `DATA_DICTIONARY` (3.3, 4.4, 8., 10., 11.), `ARCHITECTURE` (3., 4.5, 5.1, 6.3, 6.5), `README`.

## 3. Futtatott parancsok és tényleges eredmények (2026-11-21)

| Parancs | Eredmény |
|---|---|
| `npm run check` (indulóállapot) | exit 0, 98/98 |
| élő próbahívások (curl): Frankfurter, OpenFIGI (`micCode`-próbák), SEC | formátumok és MIC-párok igazolva (DATA_SOURCES 10.); SEC User-Agent nélkül 403 |
| `node scripts/record-sec-fixtures.mjs` | 12 cég, 110–1701 tény/cég, ~2 MB |
| feltáró futtatás a 12 fixture-ön | 2 normalizálási hiba (JNJ címlap-dátum, Revenues-prioritás) és 1 formátumhiba (XOM `cik` string) → javítva |
| `npx jest` (első teljes) | 211 zöld, utána handler-tesztek: **5 piros** – 2 valódi szerződés-eltérés (listing `isin`/`securityId`, quote-alak) + teszthibák → javítva |
| negatív lint-próba (4 ideiglenes fájl) | **4 várt hiba**, a valódi `+api.ts` átment; fájlok törölve |
| `npm run check` (végső) | **exit 0**; `Test Suites: 19 passed`, `Tests: 228 passed` |
| `npx expo install --check` | `Dependencies are up to date` |
| `CI=1 npx expo start --port 8082` + curl mind az 5 végpontra | élő adat: ECB-ráták; VWCE 11 jegyzés; AAPL FY2026 árbevétel 478 834 000 000 USD; hibák: 422 / 501 / 400 / 404 a várt módon |
| `npx expo export --platform web` | szerver-bundle, 5 API route (~629 KB) |
| `npx expo export --platform android` + szkenner | Hermes bundle 3,6 MB; **nincs** benne szolgáltatói URL, szerverkód, User-Agent |
| repó-szkenner (`.env.local` értékei a követett/új fájlokban) | 159 fájl: nincs találat; `.env.local` gitignore-olt |

Emulátoron az appot **nem** futtattuk (nincs UI-változás, KI-12).

## 4. Ismert hibák és korlátok
Részletek: KNOWN_ISSUES „PHASE 04A”.
- KI-17 / KI-27: a futó dev szervert env- vagy szerverkód-változás után újra kell indítani.
- KI-18 / KI-19: negyedéves Q2/Q3 cash flow és Q4 nincs (PHASE 06).
- KI-20: JPM negyedéves árbevétel, BRK-B EPS `MISSING` (tag-lefedettség).
- KI-21 / KI-22: US-tőzsde ISIN-ből nem; OpenFIGI-ben nincs jegyzési pénznem (04B).
- KI-23 / KI-24: memóriabeli limiter, nincs proxy cache.
- KI-29: EAS Hosting nem telepít „secret”-et; próbatelepítés nem készült.

## 5. Nyitott kérdések
- **Commit:** a változások nincsenek commitolva. Javasolt üzenet: `feat: PHASE 04A – proxy váz, SEC/ECB/OpenFIGI adapterek, FX service, valós fixture-ök`.
- **EAS-próbatelepítés** most vagy a PHASE 16-ban? (Expo-fiók és tulajdonosi döntés kell.)
- U-13: FMP/EODHD csomagszint (04B).

## 6. Útmutató a PHASE 04B indításához
1. **Előkészület (tulajdonos):** az `FMP_API_KEY` és az `EODHD_API_KEY` beírása a `.env.local`-ba (NEM a chatbe); a futó dev szerver újraindítása.
2. **Olvasd el:** `CLAUDE.md`, `docs/PROJECT_STATE.md`, ez a handoff; `DECISIONS` D-004, D-024, D-027, D-042…D-048; `DATA_SOURCES` 3., 5., 8. (04B lista), 10.; `DATA_DICTIONARY` 11.; a ROADMAP „04B” szakasza és „A PHASE 04B kapcsolódási pontjai”.
3. **Indulóállapot:** `git status`, `npm run check` (elvárt: exit 0, 228 teszt), `npm run deps:check`.
4. **Kapcsolódási pontok:**
   - Új adapter = `MarketDataProvider` megvalósítás a `src/server/providers/<id>/` alatt (DTO-séma + normalizáló + adapter + valós fixture). Minta: `ecb-fx-provider.ts` (egyszerű) és `sec-edgar-provider.ts` (ütemező, memo).
   - Felfelé irányuló HTTP: kizárólag a `requestJson` (`src/server/http/request-json.ts`); a 402 már `RATE_LIMITED`.
   - Regiszter → `ProviderRouter` (`src/server/routing/`): a `findProvider` hívások helyére (`api-handlers.ts`).
   - Env: `src/server/env.ts` (+ teszt, hogy érték nem kerül naplóba/health-be).
   - Új domain-típusok csak a használójukkal (profil, osztalék, ETF-metaadat).
   - `ListingCandidate.tradingCurrency` kitöltése (KI-22), ISIN → US listing (KI-21).
5. **Tesztminta:** `fakeFetch` + `loadFixture` (`src/server/testing/test-helpers.ts`); végponttól végpontig: `src/__tests__/proxy-integration.test.ts`. Élő API-t teszt nem hívhat.
6. **Ne építsd meg a 04B-ben:** képleteket (05), proxy cache-t (13), képernyőket (12).
7. **A 04B végén:** `docs/handoffs/phase-04-handoff.md` (a teljes PHASE 04 lezárása), a fázisútmutató 04B-fejezete.
