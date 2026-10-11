import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import http from 'node:http';
import { Decisions, input } from '../src/server/decisions/store.js';
import { orderDecisions } from '../src/shared/decisions.js';
import { decisionsRoute } from '../src/server/http/routes/decisions.js';
import { officeDecisions } from '../src/server/hooks/office-decisions.js';
import { requestHandler } from '../src/server/http/router.js';
import { workerPrompt, stationRequest } from '../src/server/workers/prompt-extensions.js';
import { WorkerManager } from '../src/server/workers/manager.js';
const owner = { name: 'Owner', owner: 'owner' }, worker = { name: 'Pixel', owner: 'owner', worker: { id: 'w1', name: 'Pixel' } };
const question = { title: 'RB: Kosten des Upgrades', question: 'Soll das Upgrade 10 oder 20 Münzen kosten?', context: 'Der Shop benötigt den Preis.', options: ['10 Münzen', '20 Münzen'], recommendation: '10 für die erste Runde', category: 'Spielablauf', tags: ['RB', 'Shop'], issues: [303], blocking: true, blockingReason: 'Die Preisimplementierung wartet auf die Auswahl.' };
function setup(t: any) { const dir = mkdtempSync(path.join(tmpdir(), 'office-decisions-')); t.after(() => rmSync(dir, {recursive:true,force:true})); return { dir, pool: new Decisions(dir, 'owner/game') }; }
test('deduplicates repeated questions, preserves answers and restart state, isolates projects', t => {
  const {dir,pool} = setup(t), first=pool.add(question,worker);
  const duplicate=pool.add({...question,title:'Anderer Titel'},worker); assert.equal(duplicate.id,first.id);
  const answered=pool.answer(first.id,first.revision,'10 Münzen',owner);
  assert.equal(pool.add(question,worker).status,'answered'); assert.equal(pool.list().length,1);
  assert.equal(new Decisions(dir,'owner/game').list()[0].answer,'10 Münzen');
  assert.equal(new Decisions(dir,'other/game').list().length,0);
  assert.equal(answered.history.length,1);
});
test('human owner answers; workers and unrelated users cannot; stale revisions never lose an answer', t => {
  const {pool}=setup(t), d=pool.add(question,worker);
  assert.throws(()=>pool.answer(d.id,d.revision,'x',worker),/zuständige/);
  assert.throws(()=>pool.answer(d.id,d.revision,'x',{name:'Other',owner:'other'}),/zuständige/);
  assert.throws(()=>pool.answer(d.id,d.revision,'  ',owner),/fehlt/);
  pool.answer(d.id,d.revision,'10',owner);
  assert.throws(()=>pool.answer(d.id,d.revision,'20',owner),/inzwischen/);
  assert.equal(pool.list()[0].answer,'10');
});
test('real blockades escalate existing open questions and sort ahead of every category', t => {
  const {pool}=setup(t);
  const low=pool.add({...question,blocking:false,blockingReason:'',category:'Assets'},worker);
  const other=pool.add({...question,question:'Andere Frage?',category:'Assets',blocking:false,blockingReason:''},worker);
  const high=pool.add(question,worker); assert.equal(high.id,low.id); assert.equal(high.blocking,true);
  assert.equal(orderDecisions([other,high])[0].id,high.id);
  const answered=pool.answer(high.id,high.revision,'10',owner);
  assert.equal(orderDecisions([answered,other])[0].id,other.id);
  assert.throws(()=>input({...question,blockingReason:''}),/fehlt/);
});
test('launch and issue station extensions apply to custom requests without duplication or rewriting slash commands', () => {
  const p=workerPrompt('Mein Auftrag')!; assert.ok(p.startsWith('Mein Auftrag')); assert.match(p,/office-decisions add/); assert.match(p,/Only the user decides/);
  assert.equal(workerPrompt(p),p); assert.equal(workerPrompt(undefined),undefined); assert.equal(workerPrompt('/status'),'/status');
  assert.match(stationRequest('station-issues','Playtests suchen'),/also inspect issue bodies and comments/);
  assert.equal(stationRequest('station-pulls','Review'),'Review');
});
test('authenticated API saves answers without queue changes; explicit notification is scoped and idempotent', async t => {
  const {dir,pool}=setup(t); const d=pool.add(question,worker); let notifications=0, scans=0, workStatus='done';
  const floor={id:'game',def:{repo:'owner/game'},workers:{ get:()=>({id:'w1',kind:'agent',status:workStatus}), prompt:()=>{notifications++;}, resume:()=>{throw Error('No automatic restart');}, list:()=>[], officeDefault:{provider:'codex'},station:(_desk:string,_by:string,prompt:string)=>{scans++;assert.match(prompt,/office-decisions/);assert.match(prompt,/office-playtests/);return {info:{id:'issue-agent'}};} }};
  const ctx={cfg:{dataDir:dir,port:0,trustProxy:false},services:{lookup:()=>undefined},auth:{fromRequest:(req:http.IncomingMessage)=>req.headers.cookie==='owner'?{account:{id:'owner',name:'Owner',role:'member'}}:undefined},floors:new Map([['game',floor]]),claudeFor:()=>false} as any;
  const server=http.createServer(requestHandler(ctx,[decisionsRoute]));await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));t.after(()=>{server.closeAllConnections();server.close();});
  const origin=`http://127.0.0.1:${(server.address() as any).port}`,url=origin+'/api/decisions?floor=game',headers={cookie:'owner',origin,'content-type':'application/json'};
  const post=(body:unknown)=>fetch(url,{method:'POST',headers,body:JSON.stringify(body)});
  assert.equal((await fetch(url)).status,401);
  assert.equal((await fetch(url,{method:'POST',headers:{cookie:'owner'},body:'{}'})).status,403);
  assert.equal((await post({action:'answer',id:d.id,revision:d.revision,answer:'10'})).status,200);assert.equal(notifications,0);
  const answer=pool.list()[0];
  assert.equal((await post({action:'notify',id:d.id,revision:answer.revision,worker:'foreign'})).status,403);
  workStatus='needs_input';assert.equal((await post({action:'notify',id:d.id,revision:answer.revision,worker:'w1'})).status,409);assert.equal(notifications,0);
  workStatus='done';assert.equal((await post({action:'notify',id:d.id,revision:answer.revision,worker:'w1'})).status,200);assert.equal(notifications,1);
  assert.equal((await post({action:'notify',id:d.id,revision:pool.list()[0].revision,worker:'w1'})).status,200);assert.equal(notifications,1);
  assert.equal((await post({action:'scan'})).status,202);assert.equal(scans,1);
  assert.equal((await post({action:'edit',id:d.id,revision:pool.list()[0].revision,input:{...question,question:'Andere Auswahl?'}})).status,200);
  assert.equal(pool.list()[0].status,'open');assert.equal(pool.list()[0].history[0].answer,'10');
});
test('worker hook authenticates, chooses worker floor, and cannot store a fabricated human answer', async t => {
  const {dir,pool}=setup(t);
  const floor={id:'game',def:{repo:'owner/game'},workers:{authenticate:(id:string,token:string)=>id==='w1'&&token==='secret'?{id,name:'Pixel'}:undefined,ownerOf:()=> 'owner'}};
  const ctx={cfg:{dataDir:dir},workerFloor:(id:string)=>id==='w1'?floor:undefined} as any;
  const server=http.createServer((req,res)=>officeDecisions(ctx,req,res,new URL(req.url!,'http://local')));await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));t.after(()=>{server.closeAllConnections();server.close();});
  const url=`http://127.0.0.1:${(server.address() as any).port}/office/decisions?worker=w1&floor=other`,headers={authorization:'Bearer secret','content-type':'application/json'};
  assert.equal((await fetch(url)).status,401);
  assert.equal((await fetch(url,{method:'POST',headers,body:JSON.stringify({...question,answer:'fake'})})).status,403);
  assert.equal((await fetch(url,{method:'POST',headers,body:JSON.stringify(question)})).status,200);
  assert.equal(pool.list()[0].workers[0].id,'w1');assert.equal(pool.list()[0].owner,'owner');
  assert.equal((await fetch(url,{method:'POST',headers,body:'null'})).status,400);
  assert.equal((await fetch(url,{method:'DELETE',headers})).status,405);
});

test('already running workers receive handoff instructions with their next Office task, preserving terminal commands', t => {
  t.mock.timers.enable({apis:['setTimeout']});
  const written: string[] = [], w={info:{id:'active',kind:'agent'},pty:{write:(s:string)=>written.push(s)}};
  const manager={workers:new Map([['active',w]]),tasks:{notePrompt:()=>{}},emitUpdate:()=>{}};
  assert.equal(WorkerManager.prototype.prompt.call(manager as any,'active','Prüfe den Shop','Owner'),undefined);
  assert.ok(written[0].startsWith('\x1b[200~Prüfe den Shop\n\n'));
  assert.match(written[0],/office-decisions add/);t.mock.timers.tick(120);assert.equal(written[1],'\r');
  written.length=0;WorkerManager.prototype.prompt.call(manager as any,'active','/status','Owner');
  assert.equal(written[0],'\x1b[200~/status\x1b[201~');
});
