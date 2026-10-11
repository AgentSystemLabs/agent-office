import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { zipSync } from 'fflate';
import { apkFixture, manifestFixture } from './support/quest-apk.js';
import { apkPackage, manifestPackage } from '../src/client/ui/quest-install/manifest.js';
import { localApk, officeApk, type ApkSource } from '../src/client/ui/quest-install/source.js';
import { installApk, launchInstalled, explain } from '../src/client/ui/quest-install/install.js';
import { QuestInstaller } from '../src/client/ui/quest-install/controller.js';
import type { QuestDevice } from '../src/client/ui/quest-install/device.js';
const signal=()=>new AbortController().signal;
const local=(data=apkFixture())=>localApk(new File([data as Uint8Array<ArrayBuffer>],'game.apk'));
function fakeDevice(output='Success\n') {
  const commands:string[][]=[];let pushes=0,closed=0,resolve!:()=>void;
  const device:QuestDevice={name:'Quest 3',disconnected:new Promise<void>(r=>resolve=r),async close(){closed++;resolve();},async push(_p,source,sig,progress){pushes++;const reader=(await source.stream(sig)).getReader();let n=0;while(true){sig.throwIfAborted();const {done,value}=await reader.read();if(done)break;n+=value.length;progress(n);}assert.equal(n,source.size);},async shell(args){commands.push(args);return {stdout:args[0]==='pm'?output:args[0]==='cmd'?'com.example.game/.MainActivity\n':'',stderr:'',exitCode:0};}};
  return {device,commands,disconnect:()=>resolve(),get pushes(){return pushes;},get closed(){return closed;}};
}
test('reads binary UTF8/UTF16 manifests from stored and deflated APKs without reading game payload',async()=>{
  for(const utf8 of [true,false])for(const level of [0,6] as const){const source=local(apkFixture('com.example.game',utf8,level)),reads:number[]=[];const read=source.read;source.read=async(o,n,s)=>{reads.push(n);return read(o,n,s);};assert.equal(await apkPackage(source,signal()),'com.example.game');assert.ok(reads.every(n=>n<=65557));}
});
test('rejects corrupt manifests, non-APKs, shell-like package names and unsupported ZIP64 sizes',async()=>{
  assert.throws(()=>localApk(new File(['abc'],'file.txt')),/APK/);
  assert.throws(()=>manifestPackage(manifestFixture('com.game;reboot')),/Manifest/);
  const broken=manifestFixture();new DataView(broken.buffer).setUint32(12,0,true);assert.throws(()=>manifestPackage(broken),/Manifest/);
  await assert.rejects(apkPackage(local(zipSync({'not-manifest':new Uint8Array(3)})),signal()),/Manifest/);
  const source=local();source.size=0x100000000;await assert.rejects(apkPackage(source,signal()),/Manifest/);
});
test('remote APK reads use immutable build id, authenticated same-origin ranges, and verify returned size',async t=>{
  const bytes=apkFixture(),hash=createHash('sha256').update(bytes).digest('hex'),requests:any[]=[];
  t.mock.method(globalThis,'fetch',async(url:URL,options:RequestInit)=>{requests.push({url:String(url),options});const range=(options.headers as any).Range;if(range){const [,a,b]=range.match(/bytes=(\d+)-(\d+)/);return new Response(bytes.slice(+a,+b+1),{status:206,headers:{'content-range':`bytes ${a}-${b}/${bytes.length}`}});}return new Response(bytes,{headers:{'content-length':String(bytes.length)}});});
  const source=officeApk({name:'Store-APK',url:'/api/dev-apk/download?floor=game&kind=store&id=fixed',bytes:bytes.length,sha256:hash},'https://office.example');
  assert.equal(await apkPackage(source,signal()),'com.example.game');assert.equal((await new Response(await source.stream(signal())).arrayBuffer()).byteLength,bytes.length);assert.ok(requests.every(r=>r.url.includes('kind=store&id=fixed')&&r.options.credentials==='same-origin'&&r.options.redirect==='error'));
  assert.throws(()=>officeApk({name:'x',url:'https://other.example/a.apk',bytes:22,sha256:hash},'https://office.example'),/Ungültiger/);
  t.mock.method(globalThis,'fetch',async()=>new Response(bytes,{status:200}));await assert.rejects(source.read(0,20,signal()),/nicht verfügbar/);
});
test('successful install requires Android Success and cleans only its temporary APK',async()=>{
  const f=fakeDevice(),updates:any[]=[];assert.equal(await installApk(f.device,local(),signal(),p=>updates.push(p)),'com.example.game');assert.equal(f.pushes,1);
  const install=f.commands.find(c=>c[0]==='pm')!;assert.deepEqual(install.slice(0,4),['pm','install','-r','-t']);assert.match(install[4],/^\/data\/local\/tmp\/office-apk-[\w-]+\.apk$/);assert.deepEqual(f.commands.at(-1),['rm','-f',install[4]]);assert.equal(updates.at(-1).message,'APK erfolgreich installiert.');
});
test('checksum mismatch prevents install; signature and partial success failures never uninstall or force downgrade',async()=>{
  const f=fakeDevice(),source=local();source.sha256='0'.repeat(64);await assert.rejects(installApk(f.device,source,signal(),()=>{}),/Prüfsumme/);assert.ok(!f.commands.some(c=>c[0]==='pm'));assert.equal(f.commands.at(-1)?.[0],'rm');
  for(const output of ['Failure [INSTALL_FAILED_UPDATE_INCOMPATIBLE]','Success\nFailure [INSTALL_FAILED_VERSION_DOWNGRADE]','']){const g=fakeDevice(output);await assert.rejects(installApk(g.device,local(),signal(),()=>{}));assert.ok(!g.commands.some(c=>c.includes('uninstall')||c.includes('-d')));}
  assert.match(explain(Error('INSTALL_FAILED_UPDATE_INCOMPATIBLE')),/nichts deinstalliert/);
});
test('launch resolves the installed package and rejects package/command injection',async()=>{
  const f=fakeDevice();await launchInstalled(f.device,'com.example.game',signal());assert.deepEqual(f.commands.at(-1),['am','start','-a','android.intent.action.MAIN','-n','com.example.game/.MainActivity']);await assert.rejects(launchInstalled(f.device,'com.game;reboot',signal()));
});
test('controller gates launch on successful install and clears it when the device disconnects',async()=>{
  const f=fakeDevice(),c=new QuestInstaller(()=>{},async()=>f.device);await c.launch();assert.equal(f.commands.length,0);await c.connect();await c.install(local());assert.equal(c.state.installed,'com.example.game');await c.launch();assert.match(c.state.message,/Spiel gestartet/);f.disconnect();await Promise.resolve();assert.equal(c.state.connected,undefined);assert.equal(c.state.installed,undefined);await c.dispose();
});
test('cancel/dispose abort an active upload, suppress Android install and close the device; duplicate clicks do not dispatch twice',async()=>{
  const f=fakeDevice();let started!:()=>void;const ready=new Promise<void>(r=>started=r);
  f.device.push=async(_p,_source,s)=>{started();await new Promise((_,reject)=>{s.addEventListener('abort',()=>reject(s.reason),{once:true});});};
  const c=new QuestInstaller(()=>{},async()=>f.device);await c.connect();const first=c.install(local());await ready;await c.install(local());c.cancel();await first;assert.equal(c.state.installed,undefined);assert.ok(!f.commands.some(c=>c[0]==='pm'));assert.match(c.state.error!,/Abgebrochen/);await c.dispose();assert.equal(f.closed,1);
});
