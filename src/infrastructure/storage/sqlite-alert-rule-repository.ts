/**
 * SQLite riasztási szabályok (PHASE 14, D-088; 2. migráció). Sérült sor: kimarad és törlődik –
 * a szabály pénzügyi összeget nem tartalmaz, a felhasználó újra felveheti; az app nem akad el.
 */
import { alertRuleSchema, type AlertRule, type AlertRuleRepository } from '@/application';
import { ok } from '@/domain';

import { withDatabase, type DatabaseProvider } from './database-provider';

interface Row {
  readonly id: string;
  readonly json: string;
}

export function decodeAlertRule(json: string): AlertRule | null {
  try {
    const parsed = alertRuleSchema.safeParse(JSON.parse(json));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export function createSqliteAlertRuleRepository(provider: DatabaseProvider): AlertRuleRepository {
  return {
    list: () =>
      withDatabase(provider, 'riasztások olvasása', async (db) => {
        const rows = await db.getAll<Row>('SELECT id, json FROM alert_rules ORDER BY seq ASC');
        const rules: AlertRule[] = [];
        for (const row of rows) {
          const rule = decodeAlertRule(row.json);
          if (rule === null) await db.run('DELETE FROM alert_rules WHERE id = ?', [row.id]);
          else rules.push(rule);
        }
        return ok(rules);
      }),
    save: (rule) =>
      withDatabase(provider, 'riasztás mentése', async (db) => {
        await db.run(
          `INSERT INTO alert_rules (id, listing_id, json, seq)
           VALUES (?, ?, ?, (SELECT COALESCE(MAX(seq), 0) + 1 FROM alert_rules))
           ON CONFLICT(id) DO UPDATE SET json = excluded.json, listing_id = excluded.listing_id`,
          [rule.id, rule.listingId, JSON.stringify(rule)],
        );
        return ok(undefined);
      }),
    remove: (id) =>
      withDatabase(provider, 'riasztás törlése', async (db) => {
        await db.run('DELETE FROM alert_rules WHERE id = ?', [id]);
        return ok(undefined);
      }),
    clear: () =>
      withDatabase(provider, 'riasztások törlése', async (db) => {
        await db.run('DELETE FROM alert_rules');
        return ok(undefined);
      }),
  };
}
