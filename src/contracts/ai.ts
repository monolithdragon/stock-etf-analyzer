/**
 * PHASE 11 – AI-magyarázat: a kliens és a proxy KÖZÖS szerződése (D-076…D-078, DATA_DICTIONARY 17.).
 *
 * Pipeline: Provider → Validation → Calculation → Score/Decision → **AI Explanation** → UI.
 *
 * - `AiInputDto`: az AI EGYETLEN bemenete. Csak a már validált, determinisztikus motor kimenetét
 *   tartalmazza (számított mutatók, adatminőségi státuszok, feltevések, források, időbélyegek,
 *   pontszámok, döntés). Nyers szolgáltatói szöveg (cégleírás, hír) NINCS benne.
 *   Minden hivatkozható elemnek van `ref` azonosítója – az AI állításai ezekre mutatnak (`basedOn`).
 * - `AiExplanationContent`: a strukturált válasz. A sémán túl a `validateAiExplanation`
 *   (ai-guards.ts) tartalmi ellenőrzést is végez (hivatkozások, számok, tiltott állítások).
 *
 * A DTO szándékosan csak primitív mezőket és `string` azonosítókat használ (nincs domain
 * transzformáció), így a zod bemeneti és kimeneti típusa azonos, a JSON pedig kanonikusan hash-elhető.
 */
import { z } from 'zod';

import { FRESHNESS_VALUES, MEASUREMENT_UNITS, METRIC_STATUSES, PROVENANCE_KINDS } from '@/domain';

export const AI_SCHEMA_VERSION = '1';

export const AI_ANALYSIS_KINDS = ['stock', 'etf', 'portfolio'] as const;
export type AiAnalysisKind = (typeof AI_ANALYSIS_KINDS)[number];

/** `template` = szabályalapú (D-026, alapértelmezés); `anthropic` = Claude; `mock` = teszt/demó. */
export const AI_PROVIDER_IDS = ['template', 'anthropic', 'mock'] as const;
export type AiProviderId = (typeof AI_PROVIDER_IDS)[number];

export const AI_CONFIDENCE_LEVELS = ['HIGH', 'MEDIUM', 'LOW', 'INSUFFICIENT'] as const;

/** Méretkorlátok – a prompt költségét és a támadási felületet is korlátozzák. */
export const AI_LIMITS = {
  text: 600,
  shortText: 160,
  ref: 120,
  metrics: 120,
  listItems: 40,
  /** A teljes kérés-törzs felső korlátja (bájt, a proxy ellenőrzi). */
  requestBytes: 96_000,
  claimsPerSection: 8,
  basedOnPerClaim: 12,
} as const;

/** Hivatkozási azonosító: `metric:roe`, `category:GROWTH`, `rule:stock-watch`, `gap:ter` … */
const REF_PATTERN = /^[a-z]+:[A-Za-z0-9_.@:-]{1,100}$/;
const refSchema = z.string().max(AI_LIMITS.ref).regex(REF_PATTERN);

/**
 * Szöveg a DTO-ban: hossz-korlát, és nem lehet benne vezérlőkarakter vagy `<`/`>` (a promptban az
 * adatblokk határait nem lehessen „lezárni”). A DTO-építő a `sanitizeAiText`-tel tisztít.
 */
const UNSAFE_TEXT = /[<>\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;
const dtoText = (max: number = AI_LIMITS.text) =>
  z
    .string()
    .max(max)
    .refine((s) => !UNSAFE_TEXT.test(s), 'Tiltott karakter (vezérlőkarakter vagy < >).');

/** Szolgáltatói / motor-szöveg tisztítása a DTO-hoz (prompt injection elleni első védvonal). */
export function sanitizeAiText(value: string, max: number = AI_LIMITS.text): string {
  const cleaned = value
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, ' ')
    .replace(/</g, '‹')
    .replace(/>/g, '›')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned.length <= max ? cleaned : `${cleaned.slice(0, max - 1)}…`;
}

// --- Bemenet ---------------------------------------------------------------------------------

