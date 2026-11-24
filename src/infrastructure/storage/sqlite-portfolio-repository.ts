/**
 * SQLite portfólió-tároló (PHASE 13, D-082) – a `PortfolioRepository` port változatlan.
 *
 * Sérült rekord: `STORAGE` hiba az azonosítóval. Tranzakciót SOHA nem hagyunk ki csendben,
 * mert a hiányzó tétel hamis pozíciót és P/L-t adna (CLAUDE.md: a hiányzó adat nem nulla).
 */
import type { PortfolioRepository } from '@/application';
import { AppErrors, err, ok, type Portfolio, type PortfolioId, type Transaction } from '@/domain';

import { withDatabase, type DatabaseProvider } from './database-provider';
import {
  decodePortfolio,
  decodeTransaction,
  encodePortfolio,
  encodeTransaction,
} from './portfolio-codec';

interface JsonRow {
  readonly id: string;
  readonly json: string;
}

export function createSqlitePortfolioRepository(provider: DatabaseProvider): PortfolioRepository {
  function decodePortfolioRow(row: JsonRow) {
    const portfolio = decodePortfolio(row.json);
    return portfolio === null
      ? err(AppErrors.storage(`Sérült portfólió-rekord a helyi tárolóban (${row.id}).`))
      : ok(portfolio);
  }

  return {
    getPortfolio: (id) =>
      withDatabase(provider, 'portfólió olvasása', async (db) => {
        const row = await db.getFirst<JsonRow>('SELECT id, json FROM portfolios WHERE id = ?', [
          id,
        ]);
        return row === null ? ok(null) : decodePortfolioRow(row);
      }),

    savePortfolio: (portfolio) =>
      withDatabase(provider, 'portfólió mentése', async (db) => {
        await db.run(
          `INSERT INTO portfolios (id, json, created_at) VALUES (?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET json = excluded.json`,
          [portfolio.id, encodePortfolio(portfolio), portfolio.createdAt],
        );
        return ok(undefined);
      }),

    listTransactions: (portfolioId: PortfolioId) =>
      withDatabase(provider, 'tranzakciók olvasása', async (db) => {
        const rows = await db.getAll<JsonRow>(
          'SELECT id, json FROM transactions WHERE portfolio_id = ? ORDER BY seq ASC',
          [portfolioId],
        );
        const transactions: Transaction[] = [];
        for (const row of rows) {
          const transaction = decodeTransaction(row.json);
          if (transaction === null) {
            return err(
              AppErrors.storage(
                `Sérült tranzakció-rekord a helyi tárolóban (${row.id}). A portfóliót nem számoljuk hiányos naplóból – exportáld, majd töröld a hibás adatot.`,
              ),
            );
          }
          transactions.push(transaction);
        }
        return ok(transactions);
      }),

    addTransaction: (transaction) =>
      withDatabase(provider, 'tranzakció mentése', async (db) => {
        // A `seq` a rögzítés sorrendje (azonos napi tételeknél is determinisztikus visszaolvasás).
        await db.run(
          `INSERT INTO transactions (id, portfolio_id, seq, json)
           VALUES (?, ?, (SELECT COALESCE(MAX(seq), 0) + 1 FROM transactions), ?)`,
          [transaction.id, transaction.portfolioId, encodeTransaction(transaction)],
        );
        return ok(undefined);
      }),

    listPortfolios: () =>
      withDatabase(provider, 'portfóliók listázása', async (db) => {
        const rows = await db.getAll<JsonRow>(
          'SELECT id, json FROM portfolios ORDER BY created_at ASC, id ASC',
        );
        const portfolios: Portfolio[] = [];
        for (const row of rows) {
          const decoded = decodePortfolioRow(row);
          if (!decoded.ok) return decoded;
          portfolios.push(decoded.value);
        }
        return ok(portfolios);
      }),

    deleteAll: () =>
      withDatabase(provider, 'portfólióadatok törlése', async (db) => {
        await db.transaction(async () => {
          await db.run('DELETE FROM transactions');
          await db.run('DELETE FROM portfolios');
        });
        return ok(undefined);
      }),
  };
}
