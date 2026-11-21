import type { FxGateway, MarketDataGateway } from '@/application';
import { AppErrors, err, type AppError } from '@/domain';

/**
 * Élő (`live`) módban használt helyőrzők, ha a proxy URL-je (`EXPO_PUBLIC_API_BASE_URL`)
 * nincs (érvényesen) megadva. Őszintén hibát adnak, nem csendben demóadatot – így a UI nem
 * mutathat mockot valósként. (A hiányzó URL-t az env-validáció is jelzi.)
 */
const unconfigured = (): AppError =>
  AppErrors.upstream(
    'NOT_IMPLEMENTED',
    'Élő adatmód, de nincs proxy URL (EXPO_PUBLIC_API_BASE_URL). Állítsd be, vagy használd a mock módot.',
    'proxy',
  );

export const notImplementedMarketDataGateway: MarketDataGateway = {
  async getQuote() {
    return err(unconfigured());
  },
  async getSecurityListings() {
    return err(unconfigured());
  },
  async getFinancialStatements() {
    return err(unconfigured());
  },
};

export const notImplementedFxGateway: FxGateway = {
  async getReferenceRates() {
    return err(unconfigured());
  },
};