const sourceSchema = z.strictObject({
  sourceId: dtoText(AI_LIMITS.shortText),
  sourceName: dtoText(AI_LIMITS.shortText),
  kind: z.enum(PROVENANCE_KINDS).nullable(),
  fetchedAt: dtoText(40).nullable(),
});

/** Egy hivatkozható mutató: érték VAGY a hiány oka (a hiány nem 0). */
export const aiInputMetricSchema = z.strictObject({
  ref: refSchema,
  label: dtoText(AI_LIMITS.shortText),
  /** Nyers érték (`ratio` egységben tört: 0.15 = 15%); `null`, ha nincs érték. */
  value: z.union([z.number().finite(), dtoText(AI_LIMITS.shortText)]).nullable(),
  /** Megjelenítési alak (pl. „15,0%”) – az AI csak így idézhet számot. */
  display: dtoText(AI_LIMITS.shortText).nullable(),
  unit: z.enum(MEASUREMENT_UNITS).nullable(),
  currency: dtoText(8).nullable(),
  status: z.enum([...METRIC_STATUSES, 'NO_FEATURE']),
  reason: dtoText().nullable(),
  /** Melyik pontozási kategóriához tartozik (részvény/ETF), ha bármelyikhez. */
  categoryRef: refSchema.nullable(),
  /** A mutató pontja (0–100), ha pontozott. */
  score: z.number().finite().min(0).max(100).nullable(),
  asOf: dtoText(40).nullable(),
  freshness: z.enum(FRESHNESS_VALUES).nullable(),
  source: sourceSchema.nullable(),
});
export type AiInputMetric = z.output<typeof aiInputMetricSchema>;

const aiInputCategorySchema = z.strictObject({
  ref: refSchema,
  label: dtoText(AI_LIMITS.shortText),
  status: z.enum(['SCORED', 'PARTIAL', 'INSUFFICIENT_DATA', 'NOT_SCORED']),
  score: z.number().finite().min(0).max(100).nullable(),
  weight: z.number().finite().min(0),
  coverage: z.number().finite().min(0).max(1),
  dataQuality: z.enum(['HIGH', 'MEDIUM', 'LOW']).nullable(),
  rationale: z.array(dtoText()).max(AI_LIMITS.listItems),
});

const aiInputDecisionSchema = z.strictObject({
  ref: refSchema,
  configId: dtoText(AI_LIMITS.shortText),
  configVersion: dtoText(AI_LIMITS.shortText),
  labelKey: dtoText(40),
  labelText: dtoText(AI_LIMITS.shortText),
  baseLabelKey: dtoText(40),
  /** Más címkék szövege – az AI ezeket NEM használhatja (nem írhatja felül a döntést). */
  otherLabelTexts: z.array(dtoText(AI_LIMITS.shortText)).max(12),
  matchedRule: z.strictObject({ ref: refSchema, description: dtoText() }).nullable(),
  appliedCaps: z
    .array(
      z.strictObject({
        ref: refSchema,
        description: dtoText(),
        from: dtoText(40),
        to: dtoText(40),
      }),
    )
    .max(AI_LIMITS.listItems),
  drivers: z.array(dtoText()).max(AI_LIMITS.listItems),
  disclaimer: dtoText(1000),
});

const aiInputConfidenceSchema = z.strictObject({
  ref: refSchema,
  level: z.enum(AI_CONFIDENCE_LEVELS),
  score: z.number().finite().min(0).max(100),
  reasons: z.array(dtoText()).max(AI_LIMITS.listItems),
  meaning: dtoText(1000),
});

