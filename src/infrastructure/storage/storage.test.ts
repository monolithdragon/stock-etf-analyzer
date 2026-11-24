/**
 * PHASE 13: SQLite-tárolók VALÓDI SQL-lel (Node beépített SQLite): migráció, portfólió mentése és
 * visszaolvasása, sérült rekordok, figyelőlista, cache-tároló, beállítások (kv), adatbázis-nyitás.
 */
import type { CacheRecord } from '@/application';
import { AAPL, EUR, fxRate, PORTFOLIO, tx, USD, VWCE } from '@/application/portfolio/testing';
import type { IsoTimestamp, PortfolioId } from '@/domain';
import { createNodeSqliteDatabase, type NodeSqliteDatabase } from '@/testing/node-sqlite-database';

import { createDatabaseProvider } from './database-provider';
import {
  createKvPreferencesRepository,
  createMemoryKeyValueStore,
  PREFERENCES_CORRUPT_BACKUP_KEY,
  PREFERENCES_KEY,
} from './kv-preferences-repository';
import {
  LATEST_SCHEMA_VERSION,
  readSchemaVersion,
  runMigrations,
  type Migration,
} from './migrations';
import { createSqliteCacheStore } from './sqlite-cache-store';
import { createSqlitePortfolioRepository } from './sqlite-portfolio-repository';
import { createSqliteWatchlistRepository } from './sqlite-watchlist-repository';

function freshDb() {
  const db = createNodeSqliteDatabase();
  return { db, provider: createDatabaseProvider(async () => db) };
}

describe('migráció', () => {
  it('üres adatbázison létrehozza a sémát és beállítja a verziót', async () => {
    const db = createNodeSqliteDatabase();
    expect(await readSchemaVersion(db)).toBe(0);
    expect(await runMigrations(db)).toEqual({
      status: 'migrated',
      from: 0,
      to: LATEST_SCHEMA_VERSION,
    });
    const tables = await db.getAll<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name",
    );
    expect(tables.map((t) => t.name)).toEqual([
      'cache_entries',
      'portfolios',
      'transactions',
      'watchlist',
    ]);
  });

  it('idempotens: második futás nem csinál semmit', async () => {
    const db = createNodeSqliteDatabase();
    await runMigrations(db);
    expect(await runMigrations(db)).toEqual({
      status: 'up_to_date',
      version: LATEST_SCHEMA_VERSION,
    });
  });

  it('új migráció a meglévő adatot megtartja (v1 → v2 minta)', async () => {
    const db = createNodeSqliteDatabase();
    await runMigrations(db);
    await db.run(
      "INSERT INTO watchlist (listing_id, json, added_at, seq) VALUES ('X@XNAS', '{}', 't', 1)",
    );
    const v2: Migration = {
      version: 2,
      description: 'teszt: új oszlop',
      up: async (d) => d.exec('ALTER TABLE watchlist ADD COLUMN note TEXT'),
    };
    const outcome = await runMigrations(db, [
      { version: 1, description: 'már lefutott', up: async () => undefined },
      v2,
    ]);
    expect(outcome).toEqual({ status: 'migrated', from: 1, to: 2 });
    expect(await db.getAll('SELECT listing_id, note FROM watchlist')).toEqual([
      { listing_id: 'X@XNAS', note: null },
    ]);
  });

  it('hibás migráció visszagörget: a verzió és a séma változatlan', async () => {
    const db = createNodeSqliteDatabase();
    await runMigrations(db);
    const broken: Migration = {
      version: 2,
      description: 'hibás',
      up: async (d) => {
        await d.exec('CREATE TABLE half_done (x TEXT)');
        throw new Error('bumm');
      },
    };
    await expect(
      runMigrations(db, [{ version: 1, description: '', up: async () => undefined }, broken]),
    ).rejects.toThrow('bumm');
    expect(await readSchemaVersion(db)).toBe(1);
    expect(await db.getFirst("SELECT name FROM sqlite_master WHERE name = 'half_done'")).toBeNull();
  });

  it('újabb (ismeretlen) sémaverzió: nem nyitjuk meg, nem törlünk – STORAGE hiba', async () => {
    const db = createNodeSqliteDatabase();
    await runMigrations(db);
    await db.exec(`PRAGMA user_version = ${LATEST_SCHEMA_VERSION + 5}`);
    const provider = createDatabaseProvider(async () => db);
    const opened = await provider();
    expect(opened.ok).toBe(false);
    expect(!opened.ok && opened.error.kind).toBe('STORAGE');
    expect(!opened.ok && opened.error.message).toMatch(/újabb app-verzió/);
  });

  it('sikertelen nyitás után a következő hívás újrapróbál', async () => {
    let attempts = 0;
    const db = createNodeSqliteDatabase();
    const provider = createDatabaseProvider(async () => {
      attempts += 1;
      if (attempts === 1) throw new Error('zárolva');
      return db;
    });
    const first = await provider();
    expect(!first.ok && first.error.message).toMatch(/zárolva/);
    expect((await provider()).ok).toBe(true);
    expect((await provider()).ok).toBe(true);
    expect(attempts).toBe(2);
  });
});

