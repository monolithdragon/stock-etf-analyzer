/**
 * PHASE 10 integráció és regresszió: részvény-score + döntés VALÓS SEC- és FMP-fixture-ökön.
 *
 *   fixture → [hamis gateway] → analyzeStockFundamentals (06) → buildStockValuation (07)
 *           → buildStockEvaluation (10)
 *
 * A golden értékek a 2026-11-22-i kiinduló konfigurációval (`stock-default` 2026-11-22.1)
 * rögzítettek. Konfigurációváltozásnál ezek SZÁNDÉKOSAN pirosak lesznek – a változást a
 * DECISIONS-ben kell dokumentálni, és itt frissíteni.
 */
import {
  buildStockEvaluation,
  createAnalyzeStockValuation,
  createEvaluateStock,
  createRecalculateStockValuation,
  stockPriceInvalidation,
  type InstrumentEvaluation,
} from '@/application';
import { DEFAULT_STOCK_SCORE_CONFIG } from '@/scoring';
import { analyze, analyzerFor, clock, gatewayFor } from '@/testing/stock-analysis-fixtures';

const recalculate = createRecalculateStockValuation({ clock });

async function evaluate(ticker: string, withMarket = true) {
  const fundamentals = await analyze(ticker, withMarket);
  const valuation = recalculate(fundamentals);
  const result = buildStockEvaluation(fundamentals, valuation);
  if (!result.ok) throw new Error(result.error.message);
  return { fundamentals, valuation, evaluation: result.value };
}

const categories = (e: InstrumentEvaluation) =>
  e.score.categories.map((c) => [c.id, c.status, c.score]);

describe('regresszió – valós fixture-ök (golden)', () => {
  it('AAPL: erős minőség, drága értékelés → alapszabály Watch, DCF-prémium plafon → Hold', async () => {
    const { evaluation, valuation } = await evaluate('AAPL');
    expect(categories(evaluation)).toEqual([
      ['BUSINESS_QUALITY', 'SCORED', 88.8],
      ['GROWTH', 'SCORED', 72.5],
      ['PROFITABILITY', 'SCORED', 100],
      ['BALANCE_SHEET', 'SCORED', 87.4],
      ['CASH_FLOW', 'SCORED', 87.8],
      ['MOAT', 'NOT_SCORED', null],
      ['MANAGEMENT', 'SCORED', 100],
      ['VALUATION', 'SCORED', 5.8],
    ]);
    expect(evaluation.score.totalScore).toBe(67.5);
    expect(evaluation.confidence).toMatchObject({ level: 'HIGH', score: 93.8 });
    expect(evaluation.decision).toMatchObject({
      baseLabel: 'WATCH',
      label: 'HOLD',
      matchedRuleId: 'stock-watch',
    });
    expect(evaluation.decision.appliedCaps.map((c) => c.capId)).toEqual(['cap-dcf-premium']);
    expect(evaluation.thesis.risks.map((r) => r.id)).toEqual([
      'stock-rich-pe',
      'stock-dcf-premium',
      'stock-bear-case',
      'data-stale',
    ]);

    // Árszint-feltétel: P = IV_base × (1 − premiumBelow), a PHASE 07 küszöbével, 3 értékes jegy.
    const base = valuation.dcf.scenarios.find((s) => s.id === 'base');
    if (base?.result.status !== 'OK') throw new Error('base');
    const expected = Number(
      (
        base.result.value.intrinsicValuePerShare *
        (1 - valuation.thresholds.marginOfSafety.premiumBelow)
      ).toPrecision(3),
    );
    const trigger = evaluation.thesis.invalidation.find(
      (i) => i.id === 'price-lifts-dcf-premium-cap',
    );
    expect(trigger).toMatchObject({ kind: 'price', comparator: 'lt', threshold: expected });
  });

  it('MSFT: két hiányzó mutató → PARTIAL, újranormalizálva, confidence MEDIUM', async () => {
    const { evaluation } = await evaluate('MSFT');
    expect(evaluation.score.totalScore).toBe(71.9);
    expect(evaluation.score.totalStatus).toBe('PARTIAL');
    expect(evaluation.confidence.level).toBe('MEDIUM');
    const missing = evaluation.score.categories.flatMap((c) => c.missing.map((m) => m.featureId));
    expect(missing).toEqual(['netDebtToEbitda', 'evToEbitda']);
    expect(evaluation.decision.label).toBe('HOLD');
  });

  it('NVDA: a N/M részvényszám-CAGR nem 0 pont – a Menedzsment kategória kimarad', async () => {
    const { evaluation } = await evaluate('NVDA');
    const management = evaluation.score.categories.find((c) => c.id === 'MANAGEMENT');
    expect(management).toMatchObject({ status: 'INSUFFICIENT_DATA', score: null });
    expect(management?.missing[0]?.status).toBe('NOT_MEANINGFUL');
    expect(evaluation.score.totalScore).toBe(69.4);
    expect(evaluation.decision.label).toBe('HOLD');
  });

  it('JPM (bank): az ipari mutatók nem alkalmazhatók → NOT_RATED adat-kockázatokkal', async () => {
    const { evaluation } = await evaluate('JPM');
    expect(evaluation.score.totalScore).toBeNull();
    expect(evaluation.confidence.level).toBe('INSUFFICIENT');
    expect(evaluation.decision.label).toBe('NOT_RATED');
    expect(evaluation.thesis.risks.map((r) => r.id)).toEqual(
      expect.arrayContaining(['data-gap-CASH_FLOW', 'data-gap-VALUATION']),
    );
  });

  it('piaci adat nélkül: az értékelés hiányzik → nem Buy, és a confidence nem HIGH', async () => {
    const { evaluation } = await evaluate('AAPL', false);
    expect(evaluation.score.categories.find((c) => c.id === 'VALUATION')?.status).toBe(
      'INSUFFICIENT_DATA',
    );
    expect(evaluation.score.totalScore).toBe(88);
    expect(evaluation.confidence.level).toBe('MEDIUM');
    expect(evaluation.decision.label).toBe('HOLD');
    expect(evaluation.decision.flags.find((f) => f.id === 'mosPremium')?.value).toBeNull();
  });
});

