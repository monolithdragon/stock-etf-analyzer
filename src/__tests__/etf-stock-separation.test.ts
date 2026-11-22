/// <reference types="node" />
/**
 * Elfogadási feltétel (PHASE 08): az ETF- és a részvényelemzési logika külön van választva.
 * - Az ETF-elemzés nem importál részvény-specifikus modult (`stock-analysis`, `valuation`,
 *   `analyze-stock-*`), és nem hív DCF-/P/E-függvényt.
 * - A részvényelemzés nem importálja az ETF-elemzést.
 * Közös csak a domain, a számítási motor és az `application/shared` segéd.
 */
import fs from 'node:fs';
import path from 'node:path';

const SRC = path.join(__dirname, '..');
const read = (file: string) => fs.readFileSync(file, 'utf8');

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [full] : [];
  });
}

const specifiers = (source: string) =>
  [...source.matchAll(/from\s+'([^']+)'/g)].map((match) => match[1] ?? '');

const ETF_FILES = [
  ...sourceFiles(path.join(SRC, 'application', 'etf-analysis')),
  path.join(SRC, 'application', 'use-cases', 'analyze-etf.ts'),
];
const STOCK_FILES = [
  ...sourceFiles(path.join(SRC, 'application', 'stock-analysis')),
  ...sourceFiles(path.join(SRC, 'application', 'valuation')),
  path.join(SRC, 'application', 'use-cases', 'analyze-stock-fundamentals.ts'),
  path.join(SRC, 'application', 'use-cases', 'analyze-stock-valuation.ts'),
];

const STOCK_IMPORT = /(stock-analysis|\/valuation\/|^\.\.\/valuation|analyze-stock-)/;
const STOCK_SYMBOLS =
  /\b(runDcf|runDcfScenarios|dcfSensitivityTable|priceToEarnings|forwardPriceToEarnings|buildStockValuation|computeValuation|buildQualityAnalysis)\b/;

describe('ETF-elemzés – nem függ a részvénylogikától', () => {
  it('vannak ETF-forrásfájlok', () => {
    expect(ETF_FILES.length).toBeGreaterThanOrEqual(8);
  });

  it.each(ETF_FILES.map((file) => [path.relative(SRC, file), file]))('%s', (_name, file) => {
    const source = read(file);
    expect(specifiers(source).filter((spec) => STOCK_IMPORT.test(spec))).toEqual([]);
    expect(source).not.toMatch(STOCK_SYMBOLS);
  });
});

describe('részvényelemzés – nem függ az ETF-elemzéstől', () => {
  it.each(STOCK_FILES.map((file) => [path.relative(SRC, file), file]))('%s', (_name, file) => {
    expect(specifiers(read(file)).filter((spec) => /etf-analysis|analyze-etf/.test(spec))).toEqual(
      [],
    );
  });
});