describe('SQLite portfólió-tároló', () => {
  it('portfólió és minden tranzakciótípus mentése és visszaolvasása (újranyitás után is)', async () => {
    const db = createNodeSqliteDatabase();
    const repo = createSqlitePortfolioRepository(createDatabaseProvider(async () => db));
    const transactions = [
      tx.buy(AAPL, '2026-01-02', 10, 100, USD, 1, USD, {
        fxRateToBase: fxRate(USD, 0.92, '2026-01-02'),
      }),
      tx.buy(VWCE, '2026-01-03', 2.5, 101.25, EUR, 0.5),
      tx.dividend(AAPL, '2026-05-15', 5, USD),
      tx.fee(AAPL, '2026-06-01', 1.2, EUR),
      tx.split(AAPL, '2026-07-01', 1, 4),
      tx.sell(AAPL, '2026-08-01', 3, 30, USD, 1),
    ];
    expect((await repo.savePortfolio(PORTFOLIO)).ok).toBe(true);
    for (const t of transactions) expect((await repo.addTransaction(t)).ok).toBe(true);

    // „App-újraindítás”: új repository és provider ugyanazon az adatbázisfájlon.
    const reopened = createSqlitePortfolioRepository(createDatabaseProvider(async () => db));
    expect(await reopened.getPortfolio(PORTFOLIO.id)).toEqual({ ok: true, value: PORTFOLIO });
    expect(await reopened.listTransactions(PORTFOLIO.id)).toEqual({
      ok: true,
      value: transactions,
    });
    expect(await reopened.listPortfolios()).toEqual({ ok: true, value: [PORTFOLIO] });
  });

  it('hiányzó portfólió = ok(null); idegen portfólió tranzakciói nem keverednek', async () => {
    const { provider } = freshDb();
    const repo = createSqlitePortfolioRepository(provider);
    await repo.addTransaction(tx.buy(AAPL, '2026-01-02', 1, 100, USD));
    expect(await repo.getPortfolio('nincs' as PortfolioId)).toEqual({ ok: true, value: null });
    expect(await repo.listTransactions('p2' as PortfolioId)).toEqual({ ok: true, value: [] });
  });

  it('a mentés sorrendje determinisztikus (azonos napi tételeknél is)', async () => {
    const { provider } = freshDb();
    const repo = createSqlitePortfolioRepository(provider);
    const a = tx.buy(AAPL, '2026-02-02', 1, 100, USD);
    const b = tx.sell(AAPL, '2026-02-02', 1, 110, USD);
    await repo.addTransaction(a);
    await repo.addTransaction(b);
    const listed = await repo.listTransactions(PORTFOLIO.id);
    expect(listed.ok && listed.value.map((t) => t.id)).toEqual([a.id, b.id]);
  });

  it('sérült tranzakció-rekord: STORAGE hiba (nem hagyjuk ki csendben → nem hamis P/L)', async () => {
    const { db, provider } = freshDb();
    const repo = createSqlitePortfolioRepository(provider);
    const good = tx.buy(AAPL, '2026-01-02', 10, 100, USD);
    await repo.addTransaction(good);
    await repo.addTransaction(tx.buy(AAPL, '2026-01-03', 1, 100, USD, 0, USD, { id: 'rossz' }));
    await db.run(
      'UPDATE transactions SET json = \'{"type":"BUY","quantity":-5}\' WHERE id = \'rossz\'',
    );
    const listed = await repo.listTransactions(PORTFOLIO.id);
    expect(listed.ok).toBe(false);
    expect(!listed.ok && listed.error.kind).toBe('STORAGE');
    expect(!listed.ok && listed.error.message).toMatch(/rossz/);
  });

  it('üzleti szabályt sértő (de JSON-ként ép) rekord is sérültnek számít (domain-validáció)', async () => {
    const { db, provider } = freshDb();
    const repo = createSqlitePortfolioRepository(provider);
    const t = tx.buy(AAPL, '2026-01-02', 10, 100, USD);
    await repo.addTransaction(t);
    const tampered = JSON.stringify({ ...t, quantity: 0 });
    await db.run('UPDATE transactions SET json = ? WHERE id = ?', [tampered, t.id]);
    expect((await repo.listTransactions(PORTFOLIO.id)).ok).toBe(false);
  });

  it('sérült portfólió-rekord és nem JSON szöveg: STORAGE hiba', async () => {
    const { db, provider } = freshDb();
    const repo = createSqlitePortfolioRepository(provider);
    await repo.savePortfolio(PORTFOLIO);
    await db.run("UPDATE portfolios SET json = 'nem json'");
    const loaded = await repo.getPortfolio(PORTFOLIO.id);
    expect(!loaded.ok && loaded.error.kind).toBe('STORAGE');
  });

  it('deleteAll: minden portfólió és tranzakció törlődik', async () => {
    const { provider } = freshDb();
    const repo = createSqlitePortfolioRepository(provider);
    await repo.savePortfolio(PORTFOLIO);
    await repo.addTransaction(tx.buy(AAPL, '2026-01-02', 1, 100, USD));
    expect((await repo.deleteAll()).ok).toBe(true);
    expect(await repo.listPortfolios()).toEqual({ ok: true, value: [] });
    expect(await repo.listTransactions(PORTFOLIO.id)).toEqual({ ok: true, value: [] });
  });

  it('adatbázis-hiba: STORAGE hiba, nem kivétel', async () => {
    const { db, provider } = freshDb();
    const repo = createSqlitePortfolioRepository(provider);
    await provider();
    await db.exec('DROP TABLE portfolios');
    const loaded = await repo.getPortfolio(PORTFOLIO.id);
    expect(!loaded.ok && loaded.error.kind).toBe('STORAGE');
  });
});

