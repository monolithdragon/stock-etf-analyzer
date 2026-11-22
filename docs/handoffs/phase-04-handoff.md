# Handoff – PHASE 04 (04A + 04B) → PHASE 05

> Dátum: 2026-11-21 · Elkészült: **PHASE 04 – Adatforrások, proxy és deviza** (04A + 04B, D-028) · Következik: **PHASE 05 – Pénzügyi calculation engine**
> Kezdőbarát útmutató: [../phases/phase-04-data-sources-currency.md](../phases/phase-04-data-sources-currency.md) (04B: 15. fejezet) · A 04A részletei: [phase-04a-handoff.md](phase-04a-handoff.md)

## 1. Készültség
**PHASE 04: KÉSZ.** A 04-es prompt elfogadási feltételei:

| Feltétel | Állapot |
|---|---|
| A külső API-válaszok validálva vannak | ✅ zod-séma minden szolgáltatói válaszra (SEC, ECB, OpenFIGI, **FMP, EODHD**); hibás JSON, hiányzó mező, hibás pénznem, rate limit, timeout, offline, hibás ticker, 402/403/404 tesztelve |
| Az adatforrások képességei és korlátai dokumentáltak | ✅ DATA_SOURCES 10. (04A) és **11.** (04B, élő próbákkal), `providers/status` végpont, routing-tábla |
| A hiányzó adat nem alakul nullává / nullértékű adattá | ✅ `MISSING` / `UNAVAILABLE` / kihagyás + `notes`; hiányzó záróár, 0 összegű osztalék, ismeretlen pénznem soha nem 0 vagy kitalált; az EODHD figyelmeztető „ál-sorát” eldobjuk |
| A natív és a display currency külön | ✅ `FxConversion.original` vs `converted`; az ár natív pénznemben (GBX is), az osztalék a saját pénznemében (ISF: GBP) |
| A tesztek nem függenek élő API-tól | ✅ valós, megvágott fixture-ök + hamis `fetch`; **337/337** |

**A 04B tartalma:**
- Csomag (U-13): mindkét kulcs **free**. FMP: csak US (annak is egy része); EODHD: 20 hívás/nap, 1 év, fundamentum nélkül.
- Adapterek: `fmp` (quote, ártörténet NONE/SPLIT/SPLIT_DIVIDEND, profil, osztalék, keresés), `eodhd` (quote, ártörténet, osztalék, keresés ISIN-nel, ISIN → jegyzések pénznemmel).
- `ProviderRouter` (D-049), csomagmátrix (D-051), napi kvóta-őr prioritással, `UNAVAILABLE` + `unavailableReason` (D-053), jegyzés-pénznem szabály (D-052).
- 5 új végpont: `instruments/{id}/prices`, `/profile`, `/dividends`, `search`, `providers/status`.
- Kliens: 4 use case (`getPriceHistory`, `getInstrumentProfile`, `getDividendHistory`, `searchInstruments`), proxy- és demó-gateway.

**Nem készült (szándékosan):** ETF-metaadat/holdings (nincs free forrás → PHASE 08); split-végpont; proxy cache és tartós kvóta (13); EAS-próbatelepítés (tulajdonosi döntés, KI-29); UI (12); képletek (05).

