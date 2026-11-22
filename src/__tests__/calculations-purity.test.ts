/// <reference types="node" />
/**
 * Elfogadási feltétel (PHASE 05): a számítási modul (`src/calculations`) nem függ React
 * Native-től, UI-tól, hálózattól, órától vagy véletlentől. Az ESLint is kikényszeríti
 * (D-055); ez a teszt a `npm test` futásban is őrzi.
 * A Node-típusokat a Jest függőségeként telepített `@types/node` adja; csak ez a teszt használja.
 */
import fs from 'node:fs';
import path from 'node:path';

const CALCULATIONS_DIR = path.join(__dirname, '..', 'calculations');
const ALLOWED_IMPORT = /^(\.{1,2}\/|@\/domain(\/|$)|@\/calculations(\/|$))/;

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return /\.tsx?$/.test(entry.name) ? [full] : [];
  });
}

describe('src/calculations – tisztaság', () => {
  const files = sourceFiles(CALCULATIONS_DIR);

  it('vannak forrásfájlok', () => {
    expect(files.length).toBeGreaterThan(10);
  });

  it.each(files.map((file) => [path.relative(CALCULATIONS_DIR, file), file]))(
    '%s: csak relatív, @/domain vagy @/calculations import; nincs hálózat, óra, véletlen',
    (_name, file) => {
      const source = fs.readFileSync(file, 'utf8');
      const specifiers = [...source.matchAll(/from\s+'([^']+)'/g)].map((match) => match[1] ?? '');
      expect(specifiers.filter((spec) => !ALLOWED_IMPORT.test(spec))).toEqual([]);
      if (!/\.test\.tsx?$/.test(file)) {
        expect(source).not.toMatch(/\bfetch\s*\(|XMLHttpRequest|WebSocket/);
        expect(source).not.toMatch(/\bDate\.now\s*\(|new Date\s*\(|Math\.random/);
      }
    },
  );
});
