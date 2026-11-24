/**
 * CSAK TESZTEKHEZ (jest `moduleNameMapper`): vezérelhető `expo-network`.
 * Alapállapot: ismeretlen (`isConnected` nincs megadva) → a cache a hálózatot próbálja.
 */
export interface NetworkState {
  isConnected?: boolean;
  isInternetReachable?: boolean;
}

let state: NetworkState = {};
const listeners = new Set<(event: NetworkState) => void>();

export async function getNetworkStateAsync(): Promise<NetworkState> {
  return state;
}

export function addNetworkStateListener(listener: (event: NetworkState) => void): {
  remove: () => void;
} {
  listeners.add(listener);
  return { remove: () => listeners.delete(listener) };
}

/** Teszt: hálózati állapot váltása (minden feliratkozó értesül). */
export function __setNetworkState(next: NetworkState): void {
  state = next;
  for (const listener of listeners) listener(next);
}

export function __resetNetwork(): void {
  state = {};
  listeners.clear();
}
