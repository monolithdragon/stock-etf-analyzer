import { z } from 'zod';

import {
  BALANCE_SHEET_ITEMS,
  CASH_FLOW_ITEMS,
  INCOME_STATEMENT_ITEMS,
  STATEMENT_FREQUENCIES,
  createFinancialStatement,
  createFinancialStatementSet,
} from '@/domain';

import {
  cikSchema,
  currencyCodeSchema,
  dataProvenanceSchema,
  fiscalPeriodSchema,
  metricSchema,
  securityIdSchema,
  withDomain,
} from './shared';

const numberMetric = metricSchema(z.number());

/**
 * A szerződésben MINDEN sortétel kötelező kulcs (a hiányzó `MISSING` státusszal jön),
 * így a hálózaton sem tűnhet el egy tétel csendben (D-035). A zod 4 enum-kulcsú
 * `z.record` sémája kimerítő: minden kulcsnak szerepelnie kell.
 */
const statementBase = {
  securityId: securityIdSchema,
  period: fiscalPeriodSchema,
  currency: currencyCodeSchema,
  provenance: dataProvenanceSchema,
};

const statementStructureSchema = z.discriminatedUnion('statementType', [
  z.object({
    statementType: z.literal('income'),
    ...statementBase,
    lineItems: z.record(z.enum(INCOME_STATEMENT_ITEMS), numberMetric),
  }),
  z.object({
    statementType: z.literal('balance'),
    ...statementBase,
    lineItems: z.record(z.enum(BALANCE_SHEET_ITEMS), numberMetric),
  }),
  z.object({
    statementType: z.literal('cashflow'),
    ...statementBase,
    lineItems: z.record(z.enum(CASH_FLOW_ITEMS), numberMetric),
  }),
]);

export const financialStatementDtoSchema = withDomain(statementStructureSchema, (dto) =>
  createFinancialStatement(dto),
);

/** `GET /api/v1/stocks/{listingId}/financials?period=annual|quarterly` válaszának `data` része. */
export const financialStatementSetDtoSchema = withDomain(
  z.object({
    securityId: securityIdSchema,
    cik: cikSchema.nullable(),
    entityName: z.string().min(1).max(200),
    frequency: z.enum(STATEMENT_FREQUENCIES),
    statements: z.array(financialStatementDtoSchema).max(200),
    notes: z.array(z.string().max(500)).max(50),
    provenance: dataProvenanceSchema,
  }),
  createFinancialStatementSet,
);

export type FinancialStatementSetDto = z.input<typeof financialStatementSetDtoSchema>;
