/**
 * PHASE 11 – szabályalapú magyarázat (`template` provider, D-026 alapértelmezés).
 *
 * Determinisztikus, ingyenes, offline (a kliensen fut), és NEM hallucinál: minden mondat a
 * `AiInputDto` egy hivatkozott eleméből épül, számot csak a bemenet `display` mezőjéből vagy a
 * motor saját szövegéből idéz. Ugyanazt a kimeneti sémát adja, mint az LLM, és ugyanazon a
 * tartalmi őrön (`validateAiExplanation`) is átmegy (teszt). Eredete: `calculated`.
 *
 * Részvény/ETF és portfólió KÜLÖN sablont kap: a portfólióhoz nincs pontozási szabály, ezért ott
 * nincs „pozitív/negatív” ítélet, csak leíró tények.
 */
import {
  AI_LIMITS,
  AI_SCHEMA_VERSION,
  type AiClaim,
  type AiExplanationContent,
  type AiInputDto,
  type AiInputMetric,
} from '@/contracts';

const MAX = AI_LIMITS.claimsPerSection;
/** Pozitív/negatív tényező határa (kategóriapont) – csak a szövegezést választja, nem pontoz. */
const POSITIVE_FROM = 70;
const NEGATIVE_BELOW = 40;

const clip = (s: string) => (s.length <= AI_LIMITS.text ? s : `${s.slice(0, AI_LIMITS.text - 1)}…`);
const hu1 = (n: number) => n.toFixed(1).replace('.', ',');

const data = (text: string, basedOn: readonly string[]): AiClaim => ({
  text: clip(text),
  basedOn: basedOn.slice(0, AI_LIMITS.basedOnPerClaim),
  support: 'data',
});
const insufficient = (text: string, basedOn: readonly string[] = []): AiClaim => ({
  text: clip(text),
  basedOn: basedOn.slice(0, AI_LIMITS.basedOnPerClaim),
  support: 'insufficient_data',
});

function gapClaims(input: AiInputDto): AiClaim[] {
  const gaps = input.dataGaps;
  const shown = gaps.length > MAX ? gaps.slice(0, MAX - 1) : gaps;
  const claims = shown.map((g) => insufficient(`${g.label}: ${g.reason}`, [g.ref]));
  if (gaps.length > shown.length) {
    const rest = gaps.slice(shown.length);
    claims.push(
      insufficient(
        `Összesen ${gaps.length} hiányzó vagy nem értelmezhető adat; a többi az appban tételesen látható.`,
        rest.map((g) => g.ref),
      ),
    );
  }
  return claims;
}

function reviewTriggerClaims(input: AiInputDto): AiClaim[] {
  const claims: AiClaim[] = [];
  const dated = input.metrics.filter(
    (m): m is AiInputMetric & { asOf: string } => m.status === 'OK' && m.asOf !== null,
  );
  const oldest = [...dated].sort((a, b) => a.asOf.localeCompare(b.asOf))[0];
  if (oldest !== undefined) {
    claims.push(
      data(
        `Új beszámoló, árfolyam- vagy ETF-adat érkezésekor újra kell futtatni az elemzést; a legrégebbi felhasznált adat (${oldest.label}) dátuma: ${oldest.asOf.slice(0, 10)}.`,
        [oldest.ref],
      ),
    );
  }
  const stale = input.metrics.filter(
    (m) => m.status === 'OK' && (m.freshness === 'STALE' || m.freshness === 'EXPIRED'),
  );
  if (stale.length > 0) {
    claims.push(
      data(
        `Elavult forrásadat: ${stale
          .slice(0, 5)
          .map((m) => m.label)
          .join(', ')}${stale.length > 5 ? ' …' : ''} – frissítés után érdemes újraértékelni.`,
        stale.map((m) => m.ref),
      ),
    );
  }
  const e = input.evaluation;
  if (e !== null && e.confidence.level !== 'HIGH') {
    claims.push(
      data(
        `Az elemzés teljessége ${e.confidence.level} szintű; a hiányzó adatok pótlása után az eredmény változhat.`,
        [e.confidence.ref],
      ),
    );
  }
  return claims.slice(0, MAX);
}

