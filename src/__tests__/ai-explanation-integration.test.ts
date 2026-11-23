/**
 * PHASE 11 integráció: valós fixture-ök → PHASE 06–10 motor → AiInputDto → magyarázat.
 *
 *   SEC/FMP fixture → fundamentumok → DCF → score/döntés → buildInstrumentAiInput
 *     → explainWithTemplate → validateAiExplanation (ugyanaz az őr, mint az LLM-nél)
 *
 * Elfogadási feltételek: AI nélkül minden működik (template), AI-hibánál az app használható
 * (display = template), forrás nélküli adat nem jelenik meg tényként (őr), a kimenet strukturált.
 */
import {
  buildEtfEvaluation,
  buildInstrumentAiInput,
  buildPortfolioAiInput,
  buildStockEvaluation,
  createExplainAnalysis,
  createRecalculateStockValuation,
  type AiGateway,
} from '@/application';
import { buildEtfAnalysis } from '@/application/etf-analysis/etf-analysis';
import { holdingsList, inputs, metadata } from '@/application/etf-analysis/testing';
import { buildPortfolioAnalysis } from '@/application/portfolio/portfolio-analysis';
import {
  AAPL as AAPL_LISTING,
  EUR,
  USD,
  VWCE,
  baseInput,
  lookup,
  quote,
  tx,
} from '@/application/portfolio/testing';
import {
  aiExplanationContentSchema,
  validateAiExplanation,
  type AiExplanationDto,
  type AiInputDto,
} from '@/contracts';
import { AppErrors, err, ok, type AppError } from '@/domain';
import { explainWithTemplate } from '@/explanation';
import { analyze, clock } from '@/testing/stock-analysis-fixtures';

const recalculate = createRecalculateStockValuation({ clock });

function unwrap<T>(result: { ok: true; value: T } | { ok: false; error: AppError }): T {
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}

async function stockInput(ticker: string, withMarket = true): Promise<AiInputDto> {
  const fundamentals = await analyze(ticker, withMarket);
  const valuation = recalculate(fundamentals);
  const evaluation = unwrap(buildStockEvaluation(fundamentals, valuation));
  return unwrap(buildInstrumentAiInput(evaluation, { valuation, displayName: `${ticker} Inc.` }));
}

function etfInput(): AiInputDto {
  const analysis = unwrap(
    buildEtfAnalysis(
      inputs({
        options: {
          metadata: metadata({
            ter: 0.0022,
            aum: { amount: 30e9, currency: 'EUR' },
            inceptionDate: '2019-07-23',
            replication: 'physical_sampling',
            distribution: 'accumulating',
            holdings: {
              asOf: '2026-10-31',
              holdings: holdingsList(100, 0.01, { country: 'US', currency: 'USD', sector: 'Tech' }),
              declaredComplete: true,
            },
          }),
          displayCurrency: 'EUR' as never,
        },
      }),
    ),
  );
  return unwrap(buildInstrumentAiInput(unwrap(buildEtfEvaluation(analysis))));
}

function portfolioInput(): AiInputDto {
  const analysis = buildPortfolioAnalysis(
    baseInput({
      transactions: [
        tx.buy(AAPL_LISTING, '2026-01-02', 10, 100, USD, 1),
        tx.buy(VWCE, '2026-02-02', 10, 100, EUR, 2),
      ],
      quotes: new Map([
        [AAPL_LISTING, quote(AAPL_LISTING, 150, USD)],
        [VWCE, quote(VWCE, 110, EUR)],
      ]),
      fx: lookup({ USD: 0.85 }, { 'USD@2026-01-02': 0.9 }),
    }),
  );
  return unwrap(buildPortfolioAiInput(analysis));
}

