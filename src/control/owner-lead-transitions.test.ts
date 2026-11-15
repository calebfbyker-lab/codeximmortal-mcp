import { describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { PostgresLeadTransitions, leadTransitionAllowed } from './owner-lead-transitions.js';
const cmd = { commandId: '11111111-1111-4111-8111-111111111111', leadId: '22222222-2222-4222-8222-222222222222', from: 'new' as const, to: 'qualified' as const, reason: 'Owner reviewed fit' };
function fixture(options: { stage?: string; auditFails?: boolean; prior?: Record<string, unknown> } = {}) {
  const sql: string[] = [];
  let released = false;
  const client = {
    query: async (q: string) => {
      sql.push(q);
      if (q.startsWith('SELECT lead_id')) return { rows: options.prior ? [options.prior] : [], rowCount: options.prior ? 1 : 0 };
      if (q.startsWith('SELECT stage')) return { rows: [{ stage: options.stage ?? 'new' }], rowCount: 1 };
      if (q.startsWith('UPDATE')) return { rows: [{ id: cmd.leadId }], rowCount: 1 };
      if (q.startsWith('INSERT') && options.auditFails) throw new Error('private driver detail');
      return { rows: [], rowCount: 0 };
    }, release: () => { released = true; },
  };
  const pool = { connect: async () => client } as unknown as Pick<Pool, 'connect'>;
  return { store: new PostgresLeadTransitions(pool, 'owner'), sql, released: () => released };
}
describe('approved lead transitions', () => {
  it('permits only forward stages or explicit loss and keeps terminal states closed', () => {
    expect(leadTransitionAllowed('new', 'qualified')).toBe(true);
    expect(leadTransitionAllowed('engaged', 'won')).toBe(true);
    for (const pair of [['new','won'], ['won','engaged'], ['lost','new'], ['new','new'], ['__proto__','won']]) expect(leadTransitionAllowed(pair[0], pair[1])).toBe(false);
  });
  it('commits the update and approval receipt together', async () => {
    const f = fixture();
    expect(await f.store.approve(cmd)).toEqual({ replayed: false });
    expect(f.sql.some(s => s.startsWith('UPDATE'))).toBe(true);
    expect(f.sql.some(s => s.startsWith('INSERT'))).toBe(true);
    expect(f.sql.at(-1)).toBe('COMMIT');
    expect(f.released()).toBe(true);
  });
  it('rolls back if audit insertion fails and redacts driver details', async () => {
    const f = fixture({ auditFails: true });
    await expect(f.store.approve(cmd)).rejects.toThrow('lead_store_unavailable');
    expect(f.sql.at(-1)).toBe('ROLLBACK');
    expect(f.sql).not.toContain('COMMIT');
  });
  it('rejects a stale expected stage before updating', async () => {
    const f = fixture({ stage: 'engaged' });
    await expect(f.store.approve(cmd)).rejects.toThrow('lead_stage_conflict');
    expect(f.sql.some(s => s.startsWith('UPDATE'))).toBe(false);
  });
  it('returns the original approval for an identical retry without another update', async () => {
    const f = fixture({ prior: { lead_id: cmd.leadId, actor: 'owner', from_stage: cmd.from, to_stage: cmd.to, reason: cmd.reason } });
    expect(await f.store.approve(cmd)).toEqual({ replayed: true });
    expect(f.sql.some(s => s.startsWith('UPDATE'))).toBe(false);
  });
  it('rejects idempotency-key reuse with different content', async () => {
    const f = fixture({ prior: { lead_id: cmd.leadId, actor: 'owner', from_stage: 'qualified', to_stage: 'engaged', reason: cmd.reason } });
    await expect(f.store.approve(cmd)).rejects.toThrow('lead_command_conflict');
  });
  it('rejects invalid commands before database access', async () => {
    const f = fixture();
    await expect(f.store.approve({ ...cmd, to: 'won' })).rejects.toThrow('invalid_lead_transition');
    expect(f.sql).toEqual([]);
  });
});
