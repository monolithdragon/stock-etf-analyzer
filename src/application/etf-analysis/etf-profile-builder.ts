/**
 * `EtfProfile` összerakása: szolgáltatói profil (név, ISIN, ország – `reported`) + ETF-metaadat
 * (kézi `user_input` vagy későbbi szolgáltató) + a jegyzés pénzneme. PHASE 08, D-069.
 *
 * Szabályok:
 * - Metaadat egyáltalán nincs → az ETF-mezők `UNAVAILABLE / PLAN_LIMIT` (a free csomag nem adja).
 * - Metaadat van, de a mező hiányzik → `MISSING` (nem 0, nem alapérték).
 * - A külső/kézi bevitel futásidőben validált; hibás érték → `VALIDATION` hiba a mező útvonalával.
 * - Szolgáltatói (reported) név/ISIN/domicil az elsődleges; eltérő kézi értéknél figyelmeztetés.
 */
import {
  AppErrors,
  ETF_CLASSIFICATION_VALUES,
  ETF_DISTRIBUTIONS,
  ETF_REPLICATIONS,
  TER_SANITY_RANGE,
  assessFreshness,
  createEtfHoldingsSnapshot,
  createMoney,
  err,
  metricMissing,
  metricNotApplicable,
  metricOk,
  metricUnavailable,
  ok,
  parseCountryCode,
  parseCurrencyCode,
  parseIsin,
  parseIsoDate,
  splitListingId,
  type AppError,
  type CurrencyCode,
  type DataProvenance,
  type EtfClassification,
  type EtfClassificationKey,
  type EtfProfile,
  type FreshnessPolicy,
  type InstrumentProfile,
  type IsoTimestamp,
  type ListingId,
  type Metric,
  type Money,
  type Result,
  type ValidationIssue,
} from '@/domain';

import type { EtfMetadataInput } from './types';

const DAY_MS = 86_400_000;

/** Metaadat (TER, AUM…) frissessége: 1 évig friss, 3 év után lejárt `[FELTÉTELEZÉS]`. */
export const ETF_METADATA_FRESHNESS_POLICY: FreshnessPolicy = {
  freshForMs: 365 * DAY_MS,
  expiresAfterMs: 3 * 365 * DAY_MS,
};

/**
 * Holdings frissessége: 120 napig friss (N-PORT: negyedév vége + ~60 nap közzététel),
 * 400 nap után lejárt `[FELTÉTELEZÉS]`.
 */
export const ETF_HOLDINGS_FRESHNESS_POLICY: FreshnessPolicy = {
  freshForMs: 120 * DAY_MS,
  expiresAfterMs: 400 * DAY_MS,
};

/** Domicilek, ahol a UCITS státusz értelmezett (EU/EGT + CH, GB – UCITS-szerű keretek). */
// prettier-ignore
const UCITS_RELEVANT_DOMICILES = new Set([
  'AT', 'BE', 'CH', 'CY', 'CZ', 'DE', 'DK', 'EE', 'ES', 'FI', 'FR', 'GB', 'GR', 'HR', 'HU', 'IE',
  'IS', 'IT', 'LI', 'LT', 'LU', 'LV', 'MT', 'NL', 'NO', 'PL', 'PT', 'RO', 'SE', 'SI', 'SK',
]);

export const NO_METADATA_REASON =
  'A free adatcsomag nem ad ETF-metaadatot (FMP etf/info: 402, EODHD fundamentals: 403); kézzel megadható a kibocsátó factsheetje/KID-je alapján.';

export interface EtfProfileSources {
  readonly listingId: ListingId;
  readonly now: Date;
  readonly fetchedAt: IsoTimestamp;
  readonly metadata: EtfMetadataInput | undefined;
  readonly instrumentProfile: InstrumentProfile | null;
  readonly tradingCurrency: Metric<CurrencyCode>;
}

export interface BuiltEtfProfile {
  readonly profile: EtfProfile;
  readonly warnings: readonly string[];
}

