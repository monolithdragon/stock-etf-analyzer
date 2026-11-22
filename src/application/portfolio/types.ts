/**
 * Portfólióelemzés – bemeneti opciók és kimeneti modell (PHASE 09, DATA_DICTIONARY 7., D-072).
 *
 * Elvek:
 * - Az egyetlen igazságforrás a tranzakciólista (D-012); minden pozíció és összesítés innen
 *   számolt, és visszavezethető (`PositionAnalysis.ledger`, `PortfolioTotal.components`).
 * - Két P/L-nézet: NATÍV (a jegyzés pénznemében, FX-hatás nélkül) és ALAPDEVIZA (a portfólió
 *   bázispénznemében; bekerülés az ügyleti napi FX-szel, piaci érték a mai FX-szel → FX-hatás).
 * - Hiányzó ár / FX soha nem 0: a mutató nem-OK státuszt kap okkal, az összesítés jelzi, mely
 *   pozíciók maradtak ki.
 * - Közvetlen és ETF-en keresztüli (look-through) kitettség KÜLÖN nézet; az összevonás módszere
 *   a kimenetben le van írva.
 * - Elemzési kimenet: NEM adótanács (átlagár-módszer) és NEM befektetési tanács.
 */
import type { HoldingsOverlap, RiskReliability } from '@/calculations';
import type {
  CurrencyCode,
  DataProvenance,
  EtfHoldingsSnapshotInput,
  IsoDate,
  IsoTimestamp,
  LedgerIssue,
  ListingId,
  MeasurementUnit,
  Metric,
  MetricOrigin,
  Money,
  PortfolioAssetMetadata,
  PortfolioAssetMetadataInput,
  PortfolioId,
  TransactionId,
  TransactionType,
} from '@/domain';

// --- Bemenet ---------------------------------------------------------------------------------

/** Egy deviza napi árfolyama a portfólió bázispénznemére: 1 `currency` = `rate` bázis. */
export interface FxSeriesPoint {
  readonly date: string;
  readonly rate: number;
}

export interface PortfolioHistoryOptions {
  /** A historikus elemzés kérése (költséges: jegyzésenként 1 ártörténet-hívás). */
  readonly enabled: boolean;
  /** Kezdőnap (ÉÉÉÉ-HH-NN); alapból az első tranzakció napja. */
  readonly from?: string;
  /**
   * Napi FX-idősorok devizánként (fő pénznem → bázis). Ma nincs FX-idősor végpont (KI-77):
   * ha a portfólió többdevizás és ez hiányzik, a historikus elemzés `MISSING`.
   */
  readonly fxSeries?: Readonly<Record<string, readonly FxSeriesPoint[]>>;
}

export interface PortfolioAnalysisOptions {
  /** Kézi eszköz-metaadat (felülírja / kiegészíti a szolgáltatói profilt). */
  readonly assets?: readonly (Omit<PortfolioAssetMetadataInput, 'listingId'> & {
    readonly listingId: string;
  })[];
  /** ETF holdings-pillanatképek a look-through kitettséghez (kézi / kibocsátói fájl). */
  readonly etfHoldings?: readonly {
    readonly listingId: string;
    readonly snapshot: Omit<EtfHoldingsSnapshotInput, 'provenance'>;
    readonly sourceName: string;
  }[];
  /** Szolgáltatói profil lekérése a metaadathoz (alap: igen; jegyzésenként 1 hívás). */
  readonly fetchProfiles?: boolean;
  readonly history?: PortfolioHistoryOptions;
  /** Kockázatmentes hozam (éves, tört) a Sharpe/Sortino-hoz – felhasználói beállítás. */
  readonly riskFreeRate?: number;
  /** A kockázati mutatók minimális periódushozam-száma (alap: 126, D-066/D-070). */
  readonly minRiskObservations?: number;
}

// --- Kimenet: közös --------------------------------------------------------------------------

