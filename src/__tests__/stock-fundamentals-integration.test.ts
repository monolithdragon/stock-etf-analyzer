/**
 * PHASE 06 integráció: `analyzeStockFundamentals` VALÓS SEC- és FMP-fixture-ökön.
 *
 *   SEC companyfacts fixture → SEC-normalizáló → [hamis gateway] → valódi use case-ek
 *   (frissesség a saját óránkkal) → elemzés.
 *
 * Az ártörténet szintetikus (a fixture-ök között nincs 1 éves AAPL-sor), minden más valós adat.
 * Golden értékek: a SEC 10-K / FMP fixture-ökből kézzel ellenőrizve (lásd a kommenteket).
 */
import type { StockFundamentalAnalysis } from '@/domain';
import { analyze, annualCell, okValue, valuationOf } from '@/testing/stock-analysis-fixtures';

describe('analyzeStockFundamentals – AAPL (valós SEC + FMP fixture)', () => {
  let aapl: StockFundamentalAnalysis;
  beforeAll(async () => {
    aapl = await analyze('AAPL');
  });

  it('áttekintés: név, szektor, ország, pénznemek, év vége, ár, béta, 52 hetes tartomány', () => {
    expect(aapl.overview).toMatchObject({
      ticker: 'AAPL',
      mic: 'XNAS',
      name: 'Apple Inc.',
      sector: 'Technology',
      industry: 'Consumer Electronics',
      country: 'US',
      tradingCurrency: 'USD',
      reportingCurrency: 'USD',
      latestFiscalYearEnd: '2026-09-26',
    });
    expect(okValue(aapl.overview.price)).toBe(342.56);
    expect(aapl.overview.price.origin).toBe('stale'); // az ár > 15 perces (QUOTE_FRESHNESS_POLICY)
    expect(okValue(aapl.overview.beta)).toBe(1.089);
    expect(aapl.overview.beta.origin).toBe('reported');
    expect(okValue(aapl.overview.week52High)).toBe(360.83);
    expect(okValue(aapl.overview.week52Low)).toBe(243.42);
    expect(aapl.overview.week52High.origin).toBe('calculated');
  });

  it('éves oszlopok: csak FY, legfrissebb elöl; a pénzügyi év a szeptemberi záráshoz igazodik', () => {
    const columns = aapl.periodMetrics.annual.columns;
    expect(columns[0]).toMatchObject({ kind: 'FY', label: 'FY2026', end: '2026-09-26' });
    expect(columns.every((c) => c.kind === 'FY')).toBe(true);
  });

  it('FY2025 golden: árbevétel, EPS (jelentett hígított), árrés és növekedés pontos definícióval', () => {
    const fy2025 = aapl.periodMetrics.annual.columns.findIndex((c) => c.fiscalYear === 2025);
    expect(okValue(annualCell(aapl, 'revenue', fy2025))).toBe(416_161_000_000);
    const eps = annualCell(aapl, 'eps', fy2025);
    expect(okValue(eps)).toBeCloseTo(7.46, 2);
    expect(eps.value.status === 'OK' && eps.value.provenance.kind).toBe('reported');
    const gm = annualCell(aapl, 'grossMargin', fy2025);
    expect(gm.formula).toBe('grossProfit / revenue');
    expect(okValue(gm)).toBeGreaterThan(0.4);
    expect(okValue(gm)).toBeLessThan(0.5);
    expect(gm.origin).toBe('calculated');
  });

  it('adósság (D-059) → nettó adósság és D/E már számolható (KI-42 megoldva)', () => {
    expect(okValue(annualCell(aapl, 'totalDebt'))).toBe(80_111_000_000);
    const netDebt = annualCell(aapl, 'netDebt');
    expect(netDebt.value.status).toBe('OK');
    expect(netDebt.formula).toBe('totalDebt − cashAndEquivalents');
    expect(annualCell(aapl, 'debtToEquity').value.status).toBe('OK');
  });

  it('FCF = OCF − CapEx, FCF-árrés és -konverzió; ROE/ROA/ROIC éves oszlopban', () => {
    const fcf = okValue(annualCell(aapl, 'fcf'));
    const ocf = okValue(annualCell(aapl, 'operatingCashFlow'));
    const capex = okValue(annualCell(aapl, 'capitalExpenditure'));
    expect(fcf).toBe(ocf - capex);
    expect(annualCell(aapl, 'fcfMargin').value.status).toBe('OK');
    expect(annualCell(aapl, 'fcfConversion').value.status).toBe('OK');
    expect(annualCell(aapl, 'roe').value.status).toBe('OK');
    expect(annualCell(aapl, 'roic').value.status).toBe('OK');
  });

  it('értékelés: P/E = ár / FY EPS; piaci érték = ár × részvényszám; osztalékhozam TTM-ből', () => {
    const fyEps = okValue(annualCell(aapl, 'eps'));
    expect(okValue(valuationOf(aapl, 'pe'))).toBeCloseTo(342.56 / fyEps, 10);
    expect(valuationOf(aapl, 'pe').notes.join(' ')).toContain('FY2026');
    const shares = okValue(aapl.overview.sharesOutstanding);
    expect(okValue(valuationOf(aapl, 'marketCap'))).toBeCloseTo(342.56 * shares, 0);
    for (const id of ['enterpriseValue', 'ps', 'pb', 'pfcf', 'fcfYield', 'evToEbitda']) {
      expect([id, valuationOf(aapl, id).value.status]).toEqual([id, 'OK']);
    }
    // FMP fixture: 4 negyedéves osztalék az utolsó 365 napban.
    expect(okValue(valuationOf(aapl, 'dividendPerShareTtm'))).toBeGreaterThan(0);
    expect(valuationOf(aapl, 'dividendYield').value.status).toBe('OK');
  });

  it('negyedéves tábla: származtatott Q4 (calculated), EPS a Q4-ben MISSING (nem additív)', () => {
    const q = aapl.periodMetrics.quarterly;
    const q4Index = q.columns.findIndex((c) => c.kind === 'Q4');
    expect(q4Index).toBeGreaterThanOrEqual(0);
    expect(q.columns[q4Index]?.derived).toBe(true);
    const revenue = q.rows.find((r) => r.id === 'revenue')?.cells[q4Index];
    expect(revenue?.value.status).toBe('OK');
    expect(revenue?.value.status === 'OK' && revenue.value.provenance.kind).toBe('calculated');
    expect(q.rows.find((r) => r.id === 'eps')?.cells[q4Index]?.value.status).toBe('MISSING');
    expect(q.rows.find((r) => r.id === 'roe')?.cells[0]?.value.status).toBe('NOT_APPLICABLE');
  });

  it('TTM: 4 egymást követő negyedévből; az árbevétel a négy negyedév összege', () => {
    const ttm = aapl.periodMetrics.ttm;
    expect(ttm.columns).toHaveLength(1);
    const column = ttm.columns[0]!;
    expect(column.kind).toBe('TTM');
    expect(column.constituents).toHaveLength(4);
    const quarterly = aapl.periodMetrics.quarterly;
    const sum = column.constituents
      .map((period) => quarterly.columns.findIndex((c) => c.end === period.end))
      .map((index) => okValue(quarterly.rows.find((r) => r.id === 'revenue')!.cells[index]!))
      .reduce((a, b) => a + b, 0);
    expect(okValue(ttm.rows.find((r) => r.id === 'revenue')!.cells[0]!)).toBe(sum);
  });

  it('trendek: 1/3/5 éves CAGR van; 10 éves INSUFFICIENT_DATA (a fixture 2021 óta szűrt)', () => {
    const revenue = aapl.trends.find((t) => t.id === 'revenue')!;
    const byYears = new Map(revenue.cagr.map((c) => [c.years, c.value]));
    expect(byYears.get(1)?.value.status).toBe('OK');
    expect(byYears.get(3)?.value.status).toBe('OK');
    expect(byYears.get(10)?.value.status).toBe('INSUFFICIENT_DATA');
    // 1 éves CAGR = az éves növekedés.
    expect(okValue(byYears.get(1)!)).toBeCloseTo(okValue(annualCell(aapl, 'revenueGrowth')), 12);
  });

  it('minőség: pontszám nélkül; MOAT és MANAGEMENT forrásolt lelet nélkül Insufficient Data', () => {
    expect(aapl.quality.scoring).toBe('NOT_SCORED');
    const theme = (t: string) => aapl.quality.themes.find((x) => x.theme === t)!;
    expect(theme('MOAT').status).toBe('INSUFFICIENT_DATA');
    expect(theme('MANAGEMENT').status).toBe('INSUFFICIENT_DATA');
    expect(theme('MOAT').evidence.length).toBeGreaterThan(0); // kontextus, nem értékelés
    expect(theme('PROFITABILITY').status).toBe('EVIDENCE_AVAILABLE');
    expect(theme('BUSINESS').status).toBe('EVIDENCE_AVAILABLE');
    expect(JSON.stringify(aapl.quality)).not.toMatch(/"score"/);
  });

  it('adatminőség: források frissességgel, figyelmeztetések, nyilatkozat', () => {
    expect(aapl.dataQuality.sources.map((s) => s.resource)).toEqual([
      'annualStatements',
      'quarterlyStatements',
      'quote',
      'profile',
      'prices',
      'dividends',
    ]);
    expect(aapl.dataQuality.warnings.join(' ')).toContain('nem a naptári évvel zárul');
    expect(aapl.disclaimer).toContain('Nem befektetési tanács');
  });
});

