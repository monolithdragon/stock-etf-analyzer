import {
  ALERT_PLATFORM_LIMITATIONS,
  applyEvaluation,
  evaluateAlertRule,
  validateNewAlertRule,
  type AlertRule,
} from './alerts';
import { metric, okValue, snapshot, T0 } from './testing';

function rule(overrides: Partial<AlertRule> = {}): AlertRule {
  return {
    id: 'alert-1',
    listingId: 'A@XNAS',
    kind: 'stock',
    metric: 'price',
    comparator: 'above',
    threshold: 100,
    currency: 'USD',
    enabled: true,
    createdAt: T0,
    lastState: null,
    lastEvaluatedAt: null,
    lastTriggeredAt: null,
    ...overrides,
  };
}

const price = (value: number, extra = {}) =>
  ({ kind: 'price', price: okValue(value, { currency: 'USD' as never, ...extra }) }) as const;

describe('validateNewAlertRule', () => {
  const base = { listingId: 'A@XNAS', kind: 'stock' as const, comparator: 'above' as const };

  it('érvényes ár-, MOS-, P/E- és TER-szabály', () => {
    expect(
      validateNewAlertRule({ ...base, metric: 'price', threshold: 150, currency: 'USD' }),
    ).toEqual([]);
    expect(validateNewAlertRule({ ...base, metric: 'mosBase', threshold: 0.2 })).toEqual([]);
    expect(validateNewAlertRule({ ...base, metric: 'pe', threshold: 25 })).toEqual([]);
    expect(validateNewAlertRule({ ...base, kind: 'etf', metric: 'ter', threshold: 0.003 })).toEqual(
      [],
    );
  });

  it('típus-hiba: TER részvényre, P/E és MOS ETF-re, ismeretlen típus', () => {
    expect(validateNewAlertRule({ ...base, metric: 'ter', threshold: 0.003 }).join()).toMatch(
      /csak ETF-re/,
    );
    expect(
      validateNewAlertRule({ ...base, kind: 'etf', metric: 'pe', threshold: 20 }).join(),
    ).toMatch(/csak részvényre/);
    expect(
      validateNewAlertRule({ ...base, kind: 'etf', metric: 'mosBase', threshold: 0.2 }).join(),
    ).toMatch(/csak részvényre/);
    expect(
      validateNewAlertRule({
        ...base,
        kind: 'unknown',
        metric: 'price',
        threshold: 1,
        currency: 'USD',
      }).join(),
    ).toMatch(/Ismeretlen típusú/);
  });

  it('küszöb-hibák: nem szám, tartományon kívül (TER százalékban), 0 ár, hiányzó pénznem', () => {
    expect(validateNewAlertRule({ ...base, metric: 'pe', threshold: Number.NaN }).join()).toMatch(
      /nem szám/,
    );
    expect(
      validateNewAlertRule({ ...base, kind: 'etf', metric: 'ter', threshold: 0.3 }).join(),
    ).toMatch(/tartományon kívül/);
    expect(
      validateNewAlertRule({ ...base, metric: 'price', threshold: 0, currency: 'USD' }).join(),
    ).toMatch(/pozitív/);
    expect(validateNewAlertRule({ ...base, metric: 'price', threshold: 10 }).join()).toMatch(
      /pénzneme/,
    );
  });
});

