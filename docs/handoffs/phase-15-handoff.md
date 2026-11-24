# Handoff – PHASE 15 → PHASE 16

> Dátum: 2026-11-24 · Elkészült: **PHASE 15 – Integráció, QA, biztonság** · Következik: **PHASE 16 – Release és dokumentáció**
> Kezdőbarát útmutató: [../phases/phase-15-integration-testing-security.md](../phases/phase-15-integration-testing-security.md) · Előző handoff: [phase-14-handoff.md](phase-14-handoff.md) · Riportok: [../QA_REPORT.md](../QA_REPORT.md), [../SECURITY.md](../SECURITY.md)

## 1. Készültség
**PHASE 15: KÉSZ** – egy megszorítással: az eszközös ellenőrzés **részleges** (KI-132), a Maestro **BLOCKED**, a CI GitHubon **NOT RUN** (KI-134).

| Elfogadási feltétel | Állapot | Bizonyíték |
|---|---|---|
| Hibák és kihagyott tesztek pontosan dokumentáltak | ✅ | QA_REPORT 1., 3., 6., 7., 10. |
| Nincs hamisan PASS-nak jelölt ellenőrzés | ✅ | minden PASS mögött futtatott parancs és kimenet (QA_REPORT 2.); élő API/LLM, Maestro, CI, iOS: NOT RUN/BLOCKED indokkal |
| Alap üzleti folyamatok automatikusan teszteltek | ✅ | `e2e-business-flows.test.ts` (részvény, ETF, portfólió, hibautak) |
| Biztonsági kockázatok és kulcskezelés felülvizsgálva | ✅ | SECURITY.md; titokszkennelés (git-történet, fa, bundle) 0 találat; `npm audit` 0 high/critical |

## 2. Mi készült
- **Javítások:** a hoszt nem-JSON 429/408/504/5xx válasza a státusz szerint (D-090; korábban „szerződéssértés”); AI-végpont `Content-Length` méretkorlát a beolvasás előtt (D-091).
- **Új tesztek (+71):** E2E üzleti folyamatok (9), képlet-ellenőrzőlista (36 – eltérés nincs), kliens HTTP-réteg (24, 100% lefedettség), AI-handler (1), proxy-integráció (1 új eset, 1 szándékosan módosított).
- **CI:** `.github/workflows/ci.yml` (D-089).
- **Eszköz:** Android emulátoron fut (demó mód); 4 képernyő + tartós figyelőlista force-stop után igazolva.
- **Új csomag nincs.**

## 3. Módosított / új fájlok
- **Kód:** `src/infrastructure/api-client/proxy-http-client.ts`, `src/server/handlers/ai-handler.ts`.
- **Új tesztek:** `src/infrastructure/api-client/proxy-http-client.test.ts`, `src/__tests__/e2e-business-flows.test.ts`, `src/__tests__/formula-checklist.test.ts`.
- **Módosított tesztek:** `src/__tests__/ai-proxy-integration.test.ts` (+1), `src/__tests__/proxy-integration.test.ts` (502 → `HTTP_ERROR`, +200-as nem-JSON eset).
- **CI:** `.github/workflows/ci.yml`.
- **Docs:** új: `QA_REPORT.md`, `SECURITY.md`, ez a handoff, `phases/phase-15-integration-testing-security.md`; módosítva: `DECISIONS` (D-089…D-091), `KNOWN_ISSUES` (KI-132…KI-136), `ROADMAP`, `PROJECT_STATE`.

## 4. Parancsok és tényleges eredmények (2026-11-24, projekt gyökér)

