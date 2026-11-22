/**
 * PHASE 10 – determinisztikus döntési engine, confidence és thesis (kiinduló részvény-konfiguráció).
 *
 * A `stockFeatures(level)` minden mutatót a horgonyai közé helyez úgy, hogy a mutatópont pontosan
 * `100 × level` legyen → a dimenzió- és összpontszám célzottan beállítható a határokra.
 */
import { evaluateScoring, type ScoringOutcome } from './evaluate';
import {
  DEFAULT_STOCK_DECISION_CONFIG as DECISION,
  DEFAULT_STOCK_SCORE_CONFIG as SCORE,
  type DecisionConfig,
  type ScoringFeature,
  type ScoringInput,
} from './index';
import { missing, num, stockFeatures, stockInput } from './testing';

function run(input: ScoringInput, decision: DecisionConfig = DECISION): ScoringOutcome {
  const result = evaluateScoring(input, SCORE, decision);
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}

const label = (features: ScoringFeature[], flags: ScoringInput['flags'] = {}) =>
  run(stockInput(features, flags)).decision.label;

describe('döntési szabályok – címkék és határértékek', () => {
  it('Strong Buy: minden dimenzió erős ÉS DCF-diszkont', () => {
    const out = run(stockInput(stockFeatures(0.8), { mosDiscount: true, mosPremium: false }));
    expect(out.score.totalScore).toBe(80);
    expect(out.confidence.level).toBe('HIGH');
    expect(out.decision).toMatchObject({ label: 'STRONG_BUY', matchedRuleId: 'stock-strong-buy' });
    expect(out.decision.labelText).toBe('Strong Buy');
  });

  it('ismeretlen DCF-jelzés (null) nem „igen”: a Strong Buy UNKNOWN → Buy', () => {
    const out = run(stockInput(stockFeatures(0.8), { mosDiscount: null }));
    expect(out.decision.label).toBe('BUY');
    const strong = out.decision.ruleTrace[0];
    expect(strong?.conditions.find((c) => c.condition.kind === 'flag')?.outcome).toBe('UNKNOWN');
  });

  it('nem csak az összpontszám dönt: magas összpont, de gyenge értékelés → Watch', () => {
    const out = run(stockInput(stockFeatures(0.8, { VALUATION: 0.3 })));
    expect(out.score.totalScore).toBe(67.5); // (75 × 80 + 25 × 30) / 100
    expect(out.decision.label).toBe('WATCH');
  });

  it('nem csak az összpontszám dönt: jó összpont, de gyenge mérleg → nem Buy', () => {
    const out = run(stockInput(stockFeatures(0.75, { BALANCE_SHEET: 0.35 })));
    expect(out.score.totalScore).toBeGreaterThanOrEqual(65);
    expect(out.decision.label).not.toBe('BUY');
  });

  it.each([
    [0.65, 'BUY'], // pontosan a határon: ≥ 65
    [0.649, 'HOLD'], // 64,9 → Buy nem, Watch nem (értékelés ≥ 50)
    [0.45, 'HOLD'],
    [0.449, 'REDUCE'],
    [0.35, 'REDUCE'],
    [0.349, 'SELL'],
    [0.25, 'SELL'],
    [0.249, 'STRONG_SELL'],
    [0, 'STRONG_SELL'],
  ])('egyenletes %p szint → %s', (level, expected) => {
    expect(label(stockFeatures(level))).toBe(expected);
  });

  it('Strong Sell feltétele a gyenge mérleg is: erős mérleggel csak Sell', () => {
    expect(label(stockFeatures(0.2, { BALANCE_SHEET: 0.9 }))).toBe('SELL');
  });

  it('a szabálynyom tartalmazza az összes kiértékelt szabályt az illeszkedőig', () => {
    const out = run(stockInput(stockFeatures(0.5)));
    expect(out.decision.ruleTrace.map((r) => [r.ruleId, r.matched])).toEqual([
      ['stock-strong-buy', false],
      ['stock-buy', false],
      ['stock-watch', false],
      ['stock-hold', true],
    ]);
    expect(out.decision.drivers.join('\n')).toContain('Illeszkedő szabály: stock-hold');
  });
});

