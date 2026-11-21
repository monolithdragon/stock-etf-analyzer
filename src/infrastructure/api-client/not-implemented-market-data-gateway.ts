import type { MarketDataGateway } from '@/application';
import { AppErrors, err } from '@/domain';

/**
 * Élő (`live`) módban használt helyőrző, amíg a proxy kliens el nem készül (PHASE 04A).
 * Őszintén hibát ad, nem csendben demóadatot – így a UI nem mutathat mockot valósként.
 */
export const notImplementedMarketDataGateway: MarketDataGateway = {
  async getQuote() {
    return err(
      AppErrors.upstream(
        'NOT_IMPLEMENTED',
        'Az élő adatforrás még nincs bekötve (PHASE 04A). Használd a mock adatmódot.',
        'proxy',
      ),
    );
  },
};
