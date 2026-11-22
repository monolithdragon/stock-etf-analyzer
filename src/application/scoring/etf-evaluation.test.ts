/**
 * PHASE 10 – ETF-értékelés: a PHASE 08 feature-modelljéből, a részvénytől KÜLÖN konfigurációval.
 * Regressziós (golden) értékek: szintetikus, determinisztikus ETF-bemenet.
 */
import { DEFAULT_STOCK_DECISION_CONFIG, DEFAULT_STOCK_SCORE_CONFIG } from '@/scoring';

import { buildEtfEvaluation, buildEtfFeatures } from './etf-evaluation';
import { buildEtfAnalysis } from '../etf-analysis/etf-analysis';
import { holdingsList, inputs, metadata } from '../etf-analysis/testing';
import type { EtfAnalysis, EtfMetadataInput } from '../etf-analysis/types';
import { buildPortfolioAnalysis } from '../portfolio/portfolio-analysis';
import { EUR, VWCE, baseInput, quote, tx } from '../portfolio/testing';

function etf(fields: Partial<EtfMetadataInput> | null): EtfAnalysis {
  const result = buildEtfAnalysis(
    inputs(
      fields === null
        ? {}
        : { options: { metadata: metadata(fields), displayCurrency: 'EUR' as never } },
    ),
  );
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}

const FULL: Partial<EtfMetadataInput> = {
  ter: 0.0022,
  aum: { amount: 30e9, currency: 'EUR' },
  inceptionDate: '2019-07-23',
  replication: 'physical_sampling',
  distribution: 'accumulating',
  holdings: {
    asOf: '2026-10-31',
    holdings: [
      ...holdingsList(200, 0.004, { country: 'US', currency: 'USD', sector: 'Tech' }),
      ...holdingsList(200, 0.001, { country: 'JP', currency: 'JPY', sector: 'Ind' }),
    ],
    declaredComplete: true,
  },
};

function evaluate(analysis: EtfAnalysis, options: Parameters<typeof buildEtfEvaluation>[1] = {}) {
  const result = buildEtfEvaluation(analysis, options);
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}

describe('ETF-értékelés – regresszió (golden)', () => {
  const evaluation = evaluate(etf(FULL));

  it('kategóriapontok, összpontszám, confidence és címke', () => {
    expect(evaluation.score.categories.map((c) => [c.id, c.status, c.score])).toEqual([
      ['DIVERSIFICATION', 'SCORED', 91.7],
      ['COST', 'SCORED', 77.9],
      ['TRACKING', 'INSUFFICIENT_DATA', null],
      ['LIQUIDITY', 'INSUFFICIENT_DATA', null],
      ['SIZE', 'SCORED', 100],
      ['STRUCTURE', 'SCORED', 85],
      ['RISK', 'SCORED', 100],
      ['CONCENTRATION', 'SCORED', 70],
      ['CURRENCY_RISK', 'INSUFFICIENT_DATA', null],
    ]);
    expect(evaluation.score.totalScore).toBe(86.4);
    expect(evaluation.confidence).toMatchObject({ level: 'MEDIUM', score: 67.6 });
    expect(evaluation.decision).toMatchObject({ label: 'BUY', matchedRuleId: 'etf-buy' });
    expect(evaluation.aiInvolvement).toBe('none');
  });

  it('a hiányzó tracking/likviditás/deviza nem 0 pont, hanem látható hiány okkal', () => {
    const tracking = evaluation.score.categories.find((c) => c.id === 'TRACKING');
    expect(tracking?.missing.map((m) => m.status)).toEqual(['MISSING', 'MISSING']);
    expect(tracking?.missing[0]?.reason).toContain('indexadat');
    expect(evaluation.thesis.risks.map((r) => r.id)).toContain('data-gap-TRACKING');
  });

  it('a felhasználói (kézi) metaadat minősége 0,8 → a költség-kategória MEDIUM minőségű', () => {
    const cost = evaluation.score.categories.find((c) => c.id === 'COST');
    expect(cost?.dataQuality).toMatchObject({ factor: 0.8, level: 'MEDIUM' });
    expect(cost?.metrics[0]?.provenanceKind).toBe('user_input');
    expect(cost?.rationale[0]).toBe(
      'Teljes költséghányad (TER) = 0.22% → 77.9 pont (súly 1; lineáris: 0.75% → 0 pont, 0.07% → 100 pont (köztük arányos, kívül levágva))',
    );
  });

  it('determinisztikus: ugyanabból az elemzésből ugyanaz a kimenet', () => {
    expect(evaluate(etf(FULL))).toEqual(evaluation);
  });
});