## 2. Létrehozott / módosított fájlok (04B)
**Új – domain:** `src/domain/market/dividend.ts`, `src/domain/instrument/instrument-profile.ts`, `src/domain/instrument/instrument-search.ts`, `src/domain/phase04b-entities.test.ts`.
**Új – contracts:** `src/contracts/{market,search,provider-status}.ts`, `src/contracts/phase04b-contracts.test.ts`.
**Új – szerver:** `src/server/providers/fmp/` (`fmp-symbols.ts`, `fmp-normalizer.ts`, `fmp-provider.ts`, `fmp.test.ts`, `__fixtures__/` 10 fájl), `src/server/providers/eodhd/` (`eodhd-symbols.ts`, `eodhd-normalizer.ts`, `eodhd-provider.ts`, `eodhd.test.ts`, `__fixtures__/` 21 fájl), `src/server/routing/` (`provider-router.ts`, `plans.ts`, `quota.ts`, `markets.ts`, `routing.test.ts`), `src/server/handlers/api-handlers-04b.test.ts`.
**Új – route-ok:** `src/app/api/v1/instruments/[id]/{prices,profile,dividends}+api.ts`, `src/app/api/v1/search+api.ts`, `src/app/api/v1/providers/status+api.ts`.
**Új – kliens:** `src/application/use-cases/get-market-data.ts`.
**Módosított:** `src/domain/{index.ts, shared/errors.ts, market/quote.ts, instrument/instrument.ts, entities.test.ts}`; `src/contracts/{api-envelope,health,index}.ts`; `src/application/{index.ts, ports/index.ts}` + 2 teszt-fake; `src/infrastructure/api-client/{proxy-gateways,not-implemented-market-data-gateway}.ts`, `src/infrastructure/mock/mock-market-data-gateway.ts`; `src/config/container.ts`; `src/presentation/di/app-services-context.test.tsx`; `src/server/{env,server-context,logging}.ts`, `src/server/http/{request-json,request-scheduler,http.test}.ts`, `src/server/handlers/{api-handlers,http,api-handlers.test}.ts`, `src/server/providers/{market-data-provider.ts, mock/mock-provider.ts, ecb-fx/…, openfigi/…, sec-edgar/…}` (`plan`, `coverage`); `src/app/api/v1/instruments/[id]/quote+api.ts` (megjegyzés); `src/__tests__/proxy-integration.test.ts`; `.env.example`; `README.md`.
**Docs:** új: ez a handoff; frissítve: `PROJECT_STATE`, `ROADMAP`, `KNOWN_ISSUES` (KI-30…KI-41; KI-14/21/22/29, U-04/13/14/15, R-23), `DECISIONS` (D-049…D-054), `DATA_SOURCES` (3., 5.1, 5.2, 8., **11.**), `DATA_DICTIONARY` (3.3–3.7, 10., 11.), `ARCHITECTURE` (4.5, 5.1, 6.3, 6.5), fázisútmutató (15. fejezet).

## 3. Futtatott parancsok és tényleges eredmények (2026-11-21)

| Parancs | Eredmény |
|---|---|
| `npm run check` (indulóállapot) | exit 0 |
| EODHD `/api/user` (0 hívás, értékvak szkripttel) | `subscriptionType: free`, `dailyRateLimit: 20` |
| FMP élő próbák (~30 hívás) | US quote/profile/history/dividends/search OK; `SAP.DE`, `VWCE.DE`, `BRK-B`, `ZZZZQX`, `etf/info`, `etf/holdings`, `search-isin` → 402; NVDA split-igazolás 3 végponton |
| EODHD élő próbák (~25 hívás, a napi 20 + néhány bónuszhívás) | 3 UCITS ETF + 4 nem US részvény EOD; real-time (`NA` ismeretlen tickerre); div (ISF GBP); search (ISIN, `exchange=` szűrő); free ablak „warning” sor; fundamentals 403; 404 „Ticker Not Found.” |
| hivatalos doksi (web-fetch) | EODHD: limitek, mezők, ToS olvasva; FMP: minden oldal **HTTP 403** |
| `npx jest` (első futás a változások után) | **4 piros** – mind szándékos viselkedésváltozás (04A „nincs forrás” / `UNSUPPORTED_MARKET` → 04B `UNAVAILABLE`), tesztek frissítve |
| EODHD-tesztek első futása | 4 piros: 2× hiányzó kereső-fixture (az adapter helyesen NOT_FOUND-ot adott pénznem helyett) → 2 élő hívással rögzítve; 1 tesztszöveg-hiba |
| `npm run lint` | 16 import-sorrend figyelmeztetés → `eslint --fix` |
| élő füstpróba (saját szerver, 8083; a 8082 foglalt volt) | 11 végpont a várt eredménnyel, **kulcsszivárgás: 0**; **lelet:** a kvóta-számláló route-onként külön élt (KI-31) → `globalThis` → újrapróbálva: FMP 2/250 közös |
| `npm run check` (végső) | **exit 0**; `Test Suites: 25 passed`, `Tests: 337 passed` |
| `npx expo export --platform web` | 10 API route (route-onként külön bundle) |
| `npx expo export --platform android` + szkenner | Hermes bundle 3,6 MB; **nincs** szolgáltatói URL, szerverkód, kulcs |
| repó-szkenner (`.env.local` kulcsértékei, 220 fájl) | **0 találat**; `.env.local` gitignore-olt |