type FieldParser<T> = (raw: unknown) => Result<T>;

function enumParser<T extends string>(values: readonly T[], label: string): FieldParser<T> {
  return (raw) =>
    typeof raw === 'string' && (values as readonly string[]).includes(raw)
      ? ok(raw as T)
      : err(
          AppErrors.validation(`Érvénytelen ${label}: "${String(raw)}".`, [
            { path: '', message: `Megengedett: ${values.join(', ')}.` },
          ]),
        );
}

const stringParser: FieldParser<string> = (raw) =>
  typeof raw === 'string' && raw.trim() !== '' && raw.trim().length <= 200
    ? ok(raw.trim())
    : err(AppErrors.validation('Nem üres, legfeljebb 200 karakteres szöveg kell.'));

const booleanParser: FieldParser<boolean> = (raw) =>
  typeof raw === 'boolean' ? ok(raw) : err(AppErrors.validation('Logikai érték kell.'));

const terParser: FieldParser<number> = (raw) =>
  typeof raw === 'number' &&
  Number.isFinite(raw) &&
  raw >= TER_SANITY_RANGE.min &&
  raw <= TER_SANITY_RANGE.max
    ? ok(raw)
    : err(
        AppErrors.validation(
          `A TER tizedes tört kell ${TER_SANITY_RANGE.min} és ${TER_SANITY_RANGE.max} között (0.0022 = 0,22%), kapott: ${String(raw)}.`,
        ),
      );

const asStringParser =
  <T>(parse: (input: string) => Result<T>): FieldParser<T> =>
  (raw) =>
    typeof raw === 'string' ? parse(raw) : err(AppErrors.validation('Szöveg kell.'));

class MetadataReader {
  readonly issues: ValidationIssue[] = [];
  private readonly provenance: DataProvenance | null;

  constructor(
    private readonly metadata: EtfMetadataInput | undefined,
    fetchedAt: IsoTimestamp,
    now: Date,
  ) {
    if (metadata === undefined) {
      this.provenance = null;
      return;
    }
    const asOf = metadata.source.asOf === null ? null : parseIsoDate(metadata.source.asOf);
    if (asOf !== null && !asOf.ok) {
      this.issues.push({ path: 'source.asOf', message: 'ÉÉÉÉ-HH-NN dátum kell.' });
    }
    const asOfValue = asOf?.ok === true ? asOf.value : null;
    this.provenance = {
      sourceId: metadata.source.sourceId,
      sourceName: metadata.source.sourceName,
      kind: metadata.source.kind,
      fetchedAt,
      asOf: asOfValue,
      freshness: assessFreshness(asOfValue, now, ETF_METADATA_FRESHNESS_POLICY),
    };
  }

  get hasMetadata(): boolean {
    return this.metadata !== undefined;
  }

  get sourceProvenance(): DataProvenance | null {
    return this.provenance;
  }

  /** Hiány-metrika: metaadat nélkül UNAVAILABLE, metaadattal MISSING. */
  absent<T>(field: string): Metric<T> {
    return this.metadata === undefined
      ? metricUnavailable('PLAN_LIMIT', NO_METADATA_REASON)
      : metricMissing(
          `A(z) „${field}” mezőt a forrás (${this.metadata.source.sourceName}) nem adta meg.`,
        );
  }

  read<T>(
    path: string,
    raw: unknown,
    parse: FieldParser<T>,
    extra: Partial<DataProvenance> = {},
  ): Metric<T> {
    if (raw === undefined || raw === null || this.provenance === null) return this.absent(path);
    const parsed = parse(raw);
    if (!parsed.ok) {
      this.issues.push({ path, message: parsed.error.message });
      return this.absent(path);
    }
    return metricOk(parsed.value, { ...this.provenance, ...extra });
  }

