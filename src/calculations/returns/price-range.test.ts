import type { IsoDate, PricePoint } from '@/domain';

import { priceRange, WEEK52_RANGE_OPTIONS } from './price-range';

const d = (s: string) => s as IsoDate;

/** Napi pontok `from`-tól `days` napig (hétvégét nem hagyunk ki – a teszt egyszerűsége miatt). */
function series(from: string, days: number, close: (i: number) => number): PricePoint[] {
  const start = Date.parse(`${from}T00:00:00Z`);
  return Array.from({ length: days }, (_, i) => ({
    date: d(new Date(start + i * 86_400_000).toISOString().slice(0, 10)),
    close: close(i),
  }));
}

describe('priceRange (52 hetes csúcs / mélypont)', () => {
  it('az ablakba eső záróárak max/min-je dátummal; az ablakon kívüli pont nem számít', () => {
    const points = series('2025-11-01', 390, (i) => 100 + Math.sin(i / 10) * 10);
    points[0] = { date: points[0]!.date, close: 999 }; // ablakon kívül (2025-11-01)
    const r = priceRange(points, d('2026-11-21'));
    expect(r.status).toBe('OK');
    if (r.status !== 'OK') return;
    expect(r.value.high).toBeLessThan(111);
    expect(r.value.low).toBeGreaterThan(89);
    expect(r.value.highDate > '2025-11-21').toBe(true);
    expect(r.notes[0]).toContain('intraday');
  });

  it('rövid ártörténet (pl. free csomag 3 hónap) → INSUFFICIENT_DATA, nem részleges csúcs', () => {
    const r = priceRange(
      series('2026-08-20', 90, () => 50),
      d('2026-11-17'),
    );
    expect(r.status).toBe('INSUFFICIENT_DATA');
  });

  it('üres sorozat → INSUFFICIENT_DATA; nem pozitív ár → INVALID_INPUT', () => {
    expect(priceRange([], d('2026-11-21')).status).toBe('INSUFFICIENT_DATA');
    const bad = series('2025-11-22', 365, () => 10);
    bad[5] = { date: bad[5]!.date, close: 0 };
    expect(priceRange(bad, d('2026-11-21')).status).toBe('INVALID_INPUT');
  });

  it('az alapértelmezett beállítás 365 nap / 10 nap rés / 200 pont', () => {
    expect(WEEK52_RANGE_OPTIONS).toEqual({ windowDays: 365, maxStartGapDays: 10, minPoints: 200 });
  });
});
