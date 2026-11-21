#!/usr/bin/env node
/**
 * SEC EDGAR teszt-fixture rögzítő (fejlesztői eszköz, NEM része az appnak).
 *
 * Mit csinál?
 *   1. Letölti a SEC ticker → CIK listát és a kiválasztott cégek companyfacts JSON-ját.
 *   2. Megvágja őket: csak a normalizáló által használt XBRL tagek (sec-tags.ts) és a
 *      FILED_SINCE utáni tények maradnak, így a fixture kicsi, de VALÓS adat.
 *   3. Kiírja: src/server/providers/sec-edgar/__fixtures__/
 *
 * Futtatás (a projekt gyökérmappájában, PowerShellben vagy Git Bash-ben):
 *   node scripts/record-sec-fixtures.mjs
 *
 * Előfeltétel: a `.env.local` fájlban legyen `SEC_USER_AGENT="AppNév kapcsolattartó@email"`.
 * A SEC ezt kötelezően kéri (Fair Access), különben HTTP 403-at ad. Az értéket a script
 * nem írja ki és nem menti a fixture-be.
 *
 * Udvariasság: a kérések között 250 ms szünet (a SEC limitje 10 kérés/mp).
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { allSecTags } from '../src/server/providers/sec-edgar/sec-tags.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = join(ROOT, 'src/server/providers/sec-edgar/__fixtures__');
const FILED_SINCE = '2021-01-01';
const DELAY_MS = 250;

/**
 * Szándékosan vegyes minta (R-05 heterogenitás):
 * eltérő üzleti év vége (AAPL szept., MSFT jún., NVDA/WMT jan.), bank (JPM: nincs COGS),
 * holding (BRK-B), két részvényosztály (GOOGL), energia (XOM), IFRS-es 20-F filer TWD-ben (TSM).
 */
const TICKERS = [
  'AAPL',
  'MSFT',
  'NVDA',
  'AMZN',
  'GOOGL',
  'JPM',
  'KO',
  'XOM',
  'JNJ',
  'WMT',
  'BRK-B',
  'TSM',
];

const envFile = join(ROOT, '.env.local');
if (existsSync(envFile)) process.loadEnvFile(envFile);
const userAgent = process.env.SEC_USER_AGENT?.trim();
if (!userAgent || !userAgent.includes('@')) {
  console.error(
    'Hiba: a SEC_USER_AGENT nincs beállítva a .env.local fájlban (kell benne e-mail-cím).',
  );
  process.exit(1);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function getJson(url) {
  const response = await fetch(url, {
    headers: { 'User-Agent': userAgent, Accept: 'application/json' },
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`${url} → HTTP ${response.status}`);
  return response.json();
}

function fixtureHeader(url) {
  return {
    source: 'SEC EDGAR',
    url,
    recordedAt: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
    note: `VALÓS, de megvágott SEC-adat: csak a sec-tags.ts tagjei, filed >= ${FILED_SINCE}. Teszt-fixture.`,
  };
}

function trimCompanyFacts(raw, url) {
  const wanted = new Set(allSecTags().map((t) => `${t.taxonomy}:${t.tag}`));
  const facts = {};
  let kept = 0;
  for (const [taxonomy, tags] of Object.entries(raw.facts ?? {})) {
    for (const [tag, concept] of Object.entries(tags)) {
      if (!wanted.has(`${taxonomy}:${tag}`)) continue;
      const units = {};
      for (const [unit, list] of Object.entries(concept.units ?? {})) {
        const recent = list
          .filter((f) => typeof f.filed === 'string' && f.filed >= FILED_SINCE)
          .map(({ start, end, val, accn, fy, fp, form, filed, frame }) =>
            Object.fromEntries(
              Object.entries({ start, end, val, accn, fy, fp, form, filed, frame }).filter(
                ([, v]) => v !== undefined,
              ),
            ),
          );
        if (recent.length > 0) {
          units[unit] = recent;
          kept += recent.length;
        }
      }
      if (Object.keys(units).length > 0) {
        facts[taxonomy] ??= {};
        facts[taxonomy][tag] = { label: concept.label ?? null, units };
      }
    }
  }
  return {
    fixture: { _fixture: fixtureHeader(url), cik: raw.cik, entityName: raw.entityName, facts },
    kept,
  };
}

mkdirSync(OUT_DIR, { recursive: true });

const tickersUrl = 'https://www.sec.gov/files/company_tickers.json';
const allTickers = await getJson(tickersUrl);
const rows = Object.values(allTickers);
console.log(`Ticker-lista: ${rows.length} sor.`);

// A ticker-fixture csak a kiválasztott cégek sorait tartalmazza (méret), az eredeti alakban.
const subset = {};
let index = 0;
for (const row of rows) {
  if (TICKERS.includes(row.ticker)) subset[String(index++)] = row;
}
writeFileSync(
  join(OUT_DIR, 'company-tickers.json'),
  `${JSON.stringify({ _fixture: fixtureHeader(tickersUrl), ...subset }, null, 2)}\n`,
);

for (const ticker of TICKERS) {
  const row = rows.find((r) => r.ticker === ticker);
  if (row === undefined) {
    console.warn(`  ${ticker}: nincs a SEC ticker-listában – kihagyva.`);
    continue;
  }
  const cik = String(row.cik_str).padStart(10, '0');
  const url = `https://data.sec.gov/api/xbrl/companyfacts/CIK${cik}.json`;
  await sleep(DELAY_MS);
  try {
    const { fixture, kept } = trimCompanyFacts(await getJson(url), url);
    const file = join(OUT_DIR, `companyfacts-${ticker}.json`);
    writeFileSync(file, `${JSON.stringify(fixture)}\n`);
    console.log(`  ${ticker} (CIK ${cik}): ${kept} tény → ${file}`);
  } catch (error) {
    console.error(`  ${ticker}: ${error instanceof Error ? error.message : String(error)}`);
  }
}
console.log('Kész.');
