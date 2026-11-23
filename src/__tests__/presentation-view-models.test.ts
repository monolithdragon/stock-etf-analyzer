/**
 * View-model tesztek a VALÓDI use case-kimeneten (demó adatmód, rögzített órával).
 * Ellenőrzik: a hiány nem 0, a címke a döntési engine-től jön, a részvény/ETF/portfólió
 * külön logikát használ, és a kötelező figyelmeztetések megjelennek.
 */
import type { AppServices, InstrumentEvaluation } from '@/application';
import { createAppServices } from '@/config/container';
import { parseCurrencyCode, parseListingId } from '@/domain';
import { buildEtfViewModel } from '@/presentation/view-models/etf-view-model';
import {
  buildEvaluationViewModel,
  DECISION_TONE,
} from '@/presentation/view-models/evaluation-view-model';
import { buildMetricRow, buildTextRow } from '@/presentation/view-models/metric-row';
import { buildPortfolioViewModel } from '@/presentation/view-models/portfolio-view-model';
import { buildStockViewModel } from '@/presentation/view-models/stock-view-model';

const clock = { now: () => new Date('2026-11-21T12:00:00.000Z') };

function services(): AppServices {
  return createAppServices({ dataMode: 'mock', apiBaseUrl: null }, { clock });
}

async function stock() {
  const result = await services().evaluateStock('DEMO@XNAS');
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}

describe('metric-row', () => {
  it('a hiányzó mutató N/A, okkal és provenance nélkül sem vész el az ok', () => {
    const row = buildMetricRow({
      key: 'pe',
      label: 'P/E',
      value: { status: 'MISSING', reason: 'nincs EPS' },
      unit: 'multiple',
    });
    expect(row.text).toBe('N/A');
    expect(row.status).toBe('MISSING');
    expect(row.details).toContainEqual({ label: 'Ok', value: 'nincs EPS' });
    expect(row.accessibilityLabel).toContain('nincs EPS');
  });

  it('az OK érték részletei: forrás, adat típusa, frissesség, pénznem, képlet', () => {
    const row = buildMetricRow({
      key: 'price',
      label: 'Ár',
      value: {
        status: 'OK',
        value: 10,
        provenance: {
          sourceId: 'x',
          sourceName: 'Forrás X',
          kind: 'reported',
          fetchedAt: '2026-11-21T10:00:00.000Z' as never,
          asOf: '2026-11-20' as never,
          freshness: 'STALE',
          currency: 'USD' as never,
        },
      },
      unit: 'money_per_share',
      formula: 'jelentett',
    });
    const labels = row.details.map((d) => `${d.label}=${d.value}`);
    expect(labels).toEqual(
      expect.arrayContaining([
        'Forrás=Forrás X',
        'Adat típusa=jelentett',
        'Frissesség=elavult',
        'Pénznem=USD',
        'Képlet / definíció=jelentett',
        'Adatnap=2026. 11. 20.',
      ]),
    );
  });

  it('szöveges mező: boolean → igen/nem; hiány → N/A', () => {
    expect(
      buildTextRow({
        key: 'ucits',
        label: 'UCITS',
        value: {
          status: 'OK',
          value: true,
          provenance: {
            sourceId: 'u',
            sourceName: 'Kézi',
            kind: 'user_input',
            fetchedAt: '2026-11-21T10:00:00.000Z' as never,
            asOf: null,
            freshness: 'UNKNOWN',
          },
        },
      }).text,
    ).toBe('igen');
    expect(
      buildTextRow({
        key: 'isin',
        label: 'ISIN',
        value: { status: 'UNAVAILABLE', unavailableReason: 'PLAN_LIMIT', reason: 'free csomag' },
      }).text,
    ).toBe('Nem elérhető');
  });
});

describe('részvény view-model', () => {
  it('szakaszok, demó- és részleges-jelzés, nem értékelhető döntés semleges tónussal', async () => {
    const model = buildStockViewModel(await stock());

    expect(model.blockingError).toBeNull();
    expect(model.header.title).toBe('Demo Corp (kitalált)');
    expect(model.sections.map((s) => s.id)).toEqual([
      'overview',
      'valuation',
      'growth',
      'profitability',
      'balance',
      'cashflow',
      'risk',
    ]);
    expect(model.notices.map((n) => n.id)).toEqual(expect.arrayContaining(['mock', 'partial']));
    expect(model.evaluation.decision.labelKey).toBe('NOT_RATED');
    expect(model.evaluation.decision.rated).toBe(false);
    expect(model.evaluation.decision.tone).toBe('neutral');
  });

  it('a hiányzó mutató soha nem „0”', async () => {
    const model = buildStockViewModel(await stock());
    const all = model.sections.flatMap((s) => s.rows);
    const missing = all.filter((r) => r.status !== 'OK');
    expect(missing.length).toBeGreaterThan(0);
    for (const row of missing) {
      expect(row.text).not.toMatch(/^0([,.]0+)?/);
      expect(row.details.some((d) => d.label === 'Ok')).toBe(true);
    }
  });

  it('a DCF nem futtatható → N/A okkal, a nyilatkozat és a konvenciók megvannak', async () => {
    const model = buildStockViewModel(await stock());
    expect(model.dcf.available).toBe(false);
    expect(model.dcf.scenarios.length).toBe(3);
    for (const s of model.dcf.scenarios) {
      expect(s.valueText).toBe('N/A');
      expect(s.assumptionsText).toContain('Diszkontráta');
    }
    expect(model.dcf.disclaimer.length).toBeGreaterThan(0);
    expect(model.dcf.conventions.length).toBeGreaterThan(0);
  });

  it('minden forrás hibája → blokkoló hiba (nem csupa N/A oldal)', async () => {
    const result = await services().evaluateStock('NOPE@XNAS');
    if (!result.ok) throw new Error('a use case részlegesen hibatűrő, ok-ot vár');
    const model = buildStockViewModel(result.value);
    expect(model.blockingError?.kind).toBe('NOT_FOUND');
  });
});

