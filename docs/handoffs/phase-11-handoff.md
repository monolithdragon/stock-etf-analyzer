# Handoff – PHASE 11 → PHASE 12

> Dátum: 2026-11-23 · Elkészült: **PHASE 11 – AI-magyarázó engine** · Következik: **PHASE 12 – UI/UX és navigáció**
> Kezdőbarát útmutató: [../phases/phase-11-ai-explanation-engine.md](../phases/phase-11-ai-explanation-engine.md) · Előző handoff: [phase-10-handoff.md](phase-10-handoff.md)

## 1. Készültség
**PHASE 11: KÉSZ.** A 11-es prompt elfogadási feltételei:

| Feltétel | Állapot | Bizonyíték |
|---|---|---|
| AI nélkül is működik minden pénzügyi számítás és döntési engine | ✅ | A `src/scoring` és a `src/calculations` nem hivatkozik AI-ra (változatlan). A szabályalapú `template` magyarázat offline készül (`explainAnalysis`, `mode: 'template'` → nincs hálózati hívás, teszt). |
| AI-hiba esetén az app használható marad | ✅ | `AI_DISABLED`, timeout, rate limit, refusal, érvénytelen kimenet, hálózati hiba és hamis eredet-jelölés → `llm.status = 'failed'` + ok, a `display` a template (`ai-explanation-integration.test.ts`, `ai-proxy-integration.test.ts`). |
| Forrás nélküli pénzügyi adat nem jelenik meg tényként | ✅ | Tartalmi őr: ismeretlen `ref`, adat nélküli tényállítás, nem visszakereshető szám vagy dátum → a teljes válasz elutasítva, a szerveren ÉS a kliensen. A hiányzó mutató `null` + ok, és `dataGaps`-ként jelenik meg, soha nem 0. |
| Az AI-kimenet strukturált, validált és magyarázható | ✅ | zod `strictObject` séma (9 szakasz + confidence), minden állítás `basedOn` + `support`. Az LLM ugyanezt kapja JSON-sémaként. |

Feladatlista (1–11): mind kész.
- A 2. pont (lokális LLM és felhős API vizsgálata) **dokumentációként** készült el: DATA_SOURCES 14. A `local` provider tudatosan nem készült el (KI-94).
- **Élő LLM-hívás nem volt**, mert nincs kulcs (KI-92).

## 2. Mi készült
- **Szerződés** (`src/contracts`):
  - `ai.ts`: `AiInputDto`, kimeneti séma, `AiExplanationDto`, kérés `consent`-tel, `citableRefs`, `sanitizeAiText`;
  - `ai-guards.ts`: `validateAiExplanation`, `extractNumbers`;
  - `ai-testing.ts`: kézi DTO-fixture-ök, csak teszthez.
- **Új réteg `src/explanation`:** `explainWithTemplate` (részvény/ETF és portfólió sablon). ESLint-zóna: csak `contracts` + `domain`, próbafájllal igazolva (4 várt hiba).
- **Alkalmazás:**
  - `src/application/explanation/build-ai-input.ts`: `buildInstrumentAiInput`, `buildPortfolioAiInput`, `formatAiDisplay`, `aiRef`;
  - port: `AiGateway`;
  - use case: `src/application/use-cases/explain-analysis.ts` (`createExplainAnalysis`) → `AppServices.explainAnalysis`.
- **Kliens-infrastruktúra:**
  - `proxy-ai-gateway.ts` (`createProxyAiGateway`, `disabledAiGateway`);
  - `proxy-http-client.ts`: új `post()`.
- **Szerver** (`src/server/ai/`):
  - `ai-config.ts` (env);
  - `ai-provider.ts` (port);
  - `mock-ai-provider.ts`;
  - `anthropic-ai-provider.ts` (hivatalos SDK, strukturált kimenet, refusal, fallback, hibaleképezés);
  - `prompts.ts` (3 sablon, `PROMPT_VERSION`);
  - `ai-explain-service.ts` (kill switch → cache → napi keret → timeout → JSON → séma → őr).

  Handler: `src/server/handlers/ai-handler.ts`. Route: `src/app/api/v1/ai/explain+api.ts`. Az AI-hibák saját HTTP-kódot kapnak (`http.ts`).
- **Új csomag:** `@anthropic-ai/sdk` **1.12.0** (Apache-2.0, zod 4 peer, nincs natív rész; csak a szerver importálja).