const aiInputThesisSchema = z.strictObject({
  stance: z.enum(['positive', 'neutral', 'negative', 'not_rated']),
  risks: z
    .array(
      z.strictObject({
        ref: refSchema,
        kind: z.enum(['fundamental', 'valuation', 'risk', 'portfolio', 'data']),
        severity: z.enum(['HIGH', 'MEDIUM', 'LOW']),
        statement: dtoText(),
      }),
    )
    .max(AI_LIMITS.listItems),
  invalidation: z
    .array(
      z.strictObject({
        ref: refSchema,
        statement: dtoText(),
        currentValue: z
          .union([z.number().finite(), z.boolean(), dtoText(AI_LIMITS.shortText)])
          .nullable(),
        threshold: z
          .union([z.number().finite(), z.boolean(), dtoText(AI_LIMITS.shortText)])
          .nullable(),
      }),
    )
    .max(AI_LIMITS.listItems),
  note: dtoText(1000),
});

const aiInputEvaluationSchema = z.strictObject({
  totalScore: z.strictObject({
    ref: refSchema,
    value: z.number().finite().min(0).max(100).nullable(),
    status: z.enum(['SCORED', 'PARTIAL', 'INSUFFICIENT_DATA']),
    dataCoverage: z.number().finite().min(0).max(1),
  }),
  categories: z.array(aiInputCategorySchema).max(20),
  decision: aiInputDecisionSchema,
  confidence: aiInputConfidenceSchema,
  thesis: aiInputThesisSchema,
});

const aiInputDcfScenarioSchema = z.strictObject({
  ref: refSchema,
  label: dtoText(AI_LIMITS.shortText),
  /** `default`: a D-064 kiinduló feltevései; `user`: felhasználói felülírás. */
  assumptionSource: z.enum(['default', 'user']),
  explicitYears: z.number().int().min(1).max(10),
  growthRates: z.array(z.number().finite()).max(10),
  discountRate: z.number().finite(),
  terminalGrowth: z.number().finite(),
  display: dtoText(),
  status: z.enum(METRIC_STATUSES),
  intrinsicValuePerShare: z.number().finite().nullable(),
  marginOfSafetyPercent: z.number().finite().nullable(),
  reason: dtoText().nullable(),
});

const aiInputDcfSchema = z.strictObject({
  provenanceKind: z.literal('estimated'),
  currency: dtoText(8).nullable(),
  inputs: z.array(aiInputMetricSchema).max(10),
  scenarios: z.array(aiInputDcfScenarioSchema).max(5),
  notes: z.array(dtoText()).max(AI_LIMITS.listItems),
});

const aiInputPortfolioSchema = z.strictObject({
  /**
   * Adatminimalizálás (R-13, NFR-04): csak súlyok, típusok és százalékos mutatók; pénzösszeg,
   * darabszám, ár és portfólió-név NEM kerül a DTO-ba.
   */
  baseCurrency: dtoText(8),
  openPositionCount: z.number().int().min(0),
  positions: z
    .array(
      z.strictObject({
        ref: refSchema,
        listingId: dtoText(40),
        instrumentKind: dtoText(20).nullable(),
        status: z.enum(['open', 'closed', 'invalid']),
        weight: z.number().finite().min(0).max(1).nullable(),
        weightDisplay: dtoText(40).nullable(),
      }),
    )
    .max(60),
});

const aiDataGapSchema = z.strictObject({
  ref: refSchema,
  label: dtoText(AI_LIMITS.shortText),
  reason: dtoText(),
});

