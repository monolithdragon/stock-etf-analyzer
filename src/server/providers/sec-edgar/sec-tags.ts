/**
 * SEC XBRL tag → normalizált sortétel leképezés (DATA_DICTIONARY 4.1–4.2, R-05).
 *
 * Szabályok:
 * - A lista sorrendje = prioritás. Egy időszakra az ELSŐ olyan tag értéke számít, amelyiknek
 *   van pontosan arra az időszakra szóló ténye. Tagek értékeit SOHA nem adjuk össze és nem keverjük.
 * - A provenance `reference` mezője mindig a ténylegesen használt taget és az accession számot mutatja.
 * - Ami itt nem szerepel (pl. `totalDebt`), az a normalizálás után `MISSING` – szándékosan:
 *   összetett tételnél a komponensek összeadása dupla számoláshoz vezethet (PHASE 05/06 dönt).
 *
 * FONTOS: ez a fájl szándékosan függőség nélküli (csak törölhető TS-szintaxis), mert a
 * `scripts/record-sec-fixtures.mjs` közvetlenül, Node-dal importálja a fixture-ök megvágásához.
 */

export type SecTaxonomy = 'us-gaap' | 'ifrs-full' | 'dei';

/** Hogyan illeszkedik egy tény az időszakhoz. */
export type SecFactShape =
  /** Időszaki tény (`start` + `end`), pl. árbevétel. */
  | 'duration'
  /** Időpontra szóló tény az időszak végén (`end` = időszak vége), pl. mérlegtétel. */
  | 'instant'
  /** Címlapadat (dei) ugyanabból a filingből; az `end` a címlap dátuma, NEM az időszak vége. */
  | 'cover';

/** Az XBRL egység, amelyben az értéket várjuk. `currency` = bármely ISO 4217 kód (USD, TWD…). */
export type SecUnitKind = 'currency' | 'currency_per_share' | 'shares';

export interface SecTagCandidate {
  readonly taxonomy: SecTaxonomy;
  readonly tag: string;
}

export interface SecLineItemMapping {
  readonly shape: SecFactShape;
  readonly unit: SecUnitKind;
  /** Kiáramlás, amelyet pozitív nagyságként tárolunk (DATA_DICTIONARY 1.). */
  readonly outflow?: boolean;
  /** Fallback lánc: elöl a fő tag, utána a régebbi vagy IFRS megfelelők. */
  readonly candidates: readonly SecTagCandidate[];
  /** Csak kiegészítő, alacsonyabb prioritású forrás (pl. címlap), külön alakkal. */
  readonly coverFallback?: SecTagCandidate;
}

const g = (tag: string): SecTagCandidate => ({ taxonomy: 'us-gaap', tag });
const ifrs = (tag: string): SecTagCandidate => ({ taxonomy: 'ifrs-full', tag });

export const SEC_INCOME_TAGS = {
  revenue: {
    shape: 'duration',
    unit: 'currency',
    // A `Revenues` az ELSŐ: valós fixture-ön (BRK-B, WMT) a RevenueFromContract… csak részösszeg
    // (pl. biztosítási díjak / tagdíjak nélkül), a `Revenues` a teljes árbevétel.
    candidates: [
      g('Revenues'),
      g('RevenueFromContractWithCustomerExcludingAssessedTax'),
      g('SalesRevenueNet'),
      g('RevenueFromContractWithCustomerIncludingAssessedTax'),
      ifrs('Revenue'),
    ],
  },
  costOfRevenue: {
    shape: 'duration',
    unit: 'currency',
    candidates: [g('CostOfRevenue'), g('CostOfGoodsAndServicesSold'), ifrs('CostOfSales')],
  },
  grossProfit: {
    shape: 'duration',
    unit: 'currency',
    candidates: [g('GrossProfit'), ifrs('GrossProfit')],
  },
  operatingIncome: {
    shape: 'duration',
    unit: 'currency',
    candidates: [g('OperatingIncomeLoss'), ifrs('ProfitLossFromOperatingActivities')],
  },
  pretaxIncome: {
    shape: 'duration',
    unit: 'currency',
    candidates: [
      g(
        'IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest',
      ),
      g(
        'IncomeLossFromContinuingOperationsBeforeIncomeTaxesMinorityInterestAndIncomeLossFromEquityMethodInvestments',
      ),
      // A `…BeforeIncomeTaxesDomestic` szándékosan NINCS itt: csak a belföldi rész, nem a teljes.
      ifrs('ProfitLossBeforeTax'),
    ],
  },
  incomeTaxExpense: {
    shape: 'duration',
    unit: 'currency',
    candidates: [g('IncomeTaxExpenseBenefit'), ifrs('IncomeTaxExpenseContinuingOperations')],
  },
  netIncome: {
    shape: 'duration',
    unit: 'currency',
    candidates: [g('NetIncomeLoss'), ifrs('ProfitLossAttributableToOwnersOfParent')],
  },
  epsBasic: {
    shape: 'duration',
    unit: 'currency_per_share',
    candidates: [g('EarningsPerShareBasic'), ifrs('BasicEarningsLossPerShare')],
  },
  epsDiluted: {
    shape: 'duration',
    unit: 'currency_per_share',
    candidates: [g('EarningsPerShareDiluted'), ifrs('DilutedEarningsLossPerShare')],
  },
  weightedSharesDiluted: {
    shape: 'duration',
    unit: 'shares',
    candidates: [
      g('WeightedAverageNumberOfDilutedSharesOutstanding'),
      ifrs('AdjustedWeightedAverageShares'),
    ],
  },
  depreciationAmortization: {
    shape: 'duration',
    unit: 'currency',
    candidates: [
      g('DepreciationDepletionAndAmortization'),
      g('DepreciationAndAmortization'),
      g('DepreciationAmortizationAndAccretionNet'),
      ifrs('DepreciationAndAmortisationExpense'),
    ],
  },
  interestExpense: {
    shape: 'duration',
    unit: 'currency',
    candidates: [g('InterestExpense'), g('InterestExpenseNonoperating'), ifrs('InterestExpense')],
  },
} as const satisfies Record<string, SecLineItemMapping>;

