import type { Express, Request, Response } from 'express';
import type { Pool } from 'pg';
import { randomUUID } from 'node:crypto';
import { commercePage, assessmentDetails } from './commerce-ui.js';
import { LEAD_TRANSITION_POLICY, LeadTransitionError, PostgresLeadTransitions, type LeadTransitionCommand } from './owner-lead-transitions.js';
import { prospectIntake, ProspectInputError } from './prospect-assistant.js';
import type { AnalyticsStore, LeadStage } from './owner-analytics.js';

export interface PipelineLead { id: string; name: string; stage: LeadStage; source?: string; notes?: string }
export interface PipelineWorkflow {
  list(): Promise<PipelineLead[]>;
  approve(command: LeadTransitionCommand): Promise<{ replayed: boolean }>;
}
export function postgresPipelineWorkflow(pool: Pool, owner: string): PipelineWorkflow {
  const transitions = new PostgresLeadTransitions(pool, owner);
  return {
    async list() {
      // Missing migration 006 disables controls even when lead rows exist.
      await pool.query('SELECT command_id FROM owner_control.owner_lead_transition_events LIMIT 0');
      const r = await pool.query('SELECT id::text, name, stage, source, notes FROM owner_control.owner_leads ORDER BY updated_at DESC, id LIMIT 100');
      return r.rows as PipelineLead[];
    },
    approve: command => transitions.approve(command),
  };
}
const esc = (v: unknown) => String(v).replace(/[&<>"']/g, c => ({ '&': '&'+'amp;', '<': '&'+'lt;', '>': '&'+'gt;', '"': '&'+'quot;', "'": '&'+'#39;' })[c]!);
const errors = new Set(['invalid_lead_transition','lead_command_conflict','lead_not_found','lead_stage_conflict']);

/** Existing owner closures remain the only authentication and mutation guards. */
export function registerOwnerPipeline(app: Express, options: {
  owner: string; revision: string; now: () => number;
  current: (req: Request) => { csrf: string; expires: number } | undefined;
  guarded: (req: Request, res: Response) => unknown;
  workflow?: PipelineWorkflow;
  analytics?: Pick<AnalyticsStore, 'pipeline'> & Partial<Pick<AnalyticsStore, 'addLead'>>;
  taskQueueConnected?: boolean;
}) {
  app.get('/', async (req, res, next) => {
    if (req.query.view !== 'pipeline') { next(); return; }
    const session = options.current(req);
    if (!session) { res.redirect(303, '/login'); return; }
    const intake = options.analytics?.addLead ? '<section class=panel><div class=panel-head><h2>Record an opportunity</h2></div><div class=panel-body><p>Rules-based assistance only; no messages are sent. Source, identity and buying intent remain unverified.</p><form class="prospect-form" method=post action=/leads/intake><input type=hidden name=csrf value="' + esc(session.csrf) + '"><label class=field>Name or reference <input name=name required maxlength=200></label><label class=field>Claimed source <input name=source required maxlength=64></label><label class="field wide">Expressed need <input name=need required maxlength=600></label><div class=wide><button class="btn btn--primary">Save prospect and fit assessment</button></div></form><p class=hint>Do not enter credentials or sensitive payloads. Repeated submissions create separate records; inspect before retrying an uncertain response.</p></div></section>' : '<p class=flash role=status>Prospect intake is unavailable because the lead store is not configured.</p>';
    let content: string;
    if (!options.workflow) content = '<p class=flash role=alert>Lead transitions are not configured. No controls are enabled.</p>';
    else {
      try {
        const leads = await options.workflow.list();
        content = '<div class=toolbar><h2>Prospect records</h2><a class=btn href="/?view=pipeline">Refresh prospects</a></div><p class=hint>Latest 100 records. Won value is a pipeline label, not verified revenue. No aggregate currency totals are shown here.</p>';
        const message = typeof req.query.lead_status === 'string' ? req.query.lead_status : '';
        if (message === 'created') content += '<p role=status>Prospect saved. Its assessment is a draft, not verified buying intent.</p>';
        if (message === 'approved') content += '<p role=status>Approval request completed. Refresh confirms the current stage; the durable receipt is authoritative.</p>';
        if (errors.has(message) || message === 'lead_store_unavailable') content += '<p class=flash role=alert>Transition not completed: ' + esc(message) + '. Refresh before retrying.</p>';
        content += leads.length ? leads.map(lead => {
          if (!Object.hasOwn(LEAD_TRANSITION_POLICY, lead.stage)) throw new Error('invalid_stage');
          const targets = LEAD_TRANSITION_POLICY[lead.stage] as readonly LeadStage[];
          return '<section class=panel><div class=panel-body><div class=record-head><h3>' + esc(lead.name) + '</h3><span class=badge>' + esc(lead.stage) + '</span></div><p class=hint>Claimed source: ' + esc(lead.source ?? 'Unknown') + ' / <code>' + esc(lead.id) + '</code></p>' + (lead.notes ? assessmentDetails(lead.notes) : '<p class=hint>No assessment recorded.</p>') + '<details><summary>Governed lead transitions</summary><div class=panel-body>' + (targets.length ?
            '<form method=post action=/leads/transition><input type=hidden name=csrf value="' + esc(session.csrf) + '"><input type=hidden name=commandId value="' + randomUUID() + '"><input type=hidden name=leadId value="' + esc(lead.id) + '"><input type=hidden name=from value="' + esc(lead.stage) + '"><label class=field>Next stage <select name=to required>' + targets.map(t => '<option value="' + t + '">' + t + '</option>').join('') + '</select></label><label class=field>Approval reason <input name=reason required maxlength=400></label><button class="btn btn--primary">Approve transition</button></form>' : '<p>Terminal stage. No transition permitted.</p>') + '</div></details></div></section>';
        }).join('') : '<section class=empty><h2>No leads recorded yet.</h2><p>Record an observed opportunity above. There is no background collector in this increment.</p></section>';
      } catch { content = '<p class=flash role=alert>Lead store unavailable. No transition controls are enabled. Check migrations 005 and 006 locally.</p>'; }
    }
    const metadata = '<p class=hint>Configured revision: <code>' + esc(options.revision) + '</code> / Snapshot: ' + esc(new Date(options.now()).toISOString()) + '</p>';
    res.type('html').send(commercePage('Prospects & pipeline', 'pipeline', metadata + intake + content));
  });
  app.post('/leads/intake', async (req, res) => {
    if (!options.guarded(req, res)) return;
    if (!options.analytics?.addLead) { res.status(503).json({ error: 'lead_store_unavailable' }); return; }
    try {
      const input = prospectIntake(req.body ?? {});
      const lead = await options.analytics.addLead(input);
      if (req.is('application/x-www-form-urlencoded')) res.redirect(303, '/?view=pipeline&lead_status=created');
      else res.status(201).json({ id: lead.id, stage: lead.stage, assessment: 'rules-v1', evidence: 'owner_recorded_unverified' });
    } catch (error) {
      res.status(error instanceof ProspectInputError ? 400 : 503).json({ error: error instanceof ProspectInputError ? 'invalid_prospect_input' : 'lead_store_unavailable' });
    }
  });
  app.post('/leads/transition', async (req, res) => {
    if (!options.guarded(req, res)) return;
    if (!options.workflow) { res.status(503).json({ error: 'lead_store_unavailable' }); return; }
    const b = req.body ?? {};
    const form = Boolean(req.is('application/x-www-form-urlencoded'));
    const expectedKeys = ['csrf', 'commandId', 'leadId', 'from', 'to', 'reason'];
    if (Object.keys(b).some(key => !expectedKeys.includes(key)) || expectedKeys.some(key => typeof b[key] !== 'string')) {
      res.status(400).json({ error: 'invalid_lead_transition' }); return;
    }
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
