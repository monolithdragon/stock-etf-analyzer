/**
 * Provenance = honnan jön egy érték, mikor kértük le, mire vonatkozik (DATA_DICTIONARY 2.3–2.4).
 */
import type { CurrencyCode } from './currency';
import { toEpochMs, type IsoDate, type IsoTimestamp } from './dates';
import type { FiscalPeriod } from './period';

export const PROVENANCE_KINDS = [
  /** A forrás által jelentett érték (pl. 10-K). */
  'reported',
  /** A saját motorunk számolta jelentett értékekből. */
  'calculated',
  /** Feltevésen alapuló becslés (pl. DCF). */
  'estimated',
  /** LLM által írt értelmezés – SOHA nem számszerű mutató forrása. */
  'ai_interpretation',
  /** A felhasználó adta meg (pl. kézi TER, DCF feltevés). */
  'user_input',
  /** Teszt-/demóadat – a UI-ban mindig feltűnően jelölve. */
  'mock',
] as const;
export type ProvenanceKind = (typeof PROVENANCE_KINDS)[number];

export const FRESHNESS_VALUES = ['FRESH', 'STALE', 'EXPIRED', 'UNKNOWN'] as const;
export type Freshness = (typeof FRESHNESS_VALUES)[number];

export const MEASUREMENT_UNITS = [
  'money',
  'money_per_share',
  'shares',
  /** Tizedes tört: 0.15 = 15% (D-009). */
  'ratio',
  /** Szorzó, pl. P/E 18.4x. */
  'multiple',
  'count',
] as const;
export type MeasurementUnit = (typeof MEASUREMENT_UNITS)[number];

export interface DataProvenance {
  /** Gépi forrásazonosító, pl. `sec-edgar`, `ecb-fx`, `mock`, `engine`. */
  readonly sourceId: string;
  /** Emberi név, pl. „SEC EDGAR”. */
  readonly sourceName: string;
  readonly kind: ProvenanceKind;
  /** Mikor kértük le (UTC). */
  readonly fetchedAt: IsoTimestamp;
  /** Az adat tényleges időpontja (pl. záróár napja). `null`, ha a forrás nem közölte. */
  readonly asOf: IsoDate | IsoTimestamp | null;
  readonly freshness: Freshness;
  readonly period?: FiscalPeriod;
  readonly currency?: CurrencyCode;
  readonly unit?: MeasurementUnit;
  /** Forrásbeli hivatkozás, pl. SEC accession number, XBRL tag. */
  readonly reference?: string;
  /** Számított értéknél a felhasznált bemenetek azonosítói. */
  readonly inputs?: readonly string[];
  /**
   * PHASE 13 (D-082): ha az érték az eszköz gyorsítótárából (cache) jön, nem közvetlenül a
   * hálózatról. Hiánya = friss hálózati válasz (vagy demóadat). A `fetchedAt` ilyenkor is az
   * EREDETI lekérés ideje marad – a cache soha nem „frissíti fel” az időbélyeget.
   */
  readonly cache?: CacheServeInfo;
}

/**
 * Hogyan szolgálta ki a cache az értéket (PHASE 13, D-082).
 * - `cache_hit`: a rekord a saját TTL-jén belül van, hálózati kérés nem kellett;
 * - `offline_fallback`: a hálózat nem volt elérhető (vagy a kérés átmeneti hibával bukott),
 *   ezért egy korábban letöltött – lehet, hogy elavult – rekordot mutatunk.
 */
export interface CacheServeInfo {
  readonly mode: 'cache_hit' | 'offline_fallback';
  /** Mikor került a rekord a cache-be (≈ az eredeti lekérés ideje). */
  readonly storedAt: IsoTimestamp;
}

/**
 * Offline tartalékból kiszolgált érték SOHA nem lehet `FRESH` (PHASE 13 elfogadási feltétel):
 * nem tudjuk, van-e már újabb adat. A többi frissesség változatlan (a rosszabb marad).
 */
export function capFreshnessForCache(
  freshness: Freshness,
  cache: CacheServeInfo | undefined,
): Freshness {
  if (cache?.mode === 'offline_fallback' && freshness === 'FRESH') return 'STALE';
  return freshness;
}

export interface FreshnessPolicy {
  /** Eddig az életkorig FRESH. */
  readonly freshForMs: number;
  /** Efölött EXPIRED (a kettő között STALE). */
  readonly expiresAfterMs: number;
}

/**
 * Frissesség meghatározása egy referencia-időpont (általában `asOf`) életkorából.
 * - nincs időpont → UNKNOWN
 * - jövőbeli időpont → UNKNOWN (gyanús: óraeltérés vagy hibás adat)
 */
export function assessFreshness(
  reference: IsoDate | IsoTimestamp | null,
  now: Date,
  policy: FreshnessPolicy,
): Freshness {
  if (reference === null) return 'UNKNOWN';
  const ageMs = now.getTime() - toEpochMs(reference);
  if (!Number.isFinite(ageMs) || ageMs < 0) return 'UNKNOWN';
  if (ageMs <= policy.freshForMs) return 'FRESH';
  if (ageMs <= policy.expiresAfterMs) return 'STALE';
  return 'EXPIRED';
}
