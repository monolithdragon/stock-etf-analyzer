/**
 * Felhasználói beállítások modellje (PHASE 13, D-083). A PHASE 12 `AppSettings` (presentation)
 * innen származik – egy igazságforrás, a tároló és a UI ugyanazt a típust látja.
 *
 * Verziózott: a tárolt alak `{ schemaVersion, data }` boríték; a régebbi verziókat a
 * `migratePreferences` emeli a jelenlegire (lásd `docs/phases/phase-13-…` migrációs terv).
 */
import { z } from 'zod';

/** A választható bázispénznemek (az ECB-referenciaárfolyamok közül, D-017). */
export const BASE_CURRENCIES = ['HUF', 'EUR', 'USD'] as const;
export type BaseCurrency = (typeof BASE_CURRENCIES)[number];

export const THEME_PREFERENCES = ['system', 'light', 'dark'] as const;
export type ThemePreferenceSetting = (typeof THEME_PREFERENCES)[number];

export interface RefreshPreferences {
  /**
   * Hálózat visszatérésekor a figyelőlista és a portfólió árfolyamait a háttérben frissítsük-e
   * (csak a már nem friss rekordokat, korlátozott darabszámmal – kvótakímélés).
   */
  readonly refreshOnReconnect: boolean;
}

export interface UserPreferences {
  /** Portfólió és átváltott összegek pénzneme. */
  readonly baseCurrency: BaseCurrency;
  readonly themePreference: ThemePreferenceSetting;
  /**
   * Megjelenjen-e az „AI-magyarázat kérése” gomb. Alapból KI (D-078): költséges, és adatot küld
   * külső szolgáltatónak. A szerveren külön is kikapcsolható (kill switch).
   */
  readonly llmEnabled: boolean;
  readonly refresh: RefreshPreferences;
}

export const DEFAULT_PREFERENCES: UserPreferences = {
  baseCurrency: 'HUF',
  themePreference: 'system',
  llmEnabled: false,
  refresh: { refreshOnReconnect: true },
};

export const PREFERENCES_SCHEMA_VERSION = 2;

/** A jelenlegi (v2) tárolt alak sémája – ismeretlen mező nem engedett. */
export const userPreferencesSchema = z.strictObject({
  baseCurrency: z.enum(BASE_CURRENCIES),
  themePreference: z.enum(THEME_PREFERENCES),
  llmEnabled: z.boolean(),
  refresh: z.strictObject({ refreshOnReconnect: z.boolean() }),
});

/**
 * v1 = a PHASE 12 `AppSettings` alakja (frissítési beállítás nélkül). A PHASE 12 nem tárolt
 * semmit, de a migrációs lánc első lépését így is rögzítjük: ez a minta a további verziókhoz.
 */
const preferencesV1Schema = z.strictObject({
  baseCurrency: z.enum(BASE_CURRENCIES),
  themePreference: z.enum(THEME_PREFERENCES),
  llmEnabled: z.boolean(),
});

const envelopeSchema = z.object({ schemaVersion: z.number().int(), data: z.unknown() });

export type PreferencesDecodeResult =
  | {
      readonly status: 'ok';
      readonly preferences: UserPreferences;
      readonly migratedFrom: number | null;
    }
  | { readonly status: 'corrupt'; readonly reason: string }
  | { readonly status: 'newer_version'; readonly version: number };

/** Tárolt JSON → jelenlegi modell (migrációval). Nem dob kivételt. */
export function decodePreferences(raw: unknown): PreferencesDecodeResult {
  const envelope = envelopeSchema.safeParse(raw);
  if (!envelope.success) return { status: 'corrupt', reason: 'Hiányzó vagy hibás boríték.' };
  const { schemaVersion, data } = envelope.data;
  if (schemaVersion > PREFERENCES_SCHEMA_VERSION) {
    // Újabb app írta (pl. visszaállított régebbi verzió): nem írjuk felül, nem találgatunk.
    return { status: 'newer_version', version: schemaVersion };
  }
  if (schemaVersion === 1) {
    const v1 = preferencesV1Schema.safeParse(data);
    if (!v1.success) return { status: 'corrupt', reason: 'Érvénytelen v1 beállítás.' };
    return {
      status: 'ok',
      preferences: { ...v1.data, refresh: DEFAULT_PREFERENCES.refresh },
      migratedFrom: 1,
    };
  }
  if (schemaVersion === PREFERENCES_SCHEMA_VERSION) {
    const current = userPreferencesSchema.safeParse(data);
    if (!current.success) return { status: 'corrupt', reason: 'Érvénytelen beállítás.' };
    return { status: 'ok', preferences: current.data, migratedFrom: null };
  }
  return { status: 'corrupt', reason: `Ismeretlen sémaverzió: ${schemaVersion}.` };
}

export function encodePreferences(preferences: UserPreferences): {
  readonly schemaVersion: number;
  readonly data: UserPreferences;
} {
  return { schemaVersion: PREFERENCES_SCHEMA_VERSION, data: preferences };
}
