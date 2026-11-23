import { AppErrors, type DataProvenance, type Metric } from '@/domain';

import {
  currencyDecimals,
  directionOf,
  formatAppError,
  formatDate,
  formatDateTime,
  formatLargeMoney,
  formatLargeNumber,
  formatMetric,
  formatMoney,
  formatMoneyMetric,
  formatMultiple,
  formatNumber,
  formatPercent,
  formatUnitValue,
} from './index';

const NBSP = ' ';
const provenance: DataProvenance = {
  sourceId: 'test',
  sourceName: 'Teszt',
  kind: 'reported',
  fetchedAt: '2026-11-23T10:00:00.000Z' as DataProvenance['fetchedAt'],
  asOf: null,
  freshness: 'FRESH',
};

describe('formatNumber', () => {
  it('magyar tagolás és tizedesvessző', () => {
    expect(formatNumber(1234567.891)).toBe(`1${NBSP}234${NBSP}567,89`);
    expect(formatNumber(999.5, 0)).toBe(`1${NBSP}000`);
    expect(formatNumber(0.5, 1)).toBe('0,5');
  });

  it('negatív szám előjellel; a kerekítés utáni -0 előjel nélkül', () => {
    expect(formatNumber(-1234.5, 1)).toBe(`-1${NBSP}234,5`);
    expect(formatNumber(-0.001, 2)).toBe('0,00');
  });

  it('nem véges szám N/A, nem 0', () => {
    expect(formatNumber(Number.NaN)).toBe('N/A');
    expect(formatNumber(Number.POSITIVE_INFINITY)).toBe('N/A');
  });
});

describe('százalék, szorzó, pénz', () => {
  it('tört → százalék, opcionális előjellel', () => {
    expect(formatPercent(0.153)).toBe('15,3%');
    expect(formatPercent(0.023, { signed: true })).toBe('+2,3%');
    expect(formatPercent(-0.05, { signed: true })).toBe('-5,0%');
    expect(formatPercent(0, { signed: true })).toBe('0,0%');
    expect(formatPercent(0.12345, { decimals: 2 })).toBe('12,35%');
  });

  it('szorzó', () => {
    expect(formatMultiple(18.43)).toBe('18,4x');
  });

  it('pénz: pénznem szerinti tizedesek, HUF egészre', () => {
    expect(formatMoney(1234.5, 'USD')).toBe(`1${NBSP}234,50${NBSP}USD`);
    expect(formatMoney(1234.5, 'HUF')).toBe(`1${NBSP}235${NBSP}HUF`);
    expect(formatMoney(10, null)).toBe('10,00');
    expect(formatMoney(5, 'EUR', { signed: true })).toBe(`+5,00${NBSP}EUR`);
    expect(currencyDecimals('JPY')).toBe(0);
    expect(currencyDecimals(undefined)).toBe(2);
  });

  it('nagy számok magyar rövidítéssel', () => {
    expect(formatLargeNumber(1_234_000_000)).toBe(`1,23${NBSP}Mrd`);
    expect(formatLargeNumber(2_500_000)).toBe(`2,50${NBSP}M`);
    expect(formatLargeNumber(3_100_000_000_000)).toBe(`3,10${NBSP}ezer${NBSP}Mrd`);
    expect(formatLargeNumber(12_300)).toBe(`12,30${NBSP}e`);
    expect(formatLargeNumber(512)).toBe('512');
    expect(formatLargeNumber(-4_000_000)).toBe(`-4,00${NBSP}M`);
    expect(formatLargeMoney(2.5e9, 'USD')).toBe(`2,50${NBSP}Mrd${NBSP}USD`);
  });

  it('mértékegység szerinti formázás', () => {
    expect(formatUnitValue(0.2, 'ratio')).toBe('20,0%');
    expect(formatUnitValue(12.34, 'multiple')).toBe('12,3x');
    expect(formatUnitValue(3.5, 'money_per_share', 'USD')).toBe(`3,50${NBSP}USD`);
    expect(formatUnitValue(5e9, 'money', 'USD')).toBe(`5,00${NBSP}Mrd${NBSP}USD`);
    expect(formatUnitValue(7, 'count')).toBe('7');
    expect(formatUnitValue(1e6, 'shares')).toBe(`1,00${NBSP}M`);
  });
});