## 3. Módosított / új fájlok
- **Új kód (18):**
  - `src/contracts/{ai,ai-guards,ai-testing}.ts`;
  - `src/explanation/{index,template-explainer}.ts`;
  - `src/application/explanation/build-ai-input.ts`;
  - `src/application/use-cases/explain-analysis.ts`;
  - `src/infrastructure/api-client/proxy-ai-gateway.ts`;
  - `src/server/ai/{ai-config,ai-provider,mock-ai-provider,anthropic-ai-provider,prompts,ai-explain-service}.ts`;
  - `src/server/handlers/ai-handler.ts`;
  - `src/app/api/v1/ai/explain+api.ts`.
- **Új tesztek (5 fájl, 119 teszt):**
  - `src/contracts/ai-guards.test.ts` (40);
  - `src/server/ai/ai-explain-service.test.ts` (21);
  - `src/server/ai/anthropic-ai-provider.test.ts` (15);
  - `src/__tests__/ai-explanation-integration.test.ts` (21);
  - `src/__tests__/ai-proxy-integration.test.ts` (22).
- **Módosított kód:**
  - `eslint.config.js` (explanation-zóna; az application importálhatja);
  - `src/application/{index,ports/index}.ts`;
  - `src/config/container.ts` (`aiGateway`, `explainAnalysis`);
  - `src/contracts/index.ts`;
  - `src/infrastructure/api-client/proxy-http-client.ts`;
  - `src/server/{server-context,handlers/http}.ts`;
  - `src/presentation/di/app-services-context.test.tsx` (új szolgáltatás a fake-ben);
  - `package.json`, `package-lock.json`.
- **Docs:**
  - új: ez a handoff és a `docs/phases/phase-11-ai-explanation-engine.md`;
  - módosítva:
    - `DECISIONS` (D-016 kiegészítés, **D-076…D-078**);
    - `DATA_SOURCES` (**14. fejezet**: LLM-vizsgálat);
    - `DATA_DICTIONARY` (**17. fejezet**, `AiAnalysis` sor);
    - `ARCHITECTURE` (5.1, 6.3, 6.5, 9. biztonsági terv);
    - `KNOWN_ISSUES` (blokkolók, **KI-89…KI-96**, R-09, R-13, U-09, U-16);
    - `ROADMAP`, `PROJECT_STATE`;
    - `.env.example` (új AI-változók magyarázattal).

## 4. Parancsok és tényleges eredmények (2026-11-23, a projekt gyökerében)

