/**
 * SEC EDGAR szolgáltatói DTO-sémák – csak a `sec-edgar` adapteren belül használhatók.
 *
 * Teljesítmény: egy companyfacts válasz több MB is lehet (több ezer tag). Ezért a burkot
 * lazán validáljuk, és CSAK a ténylegesen felhasznált tageket validáljuk szigorúan
 * (`secConceptSchema`), amikor a normalizáló hozzájuk nyúl.
 */
import { z } from 'zod';

/**
 * CIK: a SEC hol számként, hol szövegként adja. Valós lelet (2026-11-21): az XOM új CIK-jénél
 * (0002115436) a companyfacts `cik` mezője `"2115436"` (string), a többi cégnél szám.
 * Ezért mindkettőt elfogadjuk, de csak pozitív egész / csupa számjegy alakban.
 */
const secCikSchema = z.union([
  z.number().int().positive(),
  z
    .string()
    .regex(/^\d{1,10}$/)
    .transform(Number),
]);

/** `https://www.sec.gov/files/company_tickers.json` – `{ "0": { cik_str, ticker, title }, … }` */
export const secTickersSchema = z.record(
  z.string(),
  z.object({
    cik_str: secCikSchema,
    ticker: z.string().min(1).max(20),
    title: z.string().max(300),
  }),
);

export const secFactSchema = z.object({
  /** Csak időszaki (duration) tényeknél van. */
  start: z.string().optional(),
  end: z.string(),
  val: z.number(),
  accn: z.string().min(1).max(30),
  fy: z.number().int().nullish(),
  fp: z.string().max(4).nullish(),
  form: z.string().min(1).max(20),
  filed: z.string(),
  frame: z.string().max(20).optional(),
});
export type SecFactDto = z.output<typeof secFactSchema>;

export const secConceptSchema = z.object({
  label: z.string().max(500).nullish(),
  units: z.record(z.string().max(40), z.array(secFactSchema).max(20_000)),
});
export type SecConceptDto = z.output<typeof secConceptSchema>;

/** `https://data.sec.gov/api/xbrl/companyfacts/CIK##########.json` – laza burok. */
export const secCompanyFactsShellSchema = z.object({
  cik: secCikSchema,
  entityName: z.string().min(1).max(300),
  facts: z.record(z.string(), z.record(z.string(), z.unknown())),
});
export type SecCompanyFactsShell = z.output<typeof secCompanyFactsShellSchema>;
