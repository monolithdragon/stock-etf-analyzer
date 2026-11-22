/**
 * Use case: tranzakció rögzítése egy portfólióba.
 *
 * Lépések: azonosító ellenőrzése → portfólió létezik? → domain-validáció → napló-validáció
 * (PHASE 09: túladás, ellentmondó deviza, hibás FX-irány – a meglévő tranzakciókkal együtt;
 * visszadátumozott eladás is lehet túladás egy későbbi eladásnál) → mentés.
 * Minden várt hiba `Result`-ként jön vissza (VALIDATION, NOT_FOUND, STORAGE).
 * A napló-figyelmeztetések (pl. lehetséges duplikátum) nem akadályozzák a rögzítést.
 */
import {
  AppErrors,
  createTransaction,
  err,
  ok,
  parsePortfolioId,
  toLocalIsoDate,
  validateFields,
  validateTransactionLedger,
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

    const existing = await deps.portfolioRepository.listTransactions(portfolioId);
    if (!existing.ok) return existing;
    const before = validateTransactionLedger(portfolio.value, existing.value);
    const after = validateTransactionLedger(portfolio.value, [
      ...existing.value,
      transaction.value,
    ]);
    const known = new Set(before.issues.map((i) => `${i.code}|${i.transactionId}`));
    const introduced = after.issues.filter(
      (i) => i.severity === 'error' && !known.has(`${i.code}|${i.transactionId}`),
    );
    if (introduced.length > 0) {
      return err(
        AppErrors.validation(
          'A tranzakció ellentmond a meglévő naplónak.',
          introduced.map((i) => ({ path: `transactions.${i.transactionId}`, message: i.message })),
        ),
      );
    }

    const saved = await deps.portfolioRepository.addTransaction(transaction.value);
    if (!saved.ok) return saved;

    return ok(transaction.value);
  };
}
