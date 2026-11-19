import type { Express, Request, Response } from 'express';
import type { GrowthRuntime } from './runtime.js';
import { roles, type Role } from './agents.js';
// Inject existing owner-app session and Origin+CSRF guards. Not mounted automatically.
export function registerGrowthRoutes(app:Express,current:(req:Request)=>unknown,guarded:(req:Request,res:Response)=>unknown,runtime:GrowthRuntime) {
 app.get('/api/growth/runs',async(req,res)=>{
  if(!current(req)) {res.status(401).json({error:'unauthorized'});return;}
  try {const runs=await runtime.list(); if(!current(req)) {res.status(401).json({error:'unauthorized'});return;} res.json({mode:'proposal_only',runs});}
  catch {res.status(503).json({error:'growth_unavailable'});}
 });
 app.post('/api/growth/runs',async(req,res)=>{
  if(!guarded(req,res)) return;
  const body=req.body as Record<string,unknown>|undefined;
  if(!body||typeof body.commandKey!=='string'||!roles.includes(body.role as Role)) {res.status(400).json({error:'invalid_request'});return;}
  try {res.status(202).json(await runtime.enqueue(body.commandKey,body.role as Role,body.input));}
  catch {res.status(400).json({error:'growth_proposal_rejected'});}
 });
}
