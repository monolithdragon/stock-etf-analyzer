# Stock & ETF Analyzer

Mobilalkalmazás (Android / iOS) részvények, ETF-ek és saját portfólió **átlátható, forrásolt, reprodukálható** elemzésére.
A számítás determinisztikus, az AI csak magyaráz. Saját használatra készül; **nem befektetési tanács**.

> **Állapot (2026-11-21): PHASE 02 – projektváz kész.**
> Az app elindul, van kezdőképernyő, navigáció és téma, de **még nincs benne pénzügyi adat vagy számítás**.
> A teljes ütemterv: [docs/ROADMAP.md](docs/ROADMAP.md). Részletes, lépésenkénti telepítési útmutató: [docs/phases/phase-02-project-setup.md](docs/phases/phase-02-project-setup.md).

## Technológia

| Elem | Verzió (a `package.json` szerint) |
|---|---|
| Expo SDK | 58 (`expo` ~58.0.26) |
| React Native | 0.88.1 |
| React | 19.3.0 |
| Expo Router | ~58.0.32 (fájlalapú navigáció, `src/app/`) |
| TypeScript | ~6.0.3, strict mód |
| Teszt | Jest 30 + jest-expo + React Native Testing Library 14 |
| Lint / formázás | ESLint 9 (eslint-config-expo) + Prettier 3 |
| Csomagkezelő | npm |

## Előfeltételek

| Eszköz | Követelmény | Ellenőrzés (terminálban) |
|---|---|---|
| Node.js | 22.13+ vagy 24.3+ vagy 26+ (páratlan főverzió, pl. 25 **nem** támogatott) | `node -v` |
| npm | a Node.js-sel együtt települ | `npm -v` |
| Git | bármely friss verzió | `git --version` |
| Android Studio | Android SDK + legalább egy emulátor (AVD) | Android Studio → Device Manager |

> **Terminál** = parancssori ablak. Windowson: VS Code-ban *Terminal → New Terminal*, vagy a Start menüből „PowerShell”.
> Minden parancsot a **projekt gyökérmappájában** futtass (ahol a `package.json` van): `c:\Users\lujzi\Documents\stock-etf-analyzer`.

## Telepítés (egyszer)

```powershell
cd c:\Users\lujzi\Documents\stock-etf-analyzer
npm install
```

Elvárt eredmény: `added … packages`, hibaüzenet (`ERR!`) nélkül. A „moderate severity vulnerabilities” figyelmeztetés ismert, lásd [docs/KNOWN_ISSUES.md](docs/KNOWN_ISSUES.md).

## Indítás Android emulátoron (ajánlott)

1. Indítsd el az emulátort: Android Studio → **Device Manager** → `Medium_Phone_API_37.0` → ▶ (Play).
   Várd meg, amíg megjelenik az Android kezdőképernyő.
2. A terminálban:
   ```powershell
   npm run android
   ```
3. Első alkalommal az Expo CLI letölti és feltelepíti az emulátorra az SDK 58-hoz illő **Expo Go** alkalmazást, majd megnyitja benne a projektet.
4. Elvárt eredmény: a terminálban `Android Bundled … ms`, az emulátoron a **Kezdőlap** képernyő „Stock & ETF Analyzer” címmel és egy kék „A projektről” gombbal.

Leállítás: a terminálban `Ctrl + C`.

Hasznos billentyűk a futó `npm start` / `npm run android` terminálban: `r` = újratöltés, `m` = fejlesztői menü, `a` = megnyitás Androidon.

## Indítás saját Android telefonon

1. Telepítsd a telefonra az **Expo Go** alkalmazást. **Fontos:** az Expo Go verziójának az SDK 58-at kell támogatnia. Az SDK 58 megjelenésekor (2026-10-15) a store-verzió még nem volt kint („a következő hetekben”). Ha a store-ban lévő Expo Go nem nyitja meg a projektet, lásd a [fázisútmutató](docs/phases/phase-02-project-setup.md) hibaelhárítását.
2. A gép és a telefon legyen **ugyanazon a Wi-Fi hálózaton**.
3. `npm start`, majd olvasd be a terminálban megjelenő QR-kódot az Expo Go-val.

## iOS

- **iOS szimulátorhoz macOS és Xcode kell** (Apple-korlát). Windows alatt nincs iOS szimulátor.
- Fizikai iPhone-on az Expo Go-val futtatható (`npm start` + QR-kód a Kamera appal), ha az App Store-os Expo Go már támogatja az SDK 58-at.
- Telepíthető iOS build Windows alól csak a felhőben (EAS Build) készíthető, ehhez **fizetős Apple Developer fiók** kell. Ez a PHASE 16 témája.

## Parancsok (npm scriptek)

| Parancs | Mit csinál |
|---|---|
| `npm start` | Fejlesztői szerver (Metro) indítása, QR-kóddal |
| `npm run android` | Indítás és megnyitás Android emulátoron/eszközön |
| `npm run ios` | Indítás iOS szimulátoron (csak macOS) |
| `npm run web` | Indítás böngészőben (jelenleg nem célplatform, nem tesztelt) |
| `npm run typecheck` | TypeScript típusellenőrzés (`tsc --noEmit`) |
| `npm run lint` | ESLint (0 figyelmeztetés megengedett) |
| `npm run lint:fix` | ESLint automatikus javítás |
| `npm run format` | Prettier formázás minden kódfájlon |
| `npm run format:check` | Csak ellenőrzi a formázást |
| `npm test` | Jest tesztek egyszeri futtatása |
| `npm run test:watch` | Tesztek figyelő módban |
| `npm run check` | typecheck + lint + format:check + test egyben |
| `npm run deps:check` | Expo függőség-kompatibilitás (`npx expo install --check`) |
| `npm run doctor` | Projekt-egészségügyi ellenőrzés (`npx expo-doctor@latest`) |