describe('SQLite figyelőlista', () => {
  it('hozzáadás sorrendben, idempotens, eltávolítás, ürítés', async () => {
    const { provider } = freshDb();
    const repo = createSqliteWatchlistRepository(provider);
    await repo.add(
      { listingId: 'AAPL@XNAS', name: 'Apple', kind: 'stock' },
      '2026-11-24T10:00:00Z',
    );
    await repo.add({ listingId: 'VWCE@XETR', name: null, kind: 'etf' }, '2026-11-24T10:01:00Z');
    await repo.add(
      { listingId: 'AAPL@XNAS', name: 'Apple Inc.', kind: 'stock' },
      '2026-11-24T10:02:00Z',
    );
    expect(await repo.list()).toEqual({
      ok: true,
      value: [
        { listingId: 'AAPL@XNAS', name: 'Apple Inc.', kind: 'stock' },
        { listingId: 'VWCE@XETR', name: null, kind: 'etf' },
      ],
    });
    await repo.remove('AAPL@XNAS');
    expect((await repo.list()).ok && (await repo.list())).toEqual({
      ok: true,
      value: [{ listingId: 'VWCE@XETR', name: null, kind: 'etf' }],
    });
    await repo.clear();
    expect(await repo.list()).toEqual({ ok: true, value: [] });
  });

  it('sérült sor kimarad és törlődik, a többi megmarad', async () => {
    const { db, provider } = freshDb();
    const repo = createSqliteWatchlistRepository(provider);
    await repo.add({ listingId: 'AAPL@XNAS', name: 'Apple', kind: 'stock' }, 't');
    await repo.add({ listingId: 'MSFT@XNAS', name: 'Microsoft', kind: 'stock' }, 't');
    await db.run(
      'UPDATE watchlist SET json = \'{"kind":"kripto"}\' WHERE listing_id = \'MSFT@XNAS\'',
    );
    expect(await repo.list()).toEqual({
      ok: true,
      value: [{ listingId: 'AAPL@XNAS', name: 'Apple', kind: 'stock' }],
    });
    expect(await db.getAll('SELECT listing_id FROM watchlist')).toEqual([
      { listing_id: 'AAPL@XNAS' },
    ]);
  });
});

