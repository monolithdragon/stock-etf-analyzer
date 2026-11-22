import { futureValueOfContributions, type ContributionTiming } from './future-value';
import { failureReason, okValue } from '../core/testing';

/** Független ellenőrzés: hónapról hónapra szimulált egyenleg (nem zárt képlet). */
function simulate(
  payment: number,
  annualRate: number,
  months: number,
  timing: ContributionTiming,
  initial = 0,
): number {
  const i = (1 + annualRate) ** (1 / 12) - 1;
  let balance = initial;
  for (let month = 0; month < months; month += 1) {
    balance = timing === 'begin' ? (balance + payment) * (1 + i) : balance * (1 + i) + payment;
  }
  return balance;
}

describe('futureValueOfContributions', () => {
  it('időszak végi befizetés: egyezik a havi szimulációval (100/hó, 7%, 10 év)', () => {
    const result = okValue(
      futureValueOfContributions({
        periodicPayment: 100,
        annualRate: 0.07,
        years: 10,
        timing: 'end',
      }),
    );
    expect(result.futureValue).toBeCloseTo(simulate(100, 0.07, 120, 'end'), 6);
    expect(result.periods).toBe(120);
    expect(result.totalContributed).toBe(12_000);
    expect(result.growth).toBeCloseTo(result.futureValue - 12_000, 9);
  });

  it('időszak eleji befizetés = végi × (1 + i)', () => {
    const end = okValue(
      futureValueOfContributions({
        periodicPayment: 100,
        annualRate: 0.07,
        years: 10,
        timing: 'end',
      }),
    );
    const begin = okValue(
      futureValueOfContributions({
        periodicPayment: 100,
        annualRate: 0.07,
        years: 10,
        timing: 'begin',
      }),
    );
    expect(begin.futureValue).toBeCloseTo(end.futureValue * (1 + end.periodicRate), 6);
    expect(begin.futureValue).toBeCloseTo(simulate(100, 0.07, 120, 'begin'), 6);
  });

  it('effektív havi ráta: 12 havi kamatozás pontosan az éves hozamot adja', () => {
    const { periodicRate } = okValue(
      futureValueOfContributions({ periodicPayment: 0, annualRate: 0.12, years: 1, timing: 'end' }),
    );
    expect((1 + periodicRate) ** 12 - 1).toBeCloseTo(0.12, 12);
    expect(periodicRate).toBeCloseTo(0.009488793, 8);
  });

  it('0% hozam: FV = befizetések összege (nincs nullával osztás)', () => {
    const result = okValue(
      futureValueOfContributions({
        periodicPayment: 100,
        annualRate: 0,
        years: 10,
        timing: 'begin',
      }),
    );
    expect(result.futureValue).toBe(12_000);
    expect(result.growth).toBe(0);
  });

  it('kezdőösszeg kamatos kamattal: 1000 × 1.07^10', () => {
    const result = okValue(
      futureValueOfContributions({
        periodicPayment: 0,
        annualRate: 0.07,
        years: 10,
        timing: 'end',
        initialAmount: 1000,
      }),
    );
    expect(result.futureValue).toBeCloseTo(1000 * 1.07 ** 10, 8);
  });

  it('negyedéves befizetés, 2.25 év = 9 periódus', () => {
    const result = okValue(
      futureValueOfContributions({
        periodicPayment: 300,
        annualRate: 0.05,
        years: 2.25,
        timing: 'end',
        periodsPerYear: 4,
      }),
    );
    expect(result.periods).toBe(9);
  });

  it('érvénytelen bemenetek → INVALID_INPUT', () => {
    const base = { periodicPayment: 100, annualRate: 0.07, years: 10, timing: 'end' as const };
    const percent = futureValueOfContributions({ ...base, annualRate: 7 });
    expect(percent.status).toBe('INVALID_INPUT');
    expect(failureReason(percent)).toContain('tizedes tört');
    expect(futureValueOfContributions({ ...base, annualRate: -1 }).status).toBe('INVALID_INPUT');
    expect(futureValueOfContributions({ ...base, years: 0 }).status).toBe('INVALID_INPUT');
    expect(futureValueOfContributions({ ...base, years: 1.05 }).status).toBe('INVALID_INPUT');
    expect(futureValueOfContributions({ ...base, periodsPerYear: 0 }).status).toBe('INVALID_INPUT');
    expect(futureValueOfContributions({ ...base, periodicPayment: -1 }).status).toBe(
      'INVALID_INPUT',
    );
    expect(futureValueOfContributions({ ...base, periodicPayment: null }).status).toBe('MISSING');
  });
});
