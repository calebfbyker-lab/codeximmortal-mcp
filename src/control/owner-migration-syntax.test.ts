import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const sql = readFileSync(new URL('../../migrations/005_owner_analytics.sql', import.meta.url), 'utf8');
describe('owner analytics migration index-name regression', () => {
  it('uses unqualified index names while retaining qualified parent tables', () => {
    const names = [...sql.matchAll(/CREATE\s+INDEX\s+IF\s+NOT\s+EXISTS\s+(\S+)/gi)].map(match => match[1]);
    expect(names).toEqual(['owner_revenue_events_occurred_at_idx', 'owner_leads_stage_idx']);
    expect(names.every(name => !name.includes('.'))).toBe(true);
    expect(sql).toContain('ON owner_control.owner_revenue_events (occurred_at DESC)');
    expect(sql).toContain('ON owner_control.owner_leads (stage)');
  });
  it('retains replay-safe index declarations without destructive SQL', () => {
    expect(sql.match(/CREATE INDEX IF NOT EXISTS/g)).toHaveLength(2);
    expect(sql).not.toMatch(/\b(DROP|TRUNCATE)\b/i);
  });
});