| Parancs | Eredmény |
|---|---|
| `npm run check` (kiinduló) | exit 0, 1628/1628, 95 suite |
| `npm audit` / `--omit=dev --audit-level=high` | 22 moderate, 0 high/critical / exit 0 |
| Értékvak titokszkennelés (git-történet + fa) | 3 érték, 0 találat; csak tesztbeli hamis kulcsminták |
| `npm run check` (1. kör a javítások után) | exit 1 – 1 teszt a régi 502-es viselkedést rögzítette (D-090) → frissítve |
| `npm run check` (végső) | **exit 0, 1699/1699, 98 suite** |
| Tiszta worktree: `tsc`, `expo lint`, `prettier --check`, `jest --ci` | mind exit 0 (1628/1628 a `main` HEAD-en) |
| `CI=1 npx expo export -p android` + bundle-szkennelés | exit 0 (Hermes 4,7 MB); 3 titkos érték 0 találat; SDK/kulcsnevek/hostok nincsenek |
| Emulátor + `npx expo start --android --port 8093` (demó) | fut; Metro-napló 0 hiba; képernyőképek: Kezdőlap, részvény, ETF, Figyelő (force-stop után) |
| `tsc` a dev szerver leállítása után | exit 0 (router.d.ts ép) |

## 5. Ismert hibák / korlátok
Részletek: [../KNOWN_ISSUES.md](../KNOWN_ISSUES.md), „PHASE 15” szakasz.
- **KI-135 (K):** a proxy nyilvános, hitelesítés és IP-limit nélkül (SECURITY R-S1) – döntés a PHASE 16 telepítés előtt.
- **KI-132 (K):** eszközös kézi lista nyitott (űrlapok, repülőgép-mód élő módban, kis kijelző); Maestro BLOCKED.
- **KI-134 (A):** CI még nem futott GitHubon.
- **KI-133 (A):** 22 moderate audit-lelet az eszközláncban.
- **KI-136 (A):** `ANDROID_HOME` nincs beállítva a gépen.
- Változatlan, más fázis hatóköre: KI-74/KI-123, KI-101, KI-114, KI-125, KI-122, KI-112, KI-113.

## 6. Nyitott kérdések (a tulajdonos dönt)
- **Commit:** tulajdonosi kérésre commitolva a `phase-15` branchen (`7581ad6`); a push, a PR és a merge a tulajdonos döntése. Commit-üzenet:
  `feat: PHASE 15 – integráció, QA és biztonság (E2E üzleti folyamatok, képlet-ellenőrzőlista, hoszt-429/5xx helyes leképezése, AI-kérés méretkorlát, CI-workflow, QA_REPORT és SECURITY)`
- **Proxy-védelem (KI-135):** hosztszintű rate limit / WAF, vagy elfogadott kockázat saját használatra?
- **Maestro:** kell-e a PHASE 16 release-ellenőrzéséhez (telepítés + 3–4 flow)?
- Korábbiak változatlanok: LLM bekapcsolása (DP-04), értesítések (D-088), holdings-adat (KI-123), FMP ToS, DP-05.

## 7. Indulási útmutató a PHASE 16-hoz
1. **Olvasnivaló:** `docs/PROJECT_STATE.md`, ez a handoff, `QA_REPORT.md`, `SECURITY.md` (9. kockázatok), ROADMAP PHASE 16, D-004 (hosztolás), D-089.
2. **Ellenőrzés:** `git status`, `git branch --show-current`, `npm run check` → elvárt exit 0, **1699 teszt**.
3. **Kapcsolódási pontok:**
   - Push után a CI első futása → eredmény a QA_REPORT 7.-be (KI-134).
   - Proxy-telepítés (`eas deploy`): titkok EAS env „sensitive”-ként; a SECURITY.md 10. rutin futtatása a telepített verzióra; KI-135 döntés.
   - EAS Build (Android `preview` APK) után a 9.3 kézi lista a valódi telefonon (KI-132).
   - Az új élő hibautak (429/5xx a hosztról) már helyes üzenetet adnak – a release-dokumentációban a felhasználói hibaüzenetek ezekre hivatkozhatnak.
4. **Tilos (marad):** titok a kliensben vagy a CI-ban; hamis PASS; hiány 0-ként; automatikus LLM-hívás; `npm audit fix --force`.