describe('plafonok', () => {
  it('DCF-prémium → legfeljebb Hold', () => {
    const out = run(stockInput(stockFeatures(0.8), { mosDiscount: false, mosPremium: true }));
    expect(out.decision.baseLabel).toBe('BUY');
    expect(out.decision.label).toBe('HOLD');
    expect(out.decision.appliedCaps.map((c) => c.capId)).toEqual(['cap-dcf-premium']);
  });

  it('nagyon magas béta (kockázati pont < 25) → legfeljebb Watch', () => {
    const out = run(stockInput(stockFeatures(0.8, { RISK: 0.1 }), { mosDiscount: true }));
    expect(out.decision.label).toBe('WATCH');
  });

  it('portfólió-túlsúly > 10% → legfeljebb Hold; pontosan 10% → nincs plafon', () => {
    const base = stockFeatures(0.8);
    expect(label([...base, num('portfolioWeight', 0.15)])).toBe('HOLD');
    expect(label([...base, num('portfolioWeight', 0.1)])).toBe('BUY');
  });

  it('demóadat → confidence legfeljebb LOW → legfeljebb Watch', () => {
    const mock = stockFeatures(0.8).map((f) =>
      f.kind === 'numeric' && f.value.status === 'OK'
        ? {
            ...f,
            value: { ...f.value, provenance: { ...f.value.provenance, kind: 'mock' as const } },
          }
        : f,
    );
    const out = run(stockInput(mock, { mosDiscount: true }));
    expect(out.confidence.level).toBe('LOW');
    expect(out.decision.label).toBe('WATCH');
    expect(out.thesis.risks.map((r) => r.id)).toContain('data-mock');
  });

  it('a plafon nem emel: Sell címke DCF-prémiummal is Sell marad', () => {
    expect(label(stockFeatures(0.3), { mosPremium: true })).toBe('SELL');
  });
});

describe('hiányzó adat a döntésben', () => {
  it('elégtelen adat → NOT_RATED, a szabályok nem futnak, a hiány nem 0', () => {
    const out = run(stockInput([num('roic', 0.2), num('grossMargin', 0.6)]));
    expect(out.score.totalScore).toBeNull();
    expect(out.confidence.level).toBe('INSUFFICIENT');
    expect(out.decision).toMatchObject({ label: 'NOT_RATED', ruleTrace: [], matchedRuleId: null });
    expect(out.decision.labelText).toBe('Nem értékelhető');
    expect(out.thesis.invalidation).toEqual([]);
  });

  it('hiányzó értékelés: a Buy-szabály UNKNOWN → óvatosabb címke, confidence nem HIGH', () => {
    const features = stockFeatures(0.9).map((f) =>
      ['pe', 'pfcf', 'evToEbitda', 'fcfYield', 'ps'].includes(f.id) ? missing(f.id) : f,
    );
    const out = run(stockInput(features));
    expect(out.score.totalScore).toBe(90);
    expect(out.score.totalStatus).toBe('PARTIAL');
    expect(out.confidence.level).toBe('MEDIUM'); // 0,75 lefedettség → 75 < 80
    expect(out.decision.label).toBe('HOLD');
    expect(out.decision.dimensions.find((d) => d.id === 'valuation')?.score).toBeNull();
  });

  it('a confidence az adatteljességet méri, és ezt ki is mondja', () => {
    const out = run(stockInput(stockFeatures(0.8)));
    expect(out.confidence.meaning).toContain('NEM a jövőbeli hozam valószínűsége');
    expect(out.confidence.score).toBe(100);
  });
});

