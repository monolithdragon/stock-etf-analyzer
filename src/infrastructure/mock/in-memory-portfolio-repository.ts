import type { PortfolioRepository } from '@/application';
import { ok, type Portfolio, type PortfolioId, type Transaction } from '@/domain';

/**
 * Memóriabeli portfólió-tároló: tesztekhez és a PHASE 13 (SQLite) előtti demóhoz.
 * FIGYELEM: az app újraindításakor az adatok elvesznek.
 */
export class InMemoryPortfolioRepository implements PortfolioRepository {
  private readonly portfolios = new Map<PortfolioId, Portfolio>();
  private readonly transactions = new Map<PortfolioId, Transaction[]>();

  constructor(seed: { portfolios?: readonly Portfolio[] } = {}) {
    for (const portfolio of seed.portfolios ?? []) {
      this.portfolios.set(portfolio.id, portfolio);
    }
  }

  async getPortfolio(id: PortfolioId) {
    return ok(this.portfolios.get(id) ?? null);
  }

  async savePortfolio(portfolio: Portfolio) {
    this.portfolios.set(portfolio.id, portfolio);
    return ok(undefined);
  }

  async listTransactions(portfolioId: PortfolioId) {
    // Másolatot adunk vissza, hogy a hívó ne módosíthassa a belső állapotot.
    return ok([...(this.transactions.get(portfolioId) ?? [])]);
  }

  async addTransaction(transaction: Transaction) {
    const list = this.transactions.get(transaction.portfolioId) ?? [];
    this.transactions.set(transaction.portfolioId, [...list, transaction]);
    return ok(undefined);
  }
}