describe('evaluateAlertRule', () => {
  it('ár felett / alatt; a határérték NEM teljesül (szigorú reláció)', () => {
    expect(evaluateAlertRule(rule(), price(101), T0).status).toBe('TRIGGERED');
    expect(evaluateAlertRule(rule(), price(100), T0).status).toBe('NOT_TRIGGERED');
    expect(evaluateAlertRule(rule({ comparator: 'below' }), price(99), T0).status).toBe(
      'TRIGGERED',
    );
  });

  it('MOS és P/E a pillanatképből; TER ETF-nél', () => {
    const s = snapshot('A@XNAS', 'stock', {
      metrics: [metric('mosBase', okValue(0.25)), metric('pe', okValue(30), 'multiple')],
    });
    const subject = { kind: 'snapshot', snapshot: s } as const;
    expect(
      evaluateAlertRule(rule({ metric: 'mosBase', threshold: 0.2, currency: null }), subject, T0)
        .status,
    ).toBe('TRIGGERED');
    expect(
      evaluateAlertRule(
        rule({ metric: 'pe', comparator: 'below', threshold: 20, currency: null }),
        subject,
        T0,
      ).status,
    ).toBe('NOT_TRIGGERED');
    const e = snapshot('E@XETR', 'etf', { metrics: [metric('ter', okValue(0.0012))] });
    expect(
      evaluateAlertRule(
        rule({ kind: 'etf', metric: 'ter', comparator: 'below', threshold: 0.002, currency: null }),
        { kind: 'snapshot', snapshot: e },
        T0,
      ).status,
    ).toBe('TRIGGERED');
  });

  it('hiányzó mutató vagy betöltési hiba → NOT_EVALUABLE az okkal (nem 0)', () => {
    const s = snapshot('A@XNAS', 'stock');
    const r = evaluateAlertRule(
      rule({ metric: 'pe', currency: null }),
      { kind: 'snapshot', snapshot: s },
      T0,
    );
    expect(r.status).toBe('NOT_EVALUABLE');
    expect(r.reason).toMatch(/pe mutató nem szerepel/);
    expect(evaluateAlertRule(rule(), { kind: 'error', reason: 'kvóta' }, T0)).toMatchObject({
      status: 'NOT_EVALUABLE',
      reason: 'kvóta',
    });
  });

  it('eltérő pénznemű ár → NOT_EVALUABLE (átváltva nem riasztunk)', () => {
    const r = evaluateAlertRule(rule({ currency: 'EUR' }), price(500), T0);
    expect(r.status).toBe('NOT_EVALUABLE');
    expect(r.reason).toMatch(/pénzneme/);
  });

  it('elavult / offline adat: kiértékel, de jelöli', () => {
    const stale = evaluateAlertRule(rule(), price(200, { freshness: 'STALE' }), T0);
    expect(stale).toMatchObject({ status: 'TRIGGERED', stale: true });
    const offline = evaluateAlertRule(
      rule(),
      price(200, { cache: { mode: 'offline_fallback', storedAt: T0 } }),
      T0,
    );
    expect(offline.stale).toBe(true);
  });

  it('élváltás: csak az első teljesüléskor „újonnan teljesült”; adathiány nem nullázza', () => {
    const first = evaluateAlertRule(rule(), price(150), T0);
    expect(first.newlyTriggered).toBe(true);
    const after = applyEvaluation(rule(), first);
    expect(after).toMatchObject({
      lastState: 'TRIGGERED',
      lastTriggeredAt: T0,
      lastEvaluatedAt: T0,
    });
    expect(evaluateAlertRule(after, price(160), T0).newlyTriggered).toBe(false);
    const gap = evaluateAlertRule(after, { kind: 'error', reason: 'x' }, T0);
    const afterGap = applyEvaluation(after, gap);
    expect(afterGap.lastState).toBe('TRIGGERED');
    expect(evaluateAlertRule(afterGap, price(170), T0).newlyTriggered).toBe(false);
    const reset = applyEvaluation(afterGap, evaluateAlertRule(afterGap, price(90), T0));
    expect(evaluateAlertRule(reset, price(150), T0).newlyTriggered).toBe(true);
  });

  it('a platformkorlátok dokumentálják: nincs push, nincs háttér-ellenőrzés', () => {
    const text = ALERT_PLATFORM_LIMITATIONS.join(' ');
    expect(text).toMatch(/Nincs push/);
    expect(text).toMatch(/Expo Go/);
    expect(text).toMatch(/development build/);
  });
});
