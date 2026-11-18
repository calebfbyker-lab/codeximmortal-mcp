import { strict as assert } from 'node:assert';
import { scryptSync } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { createOwnerControlApp } from '../dist/control/owner-app.js';
import { OWNER_TASK_POLICY } from '../dist/control/owner-task-queue.js';
const {chromium}=await import('playwright');
const origin='https://owner.fixture.test',password='synthetic-browser-password',saltHex='12'.repeat(16);
let clock=Date.now(),fail=false,taskState='proposed';
const deny=async()=>{throw Error('browser fixture prohibits mutation');};
const app=createOwnerControlApp({owner:'owner',origin,saltHex,hashHex:scryptSync(password,Buffer.from(saltHex,'hex'),64).toString('hex'),revision:'a'.repeat(40)},()=>clock,{view:async()=>{if(fail)throw Error('fixture outage');return {paused:true,policy:OWNER_TASK_POLICY,tasks:[{id:'00000000-0000-4000-8000-000000000001',command_key:'fixture',objective:'BROWSER FIXTURE task',baseline_revision:'a'.repeat(40),state:taskState,attempts:0,worker_id:null,verifier_id:null,error_code:null,result:null,created_at:'2026-11-01T00:00:00.000Z'}],events:[]};},propose:deny,approve:deny,cancel:deny,pause:deny});
const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));const base='http://127.0.0.1:'+server.address().port;
let browser;const results=[];await mkdir('output/workspace-browser',{recursive:true});
try{
 browser=await chromium.launch();const context=await browser.newContext();
 await context.route('**/*',async route=>{
  const req=route.request(),url=new URL(req.url());
  if(url.origin!==origin){console.error('Blocked external request origin: '+url.origin);await route.abort();return;}
  try{
   const headers=await req.allHeaders();delete headers.host;
   const response=await fetch(base+url.pathname+url.search,{method:req.method(),headers,body:req.postDataBuffer()??undefined,redirect:'manual'});
   const h=Object.fromEntries(response.headers);delete h['content-length'];delete h['transfer-encoding'];delete h['connection'];
   await route.fulfill({status:response.status,headers:h,body:Buffer.from(await response.arrayBuffer())});
  }catch(error){console.error('Fixture proxy failure for '+url.pathname+': '+(error instanceof Error?error.message:'unknown'));await route.abort();}
 });
 const page=await context.newPage(),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 page.on('requestfailed',r=>console.error('Request failed: '+r.url()+' '+(r.failure()?.errorText??'unknown')));
 const unauthenticated=await fetch(base+'/',{redirect:'manual'});assert.equal(unauthenticated.status,303);assert.equal(unauthenticated.headers.get('location'),'/login');results.push({check:'unauthenticated root redirects to login',passed:true});
 const loginPage=await page.goto(origin+'/login');assert.equal(loginPage.status(),200);results.push({check:'login page loads through the isolated fixture origin',passed:true});
 const login=await fetch(base+'/login',{method:'POST',redirect:'manual',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({owner:'owner',password})});assert.equal(login.status,303);const pair=login.headers.get('set-cookie').split(';')[0],i=pair.indexOf('=');await context.addCookies([{name:pair.slice(0,i),value:pair.slice(i+1),url:origin,secure:true,httpOnly:true,sameSite:'Strict'}]);
 const paths=['/','/?view=services','/distribution','/?view=pipeline','/orders','/?view=tasks','/?view=revenue','/?view=blockers','/?view=runtime'];let navigation;
 for(const width of [1440,768,390]){await page.setViewportSize({width,height:1000});for(const [index,path]of paths.entries()){const response=await page.goto(origin+path);assert.equal(response.status(),200);assert.equal(await page.locator('[data-owner-shell="shared-v1"]').count(),1);assert.equal(await page.locator('main').count(),1);assert.equal(await page.locator('nav [aria-current="page"]').count(),1);assert.equal(await page.locator('form[action="/logout"]').count(),1);assert.equal(await page.locator('[data-workspace-diagnostics]').getAttribute('open'),null);const nav=await page.locator('nav a').evaluateAll(nodes=>nodes.map(n=>n.getAttribute('href')));if(navigation)assert.deepEqual(nav,navigation);else navigation=nav;assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+2));await page.screenshot({path:`output/workspace-browser/${width}-${index}.png`,fullPage:true});results.push({width,path,passed:true});}}
 await page.goto(origin+'/');await page.waitForFunction(()=>document.querySelector('[data-work-queue]').dataset.queuePhase==='ready');
 taskState='running';clock+=3000;await page.locator('[data-queue-retry]').click();await page.waitForFunction(()=>document.querySelector('[data-queue-rows]').textContent.includes('running'));results.push({check:'live stored state update',passed:true});
 fail=true;clock+=3000;await page.locator('[data-queue-retry]').click();await page.waitForFunction(()=>document.querySelector('[data-work-queue]').dataset.queuePhase==='stale');assert.match(await page.locator('[data-queue-rows]').innerText(),/BROWSER FIXTURE task/);results.push({check:'outage retains stale rows',passed:true});
 clock+=900001;await page.locator('[data-queue-retry]').click();await page.waitForFunction(()=>document.querySelector('[data-work-queue]').dataset.queuePhase==='expired');assert.equal(await page.locator('[data-queue-rows]').innerText(),'');results.push({check:'expired session clears records',passed:true});assert.deepEqual(errors,[]);
}finally{if(browser)await browser.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await writeFile('output/workspace-browser/results.json',JSON.stringify({scope:'isolated synthetic fixture, not deployed-system evidence',results},null,2));}
console.log('Workspace browser acceptance passed.');
