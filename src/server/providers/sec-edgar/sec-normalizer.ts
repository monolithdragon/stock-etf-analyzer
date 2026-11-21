/**
 * SEC companyfacts → normalizált `FinancialStatementSet` (ARCHITECTURE 4.1 [3], D-021, R-05).
 *
 * Algoritmus (valós fixture-ökön kialakítva, lásd docs/DATA_DICTIONARY.md 4.4):
 * 1. Pénznem: a pénzösszeg-tények leggyakoribb egysége (pl. TSM: TWD, mert az USD csak
 *    kényelmi átszámítás). Eltérő pénznemű tény nem kerül a kimutatásba.
 * 2. Időszakok: a horgonytételek (árbevétel, nettó eredmény, működési CF) időszaki tényei,
 *    a `start`/`end` alapján; FY = 350–380, negyedév = 80–100 nap (D-037). A 10-Q-k 6/9 hónapos
 *    halmozott (YTD) tényei így kiesnek.
 * 3. Címke (fiscalYear, Q1…): annak a filingnek az `fy`/`fp` mezőjéből, amelynek ez a SAJÁT
 *    időszaka (a filing legkésőbbi záródátuma). Az összehasonlító adatok `fy`-ja félrevezető
 *    (pl. az AAPL 2023-as adata a 2026-os 10-K-ban `fy: 2026`), ezért azt nem használjuk.
 * 4. Érték: tételenként a tag-prioritási lista első olyan tagje, amelynek van pontosan erre az
 *    időszakra ténye; ezen belül a LEGKÉSŐBB beadott (restatement, DATA_DICTIONARY 4.3/3).
 *    Tagek értékei soha nem adódnak össze.
 * 5. Ami nincs: `MISSING` státusz indoklással – soha nem 0.
 */
import {
  PERIOD_DURATION_DAYS,
  createFinancialStatement,
  createFinancialStatementSet,
  createFiscalPeriod,
  err,
  inclusiveDaysBetween,
  metricInvalidInput,
  metricMissing,
  metricOk,
  ok,
  parseCurrencyCode,
  parseIsoDate,
  type BalanceSheetItem,
  type CashFlowItem,
  type Cik,
  type CurrencyCode,
  type DataProvenance,
  type FinancialStatement,
  type FinancialStatementSet,
  type FiscalPeriodType,
  type IncomeStatementItem,
  type IsoDate,
  type IsoTimestamp,
  type MeasurementUnit,
  type Metric,
  type Result,
  type SecurityId,
  type StatementFrequency,
} from '@/domain';

import { secConceptSchema, type SecCompanyFactsShell } from './sec-dto';
import {
  SEC_ANNUAL_FORMS,
  SEC_BALANCE_TAGS,
  SEC_CASH_FLOW_TAGS,
  SEC_INCOME_TAGS,
  SEC_QUARTERLY_FORMS,
  type SecLineItemMapping,
  type SecTagCandidate,
} from './sec-tags';
import { invalidUpstream } from '../../http/request-json';

export const SEC_SOURCE = {
  sourceId: 'sec-edgar',
  sourceName: 'SEC EDGAR (XBRL companyfacts)',
} as const;

/** Fordítási idejű ellenőrzés: a tag-táblák kulcsai a domain sortételei közül valók. */
type KeysWithin<T, K> = Exclude<keyof T, K> extends never ? true : false;
const TAG_TABLES_MATCH_DOMAIN: [
  KeysWithin<typeof SEC_INCOME_TAGS, IncomeStatementItem>,
  KeysWithin<typeof SEC_BALANCE_TAGS, BalanceSheetItem>,
  KeysWithin<typeof SEC_CASH_FLOW_TAGS, CashFlowItem>,
] = [true, true, true];
void TAG_TABLES_MATCH_DOMAIN;

/** Tételek, amelyeket a SEC-adapter szándékosan NEM állít elő – indoklással. */
const UNMAPPED_REASONS: Partial<Record<BalanceSheetItem, string>> = {
  totalDebt:
    'Összetett tétel (rövid + hosszú lejáratú adósság); a SEC-adapter szándékosan nem állítja elő, mert a komponensek összeadása dupla számoláshoz vezethet (R-05). Döntés: PHASE 05/06.',
};

