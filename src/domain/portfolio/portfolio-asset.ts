/**
 * Egy portfólióban tartott jegyzés leíró metaadata a kitettség-bontáshoz (PHASE 09 feladat 4.,
 * DATA_DICTIONARY 7.3, D-072).
 *
 * Forrás: szolgáltatói profil (`reported`, pl. FMP – free csomagban csak US) vagy felhasználói
 * bevitel (`user_input`). A hiányzó mező explicit `null` – nem találjuk ki; a kitettség-bontásban
 * „besorolatlan” lesz.
 *
 * Fontos: az ETF `country` mezője a DOMICIL (pl. IE), NEM a gazdasági kitettség – ezért ETF-nél a
 * közvetlen ország-bontás nem használja; az ETF ország-/szektorkitettsége csak holdings-ból
 * (look-through) jön.
 */
import { ETF_ASSET_CLASSES, type EtfAssetClass } from '../etf/etf-classification';
import { INSTRUMENT_KINDS, parseCountryCode, type InstrumentKind } from '../instrument/instrument';
import {
  invalid,
  ok,
  parseCurrencyCode,
  parseIsin,
  parseNullable,
  requireNonEmpty,
  validateFields,
  type CurrencyCode,
  type Isin,
  type ListingId,
  type Result,
} from '../shared';

export interface PortfolioAssetMetadata {
  readonly listingId: ListingId;
  readonly name: string | null;
  readonly isin: Isin | null;
  readonly kind: InstrumentKind | null;
  /** Részvénynél mindig `equity`; ETF-nél a besorolásból / kézi bevitelből. */
  readonly assetClass: EtfAssetClass | null;
  /** Részvény: székhely / kockázati ország (ISO alpha-2). ETF-nél NEM használjuk kitettségként. */
  readonly country: string | null;
  readonly sector: string | null;
  /** Devizafedezett ETF-osztály fedezési devizája (a teljes kitettség ide sorolódik, D-068/3). */
  readonly hedgeCurrency: CurrencyCode | null;
  readonly source: { readonly kind: 'reported' | 'user_input'; readonly sourceName: string };
}

export interface PortfolioAssetMetadataInput {
  readonly listingId: ListingId;
  readonly name?: string | null;
  readonly isin?: string | null;
  readonly kind?: string | null;
  readonly assetClass?: string | null;
  readonly country?: string | null;
  readonly sector?: string | null;
  readonly hedgeCurrency?: string | null;
  readonly source: { readonly kind: 'reported' | 'user_input'; readonly sourceName: string };
}

function parseEnum<T extends string>(values: readonly T[], label: string) {
  return (input: string): Result<T> =>
    (values as readonly string[]).includes(input)
      ? ok(input as T)
      : invalid(`Ismeretlen ${label}: "${input}" (megengedett: ${values.join(', ')}).`);
}

export function createPortfolioAssetMetadata(
  input: PortfolioAssetMetadataInput,
): Result<PortfolioAssetMetadata> {
  const fields = validateFields(
    {
      name: parseNullable(input.name, (v) => requireNonEmpty(v, 200)),
      isin: parseNullable(input.isin, parseIsin),
      kind: parseNullable(input.kind, parseEnum(INSTRUMENT_KINDS, 'instrumentumfajta')),
      assetClass: parseNullable(input.assetClass, parseEnum(ETF_ASSET_CLASSES, 'eszközosztály')),
      country: parseNullable(input.country, parseCountryCode),
      sector: parseNullable(input.sector, (v) => requireNonEmpty(v, 100)),
      hedgeCurrency: parseNullable(input.hedgeCurrency, parseCurrencyCode),
      sourceName: requireNonEmpty(input.source.sourceName, 100),
    },
    'Érvénytelen eszköz-metaadat.',
  );
  if (!fields.ok) return fields;
  const { sourceName, ...rest } = fields.value;
  if (rest.kind === 'stock' && rest.assetClass !== null && rest.assetClass !== 'equity') {
    return invalid('Részvény eszközosztálya csak `equity` lehet.');
  }
  return ok({
    ...rest,
    listingId: input.listingId,
    assetClass: rest.kind === 'stock' ? 'equity' : rest.assetClass,
    source: { kind: input.source.kind, sourceName },
  });
}
