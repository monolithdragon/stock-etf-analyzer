/**
 * Nyilvános (kliensoldali) környezeti konfiguráció.
 *
 * FONTOS:
 * - Csak `EXPO_PUBLIC_*` változó olvasható a kliensen. Ezek plain-textként bekerülnek
 *   a lefordított appba, ezért SOHA nem tartalmazhatnak titkot.
 * - Az Expo csak a `process.env.EXPO_PUBLIC_VALAMI` alakú, statikus hozzáférést
 *   helyettesíti be build időben. Destrukturálás vagy `process.env[name]` NEM működik.
 * - A szerveroldali titkokat (API-kulcsok) a PHASE 04 proxy olvassa, nem ez a modul.
 *
 * A validáció szándékosan kézi (zod nélkül): a zod a PHASE 03-ban kerül be (D-014).
 */

export type DataMode = 'mock' | 'live';

export interface PublicEnv {
  /** `mock` = demóadat (alapértelmezés), `live` = valós adat a proxyn át (PHASE 04-től). */
  readonly dataMode: DataMode;
  /** A proxy alap URL-je záró `/` nélkül, vagy `null`, ha nincs (érvényesen) megadva. */
  readonly apiBaseUrl: string | null;
}

export interface EnvIssue {
  readonly variable: string;
  readonly message: string;
}

export interface PublicEnvResult {
  readonly env: PublicEnv;
  /** Érvénytelen vagy ellentmondásos beállítások – a UI megjeleníti, nem nyeli el csendben. */
  readonly issues: readonly EnvIssue[];
}

export interface RawPublicEnv {
  readonly EXPO_PUBLIC_DATA_MODE?: string | undefined;
  readonly EXPO_PUBLIC_API_BASE_URL?: string | undefined;
}

const DEFAULT_DATA_MODE: DataMode = 'mock';
const HTTP_URL_PATTERN = /^https?:\/\/[^\s/?#]+(?:[/?#]\S*)?$/i;

function normalize(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed === undefined || trimmed === '' ? undefined : trimmed;
}

function isDataMode(value: string): value is DataMode {
  return value === 'mock' || value === 'live';
}

/** Tiszta függvény: a nyers env értékekből validált konfigurációt és hibalistát ad. */
export function parsePublicEnv(raw: RawPublicEnv): PublicEnvResult {
  const issues: EnvIssue[] = [];

  let dataMode: DataMode = DEFAULT_DATA_MODE;
  const rawMode = normalize(raw.EXPO_PUBLIC_DATA_MODE)?.toLowerCase();
  if (rawMode !== undefined) {
    if (isDataMode(rawMode)) {
      dataMode = rawMode;
    } else {
      issues.push({
        variable: 'EXPO_PUBLIC_DATA_MODE',
        message: `Ismeretlen érték: "${rawMode}". Engedélyezett: mock | live. Alapértelmezés: ${DEFAULT_DATA_MODE}.`,
      });
    }
  }

  let apiBaseUrl: string | null = null;
  const rawUrl = normalize(raw.EXPO_PUBLIC_API_BASE_URL);
  if (rawUrl !== undefined) {
    if (HTTP_URL_PATTERN.test(rawUrl)) {
      apiBaseUrl = rawUrl.replace(/\/+$/, '');
    } else {
      issues.push({
        variable: 'EXPO_PUBLIC_API_BASE_URL',
        message: 'Érvénytelen URL. Formátum: http(s)://gép[:port][/útvonal].',
      });
    }
  }

  if (dataMode === 'live' && apiBaseUrl === null) {
    issues.push({
      variable: 'EXPO_PUBLIC_API_BASE_URL',
      message: 'A live adatmódhoz meg kell adni a proxy URL-jét.',
    });
  }

  return { env: { dataMode, apiBaseUrl }, issues };
}

/** Az alkalmazás tényleges nyilvános konfigurációja (build időben behelyettesítve). */
export const publicEnvResult: PublicEnvResult = parsePublicEnv({
  EXPO_PUBLIC_DATA_MODE: process.env.EXPO_PUBLIC_DATA_MODE,
  EXPO_PUBLIC_API_BASE_URL: process.env.EXPO_PUBLIC_API_BASE_URL,
});
