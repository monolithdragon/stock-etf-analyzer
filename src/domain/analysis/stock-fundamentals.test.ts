import {
  classifyMetricOrigin,
  createFundamentalMetric,
  createQualitativeFinding,
  type QualitativeFindingInput,
} from './stock-fundamentals';
import {
  metricMissing,
  metricNotMeaningful,
  metricOk,
  metricUnavailable,
  type DataProvenance,
  type ProvenanceKind,
} from '../shared';

const prov = (
  kind: ProvenanceKind,
  freshness: DataProvenance['freshness'] = 'FRESH',
): DataProvenance => ({
  sourceId: 's',
  sourceName: 'S',
  kind,
  fetchedAt: '2026-11-21T00:00:00Z' as never,
  asOf: null,
  freshness,
});

describe('classifyMetricOrigin (feladat 9.)', () => {
  it.each([
    ['reported', 'FRESH', 'reported'],
    ['calculated', 'UNKNOWN', 'calculated'],
    ['estimated', 'FRESH', 'estimated'],
    ['user_input', 'FRESH', 'user_input'],
    ['mock', 'EXPIRED', 'mock'],
    ['reported', 'STALE', 'stale'],
    ['calculated', 'EXPIRED', 'stale'],
  ] as const)('%s + %s → %s', (kind, freshness, expected) => {
    expect(classifyMetricOrigin(metricOk(1, prov(kind, freshness)))).toBe(expected);
  });

  it('nem-OK: UNAVAILABLE → unavailable; minden más → missing (a pontos ok a státuszban marad)', () => {
    expect(classifyMetricOrigin(metricUnavailable('PLAN_LIMIT', 'free'))).toBe('unavailable');
    expect(classifyMetricOrigin(metricMissing('nincs'))).toBe('missing');
    expect(classifyMetricOrigin(metricNotMeaningful('negatív EPS'))).toBe('missing');
  });
});

describe('createFundamentalMetric', () => {
  it('AI-értelmezés nem lehet számszerű mutató forrása → INVALID_INPUT', () => {
    const m = createFundamentalMetric({
      id: 'pe',
      unit: 'multiple',
      formula: 'price / eps',
      period: null,
      value: metricOk(20, prov('ai_interpretation')),
    });
    expect(m.value.status).toBe('INVALID_INPUT');
    expect(m.origin).toBe('missing');
  });
});

describe('createQualitativeFinding (feladat 8.)', () => {
  const valid: QualitativeFindingInput = {
    theme: 'MOAT',
    statement: 'A cég 2026-ban 1 200 aktív szabadalmat jelentett.',
    sourceKind: 'filing',
    sourceReference: '10-K 2026, Item 1, accn=0000000000-26-000001',
    verifiableBy: 'A 10-K „Intellectual Property” szakasza.',
    asOf: '2026-11-03',
  };

  it('forrásolt lelet → reported; felhasználói lelet → user_input', () => {
    expect(createQualitativeFinding(valid)).toMatchObject({
      ok: true,
      value: { provenanceKind: 'reported' },
    });
    expect(createQualitativeFinding({ ...valid, sourceKind: 'user' })).toMatchObject({
      ok: true,
      value: { provenanceKind: 'user_input' },
    });
  });

  it.each([
    ['forrás nélkül', { sourceReference: '  ' }],
    ['ellenőrizhetőség nélkül', { verifiableBy: '' }],
    ['üres állítás', { statement: '' }],
    ['ismeretlen téma', { theme: 'VIBES' as never }],
    ['ismeretlen forrásfajta', { sourceKind: 'rumor' as never }],
    ['hibás dátum', { asOf: '2026-13-01' }],
  ])('%s → elutasítva', (_label, patch) => {
    expect(createQualitativeFinding({ ...valid, ...patch }).ok).toBe(false);
  });
});