/** Egy FX-ráta, amelyet a számítás ténylegesen felhasznált (1 `currency` = `rate` bázis). */
export interface UsedFxRate {
  readonly currency: CurrencyCode;
  readonly rate: number;
  readonly asOf: IsoDate;
  /** `transaction`: a tranzakcióhoz rögzített ráta; `market`: referencia (ECB) ráta. */
  readonly source: 'transaction' | 'market';
  readonly provenance: DataProvenance;
}

export interface PortfolioMetric {
  readonly id: string;
  readonly label: string;
  readonly unit: MeasurementUnit;
  readonly formula: string;
  readonly value: Metric<number>;
  readonly origin: MetricOrigin;
  /** Csak kiszámolt kockázati mutatónál (D-070); máskor `null`. */
  readonly reliability: RiskReliability | null;
  readonly notes: readonly string[];
}

// --- Kimenet: pozíció ------------------------------------------------------------------------

/** A pozíció egy könyvelési lépése – az összesítések visszavezethetősége. */
export interface PositionLedgerRow {
  readonly transactionId: TransactionId;
  readonly type: TransactionType;
  readonly tradeDate: IsoDate;
  /** Mennyiség a lépés után (osztalék/díj: változatlan). */
  readonly quantityAfter: number;
  /** Natív bekerülési érték és átlagár a lépés után; `null`, ha a natív könyvelés nem futott. */
  readonly costBasisNativeAfter: number | null;
  readonly averageCostNativeAfter: number | null;
  /** Az eladás realizált natív P/L-je (más lépésnél 0). */
  readonly realizedNativeDelta: number | null;
  /** A lépés bázispénznemre váltásához használt ráta (a fő pénznemre); `null` = nem kellett / hiányzik. */
  readonly fxRate: UsedFxRate | null;
}

export interface PositionAnalysis {
  readonly listingId: ListingId;
  readonly metadata: PortfolioAssetMetadata | null;
  readonly status: 'open' | 'closed' | 'invalid';
  /** Érvénytelen naplónál a hibák (a mutatók ekkor `INVALID_INPUT`). */
  readonly issues: readonly LedgerIssue[];
  readonly transactionIds: readonly TransactionId[];
  readonly firstTradeDate: IsoDate | null;
  readonly quantity: number;
  /** A jegyzés (ügyletek) pénzneme, ahogy rögzítették (pl. GBX). */
  readonly nativeCurrency: CurrencyCode | null;
  // Natív nézet (FX-hatás nélkül)
  readonly averageCostNative: Metric<Money>;
  readonly costBasisNative: Metric<Money>;
  readonly lastPrice: Metric<Money>;
  readonly marketValueNative: Metric<Money>;
  readonly unrealizedPLNative: Metric<Money>;
  readonly unrealizedReturnNative: Metric<number>;
  readonly realizedPLNative: Metric<Money>;
  /** Kapott osztalék a kifizetés pénznemében (lehet több deviza). */
  readonly dividendsNative: readonly Money[];
  // Alapdeviza-nézet (FX-hatással)
  readonly costBasisBase: Metric<Money>;
  readonly marketValueBase: Metric<Money>;
  readonly unrealizedPLBase: Metric<Money>;
  /** Az alapdevizás nem realizált P/L árhatás-része = natív P/L × mai FX. */
  readonly priceEffectBase: Metric<Money>;
  /** FX-hatás = natív bekerülés × mai FX − alapdevizás bekerülés (ügyleti napi FX-szel). */
  readonly fxEffectBase: Metric<Money>;
  readonly realizedPLBase: Metric<Money>;
  readonly dividendsBase: Metric<Money>;
  /** A jegyzéshez rögzített külön díjak (FEE tranzakciók) bázisban. */
  readonly otherFeesBase: Metric<Money>;
  /** Vételek bruttó költsége (q × ár + díj) bázisban – a %-os összhozam nevezője. */
  readonly grossInvestedBase: Metric<Money>;
  /** Nem realizált + realizált + osztalék − külön díjak (bázisban). */
  readonly totalReturnBase: Metric<Money>;
  readonly totalReturnPct: Metric<number>;
  /** Súly a portfólió árazott piaci értékében; zárt pozíciónál `NOT_APPLICABLE`. */
  readonly weight: Metric<number>;
  /** A mai piaci érték átváltásához használt ráta. */
  readonly currentFx: UsedFxRate | null;
  readonly ledger: readonly PositionLedgerRow[];
  readonly notes: readonly string[];
}