  readAum(raw: EtfMetadataInput['aum'], now: Date): Metric<Money> {
    if (raw === undefined || raw === null || this.provenance === null) return this.absent('aum');
    const currency =
      typeof raw.currency === 'string' ? parseCurrencyCode(raw.currency) : parseCurrencyCode('');
    const asOf = raw.asOf ? parseIsoDate(raw.asOf) : null;
    const money =
      typeof raw.amount === 'number' &&
      Number.isFinite(raw.amount) &&
      raw.amount >= 0 &&
      currency.ok
        ? createMoney(raw.amount, currency.value)
        : null;
    if (money === null || !money.ok || (asOf !== null && !asOf.ok)) {
      this.issues.push({
        path: 'aum',
        message: 'Érvénytelen AUM: összeg ≥ 0, ISO pénznem (pl. EUR), ÉÉÉÉ-HH-NN dátum kell.',
      });
      return this.absent('aum');
    }
    const asOfValue = asOf?.ok === true ? asOf.value : this.provenance.asOf;
    return metricOk(money.value, {
      ...this.provenance,
      asOf: asOfValue,
      currency: money.value.currency,
      unit: 'money',
      freshness: assessFreshness(asOfValue, now, ETF_METADATA_FRESHNESS_POLICY),
    });
  }
}

/** Szolgáltatói (reported) érték elsőbbsége; eltérő metaadatnál figyelmeztetés. */
function preferReported<T>(
  label: string,
  reported: { readonly value: T | null; readonly provenance: DataProvenance } | null,
  fromMetadata: Metric<T>,
  warnings: string[],
): Metric<T> {
  if (reported === null || reported.value === null) return fromMetadata;
  if (fromMetadata.status === 'OK' && fromMetadata.value !== reported.value) {
    warnings.push(
      `${label}: a szolgáltató (${reported.provenance.sourceName}) értéke „${String(reported.value)}”, a megadott „${String(fromMetadata.value)}” – a szolgáltatóét használjuk.`,
    );
  }
  return metricOk(reported.value, reported.provenance);
}

function classificationFrom(reader: MetadataReader, metadata: EtfMetadataInput | undefined) {
  const read = <K extends EtfClassificationKey>(key: K) =>
    reader.read(
      `classification.${key}`,
      metadata?.classification?.[key],
      enumParser(ETF_CLASSIFICATION_VALUES[key], `kategória (${key})`),
    );
  return {
    region: read('region'),
    assetClass: read('assetClass'),
    sizeSegment: read('sizeSegment'),
    style: read('style'),
    dividendFocus: read('dividendFocus'),
    weighting: read('weighting'),
  } as EtfClassification;
}

