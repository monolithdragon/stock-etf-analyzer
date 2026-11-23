/**
 * PHASE 11 – az AI-kimenet TARTALMI ellenőrzése (D-077). A zod-séma csak az alakot nézi; ez a
 * modul azt, hogy a válasz a bemenetre épül-e. Bármely sértés → a TELJES válasz elutasítva
 * (`AI_INVALID_OUTPUT`): félig ellenőrzött, megbízhatónak látszó szöveg nem jelenik meg.
 *
 * Szabályok:
 *  1. `kind` egyezik a bemenetével.
 *  2. `basedOn`: csak a bemenetben létező `ref`; `support: 'data'` állításnál legalább egy
 *     olyan hivatkozás, amely mögött tényleges adat van (hiányzó mutató / `gap:` nem elég).
 *  3. Számok: a szövegben szereplő minden szám visszakereshető a bemenetből (nyers érték,
 *     százalékos alak, vagy a bemenet szövegeiben – pl. `display` – szereplő szám), a szövegben
 *     használt tizedesjegyre kerekítve. Kivétel: 0–10 közötti egész szám mértékegység nélkül
 *     (darabszám, „3 kockázat”, „5 éves”).
 *  4. Tiltott állítások: hozamgarancia, százalékos „esély”/valószínűség árfolyamra, felszólító
 *     vételi/eladási tanács, URL, titok-/kulcskérés, rendszer-utasítás; az ítéletet hordozó
 *     szakaszokban (összefoglaló, pozitív/negatív, adathiány, confidence) a döntéstől eltérő címke.
 *  5. `confidence.level` = a bemenet confidence-szintje (portfóliónál `NOT_APPLICABLE`).
 *  6. ETF-nél nincs DCF-állítás; ha a bemenetben adathiány van, a `dataGaps` nem lehet üres.
 */
import { citableRefs, type AiClaim, type AiExplanationContent, type AiInputDto } from './ai';

export interface AiGuardIssue {
  readonly path: string;
  readonly code:
    | 'KIND_MISMATCH'
    | 'UNKNOWN_REF'
    | 'NO_SUPPORTING_DATA'
    | 'UNGROUNDED_NUMBER'
    | 'FORBIDDEN_CLAIM'
    | 'CONFIDENCE_MISMATCH'
    | 'DCF_NOT_APPLICABLE'
    | 'DATA_GAPS_OMITTED';
  readonly message: string;
}

type ClaimSection = Exclude<keyof AiExplanationContent, 'schemaVersion' | 'kind' | 'confidence'>;
const LIST_SECTIONS: readonly Exclude<ClaimSection, 'summary'>[] = [
  'positives',
  'negatives',
  'keyRisks',
  'valuationExplanation',
  'dcfAssumptions',
  'dataGaps',
  'reviewTriggers',
  'thesisInvalidators',
];

/** Ítéletet hordozó szakaszok: itt más döntési címke nem szerepelhet. */
const VERDICT_SECTIONS: ReadonlySet<string> = new Set([
  'summary',
  'positives',
  'negatives',
  'dataGaps',
]);

/** Tiltott minták (kis-nagybetű független). A szöveg szándékosan rövid, a minta a lényeg. */
const FORBIDDEN_PATTERNS: readonly { readonly pattern: RegExp; readonly message: string }[] = [
  { pattern: /garant[áa]l|guarantee/i, message: 'hozam- vagy eredménygarancia' },
  { pattern: /kock[áa]zatmentes|risk[- ]free profit/i, message: 'kockázatmentesség állítása' },
  {
    pattern: /biztos(an|\s+)\s*(hozam|nyeres|emelked|n[őo]\b|profit)/i,
    message: 'biztos hozam/emelkedés állítása',
  },
  {
    pattern:
      /\d+(?:[.,]\d+)?\s*%[-\s]*(?:os|es|as|ös)?\s*(?:es[ée]ll?y|val[óo]sz[íi]n[űu]s[ée]g|probab)/i,
    message: 'százalékos esély / valószínűség (a confidence nem hozam-valószínűség)',
  },
  {
    pattern:
      /\b(?:vegy[ée]l|vedd meg|v[áa]s[áa]rold meg|v[áa]s[áa]rolja meg|add el|adja el|adj el)\b/i,
    message: 'felszólító vételi/eladási tanács (nem személyre szabott tanácsadás)',
  },
  { pattern: /https?:\/\/|www\./i, message: 'URL (a válasz nem hivatkozhat külső tartalomra)' },
  {
    pattern: /sk-ant-|api[-_ ]?(?:key|kulcs)|jelsz[óo]|password|token/i,
    message: 'titok / kulcs említése vagy kérése',
  },
  {
    pattern:
      /system prompt|rendszer[- ]?(?:prompt|utas[íi]t[áa]s)|ignore (?:all|previous)|hagyd figyelmen k[íi]v[üu]l/i,
    message: 'utasítás-szivárgás / prompt injection nyoma',
  },
];