describe('thesis risks és érvénytelenítés', () => {
  it('pozitív álláspont: a még nem teljesülő kockázati szabályok érvénytelenítők', () => {
    const out = run(stockInput(stockFeatures(0.8), { mosDiscount: true, mosPremium: false }));
    expect(out.thesis.stance).toBe('positive');
    const ids = out.thesis.invalidation.map((i) => i.id);
    expect(ids).toEqual(
      expect.arrayContaining([
        'rule-stock-strong-buy-quality-min',
        'rule-stock-strong-buy-mosDiscount',
        'risk-stock-net-loss',
        'risk-stock-negative-fcf',
        'risk-stock-dcf-premium',
      ]),
    );
    const quality = out.thesis.invalidation.find(
      (i) => i.id === 'rule-stock-strong-buy-quality-min',
    );
    expect(quality).toMatchObject({ comparator: 'lt', threshold: 70, currentValue: 80 });
  });

  it('negatív álláspont: a teljesülő kockázatok, ha megszűnnek', () => {
    const features = stockFeatures(0.1).map((f) =>
      f.id === 'netMargin'
        ? num('netMargin', -0.05)
        : f.id === 'fcfMargin'
          ? num('fcfMargin', -0.02)
          : f,
    );
    const out = run(stockInput(features));
    expect(out.thesis.stance).toBe('negative');
    expect(out.thesis.risks.map((r) => r.id)).toEqual(
      expect.arrayContaining(['stock-net-loss', 'stock-negative-fcf']),
    );
    const loss = out.thesis.risks.find((r) => r.id === 'stock-net-loss');
    expect(loss?.evidence).toEqual({
      featureId: 'netMargin',
      flag: null,
      value: -0.05,
      comparator: 'lt',
      threshold: 0,
    });
    expect(
      out.thesis.invalidation.find((i) => i.id === 'risk-stock-net-loss')?.statement,
    ).toContain('pozitívba fordul');
  });

  it('alkalmazott plafon → érvénytelenítő: ha megszűnik, a címke visszaállhat', () => {
    const out = run(stockInput(stockFeatures(0.8), { mosPremium: true }));
    const cap = out.thesis.invalidation.find((i) => i.id === 'cap-cap-dcf-premium');
    expect(cap?.statement).toContain('HOLD → BUY');
  });

  it('adathiányos nagy súlyú kategória → adat-kockázat', () => {
    const features = stockFeatures(0.8).filter(
      (f) => !['fcfMargin', 'fcfConversion'].includes(f.id),
    );
    const out = run(stockInput(features));
    expect(out.thesis.risks.map((r) => r.id)).toContain('data-gap-CASH_FLOW');
  });
});

describe('konfigurálhatóság', () => {
  it('a címkék szövege konfigurálható, a kulcs és a logika változatlan', () => {
    const custom: DecisionConfig = {
      ...DECISION,
      labels: { ...DECISION.labels, BUY: { text: 'Vételi kategória', description: 'x' } },
    };
    const out = run(stockInput(stockFeatures(0.8)), custom);
    expect(out.decision).toMatchObject({ label: 'BUY', labelText: 'Vételi kategória' });
  });

  it('a küszöbök konfigurálhatók: szigorúbb Buy-szabállyal ugyanaz a bemenet Hold', () => {
    const strict: DecisionConfig = {
      ...DECISION,
      rules: DECISION.rules.map((r) =>
        r.id === 'stock-buy' ? { ...r, all: [...r.all, { kind: 'total', min: 85 }] } : r,
      ),
    };
    expect(run(stockInput(stockFeatures(0.8)), strict).decision.label).toBe('HOLD');
  });
});

describe('determinizmus – ugyanaz a bemenet mindig ugyanazt adja', () => {
  const input = stockInput(
    stockFeatures(0.73, { VALUATION: 0.41, GROWTH: 0.92 }).map((f) =>
      f.id === 'fcfCagr3y' ? missing('fcfCagr3y') : f,
    ),
    { mosDiscount: false, mosPremium: false, bearMosNegative: true },
  );

  it('ismételt futás: mélyen egyenlő kimenet (100×)', () => {
    const first = run(input);
    for (let i = 0; i < 100; i += 1) expect(run(input)).toEqual(first);
  });

  it('a bemenetet nem módosítja (mélyen fagyasztott bemenet)', () => {
    const deepFreeze = <T>(value: T): T => {
      if (value !== null && typeof value === 'object') {
        Object.values(value).forEach(deepFreeze);
        Object.freeze(value);
      }
      return value;
    };
    const frozen = deepFreeze(structuredClone(input));
    expect(() => run(frozen)).not.toThrow();
    expect(frozen).toEqual(input);
  });

  it('a feature-ek sorrendje nem számít', () => {
    const reversed = { ...input, features: [...input.features].reverse() };
    expect(run(reversed)).toEqual(run(input));
  });

  it('duplikált feature-azonosító → VALIDATION (különben a sorrend döntene)', () => {
    const result = evaluateScoring(
      stockInput([...stockFeatures(0.5), num('pe', 10)]),
      SCORE,
      DECISION,
    );
    expect(result.ok).toBe(false);
    if (!result.ok && result.error.kind === 'VALIDATION') {
      expect(result.error.issues).toEqual([{ path: 'features.pe', message: 'Többször szerepel.' }]);
    }
  });

  it('a kimenet JSON-ban oda-vissza alakítható (nincs függvény, Date vagy undefined érték)', () => {
    const out = run(input);
    expect(JSON.parse(JSON.stringify(out))).toEqual(out);
  });
});
