/**
 * Cache-/offline-jelzések a képernyőknek (PHASE 13, ARCHITECTURE 12.). Tiszta függvény.
 *
 * Szabály: cache-ből kiszolgált adatnál MINDIG látszik az „utoljára frissítve” időpont (a
 * LEGRÉGEBBI felhasznált rekord lekérési ideje – a leggyengébb láncszem), offline tartaléknál
 * figyelmeztetés, hogy az adat elavult lehet. Friss hálózati adatnál nincs jelzés.
 */
import type { DataStatus } from '@/application';
import type { DataNotice } from '@/presentation/components/states';
import { formatDateTime } from '@/presentation/format';

export function buildDataStatusNotices(status: DataStatus | null): DataNotice[] {
  if (status === null || status.entries.length === 0) {
    return status?.connectivity === 'offline'
      ? [
          {
            id: 'offline',
            tone: 'warning',
            title: 'Nincs hálózat',
            message: 'Offline vagy. Ehhez az adathoz nincs korábban letöltött (cache) példány.',
          },
        ]
      : [];
  }
  const oldest = formatDateTime(status.oldestFetchedAt);
  const fromCache = status.entries.some(
    (e) => e.lastServed === 'cache_hit' || e.lastServed === 'offline_fallback',
  );
  if (status.servedOffline || status.connectivity === 'offline') {
    return [
      {
        id: 'offline',
        tone: 'warning',
        title: 'Offline adat – elavult lehet',
        message: `A friss lekérés nem sikerült (nincs hálózat vagy forráskorlát), ezért korábban letöltött adatot mutatunk. Utoljára frissítve: ${oldest} (a legrégebbi felhasznált adat). Ha újra van hálózat, húzd le a képernyőt a frissítéshez.`,
      },
    ];
  }
  if (fromCache) {
    return [
      {
        id: 'cache',
        tone: 'info',
        title: 'Gyorsítótárból (cache)',
        message: `Az adatok egy része a korábbi lekérésből való. Utoljára frissítve: ${oldest}. Kézi frissítés: húzd le a képernyőt.`,
      },
    ];
  }
  return [];
}
