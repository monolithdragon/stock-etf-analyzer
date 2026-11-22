/**
 * Integrációs teszt: composition root + valódi (memóriabeli/mock) adapterek + use case-ek.
 */
import type { Clock } from '@/application';
import { createPortfolio, parseCurrencyCode } from '@/domain';
import { InMemoryPortfolioRepository } from '@/infrastructure/mock/in-memory-portfolio-repository';

import { createAppServices } from './container';

const clock: Clock = { now: () => new Date('2026-11-21T12:00:00Z') };

describe('createAppServices', () => {
  it('mock módban demó árfolyamot ad, feltűnő mock jelöléssel és számolt frissességgel', async () => {
    const services = createAppServices({ dataMode: 'mock', apiBaseUrl: null }, { clock });

    expect(await services.getListingQuote('DEMO@XNAS')).toMatchObject({
      ok: true,
      value: {
        price: { amount: 100, currency: 'USD' },
        provenance: { kind: 'mock', sourceId: 'mock', freshness: 'FRESH' },
      },
    });
    expect(await services.getListingQuote('DEMOOLD@XNAS')).toMatchObject({
      ok: true,
      value: { provenance: { freshness: 'EXPIRED' } },
    });
    expect(await services.getListingQuote('NINCS@XNAS')).toMatchObject({
      ok: false,
      error: { kind: 'NOT_FOUND' },
    });
  });

  it('live módban proxy URL nélkül őszinte hibát ad, nem csendes demóadatot', async () => {
    const services = createAppServices({ dataMode: 'live', apiBaseUrl: null }, { clock });

    expect(await services.getListingQuote('DEMO@XNAS')).toMatchObject({
      ok: false,
      error: { kind: 'UPSTREAM', failure: 'NOT_IMPLEMENTED' },
    });
    expect(await services.getSecurityListings('IE00BK5BQT80')).toMatchObject({
      ok: false,
      error: { kind: 'UPSTREAM', failure: 'NOT_IMPLEMENTED' },
    });
  });

  it('live módban a proxy gateway-t köti be (a kért URL a szerződés szerinti)', async () => {
    const requested: string[] = [];
    const fetchImpl = async (url: string) => {
      requested.push(url);
      return new Response(
        JSON.stringify({
          apiVersion: '1',
          error: { code: 'CAPABILITY_UNAVAILABLE', message: 'PHASE 04B' },
        }),
        { status: 501 },
      );
    };
    const services = createAppServices(
      { dataMode: 'live', apiBaseUrl: 'https://proxy.example' },
      { clock, fetchImpl },
    );

    const quote = await services.getListingQuote('AAPL@XNAS');

    expect(requested).toEqual(['https://proxy.example/api/v1/instruments/AAPL%40XNAS/quote']);
    expect(quote).toMatchObject({
      ok: false,
      error: { kind: 'MISSING_DATA', missing: ['source'] },
    });
  });

  it('mock módban az FX demóráta „mock” marad átváltás után is', async () => {
    const services = createAppServices({ dataMode: 'mock', apiBaseUrl: null }, { clock });
    const huf = parseCurrencyCode('HUF');
    const usd = parseCurrencyCode('USD');
    if (!huf.ok || !usd.ok) throw new Error('setup');

    const result = await services.convertMoney({
      money: { amount: 100, currency: usd.value },
      target: huf.value,
    });

    // 100 USD → EUR (/1,1) → HUF (×400) = 36 363,63…
    expect(result.ok && result.value.converted.amount).toBeCloseTo(36363.636, 2);
    expect(result.ok && result.value.rate?.provenance.kind).toBe('mock');
  });

  it('tranzakció rögzítése a memóriabeli repository-ba (application ↔ repository példa)', async () => {
    const eur = parseCurrencyCode('EUR');
    const usd = parseCurrencyCode('USD');
    const portfolio = createPortfolio({
      id: 'p1',
      name: 'Fő',
      baseCurrency: eur.ok ? eur.value : (undefined as never),
      createdAt: '2026-11-01T10:00:00Z',
    });
    if (!portfolio.ok || !usd.ok) throw new Error('setup');
    const repository = new InMemoryPortfolioRepository({ portfolios: [portfolio.value] });
    const services = createAppServices(
      { dataMode: 'mock', apiBaseUrl: null },
      { clock, portfolioRepository: repository },
    );

    const recorded = await services.recordTransaction({
      portfolioId: 'p1',
      listingId: 'DEMO@XNAS' as never,
      type: 'DIVIDEND',
      tradeDate: '2026-11-15',
      amount: 4.2,
      currency: usd.value,
    });

    expect(recorded).toMatchObject({ ok: true, value: { type: 'DIVIDEND' } });
    const stored = await repository.listTransactions(portfolio.value.id);
    expect(stored.ok && stored.value).toHaveLength(1);
  });

  it('PHASE 09: mock módban rögzített tranzakciókból portfólióelemzés (USD + EUR, EUR bázis)', async () => {
    const eur = parseCurrencyCode('EUR');
    const usd = parseCurrencyCode('USD');
    if (!eur.ok || !usd.ok) throw new Error('pénznem');
    const portfolio = createPortfolio({
      id: 'p9',
      name: 'Demó',
      baseCurrency: eur.value,
      createdAt: '2026-11-01T00:00:00Z',
    });
    if (!portfolio.ok) throw new Error('portfólió');
    const repository = new InMemoryPortfolioRepository({ portfolios: [portfolio.value] });
    const services = createAppServices(
      { dataMode: 'mock', apiBaseUrl: null },
      { clock, portfolioRepository: repository },
    );
    const common = { portfolioId: 'p9', tradeDate: '2026-11-10', fees: 0 } as const;
    await services.recordTransaction({
      ...common,
      listingId: 'DEMO@XNAS' as never,
      type: 'BUY',
      quantity: 2,
      price: 90,
      priceCurrency: usd.value,
      feesCurrency: usd.value,
    });
    await services.recordTransaction({
      ...common,
      listingId: 'DEMOETF@XETR' as never,
      type: 'BUY',
      quantity: 4,
      price: 45,
      priceCurrency: eur.value,
      feesCurrency: eur.value,
    });
    const result = await services.analyzePortfolio('p9');
    if (!result.ok) throw new Error(result.error.message);
    const analysis = result.value;
    // DEMO: 2 × 100 USD / 1,1 = 181,82 EUR; DEMOETF: 4 × 50 = 200 EUR (mock FX: EUR/USD 1,1)
    expect(analysis.totals.marketValue.value).toMatchObject({ status: 'OK' });
    const mv = analysis.totals.marketValue.value;
    expect(mv.status === 'OK' && mv.value.amount).toBeCloseTo(200 / 1.1 + 200, 6);
    expect(mv.status === 'OK' && mv.provenance.kind).toBe('mock'); // demó nem „mosódik tisztára”
    expect(analysis.warnings.join(' ')).toContain('DEMO');
    expect(analysis.fxRatesUsed.every((r) => r.provenance.kind === 'mock')).toBe(true);
  });

  it('PHASE 10: evaluateStock és evaluateEtf a composition rooton át (mock mód)', async () => {
    const services = createAppServices({ dataMode: 'mock', apiBaseUrl: null }, { clock });
    const stock = await services.evaluateStock('DEMO@XNAS');
    if (!stock.ok) throw new Error(stock.error.message);
    expect(stock.value.evaluation.subjectKind).toBe('stock');
    expect(stock.value.evaluation.aiInvolvement).toBe('none');
    // Demóadat soha nem „mosódik tisztára”: a confidence legfeljebb LOW (vagy nincs elég adat).
    expect(['LOW', 'INSUFFICIENT']).toContain(stock.value.evaluation.confidence.level);
    expect(['STRONG_BUY', 'BUY']).not.toContain(stock.value.evaluation.decision.label);
    const etf = await services.evaluateEtf('DEMOETF@XETR');
    if (!etf.ok) throw new Error(etf.error.message);
    expect(etf.value.evaluation.subjectKind).toBe('etf');
    expect(etf.value.evaluation.configs.score.id).toBe('etf-default');
  });
});