/** Legfeljebb ennyi időszakot adunk vissza (legfrissebb elöl) – válaszméret-korlát. */
export const MAX_PERIODS: Readonly<Record<StatementFrequency, number>> = {
  annual: 15,
  quarterly: 20,
};

interface Fact {
  readonly start: IsoDate | null;
  readonly end: IsoDate;
  readonly val: number;
  readonly accn: string;
  readonly fy: number | null;
  readonly fp: string | null;
  readonly form: string;
  readonly filed: IsoDate;
  readonly unit: string;
  readonly tag: SecTagCandidate;
}

interface PickedFact {
  readonly fact: Fact;
}

const ALL_FORMS: ReadonlySet<string> = new Set([...SEC_ANNUAL_FORMS, ...SEC_QUARTERLY_FORMS]);
const ANNUAL_FORMS: ReadonlySet<string> = new Set(SEC_ANNUAL_FORMS);
const QUARTERLY_FORMS: ReadonlySet<string> = new Set(SEC_QUARTERLY_FORMS);
const CURRENCY_UNIT = /^[A-Z]{3}$/;

/** Egy tag tényeinek betöltése és szigorú validálása. Hibás egyedi tény → kihagyás (számolva). */
function loadTag(
  shell: SecCompanyFactsShell,
  tag: SecTagCandidate,
  stats: { skippedFacts: number },
): Result<Fact[]> {
  const raw = shell.facts[tag.taxonomy]?.[tag.tag];
  if (raw === undefined) return ok([]);
  const concept = secConceptSchema.safeParse(raw);
  if (!concept.success) {
    const issue = concept.error.issues[0];
    return err(
      invalidUpstream(SEC_SOURCE.sourceId, {
        path: ['facts', tag.taxonomy, tag.tag, ...(issue?.path ?? [])],
        message: issue?.message ?? 'érvénytelen',
      }),
    );
  }
  const facts: Fact[] = [];
  for (const [unit, list] of Object.entries(concept.data.units)) {
    for (const f of list) {
      const end = parseIsoDate(f.end);
      const filed = parseIsoDate(f.filed);
      const start = f.start === undefined ? null : parseIsoDate(f.start);
      if (!end.ok || !filed.ok || (start !== null && !start.ok) || !Number.isFinite(f.val)) {
        stats.skippedFacts += 1;
        continue;
      }
      facts.push({
        start: start === null ? null : start.value,
        end: end.value,
        val: f.val,
        accn: f.accn,
        fy: f.fy ?? null,
        fp: f.fp ?? null,
        form: f.form,
        filed: filed.value,
        unit,
        tag,
      });
    }
  }
  return ok(facts);
}

type LoadedMapping = {
  readonly mapping: SecLineItemMapping;
  readonly byCandidate: Fact[][];
  readonly cover: Fact[];
};

function loadMapping(
  shell: SecCompanyFactsShell,
  mapping: SecLineItemMapping,
  stats: { skippedFacts: number },
): Result<LoadedMapping> {
  const byCandidate: Fact[][] = [];
  for (const candidate of mapping.candidates) {
    const facts = loadTag(shell, candidate, stats);
    if (!facts.ok) return facts;
    byCandidate.push(facts.value);
  }
  let cover: Fact[] = [];
  if (mapping.coverFallback !== undefined) {
    const facts = loadTag(shell, mapping.coverFallback, stats);
    if (!facts.ok) return facts;
    cover = facts.value;
  }
  return ok({ mapping, byCandidate, cover });
}

function expectedUnit(mapping: SecLineItemMapping, currency: CurrencyCode): string {
  switch (mapping.unit) {
    case 'currency':
      return currency;
    case 'currency_per_share':
      return `${currency}/shares`;
    case 'shares':
      return 'shares';
  }
}

function measurementUnit(mapping: SecLineItemMapping): MeasurementUnit {
  switch (mapping.unit) {
    case 'currency':
      return 'money';
    case 'currency_per_share':
      return 'money_per_share';
    case 'shares':
      return 'shares';
  }
}

/** Restatement: a legkésőbb beadott tény; egyezésnél a nagyobb accession szám (determinisztikus). */
function latestFiled(facts: readonly Fact[]): Fact | undefined {
  let best: Fact | undefined;
  for (const f of facts) {
    if (
      best === undefined ||
      f.filed > best.filed ||
      (f.filed === best.filed && f.accn > best.accn)
    ) {
      best = f;
    }
  }
  return best;
}