export function buildEtfProfile(sources: EtfProfileSources): Result<BuiltEtfProfile, AppError> {
  const { metadata, instrumentProfile, fetchedAt, now } = sources;
  const reader = new MetadataReader(metadata, fetchedAt, now);
  const warnings: string[] = [];
  const reportedField = <T>(value: T | null) =>
    instrumentProfile === null ? null : { value, provenance: instrumentProfile.provenance };

  const name = preferReported(
    'Név',
    reportedField(instrumentProfile?.name ?? null),
    reader.read('name', metadata?.name, stringParser),
    warnings,
  );
  const isin = preferReported(
    'ISIN',
    reportedField(instrumentProfile?.isin ?? null),
    reader.read('isin', metadata?.isin, asStringParser(parseIsin)),
    warnings,
  );
  const domicile = preferReported(
    'Domicil',
    reportedField(instrumentProfile?.country ?? null),
    reader.read('domicile', metadata?.domicile, asStringParser(parseCountryCode)),
    warnings,
  );

  const aum = reader.readAum(metadata?.aum, now);

  const ter = reader.read('ter', metadata?.ter, terParser, { unit: 'ratio' });
  const replication = reader.read(
    'replication',
    metadata?.replication,
    enumParser(ETF_REPLICATIONS, 'replikáció'),
  );
  const distribution = reader.read(
    'distribution',
    metadata?.distribution,
    enumParser(ETF_DISTRIBUTIONS, 'osztalékkezelés'),
  );
  const fundBaseCurrency = reader.read(
    'fundBaseCurrency',
    metadata?.fundBaseCurrency,
    asStringParser(parseCurrencyCode),
  );
  const inceptionDate = reader.read(
    'inceptionDate',
    metadata?.inceptionDate,
    asStringParser(parseIsoDate),
  );
  const issuer = reader.read('issuer', metadata?.issuer, stringParser);
  const benchmark = reader.read('benchmark', metadata?.benchmark, stringParser);

  // UCITS: csak európai domicilnél releváns.
  let ucits = reader.read('ucits', metadata?.ucits, booleanParser);
  if (domicile.status === 'OK' && !UCITS_RELEVANT_DOMICILES.has(domicile.value)) {
    if (ucits.status === 'OK' && ucits.value) {
      warnings.push(`UCITS = igen, de a domicil ${domicile.value} (nem európai) – ellenőrizd.`);
    } else if (ucits.status !== 'OK') {
      ucits = metricNotApplicable(
        `Nem európai domicil (${domicile.value}): a UCITS státusz nem releváns.`,
      );
    }
  }

  // Devizafedezés.
  const currencyHedged = reader.read('currencyHedged', metadata?.currencyHedged, booleanParser);
  let hedgeCurrency = reader.read(
    'hedgeCurrency',
    metadata?.hedgeCurrency,
    asStringParser(parseCurrencyCode),
  );
  if (currencyHedged.status === 'OK' && !currencyHedged.value) {
    if (hedgeCurrency.status === 'OK') {
      warnings.push(
        'Fedezési deviza meg van adva, de az osztály fedezetlen – a fedezési devizát figyelmen kívül hagyjuk.',
      );
    }
    hedgeCurrency = metricNotApplicable('Fedezetlen osztály: nincs fedezési deviza.');
  } else if (currencyHedged.status === 'OK' && hedgeCurrency.status !== 'OK') {
    hedgeCurrency = metricMissing('Fedezett osztály, de a fedezési deviza nincs megadva.');
  }

  // Holdings.
  let holdings = reader.absent<never>('holdings') as EtfProfile['holdings'];
  const sourceProvenance = reader.sourceProvenance;
  if (metadata?.holdings && sourceProvenance !== null) {
    const snapshot = createEtfHoldingsSnapshot({
      ...metadata.holdings,
      provenance: { ...sourceProvenance, asOf: null },
    });
    if (!snapshot.ok) {
      reader.issues.push(
        ...(snapshot.error.kind === 'VALIDATION' && snapshot.error.issues.length > 0
          ? snapshot.error.issues.map((issue) => ({
              path: `holdings${issue.path ? `.${issue.path}` : ''}`,
              message:
                issue.message === ''
                  ? snapshot.error.message
                  : `${snapshot.error.message} ${issue.message}`,
            }))
          : [{ path: 'holdings', message: snapshot.error.message }]),
      );
    } else {
      const asOf = snapshot.value.asOf;
      const provenance = {
        ...sourceProvenance,
        asOf,
        freshness: assessFreshness(asOf, now, ETF_HOLDINGS_FRESHNESS_POLICY),
      };
      holdings = metricOk({ ...snapshot.value, provenance }, provenance);
    }
  }

  const classification = classificationFrom(reader, metadata);
  if (reader.issues.length > 0) {
    return err(AppErrors.validation('Érvénytelen ETF-metaadat.', reader.issues));
  }

  const { symbol, mic } = splitListingId(sources.listingId);
  return ok({
    profile: {
      listingId: sources.listingId,
      ticker: symbol,
      exchange: mic,
      name,
      isin,
      issuer,
      domicile,
      tradingCurrency: sources.tradingCurrency,
      fundBaseCurrency,
      aum,
      inceptionDate,
      ter,
      replication,
      benchmark,
      distribution,
      ucits,
      currencyHedged,
      hedgeCurrency,
      classification,
      holdings,
    },
    warnings,
  });
}