describe('dátum', () => {
  it('ISO dátum → ÉÉÉÉ. HH. NN.', () => {
    expect(formatDate('2026-11-23')).toBe('2026. 11. 23.');
    expect(formatDate(null)).toBe('N/A');
    expect(formatDate('nem dátum')).toBe('N/A');
  });

  it('időbélyeg → helyi dátum és idő', () => {
    expect(formatDateTime('2026-11-23T10:05:00.000Z')).toMatch(/^2026\. 11\. 2[34]\. \d{2}:\d{2}$/);
    expect(formatDateTime('2026-11-23')).toBe('2026. 11. 23.');
  });
});

describe('formatMetric – a hiányzó adat nem nulla', () => {
  it('OK érték a provenance pénznemével', () => {
    const metric: Metric<number> = {
      status: 'OK',
      value: 2e9,
      provenance: { ...provenance, currency: 'USD' as never },
    };
    expect(formatMetric(metric, 'money')).toMatchObject({
      text: `2,00${NBSP}Mrd${NBSP}USD`,
      status: 'OK',
    });
  });

  it.each([
    ['MISSING', 'N/A'],
    ['NOT_APPLICABLE', 'N/A'],
    ['NOT_MEANINGFUL', 'N/M'],
    ['INSUFFICIENT_DATA', 'Kevés adat'],
    ['INVALID_INPUT', 'Hibás bemenet'],
    ['ERROR', 'Hiba'],
  ] as const)('%s → %s, okkal', (status, text) => {
    const formatted = formatMetric({ status, reason: 'mert' }, 'ratio');
    expect(formatted.text).toBe(text);
    expect(formatted.text).not.toBe('0');
    expect(formatted.reason).toBe('mert');
    expect(formatted.accessibilityText).toContain('mert');
  });

  it('UNAVAILABLE → „Nem elérhető”', () => {
    expect(
      formatMetric({ status: 'UNAVAILABLE', unavailableReason: 'PLAN_LIMIT', reason: 'free' }, null)
        .text,
    ).toBe('Nem elérhető');
  });

  it('pénz-metrika előjellel', () => {
    const ok = formatMoneyMetric(
      { status: 'OK', value: { amount: -12.5, currency: 'EUR' as never }, provenance },
      { signed: true },
    );
    expect(ok.text).toBe(`-12,50${NBSP}EUR`);
    expect(formatMoneyMetric({ status: 'MISSING', reason: 'nincs ár' }).text).toBe('N/A');
  });

  it('irány a szín mellé', () => {
    expect(directionOf(1)).toBe('up');
    expect(directionOf(-1)).toBe('down');
    expect(directionOf(0)).toBe('flat');
  });
});

describe('formatAppError', () => {
  it('átmeneti hiba újrapróbálható, a végleges nem', () => {
    expect(formatAppError(AppErrors.network('offline')).retryable).toBe(true);
    expect(formatAppError(AppErrors.timeout('lassú')).title).toBe('Időtúllépés');
    expect(formatAppError(AppErrors.notFound('árfolyam', 'X@Y')).retryable).toBe(false);
    expect(formatAppError(AppErrors.unavailable('QUOTA_EXHAUSTED', 'kvóta')).retryable).toBe(true);
    expect(formatAppError(AppErrors.unavailable('PLAN_LIMIT', 'csomag')).retryable).toBe(false);
  });

  it('validációs hiba a mezőket is felsorolja', () => {
    const formatted = formatAppError(
      AppErrors.validation('Hibás', [{ path: 'quantity', message: 'pozitív kell' }]),
    );
    expect(formatted.message).toContain('quantity: pozitív kell');
  });

  it('AI-hibák érthető címmel', () => {
    expect(formatAppError(AppErrors.ai('AI_DISABLED', 'off')).title).toBe(
      'Az AI-magyarázat ki van kapcsolva',
    );
    expect(formatAppError(AppErrors.rateLimited('sok', 30)).message).toContain('30 mp');
  });
});
