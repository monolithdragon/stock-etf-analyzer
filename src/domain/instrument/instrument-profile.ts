/**
 * Instrumentum-profil egy tőzsdei jegyzéshez (PHASE 04B, DATA_DICTIONARY 3.4).
 *
 * Szándékosan „lapos” és forrásközeli: azt tartalmazza, amit a profil-forrás (FMP free: csak
 * US) ténylegesen közöl. Minden hiányzó mező explicit `null` – nem találjuk ki (pl. ha a
 * forrás nem ad ISIN-t, nem keresünk hozzá másik forrásból, mert az két forrás keverése volna).
 *
 * Nem `Instrument`: az ETF-metaadat (TER, AUM…) a free forrásokban NEM érhető el (élő próbával
 * igazolva: FMP `etf/info` és EODHD fundamentals → csomagkorlát), ezért a teljes `Etf` itt nem
 * építhető fel. Az ETF-metaadat a PHASE 08 feladata.
 */
import {
  invalid,
  ok,
  parseCik,
  parseCurrencyCode,
  parseIsin,
  parseNullable,
  requireNonEmpty,
  validateFields,
  type Cik,
  type CurrencyCode,
  type DataProvenance,
  type Isin,
  type ListingId,
  type Result,
} from '../shared';
import { parseCountryCode, type InstrumentKind } from './instrument';

export interface InstrumentProfile {
  readonly listingId: ListingId;
  readonly name: string;
  /** A forrás besorolása (pl. FMP `isEtf`); `null`, ha nem egyértelmű. */
  readonly kindHint: InstrumentKind | null;
  readonly isin: Isin | null;
  readonly cik: Cik | null;
  /** ISO 3166-1 alpha-2 (székhely / domicil a forrás szerint). */
  readonly country: string | null;
  readonly sector: string | null;
  readonly industry: string | null;
  readonly exchangeName: string | null;
  /** A jegyzés pénzneme a forrás szerint; `null`, ha nem közli. */
  readonly tradingCurrency: CurrencyCode | null;
  readonly website: string | null;
  /** A forrás leírása (megbízhatatlan szöveg: csak megjelenítésre, méretkorláttal). */
  readonly description: string | null;
  /**
   * Szolgáltató által JELENTETT béta (PHASE 06). A számítási módszert (időtáv, index) a forrás
   * nem közli, ezért csak tájékoztató; saját béta a PHASE 08-ban. `null`, ha nincs.
   */
  readonly beta: number | null;
  readonly provenance: DataProvenance;
}

export interface InstrumentProfileInput {
  readonly listingId: ListingId;
  readonly name: string;
  readonly kindHint: InstrumentKind | null;
  readonly isin: string | null;
  readonly cik: string | null;
  readonly country: string | null;
  readonly sector: string | null;
  readonly industry: string | null;
  readonly exchangeName: string | null;
  readonly tradingCurrency: string | null;
  readonly website: string | null;
  readonly description: string | null;
  /** Opcionális: a béta-mezőt nem ismerő források (mock, régi proxy) elhagyhatják → `null`. */
  readonly beta?: number | null;
  readonly provenance: DataProvenance;
}

export const PROFILE_DESCRIPTION_MAX_LENGTH = 4000;

/** Üres / csak szóköz szöveg → `null` (a forrás sokszor `""`-t ad hiány helyett). */
function blankToNull(value: string | null): string | null {
  const trimmed = value?.trim() ?? '';
  return trimmed === '' ? null : trimmed;
}

export function createInstrumentProfile(input: InstrumentProfileInput): Result<InstrumentProfile> {
  const fields = validateFields(
    {
      name: requireNonEmpty(input.name),
      isin: parseNullable(blankToNull(input.isin), parseIsin),
      cik: parseNullable(blankToNull(input.cik), parseCik),
      country: parseNullable(blankToNull(input.country), parseCountryCode),
      tradingCurrency: parseNullable(blankToNull(input.tradingCurrency), parseCurrencyCode),
      sector: parseNullable(blankToNull(input.sector), (v) => requireNonEmpty(v, 100)),
      industry: parseNullable(blankToNull(input.industry), (v) => requireNonEmpty(v, 100)),
      exchangeName: parseNullable(blankToNull(input.exchangeName), (v) => requireNonEmpty(v, 100)),
      website: parseNullable(blankToNull(input.website), (v) => requireNonEmpty(v, 300)),
    },
    'Érvénytelen instrumentum-profil.',
  );
  if (!fields.ok) return fields;
  const beta = input.beta ?? null;
  if (beta !== null && !Number.isFinite(beta)) {
    return invalid('Érvénytelen instrumentum-profil: a béta nem véges szám.');
  }
  const description = blankToNull(input.description);
  return ok({
    ...fields.value,
    listingId: input.listingId,
    kindHint: input.kindHint,
    description: description === null ? null : description.slice(0, PROFILE_DESCRIPTION_MAX_LENGTH),
    beta,
    provenance: input.provenance,
  });
}