function pickForPeriod(
  loaded: LoadedMapping,
  period: { readonly start: IsoDate; readonly end: IsoDate },
  currency: CurrencyCode,
): PickedFact | null {
  const unit = expectedUnit(loaded.mapping, currency);
  for (const facts of loaded.byCandidate) {
    const matching = facts.filter(
      (f) =>
        f.unit === unit &&
        ALL_FORMS.has(f.form) &&
        f.end === period.end &&
        (loaded.mapping.shape === 'duration' ? f.start === period.start : f.start === null),
    );
    const best = latestFiled(matching);
    if (best !== undefined) return { fact: best };
  }
  return null;
}

function dominantCurrency(loaded: readonly LoadedMapping[]): CurrencyCode | null {
  const counts = new Map<string, number>();
  for (const { mapping, byCandidate } of loaded) {
    if (mapping.unit !== 'currency') continue;
    for (const facts of byCandidate) {
      for (const f of facts) {
        if (CURRENCY_UNIT.test(f.unit)) counts.set(f.unit, (counts.get(f.unit) ?? 0) + 1);
      }
    }
  }
  // Leggyakoribb; egyezésnél ábécérend (determinisztikus).
  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const top = sorted[0];
  if (top === undefined) return null;
  const parsed = parseCurrencyCode(top[0]);
  return parsed.ok ? parsed.value : null;
}

/** Az 1–7. januári év vége (52/53 hetes év) az előző üzleti évhez tartozik. `[FELTÉTELEZÉS]` */
function fiscalYearFromEnd(end: IsoDate): number {
  const year = Number(end.slice(0, 4));
  return end.slice(5, 7) === '01' && Number(end.slice(8, 10)) <= 7 ? year - 1 : year;
}

interface CandidatePeriod {
  readonly start: IsoDate;
  readonly end: IsoDate;
}

function discoverPeriods(
  anchors: readonly LoadedMapping[],
  frequency: StatementFrequency,
): CandidatePeriod[] {
  const forms = frequency === 'annual' ? ANNUAL_FORMS : QUARTERLY_FORMS;
  const range = frequency === 'annual' ? PERIOD_DURATION_DAYS.FY : PERIOD_DURATION_DAYS.QUARTER;
  const periods = new Map<string, CandidatePeriod>();
  for (const { byCandidate } of anchors) {
    for (const facts of byCandidate) {
      for (const f of facts) {
        if (f.start === null || !forms.has(f.form)) continue;
        const days = inclusiveDaysBetween(f.start, f.end);
        if (days < range.min || days > range.max) continue;
        periods.set(`${f.start}/${f.end}`, { start: f.start, end: f.end });
      }
    }
  }
  return [...periods.values()].sort((a, b) => (a.end < b.end ? 1 : a.end > b.end ? -1 : 0));
}

/** Filingenként a legkésőbbi záródátum = a filing „saját” időszakának vége. */
function ownPeriodEnds(loaded: readonly LoadedMapping[]): Map<string, IsoDate> {
  const ends = new Map<string, IsoDate>();
  for (const { byCandidate } of loaded) {
    for (const facts of byCandidate) {
      for (const f of facts) {
        const current = ends.get(f.accn);
        if (current === undefined || f.end > current) ends.set(f.accn, f.end);
      }
    }
  }
  return ends;
}

function labelPeriod(
  period: CandidatePeriod,
  frequency: StatementFrequency,
  allLoaded: readonly LoadedMapping[],
  ownEnds: ReadonlyMap<string, IsoDate>,
): { fiscalYear: number; fiscalPeriod: FiscalPeriodType; fromOwnFiling: boolean } | null {
  for (const { byCandidate } of allLoaded) {
    for (const facts of byCandidate) {
      const own = facts.find(
        (f) =>
          f.start === period.start &&
          f.end === period.end &&
          ownEnds.get(f.accn) === period.end &&
          f.fy !== null &&
          f.fp !== null,
      );
      if (own === undefined || own.fy === null) continue;
      if (frequency === 'annual' && own.fp === 'FY') {
        return { fiscalYear: own.fy, fiscalPeriod: 'FY', fromOwnFiling: true };
      }
      if (
        frequency === 'quarterly' &&
        (own.fp === 'Q1' || own.fp === 'Q2' || own.fp === 'Q3' || own.fp === 'Q4')
      ) {
        return { fiscalYear: own.fy, fiscalPeriod: own.fp, fromOwnFiling: true };
      }
    }
  }
  // Nincs saját filing (pl. csak összehasonlító adatként szerepel): évnél a dátumból címkézünk,
  // negyedévnél nem (a sorszám nem határozható meg biztosan).
  return frequency === 'annual'
    ? { fiscalYear: fiscalYearFromEnd(period.end), fiscalPeriod: 'FY', fromOwnFiling: false }
    : null;
}