Emulátoron az appot **nem** futtattuk (nincs UI-változás, KI-12).

## 4. Ismert hibák és korlátok
Részletek: KNOWN_ISSUES „PHASE 04B” és „PHASE 04A”.
- KI-30: FMP 402 ismeretlen tickerre is (nem különböztethető meg a csomagkorláttól).
- KI-32 / KI-23: memóriabeli, folyamatonkénti kvóta és limiter; az EODHD mai kerete a próbákon elfogyott.
- KI-33: az EODHD `close` nyers jellege csak doksiból igazolt.
- KI-35: EODHD pénznem-keresés +1 hívás/jegyzés/nap.
- KI-21: ISIN → US jegyzés továbbra sem (megkerülés: ticker-keresés).
- KI-22: részben megoldva (EODHD ad pénznemet; a `listings` elsődlegesen OpenFIGI marad).
- KI-38 / KI-39: fizetős csomag-sorok és FMP keret/ToS nem igazolt.
- KI-41: a 8081/8082-es régi dev szerverek újraindítandók.

## 5. Nyitott kérdések (tulajdonos)
- **Commit:** a 04B változásai nincsenek commitolva. Javasolt üzenet: `feat: PHASE 04B – FMP/EODHD adapterek, ProviderRouter, kvóta, csomagmátrix, új végpontok`.
- **FMP-fiók:** a napi keret és a ToS ellenőrzése a dashboardon (KI-39).
- **EAS-próbatelepítés** és a kulcsok „sensitive” env-változóként: legkésőbb a PHASE 16 előtt (KI-29).
- DP-05: kell-e fizetős adatcsomag (nem US fundamentum, ETF-metaadat)? Nem sürgős.

## 6. Útmutató a PHASE 05 indításához
1. **Olvasd el:** `CLAUDE.md`, `docs/PROJECT_STATE.md`, ez a handoff; `DATA_DICTIONARY` 2. (Metric, státuszok), 3.6–3.7 (ár, osztalék), 4. (kimutatások), **5. (kiinduló képletdefiníciók – a PHASE 05 véglegesíti)**, 8. (FX); `DECISIONS` D-009, D-010, D-021, D-022, D-050.
2. **Indulóállapot:** `git status`, `npm run check` (elvárt: exit 0, 337 teszt).
3. **Bemenetek a képletekhez (domain-típusok, nem szolgáltatói formátum):**
   - `FinancialStatementSet` (SEC; sortétel = `Metric<number>`, a hiány `MISSING`, a jelentett 0 `OK`);
   - `PriceSeries` – **figyelj az `adjustment`-re**: `SPLIT_DIVIDEND` = total return, `SPLIT` = árhozam; eltérő korrekciójú sorozatot ne keverj;
   - `DividendHistory` – eseményenkénti pénznem; osztalékhozamnál az ár pénznemével egyeztetni (`toMajor`, GBX ↔ GBP);
   - `Quote`, `FxConversion`.
4. **Helye:** `src/calculations/` (az ESLint-rétegszabályokban már szerepel); csak `domain`-t importálhat; UI, hálózat, RN tilos.
5. **Ne építsd meg a 05-ben:** teljes DCF (07), score (10), UI-formázás (12), új adatforrást.
6. **Élő adat nem kell:** a PHASE 05 tesztjei kézi, dokumentált bemenetekkel és (ha kell) a meglévő fixture-ökkel dolgozzanak.
