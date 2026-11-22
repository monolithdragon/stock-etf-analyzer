import { currencyRisk, deriveRegion, regionOfCountry } from './exposure';

describe('regionOfCountry', () => {
  it.each([
    ['US', 'US'],
    ['JP', 'JAPAN'],
    ['DE', 'EUROPE'],
    ['CN', 'EMERGING'],
    ['HU', 'EMERGING'],
    ['CA', 'OTHER'],
  ])('%s → %s', (country, region) => {
    expect(regionOfCountry(country)).toBe(region);
  });
});

describe('deriveRegion', () => {
  it('domináns régió (≥ 80%)', () => {
    const result = deriveRegion([
      { key: 'US', weight: 0.95 },
      { key: 'GB', weight: 0.03 },
    ]);
    expect(result.status === 'OK' && result.value.region).toBe('US');
  });

  it('pontosan 80% (lebegőpontos összegből) is domináns', () => {
    const groups = [
      ...Array.from({ length: 8 }, () => ({ key: 'US', weight: 0.1 })),
      { key: 'JP', weight: 0.2 },
    ];
    // a csoportosítás után US = 0.1 × 8 = 0.7999999999999999
    const us = groups.filter((g) => g.key === 'US').reduce((sum, g) => sum + g.weight, 0);
    const result = deriveRegion([
      { key: 'US', weight: us },
      { key: 'JP', weight: 0.2 },
    ]);
    expect(result.status === 'OK' && result.value.region).toBe('US');
  });

  it('világ-ETF → GLOBAL (USA ≥ 5% és legalább 3 régió ≥ 5%)', () => {
    const result = deriveRegion([
      { key: 'US', weight: 0.62 },
      { key: 'JP', weight: 0.06 },
      { key: 'GB', weight: 0.04 },
      { key: 'FR', weight: 0.03 },
      { key: 'CN', weight: 0.03 },
      { key: 'TW', weight: 0.03 },
      { key: 'CA', weight: 0.03 },
    ]);
    expect(result.status === 'OK' && result.value.region).toBe('GLOBAL');
  });

  it('fejlett ex-US → OTHER (nincs USA)', () => {
    const result = deriveRegion([
      { key: 'JP', weight: 0.3 },
      { key: 'GB', weight: 0.3 },
      { key: 'CA', weight: 0.3 },
    ]);
    expect(result.status === 'OK' && result.value.region).toBe('OTHER');
  });

  it('feltörekvő piacok → EMERGING; kevés ismert súly → INSUFFICIENT_DATA', () => {
    const em = deriveRegion([
      { key: 'CN', weight: 0.3 },
      { key: 'IN', weight: 0.2 },
      { key: 'TW', weight: 0.2 },
      { key: 'KR', weight: 0.1 },
    ]);
    expect(em.status === 'OK' && em.value.region).toBe('EMERGING');
    expect(deriveRegion([{ key: 'US', weight: 0.3 }]).status).toBe('INSUFFICIENT_DATA');
  });
});

describe('currencyRisk', () => {
  const exposures = [
    { key: 'USD', weight: 0.6 },
    { key: 'EUR', weight: 0.2 },
    { key: 'JPY', weight: 0.1 },
  ];

  it('fedezetlen: a befektetői devizától eltérő mögöttes kitettség aránya (normalizálva)', () => {
    const result = currencyRisk({ exposures, investorCurrency: 'EUR', hedgedTo: null });
    expect(result.status).toBe('OK');
    if (result.status === 'OK') {
      expect(result.value.unhedgedForeignShare).toBeCloseTo(0.7 / 0.9, 12);
      expect(result.value.effectiveExposure[0]?.key).toBe('USD');
    }
  });

  it('EUR-ra fedezett osztály EUR befektetőnek → 0; HUF befektetőnek → 1', () => {
    const eur = currencyRisk({ exposures, investorCurrency: 'EUR', hedgedTo: 'EUR' });
    expect(eur.status === 'OK' && eur.value.unhedgedForeignShare).toBe(0);
    expect(eur.status === 'OK' && eur.notes.join(' ')).toContain('feltevés');
    const huf = currencyRisk({ exposures: [], investorCurrency: 'HUF', hedgedTo: 'EUR' });
    expect(huf.status === 'OK' && huf.value.unhedgedForeignShare).toBe(1);
  });

  it('nincs ismert kitettség → INSUFFICIENT_DATA; negatív súly → INVALID_INPUT', () => {
    expect(currencyRisk({ exposures: [], investorCurrency: 'EUR', hedgedTo: null }).status).toBe(
      'INSUFFICIENT_DATA',
    );
    expect(
      currencyRisk({
        exposures: [{ key: 'USD', weight: -1 }],
        investorCurrency: 'EUR',
        hedgedTo: null,
      }).status,
    ).toBe('INVALID_INPUT');
  });
});