**Új csomag telepítése:** mindig `npx expo install <csomag>` (így az SDK 58-hoz illő verzió kerül be). Fejlesztői eszköznél: `npx expo install <csomag> -- --save-dev`, és utána ellenőrizd, hogy a `package.json` `devDependencies` részébe került-e.

## Környezeti változók és titkok

- Minta: [.env.example](.env.example). Másold le **`.env.local`** néven, és csak abba írj valódi értéket.
- A `.env.local` (és minden `.env*`, kivéve a `.env.example`) a `.gitignore` miatt **nem kerül gitbe**.
- Az `EXPO_PUBLIC_*` változók bekerülnek az appba, ezért **titkot soha nem tartalmazhatnak**.
- API-kulcsot **soha ne illessz be chatbe**, és ne commitold.
- **PHASE 04A-tól:** a SEC-adatokhoz a `.env.local`-ban kell: `SEC_USER_AGENT="AppNév kapcsolattartó@email"`. **PHASE 04B-től:** `FMP_API_KEY`, `EODHD_API_KEY` (titkos!), valamint `FMP_PLAN`, `EODHD_PLAN` (alapértelmezés: `free`).
- Env-változás után a futó dev szervert **újra kell indítani**.

## A proxy (saját szerver) lokálisan – PHASE 04

A proxy az Expo Router API route-jaiban fut (`src/app/api/v1/**/+api.ts`), ugyanazon a dev szerveren, mint az app:

```powershell
npm start
# másik terminálban:
curl.exe -s http://localhost:8081/api/v1/health
curl.exe -s http://localhost:8081/api/v1/providers/status   # csomag, kvóta, routing (kulcs nélkül)
curl.exe -s http://localhost:8081/api/v1/instruments/AAPL@XNAS/quote
```

- Végpontok és válaszok: [docs/DATA_DICTIONARY.md](docs/DATA_DICTIONARY.md) 11. fejezet.
- Az EODHD free napi **20 hívást** ad – az európai ár-lekérésekkel takarékosan (DATA_SOURCES 11.3).
- `PROXY_DATA_MODE=mock` mellett a proxy csak demóadatot ad (alapértelmezés: `live`).
- Az app élő módja: `EXPO_PUBLIC_DATA_MODE=live` és `EXPO_PUBLIC_API_BASE_URL=http://<géped-IP-je>:8081` (emulátorból a `localhost` nem a géped!).
- SEC teszt-fixture-ök újrarögzítése: `node scripts/record-sec-fixtures.mjs` (a `.env.local` `SEC_USER_AGENT`-jét használja).

Részletes, kezdőbarát leírás: [docs/phases/phase-04-data-sources-currency.md](docs/phases/phase-04-data-sources-currency.md).

## Mappaszerkezet (jelenlegi, PHASE 04A)

```
stock-etf-analyzer/
├─ CLAUDE.md                  állandó projektutasítások
├─ README.md                  ez a fájl
├─ app.json                   Expo konfiguráció (név, ikon, Router plugin)
├─ package.json               függőségek és npm scriptek
├─ tsconfig.json              TypeScript (strict, @/ alias → src/)
├─ eslint.config.js           ESLint + Prettier + rétegszabályok (ki mit importálhat)
├─ jest.config.js             tesztbeállítás
├─ .env.example               környezeti változók mintája (titok nélkül)
├─ assets/                    ikonok, splash kép
├─ docs/                      tervek, döntések, fázisútmutatók, handoffok
├─ scripts/                   fejlesztői eszközök (SEC fixture-rögzítő)
└─ src/
   ├─ app/                    Expo Router route-ok (képernyők) + api/ (proxy-végpontok, +api.ts)
   ├─ domain/                 üzleti fogalmak és szabályok (tiszta TypeScript)
   ├─ contracts/              a szerverrel közös adatszerződés (zod sémák)
   ├─ application/            use case-ek (műveletek) és portok (interfészek)
   ├─ infrastructure/         portok megvalósítása (proxy-kliens, demóadat, memória)
   ├─ server/                 CSAK SZERVER: szolgáltató-adapterek (SEC, ECB, OpenFIGI), handlerek
   ├─ config/                 env beolvasás + composition root (összekötés)
   ├─ presentation/           UI-komponensek, téma, szövegek, DI-hook
   └─ __tests__/              navigációs és kliens↔szerver integrációs tesztek
```

A teljes tervezett rétegszerkezet: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) 3. és 5. fejezet.

## Dokumentáció

- [docs/PROJECT_STATE.md](docs/PROJECT_STATE.md) – hol tart a projekt
- [docs/ROADMAP.md](docs/ROADMAP.md) – fázisok
- [docs/DECISIONS.md](docs/DECISIONS.md) – döntési napló
- [docs/KNOWN_ISSUES.md](docs/KNOWN_ISSUES.md) – ismert problémák, kockázatok
- [docs/phases/](docs/phases/) – kezdőbarát fázisútmutatók
- [docs/handoffs/](docs/handoffs/) – fázisátadások

## Jogi nyilatkozat

Elemzési eszköz, kizárólag saját használatra. A megjelenített jelzések (később pl. BUY/HOLD/SELL) elemzési kimenetek, nem személyre szabott pénzügyi tanácsok, és nem garantálnak hozamot.
