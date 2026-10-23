import test from 'node:test';
import assert from 'node:assert/strict';
// @ts-ignore Pocket browser modules are deliberately plain JavaScript.
import { createBridge, validRequest } from '../integrations/pi-pocket/office-v2-client/bridge.js';
// @ts-ignore Pocket browser modules are deliberately plain JavaScript.
import { worldDocument } from '../integrations/pi-pocket/office-v2-client/world-document.js';

const signal = () => new AbortController().signal;
test('master desk resolves only to the freshly authorized source, not a hired child', async () => {
  const inspected: unknown[] = [];
  const pocket = { api: async () => ({ source:42, master:{workerId:'pocket-master-42',title:'Master chat',busy:false}, bindings:[],workers:[] }) };
  const handle = createBridge({pocket,source:42,clientId:'client',signal:signal(),inspect:(view: unknown) => inspected.push(view)});
  await handle('open',{workerId:'pocket-master-42'});
  assert.deepEqual(inspected,[{source:42,workerId:'pocket-master-42',conversationId:42,title:'Master chat',master:true,draft:undefined}]);
  await assert.rejects(handle('open',{workerId:'pocket-master-99'}),/no session you can open/);
  await assert.rejects(handle('open',{}),/Select a worker/);
});

test('floor list is public metadata from the extension route and switch validates its target', async () => {
  const rooms = [{id:42,title:'Master',cwd:'/work',busy:false,archived:false}];
  const requested: string[] = [];
  const switched: number[] = [];
  const handle = createBridge({pocket:{api:async (path: string) => {requested.push(path);return rooms;}},source:42,clientId:'client',signal:signal(),switchFloor:(source: number) => switched.push(source)});
  assert.deepEqual(await handle('floors'),rooms);
  assert.deepEqual(requested,['floors']);
  assert.deepEqual(await handle('switch',{source:43}),{switching:true,source:43});
  assert.deepEqual(switched,[43]);
  for(const source of [0,-1,1.5,'43',null]) await assert.rejects(handle('switch',{source}),/available chat floor/);
  const frame={};
  for(const op of ['floors','switch']) assert.equal(validRequest({source:frame,origin:'https://pocket.test',data:{type:'office-v2:request',channel:'channel',id:op,op,payload:{}}},frame,'https://pocket.test','channel'),true);
});

test('world document establishes floor bootstrap before scripts without an inline script or forbidden base', () => {
  const boot={person:{id:'owner',name:'Owner'},profile:{},snapshot:{source:42,title:'</script><script>alert(1)</script>'},floors:[{id:42}]};
  const html=worldDocument('<html><head><script type="module" src="./assets/main.js"></script><link href="./assets/style.css" rel="stylesheet"></head></html>','https://pocket.test/x/office-v2/world/','channel',boot,'https://pocket.test/x/office-v2/frame-errors.js');
  assert.ok(html.indexOf('pocket-bootstrap')<html.indexOf('type="module"'));
  assert.match(html,/https:\/\/pocket.test\/x\/office-v2\/world\/assets\/main.js/);
  assert.doesNotMatch(html,/<base|alert\(1\)<\/script>/);
  const encoded=html.match(/name="pocket-bootstrap" content="([^"]+)"/)![1];
  assert.deepEqual(JSON.parse(decodeURIComponent(encoded)),boot);
  assert.throws(()=>worldDocument('<html><head></head></html>','https://pocket.test/','channel',{...boot,floors:[]},'errors.js'),/no longer available/);
});
