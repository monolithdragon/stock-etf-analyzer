/// <reference types="node" />
/**
 * Elfogadási feltételek (PHASE 10):
 * - a score-/döntési engine (`src/scoring`) tiszta: csak domain + calculations, nincs hálózat,
 *   óra, véletlen → determinisztikus;
 * - az AI nem hoz döntést: a scoring nem hivatkozik AI-gatewayre/magyarázó modulra;
 * - a UI nem pontoz és nem dönt: a képernyők csak a use case-ek kimenetét jelenítik meg.
 * Az ESLint is kikényszeríti (D-073); ez a teszt az `npm test` futásban is őrzi.
 */
import fs from 'node:fs';
import path from 'node:path';

const SRC = path.join(__dirname, '..');
const SCORING_DIR = path.join(SRC, 'scoring');
const ALLOWED_IMPORT = /^(\.{1,2}\/|@\/domain(\/|$)|@\/calculations(\/|$)|@\/scoring(\/|$))/;

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return /\.tsx?$/.test(entry.name) ? [full] : [];
  });
}

describe('src/scoring – tisztaság és AI-mentesség', () => {
  const files = sourceFiles(SCORING_DIR);

  it('vannak forrásfájlok', () => {
    expect(files.length).toBeGreaterThan(8);
  });

  it.each(files.map((file) => [path.relative(SCORING_DIR, file), file]))(
    '%s: csak domain/calculations import; nincs hálózat, óra, véletlen, AI',
    (_name, file) => {
      const source = fs.readFileSync(file, 'utf8');
      const specifiers = [...source.matchAll(/from\s+'([^']+)'/g)].map((match) => match[1] ?? '');
      expect(specifiers.filter((spec) => !ALLOWED_IMPORT.test(spec))).toEqual([]);
      if (!/\.test\.tsx?$/.test(file)) {
        expect(source).not.toMatch(/\bfetch\s*\(|XMLHttpRequest|WebSocket/);
        expect(source).not.toMatch(/\bDate\.now\s*\(|new Date\s*\(|Math\.random/);
        expect(source).not.toMatch(/AiGateway|@\/explanation|anthropic|openai/i);
      }
    },
  );
});

describe('UI (src/app, src/presentation) – nincs pontozás és döntés', () => {
  const SCORING_SYMBOLS =
    /\b(evaluateScoring|buildScoreCard|scoreCategory|scoreMetric|decide|assessConfidence|assessThesis|buildStockEvaluation|buildEtfEvaluation)\b/;
  const files = ['app', 'presentation']
    .flatMap((dir) => sourceFiles(path.join(SRC, dir)))
    .filter((file) => !/\.test\.tsx?$/.test(file));

  it.each(files.map((file) => [path.relative(SRC, file), file]))(
    '%s: nem hív score-/döntési motort',
    (_name, file) => {
      expect(fs.readFileSync(file, 'utf8')).not.toMatch(SCORING_SYMBOLS);
    },
  );
});