export const aiInputDtoSchema = z
  .strictObject({
    schemaVersion: z.literal(AI_SCHEMA_VERSION),
    kind: z.enum(AI_ANALYSIS_KINDS),
    subject: z.strictObject({
      /** Jegyzés-azonosító (pl. `AAPL@XNAS`) vagy portfóliónál `portfolio`. */
      id: dtoText(40),
      displayName: dtoText(AI_LIMITS.shortText).nullable(),
    }),
    /** A felhasznált elemzés időbélyege (nem a hívásé). */
    analysisGeneratedAt: dtoText(40),
    metrics: z.array(aiInputMetricSchema).max(AI_LIMITS.metrics),
    evaluation: aiInputEvaluationSchema.nullable(),
    dcf: aiInputDcfSchema.nullable(),
    portfolio: aiInputPortfolioSchema.nullable(),
    dataGaps: z.array(aiDataGapSchema).max(AI_LIMITS.metrics),
    warnings: z.array(dtoText()).max(AI_LIMITS.listItems),
    disclaimer: dtoText(1000),
  })
  .superRefine((dto, ctx) => {
    const issue = (path: string, message: string) =>
      ctx.addIssue({ code: 'custom', path: [path], message });
    if (dto.kind === 'portfolio') {
      if (dto.portfolio === null) issue('portfolio', 'Portfólió-elemzéshez kötelező.');
      if (dto.evaluation !== null) issue('evaluation', 'Portfóliónál nincs score/döntés.');
      if (dto.dcf !== null) issue('dcf', 'Portfóliónál nincs DCF.');
    } else {
      if (dto.evaluation === null) issue('evaluation', 'Részvény/ETF elemzéshez kötelező.');
      if (dto.portfolio !== null) issue('portfolio', 'Csak portfólió-elemzésnél.');
      if (dto.kind === 'etf' && dto.dcf !== null) issue('dcf', 'ETF-nél a DCF nem alkalmazható.');
    }
    const seen = new Set<string>();
    for (const ref of collectRefs(dto)) {
      if (seen.has(ref)) issue('refs', `Duplikált hivatkozás: ${ref}.`);
      seen.add(ref);
    }
  });
export type AiInputDto = z.output<typeof aiInputDtoSchema>;

/** A DTO összes hivatkozható azonosítója (sorrendben). */
function collectRefs(dto: AiInputDto): string[] {
  const refs: string[] = dto.metrics.map((m) => m.ref);
  const e = dto.evaluation;
  if (e !== null) {
    refs.push(e.totalScore.ref, e.decision.ref, e.confidence.ref);
    refs.push(...e.categories.map((c) => c.ref));
    if (e.decision.matchedRule !== null) refs.push(e.decision.matchedRule.ref);
    refs.push(...e.decision.appliedCaps.map((c) => c.ref));
    refs.push(...e.thesis.risks.map((r) => r.ref), ...e.thesis.invalidation.map((i) => i.ref));
  }
  if (dto.dcf !== null) {
    refs.push(...dto.dcf.inputs.map((i) => i.ref), ...dto.dcf.scenarios.map((s) => s.ref));
  }
  if (dto.portfolio !== null) refs.push(...dto.portfolio.positions.map((p) => p.ref));
  refs.push(...dto.dataGaps.map((g) => g.ref));
  return refs;
}

/**
 * Hivatkozható elemek → van-e mögöttük tényleges adat. Hiányzó mutató vagy adathiány (`gap:`)
 * csak „nincs elég adat” állítás alapja lehet, tényállításé nem.
 */
export function citableRefs(dto: AiInputDto): ReadonlyMap<string, { readonly hasData: boolean }> {
  const map = new Map<string, { hasData: boolean }>();
  const put = (ref: string, hasData: boolean) => map.set(ref, { hasData });
  for (const m of dto.metrics) put(m.ref, m.status === 'OK' && m.value !== null);
  const e = dto.evaluation;
  if (e !== null) {
    put(e.totalScore.ref, e.totalScore.value !== null);
    put(e.decision.ref, true);
    put(e.confidence.ref, true);
    for (const c of e.categories) put(c.ref, c.score !== null);
    if (e.decision.matchedRule !== null) put(e.decision.matchedRule.ref, true);
    for (const c of e.decision.appliedCaps) put(c.ref, true);
    for (const r of e.thesis.risks) put(r.ref, true);
    for (const i of e.thesis.invalidation) put(i.ref, true);
  }
  if (dto.dcf !== null) {
    for (const i of dto.dcf.inputs) put(i.ref, i.status === 'OK' && i.value !== null);
    for (const s of dto.dcf.scenarios) put(s.ref, s.status === 'OK');
  }
  if (dto.portfolio !== null) {
    for (const p of dto.portfolio.positions) put(p.ref, p.weight !== null);
  }
  for (const g of dto.dataGaps) put(g.ref, false);
  return map;
}

