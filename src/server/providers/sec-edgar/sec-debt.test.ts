/**
 * `totalDebt` összerakása (D-059): egységtesztek + golden értékek valós SEC-fixture-ökön.
 */
import {
  createFiscalPeriod,
  parseCik,
  parseSecurityId,
  type CurrencyCode,
  type FinancialStatementSet,
  type IsoDate,
  type IsoTimestamp,
  type Metric,
} from '@/domain';

import { composeTotalDebt, type DebtComponentFact, type DebtComponentPicks } from './sec-debt';
import { secCompanyFactsShellSchema } from './sec-dto';
import { normalizeSecCompanyFacts } from './sec-normalizer';
import { loadFixture } from '../../testing/test-helpers';

const period = (() => {
  const p = createFiscalPeriod({
    fiscalYear: 2025,
    fiscalPeriod: 'FY',
    start: '2025-01-01',
    end: '2025-12-31',
  });
  if (!p.ok) throw new Error('setup');
  return p.value;
})();

const context = {
  sourceId: 'sec-edgar',
  sourceName: 'SEC EDGAR',
  fetchedAt: '2026-11-22T00:00:00Z' as IsoTimestamp,
  period,
  currency: 'USD' as CurrencyCode,
};

const fact = (tag: string, val: number, filed = '2026-02-01'): DebtComponentFact => ({
  tag,
  val,
  filed: filed as IsoDate,
  reference: `us-gaap:${tag} accn=1 form=10-K filed=${filed}`,
});

const none: DebtComponentPicks = {
  noncurrent: null,
  currentTotal: null,
  currentMaturities: null,
  shortTermBorrowings: null,
  commercialPaper: null,
  otherShortTermBorrowings: null,
};

function expectOk(m: Metric<number>) {
  if (m.status !== 'OK') throw new Error(`${m.status}: ${m.reason}`);
  return m;
}

describe('composeTotalDebt – szabályok', () => {
  it('hosszú lejáratú (nem rövid) rész nélkül MISSING – a hiány nem 0', () => {
    const m = composeTotalDebt({ ...none, currentTotal: fact('DebtCurrent', 5) }, context);
    expect(m.status).toBe('MISSING');
  });

  it('DebtCurrent esetén mellé semmit nem adunk (a rövid hitel és a rövid rész már benne van)', () => {
    const m = expectOk(
      composeTotalDebt(
        {
          ...none,
          noncurrent: fact('LongTermDebtNoncurrent', 100),
          currentTotal: fact('DebtCurrent', 10),
          currentMaturities: fact('LongTermDebtCurrent', 4),
          shortTermBorrowings: fact('ShortTermBorrowings', 6),
        },
        context,
      ),
    );
    expect(m.value).toBe(110);
    expect(m.provenance.kind).toBe('calculated');
    expect(m.provenance.inputs).toEqual(['LongTermDebtNoncurrent', 'DebtCurrent']);
  });

  it('a ShortTermBorrowings elsőbbséget élvez a CommercialPaper-rel szemben (dupla számolás ellen)', () => {
    const m = expectOk(
      composeTotalDebt(
        {
          ...none,
          noncurrent: fact('LongTermDebtNoncurrent', 100),
          currentMaturities: fact('LongTermDebtCurrent', 4),
          shortTermBorrowings: fact('ShortTermBorrowings', 6),
          commercialPaper: fact('CommercialPaper', 5),
        },
        context,
      ),
    );
    expect(m.value).toBe(110);
  });

  it('ShortTermBorrowings hiányában CommercialPaper + OtherShortTermBorrowings összege', () => {
    const m = expectOk(
      composeTotalDebt(
        {
          ...none,
          noncurrent: fact('LongTermDebtNoncurrent', 100),
          currentMaturities: fact('LongTermDebtCurrent', 4),
          commercialPaper: fact('CommercialPaper', 5),
          otherShortTermBorrowings: fact('OtherShortTermBorrowings', 1, '2026-03-01'),
        },
        context,
      ),
    );
    expect(m.value).toBe(110);
    expect(m.provenance.asOf).toBe('2026-03-01');
  });

  it('hiányzó rövid lejáratú csoport → 0-nak véve, de ESTIMATED és megnevezve', () => {
    const m = expectOk(
      composeTotalDebt({ ...none, noncurrent: fact('LongTermDebtNoncurrent', 100) }, context),
    );
    expect(m.value).toBe(100);
    expect(m.provenance.kind).toBe('estimated');
    expect(m.provenance.reference).toContain('currentMaturities, shortTermBorrowings');
  });

  it('negatív komponens → INVALID_INPUT (nem csendes előjelváltás)', () => {
    const m = composeTotalDebt(
      {
        ...none,
        noncurrent: fact('LongTermDebtNoncurrent', 100),
        currentTotal: fact('DebtCurrent', -1),
      },
      context,
    );
    expect(m.status).toBe('INVALID_INPUT');
  });

  it('lízinggel együtt jelentett tagnél megjegyzés', () => {
    const m = expectOk(
      composeTotalDebt(
        {
          ...none,
          noncurrent: fact('LongTermDebtAndCapitalLeaseObligations', 30),
          currentTotal: fact('DebtCurrent', 3),
        },
        context,
      ),
    );
    expect(m.provenance.reference).toContain('pénzügyi lízinggel együtt');
  });
});