describe('visszakövethetőség és determinizmus', () => {
  it('minden pontozott mutató a forrás-provenance-t viszi (eredet, frissesség, dátum)', async () => {
    const { evaluation } = await evaluate('AAPL');
    const roic = evaluation.score.categories
      .flatMap((c) => c.metrics)
      .find((m) => m.featureId === 'roic');
    expect(roic).toMatchObject({ origin: expect.any(String), provenanceKind: 'calculated' });
    expect(roic?.asOf).not.toBeNull();
    expect(roic?.rule).toContain('5% → 0 pont, 20% → 100 pont');
    expect(evaluation.configs.score).toEqual({
      id: DEFAULT_STOCK_SCORE_CONFIG.id,
      version: DEFAULT_STOCK_SCORE_CONFIG.version,
    });
  });

  it('ugyanabból a fixture-ből kétszer felépítve azonos a kimenet', async () => {
    const a = await evaluate('AAPL');
    const b = await evaluate('AAPL');
    expect(b.evaluation).toEqual(a.evaluation);
  });

  it('eltérő jegyzésű DCF → VALIDATION (nem kever két papírt)', async () => {
    const aapl = await analyze('AAPL');
    const msftValuation = recalculate(await analyze('MSFT'));
    const forged = { ...msftValuation, listingId: 'MSFT@XNAS' as never };
    const result = buildStockEvaluation(aapl, forged);
    expect(result.ok).toBe(false);
  });
});

describe('use case: evaluateStock', () => {
  it('lekéri a fundamentumokat és a DCF-et, majd értékel (hamis gateway, élő hívás nélkül)', async () => {
    const evaluateStock = createEvaluateStock({
      analyzeStockValuation: createAnalyzeStockValuation({
        analyzeStockFundamentals: analyzerFor(gatewayFor('AAPL', { withMarket: true })),
        clock,
      }),
    });
    const result = await evaluateStock('AAPL@XNAS');
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value.evaluation.score.totalScore).toBe(67.5);
    expect(result.value.evaluation.decision.label).toBe('HOLD');
  });

  it('a fundamentális hiba változatlanul továbbmegy', async () => {
    const evaluateStock = createEvaluateStock({
      analyzeStockValuation: () =>
        Promise.resolve({ ok: false, error: { kind: 'NOT_FOUND', message: 'nincs' } as never }),
    });
    const result = await evaluateStock('NOPE@XNAS');
    expect(result.ok).toBe(false);
  });
});

describe('árszint-alapú érvénytelenítés (DCF-ből, a PHASE 07 küszöbeivel)', () => {
  const decision = (label: InstrumentEvaluation['decision']['label']) =>
    ({ label, appliedCaps: [] }) as unknown as InstrumentEvaluation['decision'];

  it('Strong Buy: a diszkont elvesztése ÉS a prémium-plafon árszintje; Buy: csak a prémium', async () => {
    const valuation = recalculate(await analyze('AAPL'));
    const base = valuation.dcf.scenarios.find((s) => s.id === 'base');
    if (base?.result.status !== 'OK') throw new Error('base');
    const iv = base.result.value.intrinsicValuePerShare;
    const strong = stockPriceInvalidation(valuation, decision('STRONG_BUY'));
    expect(strong.map((i) => [i.id, i.comparator, i.threshold])).toEqual([
      ['price-loses-dcf-discount', 'gt', Number((iv * 0.75).toPrecision(3))],
      ['price-dcf-premium', 'gt', Number((iv * 1.1).toPrecision(3))],
    ]);
    expect(strong[0]?.statement).toContain('USD');
    expect(stockPriceInvalidation(valuation, decision('BUY')).map((i) => i.id)).toEqual([
      'price-dcf-premium',
    ]);
  });

  it('Sell: az árszint, amely alatt a Base DCF érdemi diszkontot mutat; Hold plafon nélkül: semmi', async () => {
    const valuation = recalculate(await analyze('AAPL'));
    expect(
      stockPriceInvalidation(valuation, decision('SELL')).map((i) => [i.id, i.comparator]),
    ).toEqual([['price-dcf-discount', 'lt']]);
    expect(stockPriceInvalidation(valuation, decision('HOLD'))).toEqual([]);
    expect(stockPriceInvalidation(null, decision('BUY'))).toEqual([]);
  });
});
