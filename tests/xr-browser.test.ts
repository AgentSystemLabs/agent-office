import test from 'node:test';
import assert from 'node:assert/strict';
import { operatorFetch } from '../src/client/ui/quest-install/operator-http.js';
import { ensureDevelopment } from '../src/client/ui/xr-browser/build.js';
import { localApk } from '../src/client/ui/quest-install/source.js';
import { apkFixture } from './support/quest-apk.js';
import type { QuestDevice } from '../src/client/ui/quest-install/device.js';
const signal=()=>AbortSignal.timeout(5000);
test('on-device HTTP decodes fragmented chunked SSE and content-length POST without losing bytes',async()=>{
  for(const wire of ['HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\nContent-Type: text/event-stream\r\n\r\n5\r\nhello\r\n6;ext=1\r\n world\r\n0\r\n\r\n','HTTP/1.1 202 Accepted\r\nContent-Length: 11\r\n\r\nhello world']){
    const bytes=new TextEncoder().encode(wire);let at=0,closed=false;const writes:Uint8Array[]=[];
    const fetch=operatorFetch(async()=>({async read(){if(at===bytes.length)return {done:true};const value=bytes.slice(at,at+3);at+=value.length;return {done:false,value};},async write(b){writes.push(b);},async close(){closed=true;}}));
    const response=await fetch('http://127.0.0.1:8720/sse',{signal:signal()});assert.equal(await response.text(),'hello world');assert.ok(closed);assert.match(new TextDecoder().decode(writes[0]),/GET \/sse HTTP\/1.1/);
  }
});
test('on-device HTTP rejects off-device targets, truncated bodies and aborts pending socket reads',async()=>{
  const bytes=new TextEncoder().encode('HTTP/1.1 200 OK\r\nContent-Length: 4\r\n\r\na');let read=false,closed=false;
  const fetch=operatorFetch(async()=>({async read(){if(read)return {done:true};read=true;return {done:false,value:bytes};},async write(){},async close(){closed=true;}}));
  await assert.rejects(fetch('http://192.168.1.1/sse'),/Ziel/);const r=await fetch('http://127.0.0.1:8720/sse');await assert.rejects(r.text(),/unterbrochen/);assert.ok(closed);
  let unblock!:()=>void;const waiting=new Promise<void>(r=>unblock=r);const abort=new AbortController();let entered!:()=>void;const ready=new Promise<void>(r=>entered=r);
  const pending=operatorFetch(async()=>({async read(){entered();await waiting;return {done:true};},async write(){},async close(){unblock();}}));
  const task=pending('http://127.0.0.1:8720/sse',{signal:abort.signal});await ready;abort.abort();await assert.rejects(task);
});
test('exact installed APK hash skips install; missing or different builds install and verify, without trusting version numbers',async()=>{
  for(const initial of ['current','old','missing']){
    const bytes=apkFixture(),source=localApk(new File([bytes as Uint8Array<ArrayBuffer>],'dev.apk'));source.sha256='a'.repeat(64);
    let installed=initial,pushes=0;const commands:string[][]=[];
    const device:QuestDevice={name:'Quest',disconnected:new Promise(()=>{}),async close(){},async push(){pushes++;},async shell(args){commands.push(args);if(args[0]==='pm'&&args[1]==='path')return {stdout:installed==='missing'?'':'package:/data/app/a/base.apk',stderr:'',exitCode:0};if(args[0]==='sha256sum')return {stdout:(args[1].includes('/tmp/')||installed==='current'?'a':'b').repeat(64)+'  file',stderr:'',exitCode:0};if(args[0]==='pm'){installed='current';return {stdout:'Success',stderr:'',exitCode:0};}return {stdout:'',stderr:'',exitCode:0};}};
    const result=await ensureDevelopment(device,source,signal(),()=>{});assert.equal(result.updated,initial!=='current');assert.equal(pushes,initial==='current'?0:1);assert.ok(!commands.some(a=>a.includes('uninstall')||a.includes('-d')));
  }
});
test('unreadable installed APK fails safely instead of replacing an unverifiable app',async()=>{
  const source=localApk(new File([apkFixture() as Uint8Array<ArrayBuffer>],'dev.apk'));source.sha256='a'.repeat(64);let pushed=false;
  const device:QuestDevice={name:'Quest',disconnected:new Promise(()=>{}),async close(){},async push(){pushed=true;},async shell(args){return args[0]==='pm'?{stdout:'package:/data/app/a/base.apk',stderr:'',exitCode:0}:{stdout:'',stderr:'Permission denied',exitCode:1};}};
  await assert.rejects(ensureDevelopment(device,source,signal(),()=>{}),/verifiziert/);assert.equal(pushed,false);
});
test('aborting a stalled socket open returns promptly and closes the late connection',async()=>{
  let resolve!: (socket:any)=>void,closed=false;
  const fetch=operatorFetch(()=>new Promise(r=>resolve=r)),abort=new AbortController();
  const task=fetch('http://127.0.0.1:8720/sse',{signal:abort.signal});abort.abort();await assert.rejects(task);
  resolve({async close(){closed=true;}});await Promise.resolve();assert.equal(closed,true);
});