function instrumentContent(input: AiInputDto): AiExplanationContent {
  const e = input.evaluation;
  if (e === null) throw new Error('Programozási hiba: részvény/ETF-hez kötelező az evaluation.');
  const name = input.subject.displayName ?? input.subject.id;
  const kindText = input.kind === 'stock' ? 'részvény' : 'ETF';
  const okMetricsOf = (categoryRef: string) =>
    input.metrics
      .filter((m) => m.categoryRef === categoryRef && m.status === 'OK')
      .map((m) => m.ref);

  const total = e.totalScore.value;
  const summary =
    total === null
      ? data(
          `${name} (${kindText}): ${e.decision.labelText}. Összpontszám nem számolható, mert az adatlefedettség a minimum alatt van. Elemzési teljesség: ${e.confidence.level}.`,
          [e.decision.ref, e.confidence.ref],
        )
      : data(
          `${name} (${kindText}): ${e.decision.labelText}, összpontszám ${hu1(total)} pont a konfigurált szabályok szerint. Elemzési teljesség: ${e.confidence.level}.`,
          [e.decision.ref, e.totalScore.ref, e.confidence.ref],
        );

  const scored = e.categories.filter((c): c is typeof c & { score: number } => c.score !== null);
  const describe = (c: (typeof scored)[number]) => {
    const metricRefs = okMetricsOf(c.ref);
    const detail = c.rationale.slice(0, 2).join(' ');
    return data(
      `${c.label}: ${hu1(c.score)} pont${c.status === 'PARTIAL' ? ' (részleges adatból)' : ''}.${detail ? ` ${detail}` : ''}`,
      [c.ref, ...metricRefs],
    );
  };
  const positives = scored
    .filter((c) => c.score >= POSITIVE_FROM)
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX)
    .map(describe);
  const negatives = scored
    .filter((c) => c.score < NEGATIVE_BELOW)
    .sort((a, b) => a.score - b.score)
    .slice(0, MAX)
    .map(describe);

  const keyRisks = e.thesis.risks.slice(0, MAX).map((r) => data(r.statement, [r.ref]));

  const valuationExplanation: AiClaim[] = [];
  const decisionRefs = [
    e.decision.ref,
    ...(e.decision.matchedRule ? [e.decision.matchedRule.ref] : []),
  ];
  for (const driver of e.decision.drivers.slice(0, MAX - 1)) {
    valuationExplanation.push(data(driver, decisionRefs));
  }
  if (e.decision.appliedCaps.length > 0) {
    valuationExplanation.push(
      data(
        `A végső címkét ${e.decision.appliedCaps.length} korlátozó szabály (plafon) módosította az alapszabályhoz képest.`,
        e.decision.appliedCaps.map((c) => c.ref),
      ),
    );
  }

  const dcfAssumptions: AiClaim[] = [];
  if (input.kind === 'stock') {
    if (input.dcf === null || input.dcf.scenarios.length === 0) {
      dcfAssumptions.push(insufficient('DCF-eredmény nem áll rendelkezésre ehhez az elemzéshez.'));
    } else {
      for (const s of input.dcf.scenarios.slice(0, MAX - 1)) {
        dcfAssumptions.push(
          s.status === 'OK'
            ? data(`Becslés – ${s.display}`, [s.ref])
            : insufficient(`${s.label}: ${s.reason ?? 'nem számolható'}.`, [s.ref]),
        );
      }
      const anyOk = input.dcf.scenarios.find((s) => s.status === 'OK');
      if (anyOk !== undefined) {
        dcfAssumptions.push(
          data(
            'A DCF becslés: az eredmény érzékeny a növekedési, a diszkont- és a terminális rátára; a feltevések felülírhatók.',
            input.dcf.scenarios.filter((s) => s.status === 'OK').map((s) => s.ref),
          ),
        );
      }
    }
  }

  const thesisInvalidators = e.thesis.invalidation
    .slice(0, MAX)
    .map((i) => data(i.statement, [i.ref]));

  return {
    schemaVersion: AI_SCHEMA_VERSION,
    kind: input.kind,
    summary,
    positives,
    negatives,
    keyRisks,
    valuationExplanation: valuationExplanation.slice(0, MAX),
    dcfAssumptions: dcfAssumptions.slice(0, MAX),
    dataGaps: gapClaims(input),
    reviewTriggers: reviewTriggerClaims(input),
    thesisInvalidators,
    confidence: { level: e.confidence.level, explanation: clip(e.confidence.meaning) },
  };
}