// --- Számok visszakeresése -----------------------------------------------------------------

interface TextNumber {
  readonly value: number;
  readonly decimals: number;
  readonly raw: string;
  readonly hasUnit: boolean;
}

/**
 * Számok kinyerése magyar és angol írásmódból: „1 234,5”, „24,5%”, „0.15”, „-3”, „18,4x”.
 * Az ISO-dátumokat (2026-11-22) egészben kezeljük, hogy ne essenek szét kivonásra.
 */
const DATE_PATTERN = /\b\d{4}-\d{2}-\d{2}(?:T[\d:.]+Z?)?\b/g;
const NUMBER_PATTERN = /-?\d{1,3}(?:[   ]\d{3})+(?:[.,]\d+)?|-?\d+(?:[.,]\d+)?/g;
const UNIT_AFTER = /^\s*(?:%|x\b|×|szoros|USD|EUR|GBP|HUF|pont|pp|százalék)/i;

export function extractNumbers(text: string): { numbers: TextNumber[]; dates: string[] } {
  const dates = text.match(DATE_PATTERN) ?? [];
  const withoutDates = text.replace(DATE_PATTERN, ' ');
  const numbers: TextNumber[] = [];
  for (const match of withoutDates.matchAll(NUMBER_PATTERN)) {
    const raw = match[0];
    const normalized = raw.replace(/[   ]/g, '').replace(',', '.');
    const value = Number(normalized);
    if (!Number.isFinite(value)) continue;
    const decimals = normalized.includes('.') ? (normalized.split('.')[1]?.length ?? 0) : 0;
    const after = withoutDates.slice(
      (match.index ?? 0) + raw.length,
      (match.index ?? 0) + raw.length + 12,
    );
    numbers.push({ value, decimals, raw, hasUnit: UNIT_AFTER.test(after) });
  }
  return { numbers, dates };
}

interface GroundTruth {
  readonly values: readonly number[];
  readonly textNumbers: readonly number[];
  readonly text: string;
}

function collectGroundTruth(input: AiInputDto): GroundTruth {
  const values: number[] = [];
  const textNumbers: number[] = [];
  const strings: string[] = [];
  const walk = (node: unknown): void => {
    if (typeof node === 'number') {
      if (Number.isFinite(node)) values.push(node);
    } else if (typeof node === 'string') {
      strings.push(node);
      for (const n of extractNumbers(node).numbers) textNumbers.push(n.value);
    } else if (Array.isArray(node)) {
      // A listák elemszáma is levezethető tény („3 kockázat”, „12 adathiány”).
      values.push(node.length);
      for (const item of node) walk(item);
    } else if (node !== null && typeof node === 'object') {
      for (const item of Object.values(node)) walk(item);
    }
  };
  walk(input);
  return { values, textNumbers, text: strings.join('\n') };
}