function annual(ticker: string): FinancialStatementSet {
  const shell = secCompanyFactsShellSchema.parse(
    loadFixture('sec-edgar', `companyfacts-${ticker}.json`),
  );
  const cik = parseCik(String(shell.cik).padStart(10, '0'));
  const securityId = parseSecurityId(`sec-edgar:${String(shell.cik).padStart(10, '0')}`);
  if (!cik.ok || !securityId.ok) throw new Error('setup');
  const result = normalizeSecCompanyFacts(shell, {
    frequency: 'annual',
    cik: cik.value,
    securityId: securityId.value,
    fetchedAt: '2026-11-21T12:00:00Z' as IsoTimestamp,
    sourceUrl: 'https://data.sec.gov/…',
  });
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}

function debtOf(ticker: string, fiscalYear: number): Metric<number> {
  const balance = annual(ticker).statements.find(
    (s) => s.statementType === 'balance' && s.period.fiscalYear === fiscalYear,
  );
  if (balance?.statementType !== 'balance') throw new Error('nincs mérleg');
  return balance.lineItems.totalDebt;
}

describe('totalDebt – golden értékek (valós SEC-fixture, D-059)', () => {
  it('AAPL FY2026 = nem rövid 68,21 + rövid rész 9,91 + kereskedelmi papír 2,00 Mrd', () => {
    const m = expectOk(debtOf('AAPL', 2026));
    expect(m.value).toBe(80_111_000_000);
    expect(m.provenance.kind).toBe('calculated');
    expect(m.provenance.inputs).toEqual([
      'LongTermDebtNoncurrent',
      'LongTermDebtCurrent',
      'CommercialPaper',
    ]);
  });

  it('JNJ FY2025: DebtCurrent-tel; a ShortTermBorrowings NEM adódik hozzá (nincs dupla számolás)', () => {
    const m = expectOk(debtOf('JNJ', 2025));
    // 39,44 (nem rövid) + 8,50 (DebtCurrent). A LongTermDebt + ShortTermBorrowings 49,93 lenne.
    expect(m.value).toBe(47_938_000_000);
    expect(m.provenance.inputs).toEqual(['LongTermDebtNoncurrent', 'DebtCurrent']);
  });

  it('MSFT FY2026: nincs rövid hitel-tény → estimated, megnevezve', () => {
    const m = expectOk(debtOf('MSFT', 2026));
    expect(m.value).toBe(40_294_000_000);
    expect(m.provenance.kind).toBe('estimated');
    expect(m.provenance.reference).toContain('shortTermBorrowings');
  });

  it('KO FY2025: lízinggel együtt jelentett tagekből, megjegyzéssel', () => {
    const m = expectOk(debtOf('KO', 2025));
    expect(m.value).toBe(45_492_000_000);
    expect(m.provenance.reference).toContain('pénzügyi lízinggel együtt');
  });

  it.each([
    ['JPM', 2025],
    ['BRK-B', 2025],
    ['TSM', 2024],
  ])('%s FY%s: bank / holding / IFRS → MISSING indoklással, nem 0', (ticker, year) => {
    const m = debtOf(ticker, year);
    expect(m.status).toBe('MISSING');
    if (m.status === 'MISSING') expect(m.reason).toContain('D-059');
  });
});
