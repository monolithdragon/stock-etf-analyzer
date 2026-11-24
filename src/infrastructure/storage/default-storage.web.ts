/**
 * Web alapértelmezett tárolás (PHASE 13, D-082): MEMÓRIA. Az `expo-sqlite` webes változata
 * WASM-ot és COOP/COEP fejléceket igényel (alfa állapot); a web ebben a projektben csak
 * fejlesztői előnézet, ezért nem vállaljuk. Hálózati állapot: `expo-network` (navigator.onLine).
 */
import { createExpoConnectivityMonitor } from '@/infrastructure/system/expo-connectivity';

import { createInMemoryLocalStorage, type LocalStorage } from './local-storage';

export function createDefaultLocalStorage(): LocalStorage {
  return { ...createInMemoryLocalStorage(), connectivity: createExpoConnectivityMonitor() };
}
