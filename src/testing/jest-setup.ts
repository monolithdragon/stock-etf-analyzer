/**
 * Jest közös beállítás (PHASE 13): a natív tároló-/hálózati modulok tesztdublőreinek
 * visszaállítása minden teszt után, hogy a tesztek ne függjenek egymás sorrendjétől.
 */
import { __resetNetwork } from './mocks/expo-network';
import { __resetSqlite } from './mocks/expo-sqlite';
import { __resetKvStore } from './mocks/expo-sqlite-kv-store';

afterEach(() => {
  __resetKvStore();
  __resetNetwork();
  __resetSqlite();
});