export const SEC_BALANCE_TAGS = {
  cashAndEquivalents: {
    shape: 'instant',
    unit: 'currency',
    candidates: [g('CashAndCashEquivalentsAtCarryingValue'), ifrs('CashAndCashEquivalents')],
  },
  shortTermInvestments: {
    shape: 'instant',
    unit: 'currency',
    candidates: [
      g('ShortTermInvestments'),
      g('MarketableSecuritiesCurrent'),
      ifrs('CurrentInvestments'),
    ],
  },
  totalAssets: {
    shape: 'instant',
    unit: 'currency',
    candidates: [g('Assets'), ifrs('Assets')],
  },
  totalLiabilities: {
    shape: 'instant',
    unit: 'currency',
    candidates: [g('Liabilities'), ifrs('Liabilities')],
  },
  shareholdersEquity: {
    shape: 'instant',
    unit: 'currency',
    candidates: [g('StockholdersEquity'), ifrs('EquityAttributableToOwnersOfParent')],
  },
  sharesOutstanding: {
    shape: 'instant',
    unit: 'shares',
    candidates: [g('CommonStockSharesOutstanding')],
    coverFallback: { taxonomy: 'dei', tag: 'EntityCommonStockSharesOutstanding' },
  },
} as const satisfies Record<string, SecLineItemMapping>;

export const SEC_CASH_FLOW_TAGS = {
  operatingCashFlow: {
    shape: 'duration',
    unit: 'currency',
    candidates: [
      g('NetCashProvidedByUsedInOperatingActivities'),
      g('NetCashProvidedByUsedInOperatingActivitiesContinuingOperations'),
      ifrs('CashFlowsFromUsedInOperatingActivities'),
    ],
  },
  capitalExpenditure: {
    shape: 'duration',
    unit: 'currency',
    outflow: true,
    candidates: [
      g('PaymentsToAcquirePropertyPlantAndEquipment'),
      g('PaymentsToAcquireProductiveAssets'),
      ifrs('PurchaseOfPropertyPlantAndEquipmentClassifiedAsInvestingActivities'),
    ],
  },
  dividendsPaid: {
    shape: 'duration',
    unit: 'currency',
    outflow: true,
    candidates: [
      g('PaymentsOfDividends'),
      g('PaymentsOfDividendsCommonStock'),
      ifrs('DividendsPaidClassifiedAsFinancingActivities'),
    ],
  },
  debtRepayment: {
    shape: 'duration',
    unit: 'currency',
    outflow: true,
    candidates: [
      g('RepaymentsOfLongTermDebt'),
      g('RepaymentsOfDebt'),
      ifrs('RepaymentsOfBorrowingsClassifiedAsFinancingActivities'),
    ],
  },
} as const satisfies Record<string, SecLineItemMapping>;

/** Éves jelentés űrlapjai (10-K: hazai, 20-F/40-F: külföldi filer). */
export const SEC_ANNUAL_FORMS: readonly string[] = [
  '10-K',
  '10-K/A',
  '20-F',
  '20-F/A',
  '40-F',
  '40-F/A',
];
/** Negyedéves jelentés űrlapja (külföldi filer nem ad negyedéves XBRL-t). */
export const SEC_QUARTERLY_FORMS: readonly string[] = ['10-Q', '10-Q/A'];

/** Minden tag, amelyet a normalizáló felhasználhat – a fixture-rögzítő ezek alapján vág. */
export function allSecTags(): readonly SecTagCandidate[] {
  const mappings: SecLineItemMapping[] = [
    ...Object.values(SEC_INCOME_TAGS),
    ...Object.values(SEC_BALANCE_TAGS),
    ...Object.values(SEC_CASH_FLOW_TAGS),
  ];
  const tags: SecTagCandidate[] = [];
  for (const mapping of mappings) {
    tags.push(...mapping.candidates);
    if (mapping.coverFallback !== undefined) tags.push(mapping.coverFallback);
  }
  return tags;
}