function roundTo(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function isGrounded(n: TextNumber, truth: GroundTruth): boolean {
  if (!n.hasUnit && Number.isInteger(n.value) && Math.abs(n.value) <= 10) return true;
  const target = Math.abs(n.value);
  const tolerance = 0.5 * 10 ** -n.decimals + 1e-9;
  const matches = (candidate: number) =>
    Math.abs(roundTo(Math.abs(candidate), n.decimals) - target) < 1e-9 ||
    Math.abs(Math.abs(candidate) - target) <= tolerance;
  for (const v of truth.values) {
    if (matches(v) || matches(v * 100)) return true;
  }
  return truth.textNumbers.some((t) => Math.abs(Math.abs(t) - target) <= tolerance);
}

// --- Fő ellenőrzés -------------------------------------------------------------------------

export function validateAiExplanation(
  content: AiExplanationContent,
  input: AiInputDto,
): readonly AiGuardIssue[] {
  const issues: AiGuardIssue[] = [];
  const refs = citableRefs(input);
  const truth = collectGroundTruth(input);
  const otherLabels = input.evaluation?.decision.otherLabelTexts ?? [];

  if (content.kind !== input.kind) {
    issues.push({
      path: 'kind',
      code: 'KIND_MISMATCH',
      message: `A válasz „${content.kind}” elemzés, a bemenet „${input.kind}”.`,
    });
  }

  const checkText = (path: string, text: string, verdict: boolean) => {
    for (const { pattern, message } of FORBIDDEN_PATTERNS) {
      if (pattern.test(text)) issues.push({ path, code: 'FORBIDDEN_CLAIM', message });
    }
    // Más címke csak az ítéletet hordozó szakaszban tilos; a szabálynyom magyarázata (pl. „az
    // alapszabály Watch volt, a plafon Hold-ra csökkentette”) jogosan említi. Szabályazonosító
    // (`stock-watch`) nem címke: a címke előtt/után nem állhat betű, kötőjel vagy aláhúzás.
    for (const label of verdict ? otherLabels : []) {
      const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      if (new RegExp(`(^|[^\\p{L}_-])${escaped}($|[^\\p{L}_-])`, 'iu').test(text)) {
        issues.push({
          path,
          code: 'FORBIDDEN_CLAIM',
          message: `A döntéstől eltérő címke („${label}”) – az AI nem írhatja felül a döntési engine-t.`,
        });
      }
    }
    const { numbers, dates } = extractNumbers(text);
    for (const date of dates) {
      if (!truth.text.includes(date)) {
        issues.push({ path, code: 'UNGROUNDED_NUMBER', message: `Ismeretlen dátum: ${date}.` });
      }
    }
    for (const n of numbers) {
      if (!isGrounded(n, truth)) {
        issues.push({
          path,
          code: 'UNGROUNDED_NUMBER',
          message: `A(z) „${n.raw}” szám nem található a bemenetben.`,
        });
      }
    }
  };

  const checkClaim = (path: string, claim: AiClaim) => {
    const section = path.split('.')[0] ?? '';
    checkText(`${path}.text`, claim.text, VERDICT_SECTIONS.has(section));
    let supported = false;
    claim.basedOn.forEach((ref, i) => {
      const found = refs.get(ref);
      if (found === undefined) {
        issues.push({
          path: `${path}.basedOn.${i}`,
          code: 'UNKNOWN_REF',
          message: `Nem létező hivatkozás: „${ref}”.`,
        });
      } else if (found.hasData) {
        supported = true;
      }
    });
    if (claim.support === 'data' && !supported) {
      issues.push({
        path: `${path}.basedOn`,
        code: 'NO_SUPPORTING_DATA',
        message:
          'Tényállítás adat nélkül: legalább egy, tényleges adatot hordozó hivatkozás kell, különben „insufficient_data”.',
      });
    }
  };

  checkClaim('summary', content.summary);
  for (const section of LIST_SECTIONS) {
    content[section].forEach((claim, i) => checkClaim(`${section}.${i}`, claim));
  }
  checkText('confidence.explanation', content.confidence.explanation, true);

  const expectedLevel = input.evaluation?.confidence.level ?? 'NOT_APPLICABLE';
  if (content.confidence.level !== expectedLevel) {
    issues.push({
      path: 'confidence.level',
      code: 'CONFIDENCE_MISMATCH',
      message: `A confidence a bemenetből jön (${expectedLevel}); az AI nem módosíthatja.`,
    });
  }
  if (input.kind === 'etf' && content.dcfAssumptions.length > 0) {
    issues.push({
      path: 'dcfAssumptions',
      code: 'DCF_NOT_APPLICABLE',
      message: 'ETF-nél a DCF nem alkalmazható; a szakasz üres kell legyen.',
    });
  }
  if (input.dataGaps.length > 0 && content.dataGaps.length === 0) {
    issues.push({
      path: 'dataGaps',
      code: 'DATA_GAPS_OMITTED',
      message: 'A bemenetben adathiány van; a válasznak meg kell neveznie.',
    });
  }
  return issues;
}