// --- Kimenet ---------------------------------------------------------------------------------

/**
 * Egy állítás. `support: 'data'` → legalább egy `basedOn` hivatkozás, amely mögött van adat;
 * `support: 'insufficient_data'` → az AI kimondja, hogy nincs elég adat (a hiányzó elemekre
 * hivatkozhat).
 */
export const aiClaimSchema = z.strictObject({
  text: z.string().min(1).max(AI_LIMITS.text),
  basedOn: z.array(z.string().max(AI_LIMITS.ref)).max(AI_LIMITS.basedOnPerClaim),
  support: z.enum(['data', 'insufficient_data']),
});
export type AiClaim = z.output<typeof aiClaimSchema>;

const claims = () => z.array(aiClaimSchema).max(AI_LIMITS.claimsPerSection);

/**
 * A strukturált válasz (az LLM is ezt a sémát kapja JSON-sémaként). Szándékosan nincs benne
 * `refine`: a tartalmi szabályokat a `validateAiExplanation` ellenőrzi (a JSON-séma nem fejezi ki).
 */
export const aiExplanationContentSchema = z.strictObject({
  schemaVersion: z.literal(AI_SCHEMA_VERSION),
  kind: z.enum(AI_ANALYSIS_KINDS),
  summary: aiClaimSchema,
  positives: claims(),
  negatives: claims(),
  keyRisks: claims(),
  valuationExplanation: claims(),
  dcfAssumptions: claims(),
  dataGaps: claims(),
  reviewTriggers: claims(),
  thesisInvalidators: claims(),
  /**
   * Az elemzés teljességének / adatminőségének jelzése – a bemenet `confidence.level` értékét
   * kell visszaadni (portfóliónál `NOT_APPLICABLE`). NEM az árfolyam-emelkedés valószínűsége.
   */
  confidence: z.strictObject({
    level: z.enum([...AI_CONFIDENCE_LEVELS, 'NOT_APPLICABLE']),
    explanation: z.string().min(1).max(AI_LIMITS.text),
  }),
});
export type AiExplanationContent = z.output<typeof aiExplanationContentSchema>;

/** A megjelenítendő magyarázat: tartalom + eredet. */
export const aiExplanationDtoSchema = z.strictObject({
  content: aiExplanationContentSchema,
  meta: z.strictObject({
    provider: z.enum(AI_PROVIDER_IDS),
    model: z.string().max(80).nullable(),
    /** `calculated`: szabályalapú (template); `ai_interpretation`: LLM; `mock`: teszt/demó. */
    provenanceKind: z.enum(['calculated', 'ai_interpretation', 'mock']),
    generatedAt: z.string().max(40),
    /** A bemeneti DTO SHA-256 hash-e (cache-kulcs, visszakövethetőség). `null` a kliens template-nél. */
    inputHash: z
      .string()
      .regex(/^[0-9a-f]{64}$/)
      .nullable(),
    cached: z.boolean(),
  }),
});
export type AiExplanationDto = z.output<typeof aiExplanationDtoSchema>;

// --- Kérés (POST /api/v1/ai/explain) ---------------------------------------------------------

export const aiExplainRequestSchema = z
  .strictObject({
    input: aiInputDtoSchema,
    /**
     * Portfólió-elemzésnél kötelező, explicit felhasználói beleegyezés: a súlyok és a
     * jegyzés-azonosítók az LLM-szolgáltatóhoz kerülnek (NFR-04, R-13).
     */
    consent: z.strictObject({ shareWithAiProvider: z.literal(true) }).nullable(),
  })
  .superRefine((request, ctx) => {
    if (request.input.kind === 'portfolio' && request.consent === null) {
      ctx.addIssue({
        code: 'custom',
        path: ['consent'],
        message: 'Portfólió-adat csak explicit beleegyezéssel küldhető AI-szolgáltatónak.',
      });
    }
  });
export type AiExplainRequestDto = z.output<typeof aiExplainRequestSchema>;
