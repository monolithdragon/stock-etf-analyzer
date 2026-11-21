import type { Brand } from './brand';
import { ok, type Result } from './result';
import { invalid } from './validation';

/** Naptári nap `YYYY-MM-DD` alakban (pl. tőzsdei kereskedési nap, D-018). */
export type IsoDate = Brand<string, 'IsoDate'>;

/** Időpont ISO 8601 UTC alakban, `Z` végződéssel (pl. `2026-11-21T15:04:05Z`). */
export type IsoTimestamp = Brand<string, 'IsoTimestamp'>;

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;
const MS_PER_DAY = 86_400_000;

export function parseIsoDate(input: string): Result<IsoDate> {
  const match = DATE_PATTERN.exec(input.trim());
  if (match === null) return invalid(`Érvénytelen dátum: "${input}". Formátum: ÉÉÉÉ-HH-NN.`);

  const [, y, m, d] = match;
  const year = Number(y);
  const month = Number(m);
  const day = Number(d);
  const date = new Date(Date.UTC(year, month - 1, day));
  // Valódi naptári nap? (pl. 2026-02-30 nem az)
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return invalid(`Nem létező naptári nap: "${input}".`);
  }
  return ok(input.trim() as IsoDate);
}

export function parseIsoTimestamp(input: string): Result<IsoTimestamp> {
  const trimmed = input.trim();
  if (!TIMESTAMP_PATTERN.test(trimmed) || Number.isNaN(Date.parse(trimmed))) {
    return invalid(
      `Érvénytelen időbélyeg: "${input}". Formátum: ISO 8601 UTC, pl. 2026-11-21T15:04:05Z.`,
    );
  }
  return ok(trimmed as IsoTimestamp);
}

/** `Date` → ISO 8601 UTC időbélyeg. */
export function toIsoTimestamp(date: Date): IsoTimestamp {
  return date.toISOString() as IsoTimestamp;
}

/**
 * `Date` → a készülék HELYI naptári napja (`YYYY-MM-DD`).
 * A felhasználó „ma” fogalma helyi idő szerinti (pl. tranzakció dátumánál),
 * nem UTC – különben éjfél körül egy napot csúszna.
 */
export function toLocalIsoDate(date: Date): IsoDate {
  const y = String(date.getFullYear()).padStart(4, '0');
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}` as IsoDate;
}

/** Ezredmásodperc (epoch) egy dátumhoz (UTC éjfél) vagy időbélyeghez. */
export function toEpochMs(value: IsoDate | IsoTimestamp): number {
  return value.length === 10 ? Date.parse(`${value}T00:00:00Z`) : Date.parse(value);
}

/** Napok száma két dátum között, MINDKÉT végpontot beleszámolva (2026-01-01..2026-01-01 = 1). */
export function inclusiveDaysBetween(start: IsoDate, end: IsoDate): number {
  return Math.round((toEpochMs(end) - toEpochMs(start)) / MS_PER_DAY) + 1;
}