export interface SecNormalizeOptions {
  readonly frequency: StatementFrequency;
  readonly securityId: SecurityId;
  readonly cik: Cik;
  readonly fetchedAt: IsoTimestamp;
  readonly sourceUrl: string;
}

type StatementKind = 'income' | 'balance' | 'cashflow';

export function normalizeSecCompanyFacts(
  shell: SecCompanyFactsShell,
  options: SecNormalizeOptions,
): Result<FinancialStatementSet> {
  const stats = { skippedFacts: 0 };
  const notes: string[] = [];

  const tables: Record<StatementKind, Readonly<Record<string, SecLineItemMapping>>> = {
    income: SEC_INCOME_TAGS,
    balance: SEC_BALANCE_TAGS,
    cashflow: SEC_CASH_FLOW_TAGS,
  };
  const loaded: Record<StatementKind, Map<string, LoadedMapping>> = {
    income: new Map(),
    balance: new Map(),
    cashflow: new Map(),
  };
  for (const kind of ['income', 'balance', 'cashflow'] as const) {
    for (const [item, mapping] of Object.entries(tables[kind])) {
      const result = loadMapping(shell, mapping, stats);
      if (!result.ok) return result;
      loaded[kind].set(item, result.value);
    }
  }
  const everything = [
    ...loaded.income.values(),
    ...loaded.balance.values(),
    ...loaded.cashflow.values(),
  ];

  const baseProvenance = {
    ...SEC_SOURCE,
    kind: 'reported' as const,
    fetchedAt: options.fetchedAt,
    freshness: 'UNKNOWN' as const,
  };

  const currency = dominantCurrency(everything);
  const anchors = [
    loaded.income.get('revenue'),
    loaded.income.get('netIncome'),
    loaded.cashflow.get('operatingCashFlow'),
  ].filter((m): m is LoadedMapping => m !== undefined);
  const discovered = currency === null ? [] : discoverPeriods(anchors, options.frequency);
  if (currency === null)
    notes.push('A companyfacts nem tartalmaz pénzösszeg-tényt a használt tagekből.');

  const ownEnds = ownPeriodEnds(everything);
  const statements: FinancialStatement[] = [];
  let latestFiledOverall: IsoDate | null = null;
  let unlabeled = 0;
  let periodsUsed = 0;
  const empty: string[] = [];

  for (const candidate of discovered) {
    if (periodsUsed >= MAX_PERIODS[options.frequency]) {
      notes.push(
        `Csak a legutóbbi ${MAX_PERIODS[options.frequency]} időszak szerepel (méretkorlát).`,
      );
      break;
    }
    const label = labelPeriod(candidate, options.frequency, everything, ownEnds);
    if (label === null) {
      unlabeled += 1;
      continue;
    }
    const period = createFiscalPeriod({ ...label, start: candidate.start, end: candidate.end });
    if (!period.ok || currency === null) {
      unlabeled += 1;
      continue;
    }
    periodsUsed += 1;
    if (!label.fromOwnFiling) {
      notes.push(
        `${candidate.start}…${candidate.end}: a pénzügyi év a záródátumból származik (nincs saját filing a megvágott adatban).`,
      );
    }

    // A címlap-fallback (dei részvényszám) CSAK az időszak saját filingjéből jöhet. Egy későbbi
    // filing összehasonlító adatai mellett álló címlap már egy későbbi napra vonatkozna
    // (valós lelet: JNJ FY2025 mérleg + 2026. októberi 10-Q címlap).
    const ownAccnsOfPeriod = new Set(
      [...ownEnds.entries()].filter(([, end]) => end === candidate.end).map(([accn]) => accn),
    );
    for (const kind of ['income', 'cashflow', 'balance'] as const) {
      const lineItems: Record<string, Metric<number>> = {};
      let okCount = 0;
      let statementFiled: IsoDate | null = null;

      for (const [item, entry] of loaded[kind]) {
        const picked = pickForPeriod(entry, candidate, currency);
        const fallback =
          picked === null && entry.cover.length > 0
            ? latestFiled(
                entry.cover.filter((f) => ownAccnsOfPeriod.has(f.accn) && f.unit === 'shares'),
              )
            : undefined;
        const fact = picked?.fact ?? fallback;
        if (fact === undefined) {
          const tags = entry.mapping.candidates.map((c) => c.tag).join(', ');
          lineItems[item] = metricMissing(
            `Nincs SEC-tény erre az időszakra (keresett tagek: ${tags}).`,
          );
          continue;
        }
        const provenance: DataProvenance = {
          ...baseProvenance,
          // A címlap (dei) adat a címlap dátumára vonatkozik, nem az időszak végére (R-16).
          asOf: fallback !== undefined ? fact.end : fact.filed,
          period: period.value,
          unit: measurementUnit(entry.mapping),
          ...(entry.mapping.unit === 'shares' ? {} : { currency }),
          reference: `${fact.tag.taxonomy}:${fact.tag.tag} accn=${fact.accn} form=${fact.form} filed=${fact.filed}${
            fallback !== undefined ? ` (címlap, ${fact.end})` : ''
          }`,
        };
        if (entry.mapping.outflow === true && fact.val < 0) {
          lineItems[item] = metricInvalidInput(
            `Kiáramlásként pozitív nagyság várt, a forrás negatívat adott (${fact.val}).`,
            provenance,
          );
          continue;
        }
        const metric = metricOk(fact.val, provenance);
        lineItems[item] = metric;
        if (metric.status === 'OK') okCount += 1;
        if (statementFiled === null || fact.filed > statementFiled) statementFiled = fact.filed;
      }

      for (const [item, reason] of Object.entries(UNMAPPED_REASONS)) {
        if (kind === 'balance') lineItems[item] = metricMissing(reason);
      }

      if (okCount === 0) {
        empty.push(`${label.fiscalYear} ${label.fiscalPeriod} ${kind}`);
        continue;
      }
      if (
        latestFiledOverall === null ||
        (statementFiled !== null && statementFiled > latestFiledOverall)
      ) {
        latestFiledOverall = statementFiled;
      }
      const statement = createFinancialStatement({
        statementType: kind,
        securityId: options.securityId,
        period: period.value,
        currency,
        provenance: {
          ...baseProvenance,
          asOf: statementFiled,
          period: period.value,
          currency,
          reference: options.sourceUrl,
        },
        lineItems,
      });
      if (!statement.ok) return statement;
      statements.push(statement.value);
    }
  }

  if (unlabeled > 0) {
    notes.push(`${unlabeled} időszak kimaradt: a pénzügyi címke nem határozható meg biztosan.`);
  }
  if (empty.length > 0) {
    notes.push(
      `Tény nélküli kimutatás kimaradt: ${empty.slice(0, 10).join('; ')}${empty.length > 10 ? '…' : ''}.`,
    );
  }
  if (stats.skippedFacts > 0)
    notes.push(`${stats.skippedFacts} hibás formátumú SEC-tény kihagyva.`);
  if (statements.length === 0 && currency !== null) {
    notes.push(
      options.frequency === 'quarterly'
        ? 'Nincs negyedéves adat: külföldi filer (20-F/40-F) nem ad 10-Q-t, vagy a cég még nem jelentett.'
        : 'Nincs éves (10-K/20-F/40-F) adat ehhez a CIK-hez – pl. új jogalany, amely még nem adott be éves jelentést.',
    );
  }
  if (options.frequency === 'quarterly') {
    notes.push(
      'Negyedéves CF: a 10-Q halmozott (YTD) adatot ad, ezért a Q2/Q3 cash flow tételek jellemzően MISSING; a különbségképzés (calculated) a PHASE 06 feladata. A Q4 nem jelentett (D-021).',
    );
  }

  return createFinancialStatementSet({
    securityId: options.securityId,
    cik: options.cik,
    entityName: shell.entityName,
    frequency: options.frequency,
    statements,
    notes,
    provenance: {
      ...baseProvenance,
      asOf: latestFiledOverall,
      currency: currency ?? undefined,
      reference: options.sourceUrl,
    },
  });
}
