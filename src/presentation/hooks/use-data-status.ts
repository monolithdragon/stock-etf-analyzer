/**
 * Cache-/offline-állapot és kézi frissítés a képernyőknek (PHASE 13).
 *
 * - `notices`: minden sikeres betöltés után lekérdezzük, honnan jött az adat (hálózat, cache,
 *   offline tartalék), és ebből jelzést építünk (`buildDataStatusNotices`).
 * - `manualRefresh`: a KÉZI frissítés (lehúzás, újrapróbálás) – előbb jelöli a jegyzések
 *   cache-rekordjait (a következő olvasás a hálózatot próbálja, a tartalék megmarad), majd újratölt.
 *   A normál megnyitás cache-first: nincs lekérés minden renderkor / megnyitáskor.
 */
import { useCallback, useEffect, useState } from 'react';

import type { DataStatus } from '@/application';
import type { DataNotice } from '@/presentation/components/states';
import { useAppServices } from '@/presentation/di/app-services-context';
import { buildDataStatusNotices } from '@/presentation/view-models/data-status-notices';

export function useDataStatus(
  listingIds: readonly string[],
  /** Változásakor (pl. új sikeres eredmény) újra lekérdezzük az állapotot; `null` = még nincs adat. */
  trigger: unknown,
  reload: () => void,
): { readonly notices: readonly DataNotice[]; readonly manualRefresh: () => void } {
  const services = useAppServices();
  const [status, setStatus] = useState<DataStatus | null>(null);
  const key = listingIds.join('|');

  useEffect(() => {
    if (trigger === null) return undefined;
    let active = true;
    services.localData
      .getStatus(key === '' ? [] : key.split('|'))
      .then((result) => {
        if (active) setStatus(result.ok ? result.value : null);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [services, key, trigger]);

  const manualRefresh = useCallback(() => {
    services.localData
      .refreshListings(key === '' ? [] : key.split('|'))
      .then(
        () => reload(),
        () => reload(),
      )
      .catch(() => undefined);
  }, [services, key, reload]);

  return { notices: buildDataStatusNotices(status), manualRefresh };
}
