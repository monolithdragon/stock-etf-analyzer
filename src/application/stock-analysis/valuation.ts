/**
 * Pontszerű piaci és értékelési mutatók (PHASE 06, feladat 2. és 4., D-062).
 *
 * Konvenció (D-062):
 * - Ár: az aktuális (késleltetett) jegyzés a saját frissességével.
 * - Eredmény- és cash flow-alap: a LEGUTÓBBI TELJES PÉNZÜGYI ÉV (FY) – jelentett, teljes CF-fel.
 *   A TTM-alapú szorzó a PHASE 07-ben jöhet (a negyedéves CF gyakran hiányos, KI-18).
 * - Mérlegalap (adósság, pénz, saját tőke, részvényszám): a legfrissebb mérlegidőpont
 *   (negyedéves vagy éves, amelyik későbbi).
 * - Pénznem: ha a jegyzés és a beszámoló pénzneme eltér (pl. ADR), az árfolyam-alapú szorzó
 *   `MISSING` – FX-átváltás nélkül nem keverünk pénznemet (DATA_DICTIONARY 4.3/8; KI-50).
 */
import {
  ENGINE_SOURCE_ID,
  ENGINE_SOURCE_NAME,
  calculateMetric,
  dividendYieldFromMoney,
  ebitda,
  enterpriseValue,
  evToEbitda,
  fcfYield,
  freeCashFlow,
  marketCap,
  pegRatio,
  priceRange,
  priceToBook,
  priceToEarnings,
  priceToFreeCashFlow,
  priceToSales,
  trailingDividendPerShare,
  type CalculationContext,
  type MetricCalculation,
} from '@/calculations';
import {
  createFundamentalMetric,
  metricMissing,
  metricOk,
  toUtcIsoDate,
  type AppError,
  type CurrencyCode,
  type DataProvenance,
  type DividendHistory,
  type FinancialMetricId,
  type FundamentalMetric,
  type InstrumentProfile,
  type IsoDate,
  type IsoTimestamp,
  type Metric,
  type PriceSeries,
  type Quote,
  type Result,
} from '@/domain';

import { appErrorToMetric, calculatedMetric, lineItemMetric } from './metric-helpers';
import { computePeriodMetrics } from './period-metrics';
import { lineItem, type PeriodStatements } from './statement-periods';

export interface ValuationInput {
  readonly quote: Result<Quote, AppError>;
  readonly profile: Result<InstrumentProfile, AppError>;
  readonly prices: Result<PriceSeries, AppError>;
  readonly dividends: Result<DividendHistory, AppError>;
  readonly latestFy: PeriodStatements | null;
  readonly previousFy: PeriodStatements | null;
  readonly latestBalance: PeriodStatements | null;
  readonly calculatedAt: IsoTimestamp;
  /**
   * PHASE 07 (D-065): forrásolt elemzői EPS-előrejelzés (következő FY). A jelenlegi adatforrásokból
   * nem kérünk le ilyet, ezért ma mindig hiányzik → a Forward P/E `MISSING` indokkal; saját
   * becslésből SOHA nem töltjük ki.
   */
  readonly forwardEps?: Metric<number> | null;
}

export const FORWARD_EPS_MISSING_REASON =
  'Nincs bekötött, forrásolt elemzői EPS-előrejelzés (a jelenlegi ingyenes adatforrásokból nem kérünk le ilyet); a Forward P/E-t saját feltevésből nem becsüljük.';

export interface MarketOverviewMetrics {
  readonly price: FundamentalMetric;
  readonly marketCap: FundamentalMetric;
  readonly sharesOutstanding: FundamentalMetric;
  readonly beta: FundamentalMetric;
  readonly week52High: FundamentalMetric;
  readonly week52Low: FundamentalMetric;
}

export interface ValuationOutput {
  readonly overview: MarketOverviewMetrics;
  readonly valuation: FundamentalMetric[];
  readonly warnings: string[];
}

function priceMetric(quote: Result<Quote, AppError>): Metric<number> {
  if (!quote.ok) return appErrorToMetric(quote.error, 'Árfolyam');
  const q = quote.value;
  return metricOk(q.price.amount, {
    ...q.provenance,
    asOf: q.asOf,
    unit: 'money_per_share',
    currency: q.price.currency,
  });
}

