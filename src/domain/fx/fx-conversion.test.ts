import {
  createFxRate,
  createFxRateSet,
  parseCurrencyCode,
  type CurrencyCode,
  type DataProvenance,
  type FxRate,
  type FxRateSet,
  type IsoTimestamp,
} from '@/domain';

import { convertMoney, deriveFxRate } from './fx-conversion';

const c = (code: string): CurrencyCode => {
  const parsed = parseCurrencyCode(code);
  if (!parsed.ok) throw new Error(code);
  return parsed.value;
};
const NOW = '2026-11-21T12:00:00Z' as IsoTimestamp;

const ecb: DataProvenance = {
  sourceId: 'ecb-fx',
  sourceName: 'ECB',
  kind: 'reported',
  fetchedAt: NOW,
  asOf: null,
  freshness: 'UNKNOWN',
};

function rate(quote: string, value: number, asOf = '2026-11-20', provenance = ecb): FxRate {
  const r = createFxRate({ base: c('EUR'), quote: c(quote), rate: value, asOf, provenance });
  if (!r.ok) throw new Error(r.error.message);
  return r.value;
}

function set(rates: FxRate[], missing: string[] = []): FxRateSet {
  const s = createFxRateSet({ base: c('EUR'), rates, missing: missing.map(c) });
  if (!s.ok) throw new Error(s.error.message);
  return s.value;
}

// Valós ECB-ráták a fixture-ből (2026-11-20): 1 EUR = 1,099 USD = 373,55 HUF = 0,83735 GBP.
const ECB_SET = set([rate('USD', 1.099), rate('HUF', 373.55), rate('GBP', 0.83735)]);

describe('deriveFxRate', () => {
  it('közvetlen ráta: változatlan, „reported” marad', () => {
    const r = deriveFxRate(c('EUR'), c('USD'), ECB_SET, NOW);
    expect(r).toMatchObject({ ok: true, value: { rate: 1.099, provenance: { kind: 'reported' } } });
  });

  it('inverz ráta: 1 / ráta, „calculated”, a képlettel', () => {
    const r = deriveFxRate(c('USD'), c('EUR'), ECB_SET, NOW);
    expect(r.ok && r.value.rate).toBeCloseTo(1 / 1.099, 12);
    expect(r.ok && r.value.provenance).toMatchObject({
      kind: 'calculated',
      reference: '1 / (EUR→USD)',
    });
  });

  it('keresztárfolyam EUR-on át: HUF→USD = (EUR→USD)/(EUR→HUF)', () => {
    const r = deriveFxRate(c('HUF'), c('USD'), ECB_SET, NOW);
    expect(r.ok && r.value.rate).toBeCloseTo(1.099 / 373.55, 12);
    expect(r.ok && r.value.provenance).toMatchObject({
      kind: 'calculated',
      sourceId: 'engine',
      inputs: ['EUR/USD@2026-11-20', 'EUR/HUF@2026-11-20'],
    });
  });

  it('eltérő dátumú bemeneteknél a RÉGEBBI dátum az asOf (konzervatív)', () => {
    const mixed = set([rate('USD', 1.1, '2026-11-20'), rate('HUF', 370, '2026-11-18')]);
    const r = deriveFxRate(c('HUF'), c('USD'), mixed, NOW);
    expect(r.ok && r.value.asOf).toBe('2026-11-18');
  });

  it('hiányzó deviza → MISSING_DATA, nem becslés és nem 0', () => {
    const r = deriveFxRate(c('USD'), c('AED'), ECB_SET, NOW);
    expect(r).toMatchObject({
      ok: false,
      error: { kind: 'MISSING_DATA', missing: ['fx:USD/AED'] },
    });
  });

  it('demó bemenetből számolt ráta is „mock” marad (nem mosódik tisztára)', () => {
    const demo = { ...ecb, kind: 'mock' as const, sourceId: 'mock' };
    const demoSet = set([
      rate('USD', 1.1, '2026-11-20', demo),
      rate('HUF', 400, '2026-11-20', demo),
    ]);
    const r = deriveFxRate(c('HUF'), c('USD'), demoSet, NOW);
    expect(r.ok && r.value.provenance.kind).toBe('mock');
  });
});

describe('convertMoney', () => {
  it('megtartja az eredeti összeget és pénznemet, külön a kijelzettet', () => {
    const r = convertMoney({ amount: 100, currency: c('USD') }, c('HUF'), ECB_SET, NOW);
    expect(r.ok && r.value.original).toEqual({ amount: 100, currency: 'USD' });
    expect(r.ok && r.value.converted.currency).toBe('HUF');
    expect(r.ok && r.value.converted.amount).toBeCloseTo((100 / 1.099) * 373.55, 6);
  });

  it('GBX (penny) → GBP explicit /100, ráta nélkül', () => {
    const r = convertMoney({ amount: 12345, currency: c('GBX') }, c('GBP'), ECB_SET, NOW);
    expect(r).toMatchObject({
      ok: true,
      value: { converted: { amount: 123.45, currency: 'GBP' }, rate: null, minorUnitDivisor: 100 },
    });
  });

  it('GBX → EUR: előbb /100, aztán a GBP→EUR inverz ráta', () => {
    const r = convertMoney({ amount: 1000, currency: c('GBX') }, c('EUR'), ECB_SET, NOW);
    expect(r.ok && r.value.converted.amount).toBeCloseTo(10 / 0.83735, 9);
    expect(r.ok && r.value.minorUnitDivisor).toBe(100);
  });

  it('alegység nem lehet kijelzési pénznem', () => {
    const r = convertMoney({ amount: 1, currency: c('GBP') }, c('GBX'), ECB_SET, NOW);
    expect(r).toMatchObject({ ok: false, error: { kind: 'VALIDATION' } });
  });

  it('azonos pénznemnél nincs ráta és nincs változás', () => {
    const r = convertMoney({ amount: 5, currency: c('EUR') }, c('EUR'), ECB_SET, NOW);
    expect(r).toMatchObject({ ok: true, value: { converted: { amount: 5 }, rate: null } });
  });
});

describe('createFxRateSet', () => {
  it('vegyes bázist és ismétlődő rátát elutasít', () => {
    const usdBase = createFxRate({
      base: c('USD'),
      quote: c('HUF'),
      rate: 340,
      asOf: '2026-11-20',
      provenance: ecb,
    });
    if (!usdBase.ok) throw new Error('setup');
    expect(createFxRateSet({ base: c('EUR'), rates: [usdBase.value], missing: [] }).ok).toBe(false);
    expect(
      createFxRateSet({ base: c('EUR'), rates: [rate('USD', 1), rate('USD', 2)], missing: [] }).ok,
    ).toBe(false);
  });
});

describe('parseCurrencyCode – penny-jelölés', () => {
  it('a „GBp” (penny) GBX lesz, NEM GBP (100-szoros hiba elkerülése)', () => {
    expect(parseCurrencyCode('GBp')).toEqual({ ok: true, value: 'GBX' });
    expect(parseCurrencyCode('GBP')).toEqual({ ok: true, value: 'GBP' });
    expect(parseCurrencyCode('gbp')).toEqual({ ok: true, value: 'GBP' });
  });
});
