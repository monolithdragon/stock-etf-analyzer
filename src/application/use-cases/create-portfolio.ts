/**
 * Use case: portfólió létrehozása (PHASE 12).
 *
 * A UI-nak kell egy út az első (üres) portfólió létrehozásához – tranzakciót csak létező
 * portfólióba lehet rögzíteni (`recordTransaction` → `NOT_FOUND`). A tárolás a port mögött van
 * (MVP-ben memóriában, PHASE 13-tól SQLite).
 *
 * Már létező azonosító → `VALIDATION` hiba (nem írja felül csendben a meglévőt).
 */
import {
  AppErrors,
  createPortfolio,
  err,
  ok,
  parseCurrencyCode,
  parsePortfolioId,
  toIsoTimestamp,
  validateFields,
  type AppError,
  type Portfolio,
  type Result,
} from '@/domain';

import type { Clock, IdGenerator, PortfolioRepository } from '../ports';

export interface CreatePortfolioCommand {
  /** Saját azonosító (pl. egyetlen portfóliós MVP: `main`); hiányában generált. */
  readonly id?: string;
  readonly name: string;
  /** Bázispénznem (ISO 4217), pl. `HUF`. */
  readonly baseCurrency: string;
}

export type CreatePortfolio = (
  command: CreatePortfolioCommand,
) => Promise<Result<Portfolio, AppError>>;

export function createCreatePortfolio(deps: {
  readonly portfolioRepository: PortfolioRepository;
  readonly clock: Clock;
  readonly ids: IdGenerator;
}): CreatePortfolio {
  return async (command) => {
    const fields = validateFields(
      {
        id: parsePortfolioId(command.id ?? deps.ids.next('pf')),
        baseCurrency: parseCurrencyCode(command.baseCurrency),
      },
      'Érvénytelen portfólió.',
    );
    if (!fields.ok) return fields;

    const existing = await deps.portfolioRepository.getPortfolio(fields.value.id);
    if (!existing.ok) return existing;
    if (existing.value !== null) {
      return err(
        AppErrors.validation('Ilyen azonosítójú portfólió már létezik.', [
          { path: 'id', message: `A(z) „${fields.value.id}” portfólió már létezik.` },
        ]),
      );
    }

    const portfolio = createPortfolio({
      id: fields.value.id,
      name: command.name.trim(),
      baseCurrency: fields.value.baseCurrency,
      createdAt: toIsoTimestamp(deps.clock.now()),
    });
    if (!portfolio.ok) return portfolio;

    const saved = await deps.portfolioRepository.savePortfolio(portfolio.value);
    if (!saved.ok) return saved;
    return ok(portfolio.value);
  };
}
