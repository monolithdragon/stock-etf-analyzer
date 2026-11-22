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
 *   node scripts/record-sec-fixtures.mjs                 – teljes újrarögzítés (FELÜLÍR!)
 *   node scripts/record-sec-fixtures.mjs --add-new-tags  – PHASE 06: csak a sec-tags.ts-be
 *     újonnan felvett tageket teszi a meglévő fixture-ökbe, az eredeti rögzítés napjáig beadott
 *     tényekkel; a régi tények (és így a golden tesztek) változatlanok maradnak.
 *
 * Előfeltétel: a `.env.local` fájlban legyen `SEC_USER_AGENT="AppNév kapcsolattartó@email"`.
 * A SEC ezt kötelezően kéri (Fair Access), különben HTTP 403-at ad. Az értéket a script
 * nem írja ki és nem menti a fixture-be.
 *
 * Udvariasság: a kérések között 250 ms szünet (a SEC limitje 10 kérés/mp).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
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

const ADD_NEW_TAGS = process.argv.includes('--add-new-tags');

function trimCompanyFacts(raw, url, { skip = new Set(), filedUntil = null } = {}) {
  const wanted = new Set(allSecTags().map((t) => `${t.taxonomy}:${t.tag}`));
  const facts = {};
  let kept = 0;
  for (const [taxonomy, tags] of Object.entries(raw.facts ?? {})) {
    for (const [tag, concept] of Object.entries(tags)) {
      const key = `${taxonomy}:${tag}`;
      if (!wanted.has(key) || skip.has(key)) continue;
      const units = {};
      for (const [unit, list] of Object.entries(concept.units ?? {})) {
        const recent = list
          .filter(
            (f) =>
              typeof f.filed === 'string' &&
              f.filed >= FILED_SINCE &&
              (filedUntil === null || f.filed <= filedUntil),
          )
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

/**
 * --add-new-tags: a meglévő fixture kiegészítése. A régi tények változatlanok; csak a fixture-ben
 * még nem szereplő tagek kerülnek be, és csak az eredeti rögzítés napjáig beadott tényekkel.
 */
async function addNewTags(ticker, url) {
  const file = join(OUT_DIR, `companyfacts-${ticker}.json`);
  if (!existsSync(file)) {
    console.warn(`  ${ticker}: nincs meglévő fixture – kihagyva (előbb teljes rögzítés kell).`);
    return;
  }
  const existing = JSON.parse(readFileSync(file, 'utf8'));
  const present = new Set();
  for (const [taxonomy, tags] of Object.entries(existing.facts ?? {})) {
    for (const tag of Object.keys(tags)) present.add(`${taxonomy}:${tag}`);
  }
  const filedUntil = existing._fixture.recordedAt.slice(0, 10);
  const { fixture, kept } = trimCompanyFacts(await getJson(url), url, {
    skip: present,
    filedUntil,
  });
  const added = [];
  for (const [taxonomy, tags] of Object.entries(fixture.facts)) {
    existing.facts[taxonomy] ??= {};
    Object.assign(existing.facts[taxonomy], tags);
    added.push(...Object.keys(tags));
  }
  if (added.length > 0) {
    existing._fixture.note = `${existing._fixture.note} Kiegészítve (${new Date().toISOString().slice(0, 10)}, filed <= ${filedUntil}): ${added.join(', ')}.`;
  }
  writeFileSync(file, `${JSON.stringify(existing)}\n`);
  console.log(`  ${ticker}: +${kept} tény (${added.length} új tag) → ${file}`);
}

mkdirSync(OUT_DIR, { recursive: true });

const tickersUrl = 'https://www.sec.gov/files/company_tickers.json';
const allTickers = await getJson(tickersUrl);
const rows = Object.values(allTickers);
console.log(`Ticker-lista: ${rows.length} sor.`);

// A ticker-fixture csak a kiválasztott cégek sorait tartalmazza (méret), az eredeti alakban.
if (!ADD_NEW_TAGS) {
  const subset = {};
  let index = 0;
  for (const row of rows) {
    if (TICKERS.includes(row.ticker)) subset[String(index++)] = row;
  }
  writeFileSync(
    join(OUT_DIR, 'company-tickers.json'),
    `${JSON.stringify({ _fixture: fixtureHeader(tickersUrl), ...subset }, null, 2)}\n`,
  );
}

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
    if (ADD_NEW_TAGS) {
      await addNewTags(ticker, url);
      continue;
    }
    const { fixture, kept } = trimCompanyFacts(await getJson(url), url);
    const file = join(OUT_DIR, `companyfacts-${ticker}.json`);
    writeFileSync(file, `${JSON.stringify(fixture)}\n`);
    console.log(`  ${ticker} (CIK ${cik}): ${kept} tény → ${file}`);
  } catch (error) {
    console.error(`  ${ticker}: ${error instanceof Error ? error.message : String(error)}`);
  }
}
console.log('Kész.');