describe('AiInputDto valós elemzésekből', () => {
  it.each(['AAPL', 'MSFT', 'NVDA', 'JPM'])(
    '%s: séma-érvényes, determinisztikus, a template átmegy az őrön',
    async (ticker) => {
      const input = await stockInput(ticker);
      const again = await stockInput(ticker);
      expect(again).toEqual(input);

      const content = explainWithTemplate(input);
      expect(aiExplanationContentSchema.safeParse(content).success).toBe(true);
      expect(validateAiExplanation(content, input)).toEqual([]);
      expect(explainWithTemplate(input)).toEqual(content);
      // A confidence és a címke a motorból jön, változatlanul.
      expect(content.confidence.level).toBe(input.evaluation?.confidence.level);
      expect(content.summary.text).toContain(input.evaluation?.decision.labelText);
    },
  );

  it('AAPL: a DTO tartalma (DCF becslésként, plafon, adatforrás)', async () => {
    const input = await stockInput('AAPL');
    expect(input.kind).toBe('stock');
    expect(input.dcf?.provenanceKind).toBe('estimated');
    expect(input.dcf?.scenarios.map((s) => s.ref)).toEqual(['dcf:bear', 'dcf:base', 'dcf:bull']);
    expect(input.evaluation?.decision).toMatchObject({ labelKey: 'HOLD', baseLabelKey: 'WATCH' });
    expect(input.evaluation?.decision.appliedCaps.map((c) => c.ref)).toEqual([
      'cap:cap-dcf-premium',
    ]);
    expect(input.evaluation?.decision.otherLabelTexts).not.toContain('Hold');
    const roe = input.metrics.find((m) => m.ref === 'metric:roe');
    expect(roe?.source?.sourceId).toBe('engine');
    // Hiányzó adat nem 0: érték helyett státusz + ok, és adathiányként is megjelenik.
    for (const m of input.metrics.filter((x) => x.status !== 'OK')) {
      expect(m.value).toBeNull();
      expect(m.reason).not.toBeNull();
      expect(input.dataGaps.map((g) => g.ref)).toContain(`gap:${m.ref.slice('metric:'.length)}`);
    }
  });

  it('JPM (bank): NOT_RATED – a template adathiányt mond, nem negatív ítéletet', async () => {
    const input = await stockInput('JPM');
    const content = explainWithTemplate(input);
    expect(input.evaluation?.decision.labelKey).toBe('NOT_RATED');
    expect(content.summary.text).toContain('Nem értékelhető');
    expect(content.dataGaps.length).toBeGreaterThan(0);
    expect(content.dataGaps.every((c) => c.support === 'insufficient_data')).toBe(true);
  });

  it('AAPL piaci adat nélkül: az árhoz kötött mutatók hiányként, nem tényként', async () => {
    const input = await stockInput('AAPL', false);
    const content = explainWithTemplate(input);
    expect(validateAiExplanation(content, input)).toEqual([]);
    expect(input.dataGaps.length).toBeGreaterThan(0);
  });

  it('ETF: külön sablon, nincs DCF', () => {
    const input = etfInput();
    expect(input.kind).toBe('etf');
    expect(input.dcf).toBeNull();
    const content = explainWithTemplate(input);
    expect(content.dcfAssumptions).toEqual([]);
    expect(validateAiExplanation(content, input)).toEqual([]);
  });

  it('portfólió: adatminimalizált DTO (nincs összeg, darabszám, név), külön sablon', () => {
    const input = portfolioInput();
    const serialized = JSON.stringify(input);
    expect(input.portfolio?.positions.map((p) => p.weightDisplay)).toEqual(
      expect.arrayContaining([expect.stringMatching(/%$/)]),
    );
    // A tranzakciók darabszáma és ára, illetve a portfólió neve nincs a DTO-ban.
    expect(serialized).not.toMatch(/"amount"|"quantity"|"costBasis|"price"|portfolioName/);
    expect(input.portfolio?.positions.every((p) => p.weight !== null)).toBe(true);
    const content = explainWithTemplate(input);
    expect(content.positives).toEqual([]);
    expect(content.confidence.level).toBe('NOT_APPLICABLE');
    expect(validateAiExplanation(content, input)).toEqual([]);
  });
});

describe('explainAnalysis use case – AI nélkül is működik, AI-hibánál használható marad', () => {
  const okLlm = (input: AiInputDto, content = explainWithTemplate(input)): AiExplanationDto => ({
    content,
    meta: {
      provider: 'anthropic',
      model: 'claude-opus-5-5',
      provenanceKind: 'ai_interpretation',
      generatedAt: '2026-11-21T22:00:00Z',
      inputHash: 'a'.repeat(64),
      cached: false,
    },
  });
  const gateway = (respond: AiGateway['explain']): AiGateway & { calls: number } => {
    const g = {
      calls: 0,
      explain: (request: Parameters<AiGateway['explain']>[0]) => {
        g.calls += 1;
        return respond(request);
      },
    };
    return g;
  };

  it('template mód: nincs hálózati hívás, a magyarázat „calculated”', async () => {
    const input = await stockInput('AAPL');
    const g = gateway(() => Promise.reject(new Error('nem hívható')));
    const outcome = unwrap(
      await createExplainAnalysis({ aiGateway: g, clock })({ input, mode: 'template' }),
    );
    expect(g.calls).toBe(0);
    expect(outcome.llm).toEqual({ status: 'not_requested' });
    expect(outcome.display.meta).toMatchObject({
      provider: 'template',
      provenanceKind: 'calculated',
    });
  });

  it('sikeres LLM-válasz: ezt jeleníti meg, a template tartalékként megmarad', async () => {
    const input = await stockInput('MSFT');
    const g = gateway(() => Promise.resolve(ok(okLlm(input))));
    const outcome = unwrap(
      await createExplainAnalysis({ aiGateway: g, clock })({ input, mode: 'llm' }),
    );
    expect(outcome.llm.status).toBe('ok');
    expect(outcome.display.meta.provenanceKind).toBe('ai_interpretation');
    expect(outcome.template.meta.provider).toBe('template');
  });

  it.each([
    ['kikapcsolt AI', AppErrors.ai('AI_DISABLED', 'ki')],
    ['timeout', AppErrors.timeout('lassú', 75000)],
    ['rate limit', AppErrors.rateLimited('sok', 60)],
    ['refusal', AppErrors.ai('AI_REFUSED', 'nem')],
    ['érvénytelen kimenet', AppErrors.ai('AI_INVALID_OUTPUT', 'rossz')],
    ['hálózat', AppErrors.network('offline')],
  ])('%s → failed, a display a template', async (_case, error) => {
    const input = await stockInput('AAPL');
    const g = gateway(() => Promise.resolve(err(error)));
    const outcome = unwrap(
      await createExplainAnalysis({ aiGateway: g, clock })({ input, mode: 'llm' }),
    );
    expect(outcome.llm).toEqual({ status: 'failed', error });
    expect(outcome.display).toBe(outcome.template);
  });

  it('hallucináló, de séma-helyes proxy-válasz: a kliens is elutasítja', async () => {
    const input = await stockInput('AAPL');
    const content = explainWithTemplate(input);
    const forged = okLlm(input, {
      ...content,
      positives: [
        {
          text: 'A bruttó árrés 87,3%, ezért garantált a hozam.',
          basedOn: ['metric:roe'],
          support: 'data',
        },
      ],
    });
    const g = gateway(() => Promise.resolve(ok(forged)));
    const outcome = unwrap(
      await createExplainAnalysis({ aiGateway: g, clock })({ input, mode: 'llm' }),
    );
    expect(outcome.llm.status).toBe('failed');
    if (outcome.llm.status === 'failed') {
      expect(outcome.llm.error).toMatchObject({ kind: 'AI', failure: 'AI_INVALID_OUTPUT' });
    }
    expect(outcome.display).toBe(outcome.template);
  });

  it('LLM-válasz „template” eredettel → elutasítva (hamis eredet-jelölés)', async () => {
    const input = await stockInput('AAPL');
    const fake = okLlm(input);
    const g = gateway(() =>
      Promise.resolve(ok({ ...fake, meta: { ...fake.meta, provider: 'template' as const } })),
    );
    const outcome = unwrap(
      await createExplainAnalysis({ aiGateway: g, clock })({ input, mode: 'llm' }),
    );
    expect(outcome.llm.status).toBe('failed');
  });

  it('portfólió LLM-hez beleegyezés nélkül: nincs hívás, failed', async () => {
    const input = portfolioInput();
    const g = gateway(() => Promise.reject(new Error('nem hívható')));
    const outcome = unwrap(
      await createExplainAnalysis({ aiGateway: g, clock })({ input, mode: 'llm' }),
    );
    expect(g.calls).toBe(0);
    expect(outcome.llm.status).toBe('failed');
  });

  it('érvénytelen bemenet → VALIDATION (nem küldjük tovább)', async () => {
    const input = await stockInput('AAPL');
    const result = await createExplainAnalysis({
      aiGateway: gateway(() => Promise.reject(new Error('x'))),
      clock,
    })({ input: { ...input, kind: 'portfolio' }, mode: 'llm' });
    expect(result.ok).toBe(false);
  });
});
