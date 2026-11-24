/**
 * Hálózati állapot az `expo-network` alapján (PHASE 13). `isInternetReachable === false` vagy
 * `isConnected === false` → offline; ha a platform nem tudja (undefined) → `unknown` (ilyenkor a
 * cache a hálózatot próbálja, és csak hibánál ad tartalékot).
 */
import { addNetworkStateListener, getNetworkStateAsync, type NetworkState } from 'expo-network';

import type { ConnectivityMonitor, ConnectivityState } from '@/application';

export function toConnectivityState(state: NetworkState): ConnectivityState {
  if (state.isConnected === false || state.isInternetReachable === false) return 'offline';
  if (state.isConnected === true) return 'online';
  return 'unknown';
}

export function createExpoConnectivityMonitor(): ConnectivityMonitor {
  let current: ConnectivityState = 'unknown';
  const listeners = new Set<(state: ConnectivityState) => void>();

  const update = (next: ConnectivityState) => {
    if (next === current) return;
    current = next;
    for (const listener of listeners) listener(next);
  };

  // Egyetlen natív feliratkozás az app élettartamára (a composition root egyszer hozza létre).
  addNetworkStateListener((event) => update(toConnectivityState(event)));
  getNetworkStateAsync().then(
    (state) => update(toConnectivityState(state)),
    () => undefined,
  );

  return {
    current: () => current,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

/** Állapot nélküli figyelő (demó mód, tesztek): mindig `unknown`. */
export const unknownConnectivity: ConnectivityMonitor = {
  current: () => 'unknown',
  subscribe: () => () => undefined,
};
