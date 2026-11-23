import { AppErrors } from '@/domain';

import { fieldErrors, parseDecimalInput } from './portfolio-forms';

describe('parseDecimalInput', () => {
  it('tizedesvesszőt és szóközös tagolást is elfogad', () => {
    expect(parseDecimalInput('1 234,5')).toBe(1234.5);
    expect(parseDecimalInput('10')).toBe(10);
    expect(parseDecimalInput('0.25')).toBe(0.25);
  });

  it('üres vagy hibás bemenet NaN (nem 0) – a domain validáció utasítja el okkal', () => {
    expect(parseDecimalInput('')).toBeNaN();
    expect(parseDecimalInput('abc')).toBeNaN();
    expect(parseDecimalInput('1,2,3')).toBeNaN();
  });
});

describe('fieldErrors', () => {
  it('a VALIDATION hiba útvonalának első szegmense a mező', () => {
    const errors = fieldErrors(
      AppErrors.validation('Hibás', [
        { path: 'quantity', message: 'pozitív kell' },
        { path: 'price.amount', message: 'pozitív ár kell' },
        { path: 'quantity', message: 'második üzenet (elhagyva)' },
      ]),
    );
    expect(errors).toEqual({ quantity: 'pozitív kell', price: 'pozitív ár kell' });
  });

  it('nem validációs hiba vagy null → nincs mezőhiba', () => {
    expect(fieldErrors(null)).toEqual({});
    expect(fieldErrors(AppErrors.network('offline'))).toEqual({});
  });
});
