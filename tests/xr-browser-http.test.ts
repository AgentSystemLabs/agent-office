import test from 'node:test';import assert from 'node:assert/strict';import http from 'node:http';
import {mkdtempSync,rmSync}from'node:fs';import {tmpdir}from'node:os';import path from'node:path';
import {requestHandler}from'../src/server/http/router.js';import {xrSessionRoute}from'../src/server/http/routes/xr-sessions.js';import {xrBrowserRoute}from'../src/server/http/routes/xr-browser.js';import type{Ctx}from'../src/server/office/context.js';
test('browser telemetry requires same-origin owner session AND matching run token, without Authorization replacement',async t=>{
  const dir=mkdtempSync(path.join(tmpdir(),'xr-browser-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
  const ctx={cfg:{port:0,trustProxy:false},services:{lookup:()=>undefined},auth:{fromRequest:(r:http.IncomingMessage)=>r.headers.cookie?{account:{id:r.headers.cookie}}:undefined},floors:new Map([['lab',{dir}]])}as unknown as Ctx;
  const server=http.createServer(requestHandler(ctx,[xrSessionRoute,xrBrowserRoute]));await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));t.after(()=>{server.closeAllConnections();server.close();});
  const base=`http://127.0.0.1:${(server.address()as{port:number}).port}`,headers={cookie:'owner',origin:base,'content-type':'application/json'};
  const pair=await(await fetch(base+'/api/playtests/xr-session?floor=lab',{method:'POST',headers,body:'{"action":"start"}'})).json();
  const body={run:pair.id,token:pair.token,bridgeId:'browser-test-123456789',devices:[],snapshots:{}};
  const send=(h:Record<string,string>=headers,b=body)=>fetch(base+'/api/playtests/xr-browser?floor=lab',{method:'POST',headers:h,body:JSON.stringify(b)});
  assert.equal((await send({'content-type':'application/json'})).status,401);
  assert.equal((await send({...headers,origin:'https://evil.invalid'})).status,403);
  assert.equal((await send({...headers,cookie:'other'})).status,404);
  assert.equal((await send(headers,{...body,token:'0'.repeat(64)})).status,401);
  assert.equal((await send({...headers,authorization:'Basic cHJveHk6YXV0aA=='})).status,200);
});