// --- Kimenet: összesítés ---------------------------------------------------------------------

/** Portfólió-összeg: a komponensek (pozíciók) összege, vagy a hiány oka. */
export interface PortfolioTotal {
  readonly id: string;
  readonly label: string;
  /** `OK` csak akkor, ha MINDEN érintett pozíciónak van értéke. */
  readonly value: Metric<Money>;
  /** A rendelkezésre álló komponensek összege (részösszeg, ha valami hiányzik). */
  readonly availableSum: Money;
  readonly components: readonly { readonly listingId: ListingId; readonly amount: number }[];
  /** Pozíciók, amelyeknél az érték hiányzik (ár, FX vagy hibás napló miatt). */
  readonly missing: readonly ListingId[];
}

export interface PortfolioTotals {
  readonly currency: CurrencyCode;
  readonly marketValue: PortfolioTotal;
  readonly costBasis: PortfolioTotal;
  readonly unrealizedPL: PortfolioTotal;
  readonly priceEffect: PortfolioTotal;
  readonly fxEffect: PortfolioTotal;
  readonly realizedPL: PortfolioTotal;
  readonly dividends: PortfolioTotal;
  readonly otherFees: PortfolioTotal;
  readonly grossInvested: PortfolioTotal;
  readonly totalReturn: PortfolioTotal;
  /** Összhozam / bruttó befektetés (egyszerű, NEM idő- vagy pénzsúlyozott). */
  readonly totalReturnPct: PortfolioMetric;
  readonly openPositions: number;
  readonly closedPositions: number;
  readonly invalidPositions: number;
}

// --- Kimenet: kitettség és koncentráció ------------------------------------------------------

export const EXPOSURE_DIMENSIONS = [
  'instrumentKind',
  'assetClass',
  'tradingCurrency',
  'country',
  'sector',
  'underlyingCurrency',
] as const;
export type ExposureDimension = (typeof EXPOSURE_DIMENSIONS)[number];

/**
 * - `direct`: minden pozíció egy tétel a saját metaadatával (ETF-nél ország/szektor nincs:
 *   a domicil nem kitettség);
 * - `look_through`: a közvetlen részvény + az ETF súlya × a holdings súlya (D-072/6).
 */
export type ExposureMethod = 'direct' | 'look_through';

export interface ExposureGroupWeight {
  readonly key: string;
  readonly weight: number;
}

export interface PortfolioExposure {
  readonly dimension: ExposureDimension;
  readonly method: ExposureMethod;
  readonly groups: Metric<readonly ExposureGroupWeight[]>;
  /** Felsorolt, de besorolás nélküli súly (a forrás nem adta meg). */
  readonly unclassifiedWeight: number | null;
  /** Le nem fedett súly (pl. ETF holdings nélkül, részleges holdings). */
  readonly uncoveredWeight: number | null;
  readonly methodNote: string;
  readonly notes: readonly string[];
}

export interface SingleNameExposure {
  /** ISIN, vagy ISIN nélküli közvetlen részvénynél `listing:<id>`. */
  readonly key: string;
  readonly name: string | null;
  readonly directWeight: number;
  readonly viaEtfWeight: number;
  readonly totalWeight: number;
  /** Mely ETF-eken keresztül (listing-azonosítók). */
  readonly viaEtfs: readonly ListingId[];
}

