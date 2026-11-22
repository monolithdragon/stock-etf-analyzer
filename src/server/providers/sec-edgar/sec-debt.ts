/**
 * `totalDebt` összerakása SEC-komponensekből (PHASE 06, D-059, DATA_DICTIONARY 4.4).
 *
 * Definíció: `totalDebt = hosszú lejáratú adósság (nem rövid rész) + rövid lejáratú adósság`,
 * operatív lízing NÉLKÜL. A rövid lejáratú rész:
 *   1. `DebtCurrent`, ha van (ez már tartalmazza a rövid hitelt ÉS a hosszú lejáratú adósság
 *      rövid részét – ezért mellé semmit nem adunk);
 *   2. különben `currentMaturities` + rövid hitel, ahol a rövid hitel a `ShortTermBorrowings`,
 *      vagy annak hiányában `CommercialPaper` + `OtherShortTermBorrowings` (a ténylegesen jelentett
 *      tagek összege).
 *
 * Hiány-szabályok (a hiányzó adat NEM nulla):
 * - nincs hosszú lejáratú (nem rövid) komponens → `MISSING` (nem rakjuk össze);
 * - a 2. ágban egy rövid lejáratú komponenscsoportnak nincs ténye erre a napra → a csoportot 0-nak
 *   vesszük, DE az eredmény `estimated` (nem `calculated`) és az `assumedZero` lista megnevezi.
 *   Indok: az XBRL-mérleg minden sorát tageli, így a tag hiánya általában azt jelenti, hogy nincs
 *   ilyen mérlegsor – de ez feltevés, ezért látható becslésként jelöljük `[FELTÉTELEZÉS]`.
 * - negatív komponens → `INVALID_INPUT`.
 */
import {
  metricInvalidInput,
  metricMissing,
  metricOk,
  type CurrencyCode,
  type DataProvenance,
  type FiscalPeriod,
  type IsoDate,
  type IsoTimestamp,
  type Metric,
} from '@/domain';

import type { SecDebtComponent } from './sec-tags';

/** Egy kiválasztott komponens-tény (a normalizáló már időszakra és pénznemre szűrte). */
export interface DebtComponentFact {
  readonly val: number;
  readonly filed: IsoDate;
  /** Pl. `us-gaap:LongTermDebtNoncurrent accn=… form=10-K filed=…`. */
  readonly reference: string;
  readonly tag: string;
}

export type DebtComponentPicks = Readonly<Record<SecDebtComponent, DebtComponentFact | null>>;

export interface ComposeTotalDebtContext {
  readonly sourceId: string;
  readonly sourceName: string;
  readonly fetchedAt: IsoTimestamp;
  readonly period: FiscalPeriod;
  readonly currency: CurrencyCode;
}

/** A lízinggel együtt jelentett tagek (megjegyzést kapnak). */
const INCLUDES_FINANCE_LEASES = new Set([
  'LongTermDebtAndCapitalLeaseObligations',
  'LongTermDebtAndCapitalLeaseObligationsCurrent',
]);

export function composeTotalDebt(
  picks: DebtComponentPicks,
  context: ComposeTotalDebtContext,
): Metric<number> {
  const noncurrent = picks.noncurrent;
  if (noncurrent === null) {
    return metricMissing(
      'Nincs hosszú lejáratú adósság-tény erre a napra (keresett: LongTermDebtNoncurrent, LongTermDebtAndCapitalLeaseObligations). Bankoknál, biztosítóknál és IFRS-filereknél az adósság nem rakható össze megbízhatóan (D-059).',
    );
  }

  const used: DebtComponentFact[] = [noncurrent];
  const assumedZero: string[] = [];
  if (picks.currentTotal !== null) {
    used.push(picks.currentTotal);
  } else {
    if (picks.currentMaturities !== null) used.push(picks.currentMaturities);
    else assumedZero.push('currentMaturities');

    if (picks.shortTermBorrowings !== null) {
      used.push(picks.shortTermBorrowings);
    } else {
      const parts = [picks.commercialPaper, picks.otherShortTermBorrowings].filter(
        (p): p is DebtComponentFact => p !== null,
      );
      if (parts.length > 0) used.push(...parts);
      else assumedZero.push('shortTermBorrowings');
    }
  }

  const negative = used.find((fact) => fact.val < 0);
  const filed = used.reduce<IsoDate>((max, f) => (f.filed > max ? f.filed : max), used[0]!.filed);
  const notes: string[] = [];
  if (used.some((fact) => INCLUDES_FINANCE_LEASES.has(fact.tag))) {
    notes.push('a cég a pénzügyi lízinggel együtt jelenti');
  }
  if (assumedZero.length > 0) {
    notes.push(`nincs tény → 0-nak véve (becslés): ${assumedZero.join(', ')}`);
  }
  const provenance: DataProvenance = {
    sourceId: context.sourceId,
    sourceName: context.sourceName,
    kind: assumedZero.length > 0 ? 'estimated' : 'calculated',
    fetchedAt: context.fetchedAt,
    asOf: filed,
    freshness: 'UNKNOWN',
    period: context.period,
    unit: 'money',
    currency: context.currency,
    reference: `totalDebt = ${used.map((f) => f.reference).join(' + ')}${
      notes.length > 0 ? ` [${notes.join('; ')}]` : ''
    }`,
    inputs: used.map((f) => f.tag),
  };
  if (negative !== undefined) {
    return metricInvalidInput(
      `Negatív adósság-komponens (${negative.tag} = ${negative.val}) – a forrásadat hibás.`,
      provenance,
    );
  }
  return metricOk(
    used.reduce((sum, f) => sum + f.val, 0),
    provenance,
  );
}