function portfolioContent(input: AiInputDto): AiExplanationContent {
  const p = input.portfolio;
  if (p === null) throw new Error('Programozási hiba: portfólióhoz kötelező a portfolio szakasz.');
  const open = p.positions.filter((x) => x.status === 'open');
  const weighted = open
    .filter((x): x is typeof x & { weightDisplay: string } => x.weightDisplay !== null)
    .sort((a, b) => (b.weight ?? 0) - (a.weight ?? 0));
  const largest = weighted[0];

  const summary =
    largest === undefined
      ? insufficient(
          `A portfólióban ${p.openPositionCount} nyitott pozíció van, de a súlyok nem számolhatók (hiányzó ár vagy FX).`,
          p.positions.map((x) => x.ref),
        )
      : data(
          `A portfólióban ${p.openPositionCount} nyitott pozíció van (alapdeviza: ${p.baseCurrency}); a legnagyobb súlyú ${largest.listingId} (${largest.weightDisplay}).`,
          [largest.ref],
        );

  const metric = (id: string) => input.metrics.find((m) => m.ref === `metric:${id}`);
  const keyRisks: AiClaim[] = [];
  for (const id of [
    'concentration.top5Weight',
    'concentration.herfindahl',
    'concentration.effectivePositions',
    'history.volatility',
    'history.maxDrawdown',
  ]) {
    const m = metric(id);
    if (m !== undefined && m.status === 'OK' && m.display !== null) {
      keyRisks.push(data(`${m.label}: ${m.display}.`, [m.ref]));
    }
  }
  const exposures = input.metrics.filter((m) => m.ref.startsWith('metric:exposure.') && m.display);
  for (const m of exposures.slice(0, Math.max(0, MAX - keyRisks.length))) {
    keyRisks.push(data(`${m.label}: ${m.display ?? ''}.`, [m.ref]));
  }

  const valuationExplanation: AiClaim[] = [];
  for (const id of ['totals.totalReturnPct', 'history.annualizedReturn']) {
    const m = metric(id);
    if (m !== undefined && m.status === 'OK' && m.display !== null) {
      valuationExplanation.push(
        data(`${m.label}: ${m.display} (múltbeli adat, nem előrejelzés).`, [m.ref]),
      );
    }
  }

  return {
    schemaVersion: AI_SCHEMA_VERSION,
    kind: 'portfolio',
    summary,
    // A portfólióhoz nincs pontozási szabály → a sablon nem minősít (nincs pozitív/negatív ítélet).
    positives: [],
    negatives: [],
    keyRisks: keyRisks.slice(0, MAX),
    valuationExplanation,
    dcfAssumptions: [],
    dataGaps: gapClaims(input),
    reviewTriggers: reviewTriggerClaims(input),
    thesisInvalidators: [],
    confidence: {
      level: 'NOT_APPLICABLE',
      explanation:
        'Portfóliónál nincs összesített elemzési confidence; az adathiányok tételesen szerepelnek.',
    },
  };
}

/** Determinisztikus magyarázat a strukturált bemenetből (ugyanarra a bemenetre ugyanaz). */
export function explainWithTemplate(input: AiInputDto): AiExplanationContent {
  return input.kind === 'portfolio' ? portfolioContent(input) : instrumentContent(input);
}
