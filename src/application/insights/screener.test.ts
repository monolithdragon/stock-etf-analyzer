import {
  runScreener,
  SCREENER_CATEGORIES,
  SCREENER_FIELDS,
  SCREENER_PRESETS,
  validateScreenerQuery,
  type ScreenerQuery,
} from './screener';
import { metric, missing, okValue, snapshot } from './testing';

describe('validateScreenerQuery – érvénytelen szűrők', () => {
  const messages = (q: ScreenerQuery) =>
    validateScreenerQuery(q)
      .map((i) => i.message)
      .join(' | ');

  it('üres feltétellista', () => {
    expect(messages({ universe: 'stock', criteria: [] })).toMatch(/legalább egy/);
  });

  it('ismeretlen mező, rossz típus, nem szám, tartományon kívül', () => {
    expect(
      messages({ universe: 'stock', criteria: [{ fieldId: 'xyz', operator: 'gte', value: 1 }] }),
    ).toMatch(/Ismeretlen/);
    expect(
      messages({
        universe: 'stock',
        criteria: [{ fieldId: 'ter', operator: 'lte', value: 0.002 }],
      }),
    ).toMatch(/csak ETF-re/);
    expect(
      messages({
        universe: 'etf',
        criteria: [{ fieldId: 'ter', operator: 'lte', value: Number.NaN }],
      }),
    ).toMatch(/nem szám/);
    // 0,2% helyett 20 (százalék a tört helyett) → tartományon kívül
    expect(
      messages({ universe: 'etf', criteria: [{ fieldId: 'ter', operator: 'lte', value: 20 }] }),
    ).toMatch(/tartományon kívül/);
  });

  it('pénzösszeg-mezőhöz pénznem kell', () => {
    expect(
      messages({ universe: 'etf', criteria: [{ fieldId: 'aum', operator: 'gte', value: 1e9 }] }),
    ).toMatch(/pénznem/);
    expect(
      validateScreenerQuery({
        universe: 'etf',
        criteria: [{ fieldId: 'aum', operator: 'gte', value: 1e9, currency: 'EUR' }],
      }),
    ).toEqual([]);
  });

  it('duplikált és ellentmondó feltétel', () => {
    expect(
      messages({
        universe: 'stock',
        criteria: [
          { fieldId: 'pe', operator: 'lte', value: 20 },
          { fieldId: 'pe', operator: 'lte', value: 15 },
        ],
      }),
    ).toMatch(/már szerepel/);
    expect(
      messages({
        universe: 'stock',
        criteria: [
          { fieldId: 'pe', operator: 'gte', value: 30 },
          { fieldId: 'pe', operator: 'lte', value: 10 },
        ],
      }),
    ).toMatch(/Ellentmondó/);
  });

  it('minden kiinduló szűrő érvényes; minden kategóriának van mezője', () => {
    for (const preset of SCREENER_PRESETS) expect(validateScreenerQuery(preset.query)).toEqual([]);
    for (const category of SCREENER_CATEGORIES) {
      expect(SCREENER_FIELDS.some((f) => f.category === category)).toBe(true);
    }
  });
});

describe('runScreener', () => {
  const query: ScreenerQuery = {
    universe: 'stock',
    criteria: [
      { fieldId: 'pe', operator: 'lte', value: 20 },
      { fieldId: 'roic', operator: 'gte', value: 0.15 },
    ],
  };

  it('találat / nem felel meg / nem értékelhető szétválasztva, bizonyítékkal', () => {
    const pass = snapshot('P@XNAS', 'stock', {
      metrics: [
        metric('pe', okValue(12, { sourceName: 'SEC EDGAR' }), 'multiple'),
        metric('roic', okValue(0.2)),
      ],
    });
    const fail = snapshot('F@XNAS', 'stock', {
      metrics: [metric('pe', okValue(40), 'multiple'), metric('roic', okValue(0.3))],
    });
    const gap = snapshot('G@XNAS', 'stock', {
      metrics: [metric('pe', okValue(10), 'multiple'), metric('roic', missing('nincs NOPAT'))],
    });
    const r = runScreener(query, [pass, fail, gap]);
    expect(r.matches.map((m) => m.listingId)).toEqual(['P@XNAS']);
    expect(r.failed.map((m) => m.listingId)).toEqual(['F@XNAS']);
    expect(r.notEvaluable.map((m) => m.listingId)).toEqual(['G@XNAS']);
    // Visszavezethetőség: a használt érték provenance-szel
    const evidence = r.matches[0]!.evidence[0]!;
    expect(evidence.status).toBe('PASS');
    expect(evidence.value.status === 'OK' && evidence.value.provenance.sourceName).toBe(
      'SEC EDGAR',
    );
    // Hiány: ok megmarad, nem 0
    expect(r.notEvaluable[0]!.evidence[1]).toMatchObject({
      status: 'NOT_EVALUABLE',
      reason: 'nincs NOPAT',
    });
  });

  it('a határérték teljesül (≥ / ≤ zárt)', () => {
    const edge = snapshot('E@XNAS', 'stock', {
      metrics: [metric('pe', okValue(20), 'multiple'), metric('roic', okValue(0.15))],
    });
    expect(runScreener(query, [edge]).matches).toHaveLength(1);
  });

  it('más típus kimarad okkal; elavult adat jelölve', () => {
    const etf = snapshot('E@XETR', 'etf');
    const stale = snapshot('S@XNAS', 'stock', {
      metrics: [
        metric('pe', okValue(10, { freshness: 'STALE' }), 'multiple'),
        metric('roic', okValue(0.2)),
      ],
    });
    const r = runScreener(query, [etf, stale]);
    expect(r.skipped).toEqual([{ listingId: 'E@XETR', reason: 'ETF (részvényszűrő fut).' }]);
    expect(r.matches[0]?.usesStaleData).toBe(true);
  });

  it('AUM: eltérő pénznem → nem értékelhető (átváltás nélkül nem szűr)', () => {
    const q: ScreenerQuery = {
      universe: 'etf',
      criteria: [{ fieldId: 'aum', operator: 'gte', value: 1e9, currency: 'EUR' }],
    };
    const usd = snapshot('U@XNAS', 'etf', {
      metrics: [metric('aum', okValue(5e9, { currency: 'USD' as never }), 'money')],
    });
    const eur = snapshot('E@XETR', 'etf', {
      metrics: [metric('aum', okValue(5e9, { currency: 'EUR' as never }), 'money')],
    });
    const r = runScreener(q, [usd, eur]);
    expect(r.matches.map((m) => m.listingId)).toEqual(['E@XETR']);
    expect(r.notEvaluable[0]?.evidence[0]?.reason).toMatch(/Eltérő pénznem/);
  });

  it('érvénytelen lekérdezés → nincs találat', () => {
    const r = runScreener({ universe: 'stock', criteria: [] }, [snapshot('A@XNAS', 'stock')]);
    expect(r.matches).toEqual([]);
    expect(r.failed).toEqual([]);
  });
});
