import type { Pool } from 'pg';
import type { LeadStage } from './owner-analytics.js';

export const LEAD_TRANSITION_POLICY = Object.freeze({
  new: ['qualified', 'lost'], qualified: ['engaged', 'lost'],
  engaged: ['won', 'lost'], won: [], lost: [],
} satisfies Record<LeadStage, readonly LeadStage[]>);

export function leadTransitionAllowed(from: string, to: string): boolean {
  if (!Object.hasOwn(LEAD_TRANSITION_POLICY, from)) return false;
  return (LEAD_TRANSITION_POLICY[from as LeadStage] as readonly string[]).includes(to);
}
export interface LeadTransitionCommand {
  commandId: string; leadId: string; from: LeadStage; to: LeadStage; reason: string;
}
export class LeadTransitionError extends Error {}
const uuid = (s: unknown): s is string => typeof s === 'string' && /^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(s);

/** Actor must be supplied from the verified owner session, never request body.
 * This store records explicit owner approval, not independent dual approval.
 * No external action, payment or verified revenue is implied by 'won'.
 */
export class PostgresLeadTransitions {
  constructor(private readonly pool: Pick<Pool, 'connect'>, private readonly actor: string) {
    if (!/^[A-Za-z0-9_.@-]{1,100}$/.test(actor)) throw new LeadTransitionError('invalid_actor');
  }
  async approve(command: LeadTransitionCommand): Promise<{ replayed: boolean }> {
    if (!uuid(command.commandId) || !uuid(command.leadId)
      || !leadTransitionAllowed(command.from, command.to)
      || typeof command.reason !== 'string' || command.reason.trim().length < 1 || command.reason.length > 400) {
      throw new LeadTransitionError('invalid_lead_transition');
    }
    const c = await this.pool.connect().catch(() => { throw new LeadTransitionError('lead_store_unavailable'); });
    try {
      await c.query('BEGIN');
      await c.query("SET LOCAL statement_timeout = '5000ms'");
      await c.query("SET LOCAL lock_timeout = '3000ms'");
      // Serialize identical command IDs, including retries targeting different leads.
      await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [command.commandId.toLowerCase()]);
      const prior = await c.query('SELECT lead_id::text, actor, from_stage, to_stage, reason FROM owner_control.owner_lead_transition_events WHERE command_id=$1::uuid', [command.commandId]);
      if (prior.rows.length) {
        const r = prior.rows[0];
        if (r.lead_id !== command.leadId.toLowerCase() || r.actor !== this.actor
          || r.from_stage !== command.from || r.to_stage !== command.to || r.reason !== command.reason.trim()) {
          throw new LeadTransitionError('lead_command_conflict');
        }
        await c.query('COMMIT');
        return { replayed: true };
      }
      const lead = await c.query('SELECT stage FROM owner_control.owner_leads WHERE id=$1::uuid FOR UPDATE', [command.leadId]);
      if (lead.rows.length !== 1) throw new LeadTransitionError('lead_not_found');
      if (lead.rows[0].stage !== command.from) throw new LeadTransitionError('lead_stage_conflict');
      const updated = await c.query('UPDATE owner_control.owner_leads SET stage=$2, updated_at=clock_timestamp() WHERE id=$1::uuid AND stage=$3 RETURNING id', [command.leadId, command.to, command.from]);
      if (updated.rowCount !== 1) throw new LeadTransitionError('lead_stage_conflict');
      await c.query("INSERT INTO owner_control.owner_lead_transition_events (command_id,lead_id,actor,from_stage,to_stage,reason,policy_version,decision) VALUES ($1::uuid,$2::uuid,$3,$4,$5,$6,1,'approved')", [command.commandId, command.leadId, this.actor, command.from, command.to, command.reason.trim()]);
      await c.query('COMMIT');
      return { replayed: false };
    } catch (error) {
      await c.query('ROLLBACK').catch(() => undefined);
      if (error instanceof LeadTransitionError) throw error;
      throw new LeadTransitionError('lead_store_unavailable');
    } finally { c.release(); }
  }
}