| Parancs | Eredmény |
|---|---|
| `git status` (kiinduláskor) | `main`, clean; a PHASE 10 merge-ölve (`8e92ff1`, PR #6) |
| `git switch -c phase-11` | új munkaág |
| `npm view @anthropic-ai/sdk …` | 1.12.0 (2026-11-20), Apache-2.0, peer `zod ^3.25 \|\| ^4` |
| `npm install @anthropic-ai/sdk@1.12.0` | telepítve; figyelmeztetés: blokkolt `@parcel/watcher` install-szkript (KI-96, nem ennek a csomagnak a része) |
| `npm run check` (a fázis végén) | **exit 0**: typecheck ✅, lint (`--max-warnings 0`) ✅, Prettier ✅, **1307/1307 teszt, 77 suite** ✅ (+121 a PHASE 10 végi 1186-hoz képest) |
| lefedettség (új modulok) | 95,7% sor / 86,6% ág. A lefedetlen rész főleg a valódi SDK-kliens példányosítása (`createSdkMessagesClient`), amely tudatosan nem fut élőben. |
| `npx expo export -p web` | 11 API route, köztük `/api/v1/ai/explain` (~2 MB). Szkennelés: a kliens-bundle-ben **0** találat SDK-ra, `ANTHROPIC_API_KEY`-re vagy szerverkódra; a szerver-route-ban benne az SDK. |
| `expo serve --port 8083` + `AI_PROVIDER=mock AI_ENABLED=true` | `POST /api/v1/ai/explain` → **200** mock válasszal; `GET` → 405; a napló egy sor: route, státusz, latencia, provider. A szerver leállítva, a `dist` törölve. |
| ESLint-zóna próbafájl (`src/explanation/zz-probe.ts`) | 4 várt hiba (scoring-, config-, react-import, `fetch`); a próbafájl törölve |

**Élő LLM-hívás nem volt.** A `.env.local` (értékvakon ellenőrizve): `AI_PROVIDER=template`, `AI_ENABLED=false`, `ANTHROPIC_API_KEY` üres. Teszt nem hív élő API-t: az Anthropic-adapter hamis klienssel, a szolgáltatás mock providerrel van tesztelve.

**Fejlesztés közbeni leletek:**
1. Az „eséllyel” alakot (dupla l) a tiltott-állítás minta eredetileg nem ismerte fel; a teszt kimutatta, javítva.
2. A valós AAPL/MSFT/NVDA szabályalapú szövege elbukott a címke-szabályon. Ok: a motor saját `drivers` és érvénytelenítési szövegei jogosan említenek más címkét („Plafon: … WATCH → HOLD”, „nincs Buy/Strong Buy”), a `stock-watch` szabály-id pedig „Watch”-ként illeszkedett. Javítás (D-077/2): más címke csak az ítéletet hordozó szakaszokban tilos, és a szabály-id nem címke.
3. Darabszámok („12 adathiány”, „3 nyitott pozíció”) eredetileg nem voltak visszakereshetők. Javítás: a listahossz és a nyitott pozíciók száma a bemenet része, illetve levezethető tény.

## 5. Ismert hibák / korlátok
Részletek: [../KNOWN_ISSUES.md](../KNOWN_ISSUES.md), „PHASE 11” szakasz.
- **KI-89 (K):** a tartalmi őr nem ért szemantikát (szám nélküli túlzást nem szűr) → a UI-ban „AI-értelmezés” címke kell.
- **KI-90 (K):** az SDK EAS Hostingon nem igazolt (csak lokálisan).
- **KI-91 (A):** az AI-cache és a napi keret memóriában, példányonként él.
- **KI-92 (K):** élő hívás nem volt; a szolgáltató a JSON-sémát élőben még nem fogadta el.
- **KI-93 (K):** a szigorú őr miatt az LLM-válaszok egy része várhatóan elbukik (hamis pozitív → template jelenik meg).
- **KI-94 (A):** nincs `local` provider. **KI-95 (A):** a template-szöveg technikai. **KI-96 (A):** blokkolt `@parcel/watcher` install-szkript.

## 6. Nyitott kérdések (a tulajdonos dönt)
- **Commit:** tulajdonosi kérésre commitolva a `phase-11` branchen (`3c83c01`); a push, a PR és a merge a tulajdonos döntése. Üzenet:
  `feat: PHASE 11 – AI-magyarázó engine (AiInputDto + strukturált, validált kimenet basedOn-nal, tartalmi őr, template provider, explainAnalysis, POST /api/v1/ai/explain mock és Anthropic providerrel, kill switch, napi keret, cache)`
- **LLM bekapcsolása (DP-04):** marad-e a díjmentes `template`, vagy legyen `anthropic` (javaslat: `claude-haiku-5-5`, `AI_DAILY_LIMIT=20`)? Az alapértelmezett modell a D-016 szerint `claude-opus-5-5`; ez költségdöntés. A kulcs csak a `.env.local`-ba kerülhet.
- **Lokális LLM:** kell-e (adatvédelem kontra hardver és minőség)? Lásd DATA_SOURCES 14.3.
- A régebbi nyitott pontok (EAS-próbatelepítés, FMP-keret és ToS, DP-05) változatlanok, és nem blokkolják a PHASE 12-t.

## 7. Indulási útmutató a PHASE 12-höz
1. **Olvasnivaló:**
   - `docs/PROJECT_STATE.md`, ez a handoff, a ROADMAP PHASE 11 „kapcsolódási pontok” része;
   - DATA_DICTIONARY **17.** fejezet, D-076…D-078.
2. **Ellenőrzés:** `git status`, majd `npm run check`. Elvárt: exit 0, **1307 teszt** (ha a PHASE 11 merge-ölve van).
3. **A magyarázat a UI-ban:**
   - Hívási lánc: `evaluateStock`/`evaluateEtf` → `buildInstrumentAiInput(evaluation, { valuation, displayName })` → `services.explainAnalysis({ input, mode: 'template' })`.
   - Megjelenítés:
     - `outcome.display.content` szakaszai;
     - a `meta.provenanceKind` alapján címke: „Szabályalapú összefoglaló” (`calculated`) vagy „AI-értelmezés” (`ai_interpretation`);
     - `basedOn` → kattintható hivatkozás a mutatóra;
     - `support: 'insufficient_data'` → „nincs elég adat” stílus.
4. **„AI-magyarázat kérése” gomb:** `mode: 'llm'`.
   - Portfóliónál előtte beleegyezés-párbeszéd → `consent: { shareWithAiProvider: true }`.
   - `llm.status === 'failed'` esetén érthető üzenet az `error` alapján (pl. „Az AI ki van kapcsolva”, „Időtúllépés”, „Az AI-válasz nem ment át az ellenőrzésen”); a template marad látható.
5. **Tilos a UI-ban:**
   - az AI-szöveg tényként, jelölés nélkül;
   - a confidence valószínűségként;
   - automatikus LLM-hívás felhasználói művelet nélkül;
   - pontozás vagy magyarázat-építés a komponensben (a `buildInstrumentAiInput` az alkalmazási rétegben van).