function engineProvenance(
  base: DataProvenance,
  calculatedAt: IsoTimestamp,
  extra: Partial<DataProvenance>,
): DataProvenance {
  return {
    sourceId: ENGINE_SOURCE_ID,
    sourceName: ENGINE_SOURCE_NAME,
    kind: base.kind === 'mock' ? 'mock' : 'calculated',
    fetchedAt: calculatedAt,
    asOf: base.asOf,
    freshness: base.freshness,
    inputs: [base.sourceId],
    ...extra,
  };
}

function week52(
  prices: Result<PriceSeries, AppError>,
  calculatedAt: IsoTimestamp,
): { high: FundamentalMetric; low: FundamentalMetric } {
  const make = (id: 'week52High' | 'week52Low', value: Metric<number>, notes: string[] = []) =>
    createFundamentalMetric({
      id,
      unit: 'money_per_share',
      formula:
        id === 'week52High'
          ? 'max(napi záróár) az utolsó 365 napban'
          : 'min(napi záróár) az utolsó 365 napban',
      period: null,
      value,
      notes,
    });
  if (!prices.ok) {
    const failed = appErrorToMetric<number>(prices.error, 'Ártörténet');
    return { high: make('week52High', failed), low: make('week52Low', failed) };
  }
  const series = prices.value;
  const last = series.points[series.points.length - 1];
  if (last === undefined) {
    const empty = metricMissing<number>('Az ártörténet üres.');
    return { high: make('week52High', empty), low: make('week52Low', empty) };
  }
  const range = priceRange(series.points, last.date);
  if (range.status !== 'OK') {
    const failed: Metric<number> = { status: range.status, reason: range.reason };
    return { high: make('week52High', failed), low: make('week52Low', failed) };
  }
  const adjustmentNote = `Korrekció: ${series.adjustment} (osztalékkorrigált sorozatban a régebbi árak kissé alacsonyabbak).`;
  const notes = [...range.notes, adjustmentNote];
  const prov = (asOf: IsoDate) =>
    engineProvenance(series.provenance, calculatedAt, {
      asOf,
      unit: 'money_per_share',
      currency: series.currency,
      reference: `${series.provenance.sourceId} ártörténet, ${range.value.pointCount} pont`,
    });
  return {
    high: make('week52High', metricOk(range.value.high, prov(range.value.highDate)), notes),
    low: make('week52Low', metricOk(range.value.low, prov(range.value.lowDate)), notes),
  };
}

function betaMetric(profile: Result<InstrumentProfile, AppError>): FundamentalMetric {
  const value: Metric<number> = !profile.ok
    ? appErrorToMetric(profile.error, 'Profil')
    : profile.value.beta === null
      ? metricMissing('A profil-forrás nem közöl bétát.')
      : metricOk(profile.value.beta, { ...profile.value.provenance, unit: 'multiple' });
  return createFundamentalMetric({
    id: 'beta',
    unit: 'multiple',
    formula: 'jelentett (szolgáltatói béta; módszertan nem közölt)',
    period: null,
    value,
    notes:
      value.status === 'OK'
        ? ['Tájékoztató: a szolgáltató nem közli az időtávot és az indexet. Saját béta: PHASE 08.']
        : [],
  });
}

/**
 * Osztalékhozam. Nem a `calculateMetric` pénznem-őrén megy át, mert a GBX ár + GBP osztalék
 * (LSE) a `dividendYieldFromMoney` szabálya szerint összevethető (fő egységre váltás).
 */
function dividendYieldCalc(
  dps: Metric<number>,
  price: Metric<number>,
  calculatedAt: IsoTimestamp,
): MetricCalculation {
  if (dps.status !== 'OK') {
    return {
      metric: { ...dps, reason: `TTM osztalék/részvény: ${dps.reason}` } as Metric<number>,
      notes: [],
    };
  }
  if (price.status !== 'OK') {
    return { metric: { ...price, reason: `Ár: ${price.reason}` } as Metric<number>, notes: [] };
  }
  const result = dividendYieldFromMoney({
    annualDividendPerShare: {
      amount: dps.value,
      currency: dps.provenance.currency as CurrencyCode,
    },
    price: { amount: price.value, currency: price.provenance.currency as CurrencyCode },
  });
  if (result.status !== 'OK') {
    return { metric: { status: result.status, reason: result.reason }, notes: [] };
  }
  const worst = [price.provenance.freshness, dps.provenance.freshness].includes('EXPIRED')
    ? 'EXPIRED'
    : [price.provenance.freshness, dps.provenance.freshness].includes('STALE')
      ? 'STALE'
      : price.provenance.freshness;
  return {
    metric: metricOk(result.value, {
      ...engineProvenance(price.provenance, calculatedAt, { unit: 'ratio' }),
      freshness: worst,
      inputs: ['dividendPerShareTtm', 'price'],
    }),
    notes: result.notes,
  };
}

