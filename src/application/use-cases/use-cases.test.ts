/**
 * Use case tesztek kézzel írt „fake” portokkal (a rétegszabály miatt az application
 * nem importálhat infrastructure-t; a valós bekötést a src/config/container.test.ts ellenőrzi).
 */
import {
  AppErrors,
  err,
  ok,
  type AppError,
  type CurrencyCode,
  type IsoTimestamp,
  type ListingId,
  type Portfolio,
  type PortfolioId,
  type Quote,
  type Result,
  type Transaction,
} from '@/domain';

import type { Clock, IdGenerator, MarketDataGateway, PortfolioRepository } from '../ports';
import { createGetListingQuote, QUOTE_FRESHNESS_POLICY } from './get-listing-quote';
import { createRecordTransaction, type RecordTransactionCommand } from './record-transaction';

const fixedClock = (iso: string): Clock => ({ now: () => new Date(iso) });
const sequentialIds = (): IdGenerator => {
  let n = 0;
  return { next: (prefix) => `${prefix}_${(n += 1)}` };
};

const PORTFOLIO: Portfolio = {
  id: 'p1' as PortfolioId,
  name: 'Fő portfólió',
  baseCurrency: 'EUR' as CurrencyCode,
  createdAt: '2026-11-01T10:00:00Z' as IsoTimestamp,
};

function fakeRepository(options: { failSave?: AppError } = {}) {
  const saved: Transaction[] = [];
  const repository: PortfolioRepository = {
    getPortfolio: async (id) => ok(id === PORTFOLIO.id ? PORTFOLIO : null),
    savePortfolio: async () => ok(undefined),
    listTransactions: async () => ok(saved),
    addTransaction: async (tx) => {
      if (options.failSave) return err(options.failSave);
      saved.push(tx);
      return ok(undefined);
    },
  };
  return { repository, saved };
}

const BUY: RecordTransactionCommand = {
  portfolioId: 'p1',
  listingId: 'DEMO@XNAS' as ListingId,
  type: 'BUY',
  tradeDate: '2026-11-20',
  quantity: 3,
  price: 100,
  priceCurrency: 'USD' as CurrencyCode,
  fees: 1,
  feesCurrency: 'USD' as CurrencyCode,
};

/** A blokkban nem használt (PHASE 04B) gateway-képességek: hívásuk tesztelési hiba. */
const unusedPhase04bMethods = {
  getPriceHistory: async () => {
    throw new Error('nem várt hívás');
  },
  getInstrumentProfile: async () => {
    throw new Error('nem várt hívás');
  },
  getDividends: async () => {
    throw new Error('nem várt hívás');
  },
  searchInstruments: async () => {
    throw new Error('nem várt hívás');
  },
};

describe('recordTransaction', () => {
  it('validált tranzakciót ment generált azonosítóval', async () => {
    const { repository, saved } = fakeRepository();
    const record = createRecordTransaction({
      portfolioRepository: repository,
      clock: fixedClock('2026-11-21T12:00:00Z'),
      ids: sequentialIds(),
    });

    const result = await record(BUY);

    expect(result).toMatchObject({ ok: true, value: { id: 'tx_1', type: 'BUY', quantity: 3 } });
    expect(saved).toHaveLength(1);
  });

  it('nem létező portfólió → NOT_FOUND, és semmi nem mentődik', async () => {
    const { repository, saved } = fakeRepository();
    const record = createRecordTransaction({
      portfolioRepository: repository,
      clock: fixedClock('2026-11-21T12:00:00Z'),
      ids: sequentialIds(),
    });

    const result = await record({ ...BUY, portfolioId: 'nincs-ilyen' });

    expect(result).toMatchObject({ ok: false, error: { kind: 'NOT_FOUND', id: 'nincs-ilyen' } });
    expect(saved).toHaveLength(0);
  });

  it('érvénytelen adat → VALIDATION mezőlistával; a jövőbeli dátumot a Clock alapján szűri', async () => {
    const { repository, saved } = fakeRepository();
    const record = createRecordTransaction({
      portfolioRepository: repository,
      clock: fixedClock('2026-11-21T12:00:00Z'),
      ids: sequentialIds(),
    });

    const result = await record({ ...BUY, quantity: -1, tradeDate: '2026-12-01' });

    expect(result.ok).toBe(false);
    if (!result.ok && result.error.kind === 'VALIDATION') {
      expect(result.error.issues.map((i) => i.path)).toContain('tradeDate');
    }
    expect(saved).toHaveLength(0);
  });

  it('PHASE 09: túladás (a meglévő naplóhoz képest) → VALIDATION, és semmi nem mentődik', async () => {
    const { repository, saved } = fakeRepository();
    const record = createRecordTransaction({
      portfolioRepository: repository,
      clock: fixedClock('2026-11-21T12:00:00Z'),
      ids: sequentialIds(),
    });
    expect((await record(BUY)).ok).toBe(true); // 3 db
    const oversell = await record({ ...BUY, type: 'SELL', quantity: 4 });
    expect(oversell).toMatchObject({
      ok: false,
      error: { kind: 'VALIDATION', issues: [{ path: 'transactions.tx_2' }] },
    });
    // visszadátumozott eladás a vétel előtt → szintén túladás
    const backdated = await record({ ...BUY, type: 'SELL', quantity: 1, tradeDate: '2026-11-19' });
    expect(backdated.ok).toBe(false);
    // ellentmondó deviza ugyanarra a jegyzésre
    const otherCurrency = await record({ ...BUY, priceCurrency: 'EUR' as CurrencyCode });
    expect(otherCurrency.ok).toBe(false);
    expect(saved).toHaveLength(1);
    // figyelmeztetés (lehetséges duplikátum) nem akadályoz
    expect((await record(BUY)).ok).toBe(true);
    expect(saved).toHaveLength(2);
  });

  it('tárolási hiba → STORAGE hiba változatlanul továbbmegy', async () => {
    const { repository } = fakeRepository({ failSave: AppErrors.storage('A lemez megtelt.') });
    const record = createRecordTransaction({
      portfolioRepository: repository,
      clock: fixedClock('2026-11-21T12:00:00Z'),
      ids: sequentialIds(),
    });

    expect(await record(BUY)).toMatchObject({ ok: false, error: { kind: 'STORAGE' } });
  });
});

