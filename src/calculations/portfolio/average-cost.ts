/**
 * Átlagáras (average cost) pozíció-könyvelés. DATA_DICTIONARY 7.1, D-012, D-072.
 *
 * Bemenet: egy jegyzés időrendbe rendezett eseményei, MINDEN összeg EGY pénznemben (a hívó
 * váltja át: natív nézetben a jegyzés pénznemébe, alapdeviza-nézetben az ügyleti napi FX-szel).
 *
 * Szabályok (átlagár-módszer):
 * - VÉTEL: mennyiség += q; bekerülési érték += q × ár + díj (a díj a bekerülés része).
 * - ELADÁS: a bekerülési érték ARÁNYOSAN csökken (átlagár × q); realizált P/L =
 *   q × eladási ár − díj − q × átlagár. Az átlagár eladáskor NEM változik.
 * - SPLIT (`factor` = ratioTo / ratioFrom): mennyiség × factor; bekerülési érték változatlan,
 *   így az átlagár ÷ factor.
 * - Túladás (eladás > birtokolt mennyiség) → `INVALID_INPUT` (short nem támogatott).
 * - Lebegőpontos maradék: |mennyiség| < QUANTITY_EPSILON → 0 (a pozíció lezárul, bekerülés 0).
 *
 * Adózási célra NEM alkalmas (a magyar szabály pl. FIFO-t is megenged/előír – D-012).
 */
import {
  calcInsufficientData,
  calcInvalidInput,
  calcOk,
  type CalcFailure,
  type CalcResult,
} from '../core/calc-result';

/** Ennél kisebb (abszolút) mennyiség lebegőpontos maradéknak számít, és 0 lesz. */
export const QUANTITY_EPSILON = 1e-9;

export type LedgerEvent =
  | {
      readonly kind: 'buy' | 'sell';
      readonly quantity: number;
      /** Egységár a könyvelés pénznemében. */
      readonly price: number;
      /** Díj a könyvelés pénznemében (≥ 0). */
      readonly fees: number;
    }
  | {
      readonly kind: 'split';
      /** ratioTo / ratioFrom (pl. 1 → 4: 4). */
      readonly factor: number;
    };

/** Egy esemény utáni állapot – a visszakövethetőséghez (minden összesítés innen ered). */
export interface LedgerStep {
  readonly quantity: number;
  readonly costBasis: number;
  /** `null`, ha a pozíció ezután zárt (0 darab). */
  readonly averageCost: number | null;
  /** Az esemény által realizált P/L (csak eladásnál ≠ 0). */
  readonly realizedDelta: number;
}

export interface AverageCostLedger {
  readonly quantity: number;
  readonly costBasis: number;
  readonly averageCost: number | null;
  /** Az összes eladás realizált P/L-je (díjak után). */
  readonly realizedPL: number;
  /** Az összes vétel bruttó költsége (q × ár + díj) – a „befektetett tőke” alapja. */
  readonly grossInvested: number;
  /** Az összes eladás nettó bevétele (q × ár − díj). */
  readonly netProceeds: number;
  /** Az összes díj (vétel + eladás). */
  readonly totalFees: number;
  readonly steps: readonly LedgerStep[];
}

function checkEvent(event: LedgerEvent, index: number): CalcFailure | null {
  if (event.kind === 'split') {
    return Number.isFinite(event.factor) && event.factor > 0
      ? null
      : calcInvalidInput(`#${index}: a split-szorzó pozitív véges szám kell (${event.factor}).`);
  }
  if (!Number.isFinite(event.quantity) || event.quantity <= 0) {
    return calcInvalidInput(`#${index}: a mennyiség > 0 kell (${event.quantity}).`);
  }
  if (!Number.isFinite(event.price) || event.price <= 0) {
    return calcInvalidInput(`#${index}: az ár > 0 kell (${event.price}).`);
  }
  if (!Number.isFinite(event.fees) || event.fees < 0) {
    return calcInvalidInput(`#${index}: a díj ≥ 0 kell (${event.fees}).`);
  }
  return null;
}

/**
 * Átlagáras könyvelés futtatása. Üres eseménylista → `INSUFFICIENT_DATA`;
 * érvénytelen esemény vagy túladás → `INVALID_INPUT` (az esemény sorszámával).
 */
export function averageCostLedger(events: readonly LedgerEvent[]): CalcResult<AverageCostLedger> {
  if (events.length === 0) return calcInsufficientData('Nincs könyvelendő esemény.');
  let quantity = 0;
  let costBasis = 0;
  let realizedPL = 0;
  let grossInvested = 0;
  let netProceeds = 0;
  let totalFees = 0;
  const steps: LedgerStep[] = [];
  const notes: string[] = [];

  for (const [index, event] of events.entries()) {
    const bad = checkEvent(event, index);
    if (bad) return bad;
    let realizedDelta = 0;
    if (event.kind === 'split') {
      if (quantity <= 0) notes.push(`#${index}: split nyitott pozíció nélkül – hatástalan.`);
      quantity *= event.factor;
    } else if (event.kind === 'buy') {
      const cost = event.quantity * event.price + event.fees;
      quantity += event.quantity;
      costBasis += cost;
      grossInvested += cost;
      totalFees += event.fees;
    } else {
      if (event.quantity > quantity + QUANTITY_EPSILON * Math.max(1, quantity)) {
        return calcInvalidInput(
          `#${index}: eladás (${event.quantity}) több, mint a birtokolt mennyiség (${quantity}); short pozíció nem támogatott.`,
        );
      }
      const sold = Math.min(event.quantity, quantity);
      const averageCost = costBasis / quantity;
      const proceeds = sold * event.price - event.fees;
      realizedDelta = proceeds - sold * averageCost;
      realizedPL += realizedDelta;
      netProceeds += proceeds;
      totalFees += event.fees;
      quantity -= sold;
      costBasis -= sold * averageCost;
    }
    if (Math.abs(quantity) < QUANTITY_EPSILON) {
      quantity = 0;
      costBasis = 0;
    }
    steps.push({
      quantity,
      costBasis,
      averageCost: quantity > 0 ? costBasis / quantity : null,
      realizedDelta,
    });
  }
  return calcOk(
    {
      quantity,
      costBasis,
      averageCost: quantity > 0 ? costBasis / quantity : null,
      realizedPL,
      grossInvested,
      netProceeds,
      totalFees,
      steps,
    },
    notes,
  );
}
