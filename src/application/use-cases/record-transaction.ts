/**
 * Use case: tranzakció rögzítése egy portfólióba.
 *
 * Lépések: azonosító ellenőrzése → portfólió létezik? → domain-validáció → mentés.
 * Minden várt hiba `Result`-ként jön vissza (VALIDATION, NOT_FOUND, STORAGE).
 */
import {
  AppErrors,
  createTransaction,
  err,
  ok,
  parsePortfolioId,
  toLocalIsoDate,
  validateFields,
  type AppError,
  type Result,
  type Transaction,
  type TransactionInput,
} from '@/domain';

import type { Clock, IdGenerator, PortfolioRepository } from '../ports';

/**
 * „Disztributív” Omit: az unió MINDEN ágából külön hagyja el a kulcsot. (A sima `Omit` egy
 * unión csak a közös mezőket tartaná meg, és elveszne a `type` szerinti szűkítés.)
 */
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

/** A parancs a tranzakció adatai az azonosító nélkül (azt a use case generálja). */
export type RecordTransactionCommand = DistributiveOmit<TransactionInput, 'id'>;

export type RecordTransaction = (
  command: RecordTransactionCommand,
) => Promise<Result<Transaction, AppError>>;

export interface RecordTransactionDeps {
  readonly portfolioRepository: PortfolioRepository;
  readonly clock: Clock;
  readonly ids: IdGenerator;
}

export function createRecordTransaction(deps: RecordTransactionDeps): RecordTransaction {
  return async (command) => {
    const parsed = validateFields(
      { portfolioId: parsePortfolioId(command.portfolioId) },
      'Érvénytelen tranzakció.',
    );
    if (!parsed.ok) return parsed;
    const { portfolioId } = parsed.value;

    const portfolio = await deps.portfolioRepository.getPortfolio(portfolioId);
    if (!portfolio.ok) return portfolio;
    if (portfolio.value === null) return err(AppErrors.notFound('portfólió', portfolioId));

    const transaction = createTransaction(
      { ...command, id: deps.ids.next('tx') },
      { today: toLocalIsoDate(deps.clock.now()) },
    );
    if (!transaction.ok) return transaction;

    const saved = await deps.portfolioRepository.addTransaction(transaction.value);
    if (!saved.ok) return saved;

    return ok(transaction.value);
  };
}
