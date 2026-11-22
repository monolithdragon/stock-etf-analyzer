/**
 * Egy cég normalizált kimutatásai egy gyakoriságra (éves / negyedéves), EGY forrásból
 * (DATA_SOURCES 5.3/1: „egy adatsor = egy forrás”).
 */
import {
  invalid,
  ok,
  type Cik,
  type DataProvenance,
  type Result,
  type SecurityId,
} from '../shared';
import type { FinancialStatement } from './financial-statement';

export const STATEMENT_FREQUENCIES = ['annual', 'quarterly'] as const;
export type StatementFrequency = (typeof STATEMENT_FREQUENCIES)[number];

export interface FinancialStatementSet {
  readonly securityId: SecurityId;
  readonly cik: Cik | null;
  readonly entityName: string;
  readonly frequency: StatementFrequency;
  /** Időszak szerint csökkenő sorrendben (legfrissebb elöl). Üres lehet (pl. új filer). */
  readonly statements: readonly FinancialStatement[];
  /** Ember által olvasható megjegyzések a normalizálásról (pl. kihagyott időszak oka). */
  readonly notes: readonly string[];
  /** Az egész készlet forrása; az `asOf` a legutolsó felhasznált filing dátuma. */
  readonly provenance: DataProvenance;
}

export function createFinancialStatementSet(
  input: FinancialStatementSet,
): Result<FinancialStatementSet> {
  for (const statement of input.statements) {
    if (statement.securityId !== input.securityId) {
      return invalid(`Idegen kimutatás a készletben (${statement.securityId}).`);
    }
    if (statement.provenance.sourceId !== input.provenance.sourceId) {
      return invalid(
        `Egy készlet csak egy forrásból állhat (${input.provenance.sourceId} ≠ ${statement.provenance.sourceId}).`,
      );
    }
    const isAnnual = statement.period.fiscalPeriod === 'FY';
    if (isAnnual !== (input.frequency === 'annual')) {
      return invalid(
        `A(z) ${statement.period.fiscalPeriod} időszak nem illik a(z) ${input.frequency} készletbe.`,
      );
    }
  }
  return ok(input);
}