describe('getListingQuote', () => {
  const quoteAt = (asOf: string): Quote => ({
    listingId: 'DEMO@XNAS' as ListingId,
    price: { amount: 100, currency: 'USD' as CurrencyCode },
    asOf: asOf as IsoTimestamp,
    delayMinutes: null,
    provenance: {
      sourceId: 'mock',
      sourceName: 'Demó',
      kind: 'mock',
      fetchedAt: '2026-11-21T12:00:00Z' as IsoTimestamp,
      asOf: asOf as IsoTimestamp,
      freshness: 'FRESH', // a forrás állítása – a use case felülbírálja
    },
  });

  const gatewayReturning = (result: Result<Quote>): MarketDataGateway & { calls: number } => {
    const gateway = {
      calls: 0,
      getQuote: async () => {
        gateway.calls += 1;
        return result;
      },
      // Ebben a blokkban csak a getQuote számít; a többi képesség nem hívható.
      getSecurityListings: async () => {
        throw new Error('nem várt hívás');
      },
      getFinancialStatements: async () => {
        throw new Error('nem várt hívás');
      },
      ...unusedPhase04bMethods,
    };
    return gateway;
  };

  it('a frissességet a saját óránk alapján számolja (nem a forrás állítása szerint)', async () => {
    const getQuote = createGetListingQuote({
      marketData: gatewayReturning(ok(quoteAt('2026-11-20T12:00:00Z'))),
      clock: fixedClock('2026-11-21T12:00:00Z'),
    });

    const result = await getQuote('demo@xnas');

    expect(result).toMatchObject({ ok: true, value: { provenance: { freshness: 'STALE' } } });
  });

  it('érvénytelen listing-azonosítónál a gatewayt meg sem hívja', async () => {
    const gateway = gatewayReturning(ok(quoteAt('2026-11-21T11:59:00Z')));
    const getQuote = createGetListingQuote({
      marketData: gateway,
      clock: fixedClock('2026-11-21T12:00:00Z'),
    });

    expect(await getQuote('AAPL')).toMatchObject({ ok: false, error: { kind: 'VALIDATION' } });
    expect(gateway.calls).toBe(0);
  });

  it.each([
    AppErrors.network('Nincs internetkapcsolat.'),
    AppErrors.rateLimited('Túl sok kérés.', 60),
    AppErrors.timeout('Lejárt az idő.', 10_000),
    AppErrors.notFound('árfolyam', 'DEMO@XNAS'),
  ])('a gateway $kind hibáját változatlanul továbbadja', async (error) => {
    const getQuote = createGetListingQuote({
      marketData: gatewayReturning(err(error)),
      clock: fixedClock('2026-11-21T12:00:00Z'),
    });
    expect(await getQuote('DEMO@XNAS')).toEqual(err(error));
  });

  it('az alapértelmezett szabály 15 perc friss, 3 nap után lejárt', () => {
    expect(QUOTE_FRESHNESS_POLICY).toEqual({ freshForMs: 900_000, expiresAfterMs: 259_200_000 });
  });
});
