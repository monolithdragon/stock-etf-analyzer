/**
 * Pénzügyi kimutatások (DATA_DICTIONARY 4.) – diszkriminált unió a `statementType` szerint.
 *
 * Minden sortétel `Metric<number>`, és MINDEN kulcs kötelezően jelen van.
 * Amit a forrás nem adott meg, az a konstruktorban explicit `MISSING` státuszt kap –
 * így egy hiányzó tétel soha nem keverhető össze a jelentett 0-val.
 */
import {
  invalid,
  metricMissing,
  ok,
  type CurrencyCode,
  type DataProvenance,
  type FiscalPeriod,
  type Metric,
  type Result,
  type SecurityId,
} from '../shared';

export const INCOME_STATEMENT_ITEMS = [
  'revenue',
  'costOfRevenue',
  'grossProfit',
  'operatingIncome',
  'pretaxIncome',
  'incomeTaxExpense',
  'netIncome',
  'epsBasic',
  'epsDiluted',
  'weightedSharesDiluted',
  'depreciationAmortization',
  'interestExpense',
] as const;

/** Mérlegtételek – a `period.end` napra vonatkoznak („instant”). */
export const BALANCE_SHEET_ITEMS = [
  'cashAndEquivalents',
  'shortTermInvestments',
  'totalDebt',
  'totalAssets',
  'totalLiabilities',
  'shareholdersEquity',
  'sharesOutstanding',
] as const;

/** Kiáramlások (CapEx, osztalék, törlesztés) POZITÍV nagyságként tárolva (DATA_DICTIONARY 1.). */
export const CASH_FLOW_ITEMS = [
  'operatingCashFlow',
  'capitalExpenditure',
  'dividendsPaid',
  'debtRepayment',
] as const;

export type IncomeStatementItem = (typeof INCOME_STATEMENT_ITEMS)[number];
export type BalanceSheetItem = (typeof BALANCE_SHEET_ITEMS)[number];
export type CashFlowItem = (typeof CASH_FLOW_ITEMS)[number];

/** Nem pénzösszeg jellegű tételek: ezekre nem vonatkozik a pénznem-egyezés ellenőrzése. */
const NON_CURRENCY_ITEMS: ReadonlySet<string> = new Set([
  'weightedSharesDiluted',
  'sharesOutstanding',
]);

export type LineItems<K extends string> = { readonly [P in K]: Metric<number> };

interface StatementBase {
  readonly securityId: SecurityId;
  readonly period: FiscalPeriod;
  /** A kimutatás (beszámolási) pénzneme. */
  readonly currency: CurrencyCode;
  readonly provenance: DataProvenance;
}

export interface IncomeStatement extends StatementBase {
  readonly statementType: 'income';
  readonly lineItems: LineItems<IncomeStatementItem>;
}

export interface BalanceSheet extends StatementBase {
  readonly statementType: 'balance';
  readonly lineItems: LineItems<BalanceSheetItem>;
}

export interface CashFlowStatement extends StatementBase {
  readonly statementType: 'cashflow';
  readonly lineItems: LineItems<CashFlowItem>;
}

export type FinancialStatement = IncomeStatement | BalanceSheet | CashFlowStatement;
export type StatementType = FinancialStatement['statementType'];

const ITEMS_BY_TYPE = {
  income: INCOME_STATEMENT_ITEMS,
  balance: BALANCE_SHEET_ITEMS,
  cashflow: CASH_FLOW_ITEMS,
} as const;

type ItemOf<S extends StatementType> = (typeof ITEMS_BY_TYPE)[S][number];
type StatementOf<S extends StatementType> = Extract<FinancialStatement, { statementType: S }>;

export interface FinancialStatementInput<S extends StatementType> {
  readonly statementType: S;
  readonly securityId: SecurityId;
  readonly period: FiscalPeriod;
  readonly currency: CurrencyCode;
  readonly provenance: DataProvenance;
  /** Csak a forrás által ténylegesen megadott tételek; a többi `MISSING` lesz. */
  readonly lineItems: Partial<LineItems<ItemOf<S>>>;
}

export function createFinancialStatement<S extends StatementType>(
  input: FinancialStatementInput<S>,
): Result<StatementOf<S>> {
  const keys: readonly string[] = ITEMS_BY_TYPE[input.statementType];
  const provided: Partial<Record<string, Metric<number>>> = input.lineItems;

  const unknownKeys = Object.keys(provided).filter((key) => !keys.includes(key));
  if (unknownKeys.length > 0) {
    return invalid(
      `Ismeretlen tétel(ek) a(z) ${input.statementType} kimutatásban: ${unknownKeys.join(', ')}.`,
    );
  }

  const lineItems: Record<string, Metric<number>> = {};
  for (const key of keys) {
    const metric = provided[key];
    if (metric === undefined) {
      lineItems[key] = metricMissing(`A forrás (${input.provenance.sourceName}) nem adta meg.`);
      continue;
    }
    const itemCurrency = metric.status === 'OK' ? metric.provenance.currency : undefined;
    if (
      !NON_CURRENCY_ITEMS.has(key) &&
      itemCurrency !== undefined &&
      itemCurrency !== input.currency
    ) {
      return invalid(
        `A(z) ${key} pénzneme (${itemCurrency}) eltér a kimutatásétól (${input.currency}).`,
      );
    }
    lineItems[key] = metric;
  }

  // A fenti ciklus a típushoz tartozó összes kulcsot kitöltötte, ezért a szűkítés biztonságos.
  return ok({
    statementType: input.statementType,
    securityId: input.securityId,
    period: input.period,
    currency: input.currency,
    provenance: input.provenance,
    lineItems,
  } as StatementOf<S>);
}
