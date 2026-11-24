import { AppErrors, err, ok, type Portfolio, type PortfolioId } from '@/domain';

import { createCreatePortfolio } from './create-portfolio';
import type { PortfolioRepository } from '../ports';

const clock = { now: () => new Date('2026-11-23T10:00:00.000Z') };
const ids = { next: (prefix: string) => `${prefix}_generated` };

function memoryRepository(options: { failSave?: boolean } = {}) {
  const store = new Map<PortfolioId, Portfolio>();
  const repository: PortfolioRepository = {
    getPortfolio: async (id) => ok(store.get(id) ?? null),
    savePortfolio: async (portfolio) => {
      if (options.failSave === true) return err(AppErrors.storage('tele a lemez'));
      store.set(portfolio.id, portfolio);
      return ok(undefined);
    },
    listTransactions: async () => ok([]),
    addTransaction: async () => ok(undefined),
    listPortfolios: async () => ok([...store.values()]),
    deleteAll: async () => ok(undefined),
  };
  return { repository, store };
}

describe('createPortfolio', () => {
  it('létrehoz és elment egy portfóliót a megadott azonosítóval és bázispénznemmel', async () => {
    const { repository, store } = memoryRepository();
    const create = createCreatePortfolio({ portfolioRepository: repository, clock, ids });

    const result = await create({ id: 'main', name: '  Saját  ', baseCurrency: 'huf' });

    expect(result).toEqual(
      ok({
        id: 'main',
        name: 'Saját',
        baseCurrency: 'HUF',
        createdAt: '2026-11-23T10:00:00.000Z',
      }),
    );
    expect(store.size).toBe(1);
  });

  it('azonosító nélkül generált azonosítót kap', async () => {
    const { repository } = memoryRepository();
    const create = createCreatePortfolio({ portfolioRepository: repository, clock, ids });
    const result = await create({ name: 'X', baseCurrency: 'EUR' });
    expect(result.ok && result.value.id).toBe('pf_generated');
  });

  it('meglévő azonosítót nem ír felül csendben', async () => {
    const { repository } = memoryRepository();
    const create = createCreatePortfolio({ portfolioRepository: repository, clock, ids });
    await create({ id: 'main', name: 'Első', baseCurrency: 'EUR' });

    const second = await create({ id: 'main', name: 'Második', baseCurrency: 'USD' });

    expect(second.ok).toBe(false);
    expect(!second.ok && second.error.kind).toBe('VALIDATION');
  });

  it('érvénytelen pénznem, név vagy azonosító → VALIDATION mezőútvonallal', async () => {
    const { repository } = memoryRepository();
    const create = createCreatePortfolio({ portfolioRepository: repository, clock, ids });

    const badCurrency = await create({ id: 'main', name: 'X', baseCurrency: 'forint' });
    expect(
      !badCurrency.ok &&
        badCurrency.error.kind === 'VALIDATION' &&
        badCurrency.error.issues[0]?.path,
    ).toBe('baseCurrency');
    const badName = await create({ id: 'main', name: '   ', baseCurrency: 'EUR' });
    expect(!badName.ok && badName.error.kind).toBe('VALIDATION');
    const badId = await create({ id: 'rossz id!', name: 'X', baseCurrency: 'EUR' });
    expect(!badId.ok && badId.error.kind === 'VALIDATION' && badId.error.issues[0]?.path).toBe(
      'id',
    );
  });

  it('a tárolási hiba továbbmegy (STORAGE)', async () => {
    const { repository } = memoryRepository({ failSave: true });
    const create = createCreatePortfolio({ portfolioRepository: repository, clock, ids });
    const result = await create({ id: 'main', name: 'X', baseCurrency: 'EUR' });
    expect(!result.ok && result.error.kind).toBe('STORAGE');
  });
});
