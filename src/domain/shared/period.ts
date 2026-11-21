/**
 * Pénzügyi időszak (DATA_DICTIONARY 1. és 4.3, D-021).
 * Az időszakot a start/end dátumokból határozzuk meg, nem a filing `fy`/`fp` mezőjéből.
 */
import { inclusiveDaysBetween, parseIsoDate, type IsoDate } from './dates';
import { ok, type Result } from './result';
import { invalid, validateFields } from './validation';

export const FISCAL_PERIOD_TYPES = ['FY', 'Q1', 'Q2', 'Q3', 'Q4'] as const;
export type FiscalPeriodType = (typeof FISCAL_PERIOD_TYPES)[number];

export interface FiscalPeriod {
  /** A pénzügyi év záródátumának éve (eltérő üzleti év esetén ≠ naptári év). */
  readonly fiscalYear: number;
  readonly fiscalPeriod: FiscalPeriodType;
  readonly start: IsoDate;
  readonly end: IsoDate;
  /** Napok száma, mindkét végpontot beleszámolva. */
  readonly durationDays: number;
}

/**
 * Elfogadható időszakhosszak (napban, mindkét végponttal).
 * - Év: 350–380 (52/53 hetes üzleti év is belefér: 364/371 nap).
 * - Negyedév: 80–100. A DATA_DICTIONARY eredeti 85–95-ös sávja a 14 hetes (98 napos)
 *   negyedévet kizárta volna, ami 53 hetes üzleti évnél előfordul (D-037).
 */
export const PERIOD_DURATION_DAYS = {
  FY: { min: 350, max: 380 },
  QUARTER: { min: 80, max: 100 },
} as const;

export interface FiscalPeriodInput {
  readonly fiscalYear: number;
  readonly fiscalPeriod: FiscalPeriodType;
  readonly start: string;
  readonly end: string;
}

export function createFiscalPeriod(input: FiscalPeriodInput): Result<FiscalPeriod> {
  const fields = validateFields(
    {
      fiscalYear:
        Number.isInteger(input.fiscalYear) && input.fiscalYear >= 1900 && input.fiscalYear <= 2200
          ? ok(input.fiscalYear)
          : invalid('Egész évszám kell (1900–2200).'),
      start: parseIsoDate(input.start),
      end: parseIsoDate(input.end),
    },
    'Érvénytelen pénzügyi időszak.',
  );
  if (!fields.ok) return fields;
  const { fiscalYear, start, end } = fields.value;

  const durationDays = inclusiveDaysBetween(start, end);
  if (durationDays < 1) return invalid('A kezdődátum nem lehet a záródátum után.');

  const range =
    input.fiscalPeriod === 'FY' ? PERIOD_DURATION_DAYS.FY : PERIOD_DURATION_DAYS.QUARTER;
  if (durationDays < range.min || durationDays > range.max) {
    return invalid(
      `${input.fiscalPeriod} időszak hossza ${durationDays} nap; elfogadható: ${range.min}–${range.max} nap.`,
    );
  }

  return ok({ fiscalYear, fiscalPeriod: input.fiscalPeriod, start, end, durationDays });
}
