import { averageCostLedger, type LedgerEvent } from './average-cost';
import { failureReason, okNotes, okValue } from '../core/testing';

const buy = (quantity: number, price: number, fees = 0): LedgerEvent => ({
  kind: 'buy',
  quantity,
  price,
  fees,
});
const sell = (quantity: number, price: number, fees = 0): LedgerEvent => ({
  kind: 'sell',
  quantity,
  price,
  fees,
});

describe('averageCostLedger (D-012, D-072)', () => {
  it('kézzel ellenőrzött teljes életút: 2 vétel, részeladás, split, teljes eladás', () => {
    // 10 @ 100 + 5 díj → 1005; 10 @ 120 + 5 → 2210, átlag 110,5
    // eladás 5 @ 130 − 3 → 647 − 552,5 = 94,5 realizált; marad 15 db, 1657,5
    // split 1→2 → 30 db, átlag 55,25; eladás 30 @ 60 → 1800 − 1657,5 = 142,5
    const result = okValue(
      averageCostLedger([
        buy(10, 100, 5),
        buy(10, 120, 5),
        sell(5, 130, 3),
        { kind: 'split', factor: 2 },
        sell(30, 60),
      ]),
    );
    expect(result.steps[1]?.averageCost).toBeCloseTo(110.5, 10);
    expect(result.steps[2]?.realizedDelta).toBeCloseTo(94.5, 10);
    expect(result.steps[2]?.averageCost).toBeCloseTo(110.5, 10); // eladás nem változtat átlagárat
    expect(result.steps[3]?.quantity).toBe(30);
    expect(result.steps[3]?.averageCost).toBeCloseTo(55.25, 10);
    expect(result.steps[4]?.realizedDelta).toBeCloseTo(142.5, 10);
    expect(result.quantity).toBe(0);
    expect(result.costBasis).toBe(0);
    expect(result.averageCost).toBeNull();
    expect(result.realizedPL).toBeCloseTo(237, 10);
    expect(result.grossInvested).toBe(2210);
    expect(result.netProceeds).toBe(2447);
    expect(result.totalFees).toBe(13);
    // Visszakövethetőség: realizált = Σ lépés-delta = nettó bevétel − bruttó befektetés (zárt poz.)
    const sumDeltas = result.steps.reduce((sum, step) => sum + step.realizedDelta, 0);
    expect(sumDeltas).toBeCloseTo(result.realizedPL, 10);
    expect(result.netProceeds - result.grossInvested).toBeCloseTo(result.realizedPL, 10);
  });

  it('tört darab és lebegőpontos maradék: 0,1 + 0,2 eladása 0,3-ként lezárja a pozíciót', () => {
    const result = okValue(averageCostLedger([buy(0.1, 50), buy(0.2, 50), sell(0.3, 55)]));
    expect(result.quantity).toBe(0);
    expect(result.costBasis).toBe(0);
    expect(result.realizedPL).toBeCloseTo(1.5, 10);
  });

  it('túladás → INVALID_INPUT (short nem támogatott), a sorszámmal', () => {
    const result = averageCostLedger([buy(5, 10), sell(6, 10)]);
    expect(result.status).toBe('INVALID_INPUT');
    expect(failureReason(result)).toContain('#1');
  });

  it('nyitott pozíció nélküli split hatástalan, megjegyzéssel', () => {
    const result = averageCostLedger([{ kind: 'split', factor: 4 }, buy(1, 10)]);
    expect(okValue(result).quantity).toBe(1);
    expect(okNotes(result)[0]).toContain('split');
  });

  it.each<[string, LedgerEvent]>([
    ['nulla mennyiség', buy(0, 10)],
    ['negatív mennyiség', buy(-1, 10)],
    ['nulla ár', buy(1, 0)],
    ['NaN ár', buy(1, Number.NaN)],
    ['negatív díj', buy(1, 10, -1)],
    ['nulla split-szorzó', { kind: 'split', factor: 0 }],
  ])('érvénytelen esemény (%s) → INVALID_INPUT', (_label, event) => {
    expect(averageCostLedger([event]).status).toBe('INVALID_INPUT');
  });

  it('üres lista → INSUFFICIENT_DATA', () => {
    expect(averageCostLedger([]).status).toBe('INSUFFICIENT_DATA');
  });
});