export interface GroupConcentration {
  readonly method: ExposureMethod;
  readonly largest: Metric<ExposureGroupWeight>;
  readonly top3Weight: Metric<number>;
}

export interface PortfolioConcentration {
  readonly largestPosition: Metric<{ readonly listingId: ListingId; readonly weight: number }>;
  readonly top5Weight: PortfolioMetric;
  readonly top10Weight: PortfolioMetric;
  readonly herfindahl: PortfolioMetric;
  readonly effectivePositions: PortfolioMetric;
  /** Egyedi részvénykitettség (közvetlen + ETF-en át, ISIN szerint), csökkenő, max. 10. */
  readonly singleNames: Metric<readonly SingleNameExposure[]>;
  readonly sector: readonly GroupConcentration[];
  readonly country: readonly GroupConcentration[];
  readonly notes: readonly string[];
}

// --- Kimenet: ETF-átfedés (adatmodell; teljes funkció és képernyő: PHASE 14) -------------------

export interface EtfOverlapPair {
  readonly a: ListingId;
  readonly b: ListingId;
  readonly holdingsAsOf: { readonly a: IsoDate; readonly b: IsoDate };
  /** Σ min(w_A, w_B) ISIN szerint; részleges listán alsó becslés. */
  readonly overlap: Metric<HoldingsOverlap>;
}

export interface EtfOverlapModel {
  readonly pairs: readonly EtfOverlapPair[];
  /** ETF-pozíciók holdings nélkül – ezekre nincs átfedés-számítás. */
  readonly etfsWithoutHoldings: readonly ListingId[];
  readonly method: string;
}

// --- Kimenet: historikus elemzés -------------------------------------------------------------

export interface CorrelationPair {
  readonly a: ListingId;
  readonly b: ListingId;
  readonly correlation: Metric<number>;
  readonly observations: number;
}

export interface PortfolioHistoryAnalysis {
  /** `OK`: van elemezhető idősor; különben a hiány oka (minden mutató ugyanezt örökli). */
  readonly status: Metric<{ readonly start: IsoDate; readonly end: IsoDate }>;
  readonly observations: number;
  readonly cumulativeReturn: PortfolioMetric;
  readonly annualizedReturn: PortfolioMetric;
  readonly volatility: PortfolioMetric;
  readonly maxDrawdown: PortfolioMetric;
  readonly downsideDeviation: PortfolioMetric;
  readonly sharpe: PortfolioMetric;
  readonly sortino: PortfolioMetric;
  /** Napi TWR-index (első nap 1) – grafikonhoz. */
  readonly index: readonly { readonly date: IsoDate; readonly value: number }[];
  /** Páronkénti korreláció a nyitott pozíciók napi (natív) hozamai között. */
  readonly correlations: readonly CorrelationPair[];
  readonly conventions: readonly string[];
  readonly limitations: readonly string[];
}

// --- Kimenet: teljes elemzés -----------------------------------------------------------------

export interface PortfolioAnalysis {
  readonly portfolioId: PortfolioId;
  readonly portfolioName: string;
  readonly baseCurrency: CurrencyCode;
  readonly generatedAt: IsoTimestamp;
  readonly accountingMethod: {
    readonly id: 'average_cost';
    readonly description: string;
    readonly taxWarning: string;
  };
  readonly validation: { readonly issues: readonly LedgerIssue[] };
  readonly positions: readonly PositionAnalysis[];
  readonly totals: PortfolioTotals;
  readonly exposures: readonly PortfolioExposure[];
  readonly concentration: PortfolioConcentration;
  readonly etfOverlap: EtfOverlapModel;
  readonly history: PortfolioHistoryAnalysis;
  /** Az összes felhasznált FX-ráta dátummal és forrással. */
  readonly fxRatesUsed: readonly UsedFxRate[];
  readonly warnings: readonly string[];
  readonly disclaimer: string;
}