function dividendPerShare(
  dividends: Result<DividendHistory, AppError>,
  price: Metric<number>,
  calculatedAt: IsoTimestamp,
): Metric<number> {
  if (!dividends.ok) return appErrorToMetric(dividends.error, 'Osztaléktörténet');
  if (price.status !== 'OK' || price.provenance.currency === undefined) {
    return metricMissing('A TTM osztalékhoz a jegyzés pénzneme és dátuma kell (ár nem elérhető).');
  }
  const asOf = toUtcIsoDate(new Date(calculatedAt));
  const result = trailingDividendPerShare({
    events: dividends.value.events,
    asOf,
    // A free források lefedettségét nem ismerjük biztosan → esemény nélkül MISSING (nem 0).
    coverageStart: null,
    listingCurrency: price.provenance.currency,
  });
  if (result.status !== 'OK') return { status: result.status, reason: result.reason };
  return metricOk(
    result.value.amount,
    engineProvenance(dividends.value.provenance, calculatedAt, {
      asOf,
      unit: 'money_per_share',
      currency: result.value.currency,
      reference: `TTM ex-dátum ablak (${asOf} − 365 nap)`,
    }),
  );
}

export function computeValuation(input: ValuationInput): ValuationOutput {
  const { latestFy, previousFy, latestBalance, calculatedAt } = input;
  const warnings: string[] = [];
  const ctx: CalculationContext = { unit: 'multiple', calculatedAt };
  const price = priceMetric(input.quote);
  const priceCurrency = price.status === 'OK' ? price.provenance.currency : undefined;
  const reportingCurrency = latestFy?.currency ?? latestBalance?.currency;
  const currencyMismatch =
    priceCurrency !== undefined &&
    reportingCurrency !== undefined &&
    priceCurrency !== reportingCurrency;
  if (currencyMismatch) {
    warnings.push(
      `A jegyzési (${priceCurrency}) és a beszámolói (${reportingCurrency}) pénznem eltér: az árfolyam-alapú szorzók FX-átváltás nélkül nem számolhatók (KI-50).`,
    );
  }
  const fxBlocked = (): MetricCalculation => ({
    metric: metricMissing(
      `A jegyzési (${priceCurrency}) és a beszámolói (${reportingCurrency}) pénznem eltér; FX-átváltás nélkül nem számolunk (DATA_DICTIONARY 4.3/8).`,
    ),
    notes: [],
  });

  const shares = lineItem(latestBalance, 'sharesOutstanding');
  const priceAsOf = input.quote.ok ? (input.quote.value.asOf.slice(0, 10) as IsoDate) : undefined;
  const sharesAsOf = latestBalance?.column.end;
  const mc = calculateMetric(
    { price, sharesOutstanding: shares },
    {},
    (v) =>
      marketCap({
        ...v,
        ...(priceAsOf === undefined ? {} : { priceAsOf }),
        ...(sharesAsOf === undefined ? {} : { sharesAsOf }),
      }),
    { unit: 'money', calculatedAt },
  );
  const fyMetrics =
    latestFy === null
      ? null
      : computePeriodMetrics({
          current: latestFy,
          comparable: previousFy,
          previousBalance: previousFy,
          basis: 'annual',
          calculatedAt,
        });
  const fyValue = (id: string): Metric<number> =>
    fyMetrics?.find((m) => m.id === id)?.value ??
    metricMissing('Nincs teljes pénzügyi év (FY) a kimutatásokban.');
  const basisNote =
    latestFy === null
      ? []
      : [
          `Eredményalap: ${latestFy.column.label} (záró: ${latestFy.column.end}); mérlegalap: ${latestBalance?.column.label ?? '–'}.`,
        ];

  const cash = lineItem(latestBalance, 'cashAndEquivalents');
  const debt = lineItem(latestBalance, 'totalDebt');
  const ev = calculateMetric(
    { marketCap: mc.metric, totalDebt: debt, cashAndEquivalents: cash },
    {},
    enterpriseValue,
    { unit: 'money', calculatedAt },
  );
  const fcf =
    latestFy === null
      ? fyValue('fcf')
      : calculateMetric(
          {
            operatingCashFlow: lineItem(latestFy, 'operatingCashFlow'),
            capitalExpenditure: lineItem(latestFy, 'capitalExpenditure'),
          },
          {},
          freeCashFlow,
          { unit: 'money', calculatedAt },
        ).metric;
  const ebitdaFy =
    latestFy === null
      ? fyValue('ebitda')
      : calculateMetric(
          {
            operatingIncome: lineItem(latestFy, 'operatingIncome'),
            depreciationAmortization: lineItem(latestFy, 'depreciationAmortization'),
          },
          {},
          ebitda,
          { unit: 'money', calculatedAt },
        ).metric;
  const guard = (compute: () => MetricCalculation) => (currencyMismatch ? fxBlocked() : compute());
  const pe = guard(() => calculateMetric({ price, eps: fyValue('eps') }, {}, priceToEarnings, ctx));
  const forwardEps = input.forwardEps ?? metricMissing<number>(FORWARD_EPS_MISSING_REASON);
  const forwardPe = guard(() =>
    calculateMetric({ price, eps: forwardEps }, {}, priceToEarnings, ctx),
  );
  const dps = dividendPerShare(input.dividends, price, calculatedAt);

  const metric = (id: FinancialMetricId, calc: MetricCalculation) =>
    calculatedMetric(id, calc, null, basisNote);
  const valuation: FundamentalMetric[] = [
    metric('marketCap', mc),
    metric('enterpriseValue', ev),
    metric('pe', pe),
    calculatedMetric('forwardPe', forwardPe, null, [
      'Forward P/E: az aktuális ár és a forrásolt következő évi EPS-előrejelzés hányadosa (csak ha ténylegesen elérhető).',
    ]),
    metric(
      'ps',
      guard(() =>
        calculateMetric(
          { marketCap: mc.metric, revenue: fyValue('revenue') },
          {},
          priceToSales,
          ctx,
        ),
      ),
    ),
    metric(
      'pb',
      guard(() =>
        calculateMetric(
          {
            marketCap: mc.metric,
            shareholdersEquity: lineItem(latestBalance, 'shareholdersEquity'),
          },
          {},
          priceToBook,
          ctx,
        ),
      ),
    ),
    metric(
      'pfcf',
      guard(() =>
        calculateMetric({ marketCap: mc.metric, freeCashFlow: fcf }, {}, priceToFreeCashFlow, ctx),
      ),
    ),
    metric(
      'fcfYield',
      guard(() =>
        calculateMetric({ freeCashFlow: fcf, marketCap: mc.metric }, {}, fcfYield, {
          ...ctx,
          unit: 'ratio',
        }),
      ),
    ),
    metric(
      'evToEbitda',
      guard(() =>
        calculateMetric({ enterpriseValue: ev.metric, ebitda: ebitdaFy }, {}, evToEbitda, ctx),
      ),
    ),
    metric(
      'peg',
      guard(() =>
        calculateMetric(
          { priceToEarnings: pe.metric, epsGrowthRate: fyValue('epsGrowth') },
          {},
          pegRatio,
          ctx,
        ),
      ),
    ),
    metric('dividendYield', dividendYieldCalc(dps, price, calculatedAt)),
    createFundamentalMetric({
      id: 'dividendPerShareTtm',
      unit: 'money_per_share',
      formula: 'Σ osztalék/részvény, ex-dátum ∈ (ma − 365 nap, ma]',
      period: null,
      value: dps,
    }),
  ];

  const { high, low } = week52(input.prices, calculatedAt);
  return {
    overview: {
      price: createFundamentalMetric({
        id: 'price',
        unit: 'money_per_share',
        formula: 'jelentett (legutóbbi, késleltetett ár)',
        period: null,
        value: price,
      }),
      marketCap: valuation[0]!,
      sharesOutstanding: lineItemMetric(
        'sharesOutstanding',
        shares,
        latestBalance?.column.period ?? null,
      ),
      beta: betaMetric(input.profile),
      week52High: high,
      week52Low: low,
    },
    valuation,
    warnings,
  };
}