function record(overrides: Partial<CacheRecord> = {}): CacheRecord {
  const ts = (v: string) => v as IsoTimestamp;
  return {
    key: 'quote:AAPL@XNAS',
    kind: 'quote',
    listingId: 'AAPL@XNAS',
    payload: { price: 1, nested: { list: [1, 2] } },
    payloadVersion: 1,
    sourceId: 'fmp',
    sourceName: 'Financial Modeling Prep',
    provenanceKind: 'reported',
    freshnessAtFetch: 'FRESH',
    fetchedAt: ts('2026-11-24T10:00:00.000Z'),
    asOf: '2026-11-24T09:55:00.000Z',
    period: null,
    storedAt: ts('2026-11-24T10:00:00.000Z'),
    freshUntil: ts('2026-11-24T10:15:00.000Z'),
    staleUntil: ts('2026-11-27T10:00:00.000Z'),
    retainUntil: ts('2026-12-24T10:00:00.000Z'),
    invalidatedAt: null,
    ...overrides,
  };
}

describe('SQLite cache-tároló', () => {
  let db: NodeSqliteDatabase;
  let store: ReturnType<typeof createSqliteCacheStore>;
  beforeEach(() => {
    db = createNodeSqliteDatabase();
    store = createSqliteCacheStore(createDatabaseProvider(async () => db));
  });

  it('rekord mentése és visszaolvasása: minden provenance- és érvényességi mező megmarad', async () => {
    const r = record();
    await store.put(r);
    expect(await store.get(r.key)).toEqual({ ok: true, value: r });
    expect(await store.get('nincs')).toEqual({ ok: true, value: null });
  });

  it('sérült sor (rossz JSON / ismeretlen fajta / rossz időbélyeg) → null és törlés', async () => {
    await store.put(record({ key: 'a' }));
    await store.put(record({ key: 'b' }));
    await store.put(record({ key: 'c' }));
    await db.run("UPDATE cache_entries SET payload = '{nem json' WHERE key = 'a'");
    await db.run("UPDATE cache_entries SET kind = 'ismeretlen' WHERE key = 'b'");
    await db.run("UPDATE cache_entries SET fresh_until = 'tegnap' WHERE key = 'c'");
    expect(await store.get('a')).toEqual({ ok: true, value: null });
    const listed = await store.list();
    expect(listed).toEqual({ ok: true, value: [] });
    expect(await db.getAll('SELECT key FROM cache_entries')).toEqual([]);
  });

  it('jegyzés szerinti szűrés, kézi frissítés jelölése, ürítés', async () => {
    await store.put(record({ key: 'quote:AAPL@XNAS' }));
    await store.put(record({ key: 'quote:MSFT@XNAS', listingId: 'MSFT@XNAS' }));
    await store.put(record({ key: 'fx:latest:USD', kind: 'fx_latest', listingId: null }));
    const aapl = await store.list({ listingIds: ['AAPL@XNAS'] });
    expect(aapl.ok && aapl.value.map((r) => r.key)).toEqual(['quote:AAPL@XNAS']);
    expect(await store.list({ listingIds: [] })).toEqual({ ok: true, value: [] });
    expect(await store.markInvalidated(['AAPL@XNAS'], '2026-11-24T11:00:00.000Z')).toEqual({
      ok: true,
      value: 1,
    });
    const marked = await store.get('quote:AAPL@XNAS');
    expect(marked.ok && marked.value?.invalidatedAt).toBe('2026-11-24T11:00:00.000Z');
    const other = await store.get('quote:MSFT@XNAS');
    expect(other.ok && other.value?.invalidatedAt).toBeNull();
    expect(await store.clear()).toEqual({ ok: true, value: 3 });
  });

  it('takarítás: csak a megőrzési időn túli rekordok törlődnek (a legrégebbiek)', async () => {
    await store.put(
      record({ key: 'old', retainUntil: '2026-11-01T00:00:00.000Z' as IsoTimestamp }),
    );
    await store.put(record({ key: 'new' }));
    expect(await store.prune('2026-11-24T12:00:00.000Z')).toEqual({ ok: true, value: 1 });
    const listed = await store.list();
    expect(listed.ok && listed.value.map((r) => r.key)).toEqual(['new']);
  });
});

