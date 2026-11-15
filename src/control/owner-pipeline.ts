import type { Express, Request, Response } from 'express';
import type { Pool } from 'pg';
import { randomUUID } from 'node:crypto';
import { ownerConsole, ownerOverview } from './owner-console.js';
import { LEAD_TRANSITION_POLICY, LeadTransitionError, PostgresLeadTransitions, type LeadTransitionCommand } from './owner-lead-transitions.js';
import type { LeadStage } from './owner-analytics.js';

export interface PipelineLead { id: string; name: string; stage: LeadStage }
export interface PipelineWorkflow {
  list(): Promise<PipelineLead[]>;
  approve(command: LeadTransitionCommand): Promise<{ replayed: boolean }>;
}
export function postgresPipelineWorkflow(pool: Pool, owner: string): PipelineWorkflow {
  const transitions = new PostgresLeadTransitions(pool, owner);
  return {
    async list() {
      const r = await pool.query('SELECT id::text, name, stage FROM owner_control.owner_leads ORDER BY updated_at DESC, id LIMIT 100');
      return r.rows as PipelineLead[];
    },
    approve: command => transitions.approve(command),
  };
}
const esc = (v: unknown) => String(v).replace(/[&<>"']/g, c => ({ '&': '&'+'amp;', '<': '&'+'lt;', '>': '&'+'gt;', '"': '&'+'quot;', "'": '&'+'#39;' })[c]!);
const errors = new Set(['invalid_lead_transition','lead_command_conflict','lead_not_found','lead_stage_conflict']);

/** Register after body parsers and guard definitions, BEFORE the existing root
 * handler. Guards are the owner's existing closures: no new auth/session.
 */
export function registerOwnerPipeline(app: Express, options: {
  owner: string; revision: string; now: () => number;
  current: (req: Request) => { csrf: string; expires: number } | undefined;
  guarded: (req: Request, res: Response) => unknown;
  workflow?: PipelineWorkflow;
}) {
  app.get('/', async (req, res, next) => {
    if (req.query.view !== 'pipeline') { next(); return; }
    const session = options.current(req);
    if (!session) { res.redirect(303, '/login'); return; }
    let content: string;
    if (!options.workflow) content = '<p role=alert>Lead transitions are not configured. No controls are enabled.</p>';
    else {
      try {
        const leads = await options.workflow.list();
        content = '<p>Owner approval only. Won is a pipeline label, not verified revenue. Latest 100 leads.</p>';
        const message = typeof req.query.lead_status === 'string' ? req.query.lead_status : '';
        if (message === 'approved') content += '<p role=status>Lead transition approved.</p>';
        if (errors.has(message) || message === 'lead_store_unavailable') content += '<p role=alert>Transition not completed: ' + esc(message) + '. Refresh before retrying.</p>';
        content += leads.length ? leads.map(lead => {
          if (!Object.hasOwn(LEAD_TRANSITION_POLICY, lead.stage)) throw new Error('invalid_stage');
          const targets = LEAD_TRANSITION_POLICY[lead.stage] as readonly LeadStage[];
          return '<section class=panel><div class=panel-body><h3>' + esc(lead.name) + '</h3><p><code>' + esc(lead.id) + '</code> / ' + esc(lead.stage) + '</p>' + (targets.length ?
            '<form method=post action=/leads/transition><input type=hidden name=csrf value="' + esc(session.csrf) + '"><input type=hidden name=commandId value="' + randomUUID() + '"><input type=hidden name=leadId value="' + esc(lead.id) + '"><input type=hidden name=from value="' + esc(lead.stage) + '"><label>Next stage <select name=to required>' + targets.map(t => '<option value="' + t + '">' + t + '</option>').join('') + '</select></label><label class=field>Approval reason <input name=reason required maxlength=400></label><button class="btn btn--primary">Approve transition</button></form>' : '<p>Terminal stage. No transition permitted.</p>') + '</div></section>';
        }).join('') : '<p>No leads recorded yet.</p>';
      } catch { content = '<p role=alert>Lead store unavailable. No transition controls are enabled. Check migrations 005 and 006 locally.</p>'; }
    }
    const base = ownerConsole(ownerOverview(options.owner, options.revision, options.now(), session.expires), session.csrf, { view: 'pipeline' });
    res.type('html').send(base.replace('<footer class=note-foot>', '<section aria-label="Governed lead transitions"><h2>Governed lead transitions</h2>' + content + '</section><footer class=note-foot>'));
  });
  app.post('/leads/transition', async (req, res) => {
    if (!options.guarded(req, res)) return;
    if (!options.workflow) { res.status(503).json({ error: 'lead_store_unavailable' }); return; }
    const b = req.body ?? {};
    const form = Boolean(req.is('application/x-www-form-urlencoded'));
    try {
      const result = await options.workflow.approve({ commandId: b.commandId, leadId: b.leadId, from: b.from, to: b.to, reason: b.reason });
      if (form) res.redirect(303, '/?view=pipeline&lead_status=approved');
      else res.json({ approved: true, ...result });
    } catch (error) {
      const code = error instanceof LeadTransitionError && errors.has(error.message) ? error.message : 'lead_store_unavailable';
      if (form) res.redirect(303, '/?view=pipeline&lead_status=' + encodeURIComponent(code));
      else res.status(code === 'lead_store_unavailable' ? 503 : code.includes('conflict') ? 409 : code === 'lead_not_found' ? 404 : 400).json({ error: code });
    }
  });
}