describe('analyzeStockFundamentals – hiányos és eltérő adatok (valós fixture-ök)', () => {
  it('BRK-B: hiányzó EPS → MISSING (nem 0), P/E MISSING; a teljes adósság sem rakható össze', async () => {
    const brk = await analyze('BRK-B', false);
    const eps = annualCell(brk, 'eps');
    expect(eps.value.status).not.toBe('OK');
    expect(eps.origin).toBe('missing');
    expect(annualCell(brk, 'totalDebt').value.status).toBe('MISSING');
    expect(valuationOf(brk, 'pe').origin).toBe('unavailable'); // ár: PLAN_LIMIT
  });

  it('piaci adatok nélkül: az ár-alapú mutatók UNAVAILABLE, a fundamentumok ettől még elkészülnek', async () => {
    const msft = await analyze('MSFT', false);
    expect(msft.overview.price.origin).toBe('unavailable');
    expect(valuationOf(msft, 'marketCap').value.status).toBe('UNAVAILABLE');
    expect(annualCell(msft, 'revenue').value.status).toBe('OK');
    expect(msft.dataQuality.completeness).toBe('PARTIAL');
    expect(msft.dataQuality.sources.find((s) => s.resource === 'quote')?.error?.kind).toBe(
      'UNAVAILABLE',
    );
  });

  it('MSFT: becsült adósság (hiányzó rövid hitel-tény) figyelmeztetést és estimated eredetet ad', async () => {
    const msft = await analyze('MSFT', false);
    expect(annualCell(msft, 'totalDebt').origin).toBe('estimated');
    expect(annualCell(msft, 'netDebt').origin).toBe('estimated');
    expect(msft.dataQuality.warnings.join(' ')).toContain('D-059');
  });

  it('NVDA: a 10:1 split miatt a split előtti és utáni EPS nem keveredik (NOT_MEANINGFUL)', async () => {
    const nvda = await analyze('NVDA', false);
    const eps = nvda.trends.find((t) => t.id === 'eps')!;
    const statuses = eps.cagr.map((c) => c.value.value.status);
    // Legalább egy horizont átível a 2024-es spliten → nem számolunk vegyes bázisú CAGR-t.
    expect(statuses).toContain('NOT_MEANINGFUL');
  });

  it('TSM (20-F, TWD): éves adat van, negyedéves nincs → nincs Q4 és nincs TTM', async () => {
    const tsm = await analyze('TSM', false);
    expect(tsm.overview.reportingCurrency).toBe('TWD');
    expect(tsm.periodMetrics.quarterly.columns).toHaveLength(0);
    expect(tsm.periodMetrics.ttm.columns).toHaveLength(0);
    expect(tsm.periodMetrics.ttm.notes.join(' ')).toContain('TTM nem képezhető');
  });

  it('XOM (új CIK, még nincs 10-K): nincs FY → INSUFFICIENT teljesség, indokolt hiánnyal', async () => {
    const xom = await analyze('XOM', false);
    expect(xom.periodMetrics.annual.columns).toHaveLength(0);
    expect(xom.dataQuality.completeness).toBe('INSUFFICIENT');
    expect(xom.dataQuality.gaps[0]?.reason).toContain('Nincs teljes pénzügyi év');
  });
});
