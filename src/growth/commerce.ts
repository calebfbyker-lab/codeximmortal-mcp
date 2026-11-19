import type { Pool } from 'pg';
// Fulfilled job charges, not accounting recognition, profit, or subscription MRR.
export async function readFulfilledCharges(pool:Pool,since:string,until:string) {
 const start=Date.parse(since),end=Date.parse(until);
 if(!Number.isFinite(start)||!Number.isFinite(end)||end<=start||end-start>366*86400000) throw Error('invalid_window');
 const r=await pool.query<{currency:string;fulfilled_jobs:string;buyers:string;charges_minor:string}>(`
 SELECT currency,count(*)::text AS fulfilled_jobs,count(DISTINCT buyer_id)::text AS buyers,
 SUM(amount_minor)::text AS charges_minor FROM agent_commerce.jobs
 WHERE status='succeeded' AND created_at >= $1::timestamptz AND created_at < $2::timestamptz
 GROUP BY currency ORDER BY currency`,[since,until]);
 return {status:'partial' as const,window:{since,until,basis:'job_created_at'},byCurrency:r.rows,
  unavailable:['windowed_quote_count','settlement_timestamp','refund_reconciliation','delivery_costs','payment_costs','agent_costs','recognized_revenue','profit','subscription_mrr'],
  note:'Historical job-creation cohort using present status; not a settlement-period revenue report'};
}