describe('beállítások (kv-store)', () => {
  const prefs = {
    baseCurrency: 'EUR',
    themePreference: 'dark',
    llmEnabled: true,
    refresh: { refreshOnReconnect: false },
  } as const;

  it('mentés és visszaolvasás; üres tárolónál null (alapértékek)', async () => {
    const kv = createMemoryKeyValueStore();
    const repo = createKvPreferencesRepository(kv);
    expect(await repo.load()).toEqual({ ok: true, value: null });
    await repo.save(prefs);
    expect(await createKvPreferencesRepository(kv).load()).toEqual({ ok: true, value: prefs });
    expect(JSON.parse(kv.snapshot()[PREFERENCES_KEY] ?? '{}')).toMatchObject({ schemaVersion: 2 });
  });

  it('migráció: a v1 (PHASE 12 alak) beolvasva kiegészül és v2-ként visszaíródik', async () => {
    const kv = createMemoryKeyValueStore({
      [PREFERENCES_KEY]: JSON.stringify({
        schemaVersion: 1,
        data: { baseCurrency: 'USD', themePreference: 'light', llmEnabled: false },
      }),
    });
    const loaded = await createKvPreferencesRepository(kv).load();
    expect(loaded).toEqual({
      ok: true,
      value: {
        baseCurrency: 'USD',
        themePreference: 'light',
        llmEnabled: false,
        refresh: { refreshOnReconnect: true },
      },
    });
    expect(JSON.parse(kv.snapshot()[PREFERENCES_KEY] ?? '{}').schemaVersion).toBe(2);
  });

  it('sérült érték: alapértékek, a nyers szöveg biztonsági kulcsra kerül', async () => {
    const kv = createMemoryKeyValueStore({
      [PREFERENCES_KEY]: '{"schemaVersion":2,"data":{"baseCurrency":"JPY"',
    });
    expect(await createKvPreferencesRepository(kv).load()).toEqual({ ok: true, value: null });
    const snap = kv.snapshot();
    expect(snap[PREFERENCES_KEY]).toBeUndefined();
    expect(snap[PREFERENCES_CORRUPT_BACKUP_KEY]).toContain('JPY');
  });

  it('újabb sémaverzió: nem írjuk felül (mentés STORAGE hibát ad)', async () => {
    const raw = JSON.stringify({ schemaVersion: 99, data: { jövő: true } });
    const kv = createMemoryKeyValueStore({ [PREFERENCES_KEY]: raw });
    const repo = createKvPreferencesRepository(kv);
    expect(await repo.load()).toEqual({ ok: true, value: null });
    const saved = await repo.save(prefs);
    expect(!saved.ok && saved.error.kind).toBe('STORAGE');
    expect(kv.snapshot()[PREFERENCES_KEY]).toBe(raw);
  });

  it('tárolási kivétel → STORAGE hiba, nem kivétel', async () => {
    const repo = createKvPreferencesRepository({
      getItemAsync: async () => {
        throw new Error('I/O');
      },
      setItemAsync: async () => {
        throw new Error('I/O');
      },
      removeItemAsync: async () => {
        throw new Error('I/O');
      },
    });
    expect((await repo.load()).ok).toBe(false);
    expect((await repo.save(prefs)).ok).toBe(false);
    expect((await repo.clear()).ok).toBe(false);
  });
});
