import { exposureBreakdown, holdingsConcentration, topNWeight } from './holdings';

describe('topNWeight', () => {
  const weights = [0.05, 0.2, 0.1, 0.15, 0.03, 0.02];

  it('a legnagyobb N pozitív súly összege (rendezetlen bemenetből)', () => {
    const result = topNWeight({ weights, n: 3, isComplete: true });
    expect(result.status === 'OK' && result.value).toBeCloseTo(0.45, 12);
  });

  it('teljes lista N-nél kevesebb pozícióval → OK az összes súllyal, megjegyzéssel', () => {
    const result = topNWeight({ weights: [0.6, 0.4], n: 5, isComplete: true });
    expect(result).toEqual(expect.objectContaining({ status: 'OK', value: 1 }));
    expect(result.status === 'OK' && result.notes.join(' ')).toContain('csak 2 pozíciója');
  });

  it('részleges lista: elég tétel → OK feltevéssel; kevés tétel → INSUFFICIENT_DATA', () => {
    const ok = topNWeight({ weights, n: 5, isComplete: false });
    expect(ok.status).toBe('OK');
    expect(ok.status === 'OK' && ok.notes.join(' ')).toContain('legnagyobb pozíciókat');
    expect(topNWeight({ weights, n: 20, isComplete: false }).status).toBe('INSUFFICIENT_DATA');
  });

  it('negatív súly kimarad (megjegyzéssel); érvénytelen bemenet', () => {
    const result = topNWeight({ weights: [0.5, -0.1, 0.3], n: 2, isComplete: true });
    expect(result.status === 'OK' && result.value).toBeCloseTo(0.8, 12);
    expect(result.status === 'OK' && result.notes.join(' ')).toContain('negatív');
    expect(topNWeight({ weights: [5, 3], n: 1, isComplete: true }).status).toBe('INVALID_INPUT');
    expect(topNWeight({ weights: [0.5], n: 0, isComplete: true }).status).toBe('INVALID_INPUT');
    expect(topNWeight({ weights: [-0.5], n: 1, isComplete: true }).status).toBe(
      'INSUFFICIENT_DATA',
    );
  });
});

describe('holdingsConcentration', () => {
  it('egyenlő súly: HHI = 1/N, effektív N = N', () => {
    const result = holdingsConcentration({ weights: [0.25, 0.25, 0.25, 0.25], isComplete: true });
    expect(result.status).toBe('OK');
    if (result.status === 'OK') {
      expect(result.value.herfindahl).toBeCloseTo(0.25, 12);
      expect(result.value.effectiveHoldings).toBeCloseTo(4, 12);
    }
  });

  it('normalizál a pozitív súlyok összegére (pl. 98% lefedettség)', () => {
    // 0.49 / 0.49 → normalizálva 0.5 / 0.5 → HHI 0.5
    const result = holdingsConcentration({ weights: [0.49, 0.49, -0.02], isComplete: true });
    expect(result.status === 'OK' && result.value.herfindahl).toBeCloseTo(0.5, 12);
  });

  it('részleges lista → INSUFFICIENT_DATA (alulbecsült volna); nincs pozitív súly', () => {
    expect(holdingsConcentration({ weights: [0.3, 0.2], isComplete: false }).status).toBe(
      'INSUFFICIENT_DATA',
    );
    expect(holdingsConcentration({ weights: [-0.3], isComplete: true }).status).toBe(
      'INSUFFICIENT_DATA',
    );
    expect(holdingsConcentration({ weights: [Number.NaN], isComplete: true }).status).toBe(
      'INVALID_INPUT',
    );
  });
});

describe('exposureBreakdown', () => {
  it('csoportosít, csökkenő sorrend; null kulcs → unclassified; hiányzó rész → uncovered', () => {
    const result = exposureBreakdown([
      { key: 'US', weight: 0.4 },
      { key: 'JP', weight: 0.1 },
      { key: 'US', weight: 0.2 },
      { key: null, weight: 0.05 },
    ]);
    expect(result.status).toBe('OK');
    if (result.status === 'OK') {
      expect(result.value.groups).toEqual([
        { key: 'US', weight: expect.closeTo(0.6, 12) },
        { key: 'JP', weight: 0.1 },
      ]);
      expect(result.value.unclassifiedWeight).toBeCloseTo(0.05, 12);
      expect(result.value.uncoveredWeight).toBeCloseTo(0.25, 12);
      expect(result.notes.length).toBe(2);
    }
  });

  it('üres lista → INSUFFICIENT_DATA; rossz súly → INVALID_INPUT; teljes lefedettség → nincs megjegyzés', () => {
    expect(exposureBreakdown([]).status).toBe('INSUFFICIENT_DATA');
    expect(exposureBreakdown([{ key: 'US', weight: 40 }]).status).toBe('INVALID_INPUT');
    const full = exposureBreakdown([
      { key: 'A', weight: 0.5 },
      { key: 'B', weight: 0.5 },
    ]);
    expect(full.status === 'OK' && full.notes).toEqual([]);
  });
});