describe('értékelés view-model', () => {
  it('a címke a motor kimenete; a tónus csak megjelenítés', async () => {
    const { evaluation } = await stock();
    const rated: InstrumentEvaluation = {
      ...evaluation,
      decision: { ...evaluation.decision, label: 'BUY', labelText: 'Buy' },
    };
    const model = buildEvaluationViewModel(rated);
    expect(model.decision.labelText).toBe('Buy');
    expect(model.decision.tone).toBe('positive');
    expect(model.decision.rated).toBe(true);
    expect(DECISION_TONE.SELL).toBe('negative');
    expect(DECISION_TONE.NOT_RATED).toBe('neutral');
    // A pont hiánya N/A, nem 0.
    expect(buildEvaluationViewModel(evaluation).score.totalText).toBe('N/A');
    expect(model.disclaimers.every((d) => d.length > 0)).toBe(true);
  });
});

describe('ETF view-model (külön logika)', () => {
  it('ETF-szakaszok, korlátok, összehasonlítási alap; P/E és DCF nem alkalmazható', async () => {
    const result = await services().evaluateEtf('DEMOETF@XETR');
    if (!result.ok) throw new Error(result.error.message);
    const model = buildEtfViewModel(result.value);

    expect(model.sections.map((s) => s.id)).toEqual([
      'basics',
      'costs',
      'benchmark',
      'holdings',
      'style',
      'dividend',
      'tracking',
      'risk',
      'performance',
    ]);
    expect(model.limitations.length).toBeGreaterThan(0);
    expect(model.comparisonBasisText.length).toBeGreaterThan(0);
    expect(model.notApplicable.join(' ')).toMatch(/P\/E/);
    expect(model.countries.available).toBe(false);
    expect(model.countries.reason).not.toBeNull();
    expect(model.notices.map((n) => n.id)).toEqual(expect.arrayContaining(['mock', 'partial']));
    const ter = model.sections.find((s) => s.id === 'costs')?.rows.find((r) => r.key === 'ter');
    expect(ter?.text).not.toBe('0,0%');
  });
});

describe('portfólió view-model (külön logika)', () => {
  async function portfolioWith(listings: readonly string[]) {
    const s = services();
    const created = await s.createPortfolio({ id: 'main', name: 'Teszt', baseCurrency: 'HUF' });
    if (!created.ok) throw new Error(created.error.message);
    const usd = parseCurrencyCode('USD');
    if (!usd.ok) throw new Error('USD');
    for (const raw of listings) {
      const listingId = parseListingId(raw);
      if (!listingId.ok) throw new Error(raw);
      const recorded = await s.recordTransaction({
        portfolioId: 'main',
        listingId: listingId.value,
        type: 'BUY',
        quantity: 10,
        price: 90,
        priceCurrency: usd.value,
        fees: 0,
        feesCurrency: usd.value,
        tradeDate: '2026-11-02',
      });
      if (!recorded.ok) throw new Error(recorded.error.message);
    }
    const analysis = await s.analyzePortfolio('main');
    if (!analysis.ok) throw new Error(analysis.error.message);
    return buildPortfolioViewModel(analysis.value);
  }

  it('összesítés bázispénznemben, előjeles P/L szöveges iránnyal, allokáció, adózási figyelmeztetés', async () => {
    const model = await portfolioWith(['DEMO@XNAS']);

    expect(model.header.baseCurrency).toBe('HUF');
    expect(model.positions).toHaveLength(1);
    expect(model.summary.marketValue.status).toBe('OK');
    expect(model.summary.marketValue.text).toContain('HUF');
    expect(model.summary.unrealized.directionText).not.toBeNull();
    expect(model.allocation).toHaveLength(1);
    expect(model.allocation[0]?.weight).toBeCloseTo(1, 6);
    expect(model.accounting.taxWarning.length).toBeGreaterThan(0);
    expect(model.positions[0]?.plNative.text).toContain('USD');
    expect(model.notices.map((n) => n.id)).toContain('mock');
  });

  it('ár nélküli pozíció: részösszeg + hiányzó tétel, NEM 0 súly a diagramban', async () => {
    const model = await portfolioWith(['DEMO@XNAS', 'NOPE@XNAS']);

    expect(model.summary.marketValue.status).not.toBe('OK');
    expect(model.summary.marketValue.text).toMatch(/részösszeg/);
    expect(model.summary.marketValue.hint).toContain('NOPE@XNAS');
    expect(model.allocation.map((a) => a.key)).not.toContain('NOPE@XNAS');
    expect(model.unpriced.join(' ')).toContain('NOPE@XNAS');
    expect(model.notices.map((n) => n.id)).toContain('partial');
  });
});
