import type { DataProvenance, IsoTimestamp } from '../shared';
import { createEtfHoldingsSnapshot, type EtfHoldingInput } from './etf-holdings';

const provenance: DataProvenance = {
  sourceId: 'user',
  sourceName: 'Kézi bevitel',
  kind: 'user_input',
  fetchedAt: '2026-11-22T10:00:00Z' as IsoTimestamp,
  asOf: null,
  freshness: 'UNKNOWN',
};

const holding = (
  name: string,
  weight: number,
  extra: Partial<EtfHoldingInput> = {},
): EtfHoldingInput => ({
  name,
  weight,
  ...extra,
});

describe('createEtfHoldingsSnapshot', () => {
  it('teljes lista: súly szerint rendez, complete, mezők validálva', () => {
    const result = createEtfHoldingsSnapshot({
      asOf: '2026-09-30',
      holdings: [
        holding('B', 0.4, { country: 'us', currency: 'USD', isin: 'US0378331005' }),
        holding('A', 0.6, { country: 'JP', sector: ' Technology ', currency: 'GBp' }),
      ],
      declaredComplete: true,
      provenance,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.holdings.map((h) => h.name)).toEqual(['A', 'B']);
      expect(result.value.holdings[0]).toEqual(
        expect.objectContaining({
          country: 'JP',
          sector: 'Technology',
          currency: 'GBX',
          isin: null,
        }),
      );
      expect(result.value.holdings[1]?.country).toBe('US');
      expect(result.value.completeness).toBe('complete');
      expect(result.value.notes).toEqual([]);
    }
  });

  it('részleges lista (top 10 kivonat) jelentett pozíciószámmal', () => {
    const result = createEtfHoldingsSnapshot({
      asOf: '2026-10-31',
      holdings: [holding('X', 0.05), holding('Y', 0.04)],
      declaredComplete: false,
      reportedHoldingsCount: 3700,
      provenance,
    });
    expect(result.ok && result.value.completeness).toBe('partial');
    expect(result.ok && result.value.notes[0]).toContain('2 tétel a(z) 3700-ból');
  });

  it('teljesnek jelölt, de < 95% súly → részleges, megjegyzéssel', () => {
    const result = createEtfHoldingsSnapshot({
      asOf: '2026-10-31',
      holdings: [holding('X', 0.5), holding('Y', 0.3)],
      declaredComplete: true,
      provenance,
    });
    expect(result.ok && result.value.completeness).toBe('partial');
    expect(result.ok && result.value.notes[0]).toContain('80.0%');
  });

  it.each([
    ['üres lista', { holdings: [] }],
    ['százalék a tört helyett (Σ > 150%)', { holdings: [holding('A', 0.9), holding('B', 0.9)] }],
    ['súly > 1', { holdings: [holding('A', 60)] }],
    ['nem véges súly', { holdings: [holding('A', Number.NaN)] }],
    ['érvénytelen ország', { holdings: [holding('A', 0.5, { country: 'USA' })] }],
    ['érvénytelen ISIN', { holdings: [holding('A', 0.5, { isin: 'XX123' })] }],
    ['üres név', { holdings: [holding(' ', 0.5)] }],
    ['rossz dátum', { asOf: '2026-13-01' }],
    ['jelentett szám < felsorolt', { reportedHoldingsCount: 0 }],
    ['nem egész jelentett szám', { reportedHoldingsCount: 10.5 }],
  ])('%s → VALIDATION', (_name, patch) => {
    const result = createEtfHoldingsSnapshot({
      asOf: '2026-10-31',
      holdings: [holding('A', 0.5)],
      declaredComplete: false,
      provenance,
      ...patch,
    });
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error.kind).toBe('VALIDATION');
  });

  it('negatív súly (short/derivatíva) megengedett', () => {
    const result = createEtfHoldingsSnapshot({
      asOf: '2026-10-31',
      holdings: [holding('Long', 0.6), holding('Long2', 0.41), holding('Swap', -0.01)],
      declaredComplete: true,
      provenance,
    });
    expect(result.ok && result.value.listedWeight).toBeCloseTo(1, 12);
  });
});