describe('ETF-értékelés – hiányzó adat és szélsőesetek', () => {
  it('free csomag (nincs metaadat, nincs holdings) → NOT_RATED, nem negatív ítélet', () => {
    const evaluation = evaluate(etf(null));
    expect(evaluation.score.totalScore).toBeNull();
    expect(evaluation.decision.label).toBe('NOT_RATED');
    expect(evaluation.decision.labelDescription).toContain('nem negatív ítélet');
    expect(evaluation.warnings.length).toBeGreaterThan(0); // a PHASE 08 lefedettségi korlátai
  });

  it('szintetikus replikáció: alacsonyabb szerkezeti pont és partnerkockázat', () => {
    const evaluation = evaluate(etf({ ...FULL, replication: 'synthetic' }));
    expect(evaluation.score.categories.find((c) => c.id === 'STRUCTURE')?.score).toBe(60);
    expect(evaluation.thesis.risks.map((r) => r.id)).toContain('etf-synthetic');
  });

  it('drága, koncentrált ETF → rosszabb címke és kockázatok', () => {
    const evaluation = evaluate(
      etf({
        ...FULL,
        ter: 0.0095,
        holdings: {
          asOf: '2026-10-31',
          holdings: holdingsList(16, 0.0625, { country: 'US', currency: 'USD', sector: 'Tech' }),
          declaredComplete: true,
        },
      }),
    );
    expect(evaluation.score.categories.find((c) => c.id === 'COST')?.score).toBe(0);
    expect(evaluation.decision.label).not.toBe('BUY');
    expect(evaluation.thesis.risks.map((r) => r.id)).toEqual(
      expect.arrayContaining(['etf-high-ter', 'etf-concentrated']),
    );
  });
});

describe('ETF és részvény szétválasztása', () => {
  it('ETF-elemzés részvény-konfigurációval → VALIDATION (nem keverhető)', () => {
    const result = buildEtfEvaluation(etf(FULL), {
      scoreConfig: DEFAULT_STOCK_SCORE_CONFIG,
      decisionConfig: DEFAULT_STOCK_DECISION_CONFIG,
    });
    expect(result.ok).toBe(false);
  });

  it('az ETF-feature-ök között nincs vállalati mutató (P/E, ROIC, DCF)', () => {
    const ids = buildEtfFeatures(etf(FULL)).map((f) => f.id);
    for (const corporate of ['pe', 'roic', 'mosBase', 'netMargin'])
      expect(ids).not.toContain(corporate);
  });
});

describe('portfólió-kontextus (PHASE 09)', () => {
  const portfolio = buildPortfolioAnalysis(
    baseInput({
      transactions: [tx.buy(VWCE, '2026-02-02', 10, 100, EUR)],
      quotes: new Map([[VWCE, quote(VWCE, 110, EUR)]]),
    }),
  );

  it('100%-os súly > 40% → túlsúly-plafon: Buy → Hold, és portfólió-kockázat', () => {
    const evaluation = evaluate(etf(FULL), { portfolio });
    const weight = evaluation.features.find((f) => f.id === 'portfolioWeight');
    expect(weight?.value).toMatchObject({ status: 'OK', value: 1 });
    expect(evaluation.decision.baseLabel).toBe('BUY');
    expect(evaluation.decision.label).toBe('HOLD');
    expect(evaluation.thesis.risks.map((r) => r.id)).toContain('etf-portfolio-overweight');
  });

  it('a portfólióban nem szereplő jegyzés: a súly NOT_APPLICABLE, a jelzés ismeretlen', () => {
    const other = buildPortfolioAnalysis(baseInput());
    const evaluation = evaluate(etf(FULL), { portfolio: other });
    expect(evaluation.features.find((f) => f.id === 'portfolioWeight')?.value.status).toBe(
      'NOT_APPLICABLE',
    );
    expect(evaluation.decision.flags.find((f) => f.id === 'portfolioOverweight')?.value).toBeNull();
    expect(evaluation.decision.label).toBe('BUY');
  });
});
