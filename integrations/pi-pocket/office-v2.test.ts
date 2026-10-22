// Helpers must load first. These tests use temporary data and a scripted model, never the live server.
import { cleanUp, context, newSession, openApp, owner, root, scriptedModel } from '/opt/pi-pocket/test/helpers.ts';
import assert from 'node:assert/strict';
import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { createHandler } from '/opt/pi-pocket/src/server/http.ts';
import { PlanDoc, TurnsDoc } from '/opt/pi-pocket/src/server/docs.ts';
import { defineDocFamily } from '/opt/pi-pocket/node_modules/@earendil-works/pi-durable/dist/index.js';
import { SKIN_TONES, HAIR_COLORS, HAIR_STYLES } from '../../src/shared/avatar.ts';
const TestProfiles = defineDocFamily({ kind: 'x.office-v2.profiles', version: 1, scope: 'session', family: true,
  initial: (_seed: null) => ({}) });

let app: Awaited<ReturnType<typeof openApp>>;
let server: ReturnType<typeof createServer>;
let base: string;
const clientId = 'a0b1c2d3-0000-4000-8000-000000000001';
const tokens: Record<string, string> = {};
let guestId: string;
before(async () => {
  const drop = join(root, 'data', 'extensions');
  mkdirSync(join(drop, 'office-v2-client'), { recursive: true });
  writeFileSync(join(drop, 'office-v2-client', 'index.js'), 'export default () => {};');
  copyFileSync(join(import.meta.dirname, 'office-v2.ts'), join(drop, '_office-v2.ts'));
  // Test-only public capability decorator: fail the binding commit after real initial-message admission.
  writeFileSync(join(drop, 'office-v2.ts'), `
import setup from './_office-v2.ts';
export const pocketApi = 2;
export default (host, web) => setup(host, new Proxy({ ...web }, { get(target, key) {
  if (key !== 'conversationRoute') return target[key];
  return (method, path, handler, options) => target.conversationRoute(method, path, req => {
    let commits = 0;
    return handler(new Proxy({ ...req }, { get(request, member) {
      if (member !== 'commit') return request[member];
      return callback => {
        if (++commits === 2 && path === 'hire/:source' && globalThis.officeFailBinding) {
          globalThis.officeFailBinding = false;
          return Promise.reject(new Error('Test interrupted binding commit'));
        }
        return request.commit(callback);
      };
    }}));
  }, options);
}}));
`);
  app = await openApp(scriptedModel());
  tokens.owner = app.config.ownerToken;
  const guest = app.config.addUser('Guest', 'guest');
  tokens.guest = guest.token;
  guestId = guest.user.id;
  tokens.viewer = app.config.addUser('Viewer', 'viewer').token;
  tokens.scoped = app.config.addUser('Scoped', 'guest', ['1']).token;
  await app.setExtensionEnabled(owner(app), 'office-v2.ts', true);
  server = createServer(createHandler({ app, listen: { host: '127.0.0.1', port: 0 }, restart: () => {} }));
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
after(async () => { server?.closeAllConnections(); server?.close(); await app?.close(); cleanUp(); });
async function call(path: string, body?: object, actor = 'owner', header = true) {
  const response = await fetch(`${base}/api/x/office-v2/${path}`, {
    method: body ? 'POST' : 'GET', headers: {
      authorization: `Bearer ${tokens[actor]}`, ...(header ? { 'X-Pocket': '1' } : {}),
      ...(body ? { 'content-type': 'application/json' } : {}),
    }, ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { status: response.status, data: await response.json() as any };
}
const hire = (deskId = 'desk-1', requestId = 'hire-one') => ({ clientId, deskId, requestId, prompt: 'Say hello.' });
const state = (source: unknown) => `state/${source}?clientId=${clientId}`;

test('profile bootstrap computes deterministic defaults without model, source, or durable GET writes', async () => {
  assert.equal(app.sessions().length, 0, 'bootstrap does not need any source session');
  const first = await call('profile');
  assert.equal(first.status, 200, JSON.stringify(first.data));
  assert.deepEqual(first.data.person, { id: owner(app).id, name: owner(app).name, role: 'owner' });
  assert.equal(first.data.profile.name, owner(app).name);
  assert.match(first.data.profile.color, /^#[0-9a-f]{6}$/);
  assert.deepEqual((await call(`profile?clientId=${clientId}`)).data, first.data);
  assert.deepEqual((await call('profile?clientId=bbbbbbbb-0000-4000-8000-000000000002')).data, first.data);
  assert.equal(await app.harness.snapshot(TestProfiles, owner(app).id, context), undefined);
  assert.equal((await call('profile', undefined, 'viewer')).status, 404);
  assert.equal((await call('profile', undefined, 'scoped')).status, 404);
  assert.equal((await call('profile', undefined, 'owner', false)).status, 403);
});

test('per-person avatar edits persist across tabs and reload; Pocket display name remains authoritative', async () => {
  const guestDefault = (await call('profile', undefined, 'guest')).data;
  assert.deepEqual([SKIN_TONES.length, HAIR_COLORS.length, HAIR_STYLES.length], [8, 10, 7]);
  const edited = await call('profile', { color: '#A1B2C3', look: {
    skin: SKIN_TONES.length - 1, hair: HAIR_COLORS.length - 1, style: HAIR_STYLES.length - 1,
  } });
  assert.equal(edited.status, 200, JSON.stringify(edited.data));
  assert.equal(edited.data.profile.color, '#a1b2c3');
  assert.deepEqual((await call('profile', undefined, 'guest')).data, guestDefault);
  assert.equal((await call('profile', { color: '#123456' }, 'guest')).status, 200);
  assert.deepEqual((await call(`profile?clientId=${clientId}`)).data, edited.data);
  await app.setExtensionEnabled(owner(app), 'office-v2.ts', false);
  await app.setExtensionEnabled(owner(app), 'office-v2.ts', true);
  assert.deepEqual((await call('profile')).data, edited.data);
  assert.equal((await call('profile', undefined, 'guest')).data.profile.color, '#123456');
  const oldName = owner(app).name;
  try {
    app.config.updateUser(owner(app).id, { name: 'Pocket renamed person' });
    const current = (await call('profile')).data;
    assert.equal(current.person.name, 'Pocket renamed person');
    assert.equal(current.profile.name, current.person.name);
    assert.deepEqual(current.profile.look, edited.data.profile.look);
    assert.equal(current.profile.color, edited.data.profile.color);
  } finally { app.config.updateUser(owner(app).id, { name: oldName }); }
});

test('profile edits reject identity, provider, credentials, and out-of-range avatar values', async () => {
  const before = (await call('profile')).data;
  for (const body of [
    { name: 'Impersonation' }, { id: guestId }, { person: { id: guestId } }, { role: 'owner' },
    { provider: 'other' }, { credentials: 'secret' }, { token: 'secret' }, { model: 'other/model' },
    { color: 'red' }, { color: null }, { look: null }, { look: { skin: 8, hair: 0, style: 0 } },
    { look: { skin: 0, hair: 10, style: 0 } }, { look: { skin: 0, hair: 0, style: 7 } },
    { look: { skin: -1, hair: 0, style: 0 } }, { look: { skin: 0.5, hair: 0, style: 0 } },
    { look: { skin: 0, hair: 0 } }, { look: { skin: 0, hair: 0, style: 0, name: 'Other' } }, {},
  ]) assert.equal((await call('profile', body)).status, 400, JSON.stringify(body));
  assert.deepEqual((await call('profile')).data, before, 'invalid requests never partially save');
});

test('profile customization is independent of source turn and plan; state uses the saved avatar', async () => {
  const source = await newSession(app);
  await app.harness.commit(async tx => {
    Object.assign(await tx.doc(TurnsDoc, source), { on: true, driver: guestId, asks: [] });
    (await tx.doc(PlanDoc, source)).on = true;
  }, context);
  const saved = await call('profile', { color: '#bada55', look: { skin: 2, hair: 3, style: 4 } });
  assert.equal(saved.status, 200);
  const presence = encodeURIComponent(JSON.stringify({ name: 'Spoof', color: '#000000', look: { skin: 0, hair: 0, style: 0 } }));
  const a = await call(`${state(source)}&presence=${presence}`);
  const secondClient = 'bbbbbbbb-0000-4000-8000-000000000002';
  const b = await call(`state/${source}?clientId=${secondClient}&presence=${presence}`);
  assert.equal(a.status, 200);
  assert.deepEqual(a.data.person, saved.data.person);
  assert.deepEqual(a.data.profile, saved.data.profile);
  assert.deepEqual(b.data.profile, saved.data.profile);
  assert.notEqual(a.data.you, b.data.you);
  for (const peer of b.data.peers) {
    assert.equal(peer.name, saved.data.person.name);
    assert.equal(peer.color, saved.data.profile.color);
    assert.deepEqual(peer.look, saved.data.profile.look);
  }
});

test('authenticated GET presence has per-tab identity and no durable write; invalid fields fail', async () => {
  const source = await newSession(app);
  const presence = encodeURIComponent(JSON.stringify({ name: 'Avatar', x: 1, z: 2, moving: true }));
  const result = await call(`${state(source)}&presence=${presence}`);
  assert.equal(result.status, 200, JSON.stringify(result.data));
  assert.equal(result.data.you, `${owner(app).id}:${clientId}`);
  assert.equal(result.data.peers[0].floor, 'pocket');
  assert.equal(result.data.peers[0].name, owner(app).name, 'profile cannot impersonate another actor');
  assert.deepEqual(result.data.bindings, []);
  assert.equal((await call(state(source), undefined, 'viewer')).status, 404);
  assert.equal((await call(state(source), undefined, 'scoped')).status, 404);
  assert.equal((await call(state(source), undefined, 'owner', false)).status, 403);
  assert.equal((await call(`${state(source)}&presence=${encodeURIComponent('{"x":99999}')}`)).status, 400);
  assert.equal((await call(`hire/${source}`, { ...hire(), model: 'other/model' })).status, 400);
  assert.equal((await call(`hire/${source}`, hire('../../secret'))).status, 400);
  assert.equal((await call(`hire/${source}`, hire('desk-17'))).status, 400, 'unbuilt expansion desk');
  assert.equal((await call(`hire/${source}`, hire('meeting-1'))).status, 400, 'meeting seats are deferred');
});

test('native heartbeat marks lite presence and a 3D heartbeat clears it for the same tab', async () => {
  const source = await newSession(app);
  const heartbeat = presence => call(`${state(source)}&presence=${encodeURIComponent(JSON.stringify(presence))}`);
  const native = await heartbeat({ lite: true });
  assert.equal(native.status, 200);
  assert.equal(native.data.peers.find(p => p.id === native.data.you).lite, true);
  const rendered = await heartbeat({ x: 2, z: 3 });
  assert.equal(rendered.status, 200);
  assert.equal(rendered.data.peers.find(p => p.id === rendered.data.you).lite, false);
  assert.equal(rendered.data.peers.find(p => p.id === rendered.data.you).x, 2);
  assert.equal((await heartbeat({ lite: false })).data.peers[0].lite, false);
  for (const lite of ['true', 1, null, {}, []]) assert.equal((await heartbeat({ lite })).status, 400);
});

test('hire is idempotent, binds an ordinary inherited session, and refuses another actor', async () => {
  const source = await newSession(app);
  const first = await call(`hire/${source}`, hire());
  assert.equal(first.status, 200, JSON.stringify(first.data));
  assert.equal(first.data.bindings.length, 1);
  const binding = first.data.bindings[0];
  assert.match(binding.workerId, /^pocket-[0-9a-f]{24}$/);
  assert.equal(app.cwdOf(binding.conversationId), app.cwdOf(source));
  const count = app.sessions().length;
  assert.deepEqual((await call(`hire/${source}`, hire())).data.bindings, [binding]);
  assert.equal(app.sessions().length, count);
  assert.equal((await call(`hire/${source}`, hire(), 'guest')).status, 409);
  const dismissed = await call(`dismiss/${source}`, { clientId, workerId: binding.workerId });
  assert.equal(dismissed.status, 200);
  assert.deepEqual(dismissed.data.bindings, []);
  assert.equal(app.sessions().length, count, 'dismiss never deletes a session');
  assert.equal((await call(state(source))).data.workers.length, 0);
  const second = await call(`hire/${source}`, hire('desk-1', 'new-generation'));
  assert.equal(second.status, 200);
  assert.notEqual(second.data.bindings[0].workerId, binding.workerId);
  assert.equal((await call(`dismiss/${source}`, { clientId, workerId: binding.workerId })).status, 409);
  assert.equal((await call(state(source))).data.bindings[0].workerId, second.data.bindings[0].workerId);
});

test('concurrent hires reserve one desk atomically', async () => {
  const source = await newSession(app);
  const count = app.sessions().length;
  const results = await Promise.all([
    call(`hire/${source}`, hire('desk-2', 'first')),
    call(`hire/${source}`, hire('desk-2', 'second')),
  ]);
  assert.deepEqual(results.map(r => r.status).sort(), [200, 409]);
  assert.equal(app.sessions().length, count + 1);
  assert.equal((await call(state(source))).data.workers.length, 1);
});

test('failed plan admission permits original-key recovery and explicit unseat', async () => {
  const source = await newSession(app);
  await app.harness.commit(async tx => { (await tx.doc(PlanDoc, source)).on = true; }, context);
  const count = app.sessions().length;
  const failed = await call(`hire/${source}`, hire('desk-3'));
  assert.notEqual(failed.status, 200);
  assert.equal(app.sessions().length, count);
  const pending = await call(state(source));
  assert.equal(pending.status, 200, 'GET is not model work');
  assert.equal(pending.data.pending[0].requestId, 'hire-one');
  assert.equal(pending.data.pending[0].recoverable, true);
  assert.deepEqual((await call(state(source), undefined, 'guest')).data.pending, []);
  await app.harness.commit(async tx => { (await tx.doc(PlanDoc, source)).on = false; }, context);
  const retry = await call(`hire/${source}`, hire('desk-3'));
  assert.equal(retry.status, 200, JSON.stringify(retry.data));
  assert.equal(retry.data.bindings.length, 1);
  assert.equal(app.sessions().length, count + 1);
});

test('GET remains available without the turn; chat, hire, and dismiss need the turn', async () => {
  const source = await newSession(app);
  await app.harness.commit(async tx => {
    Object.assign(await tx.doc(TurnsDoc, source), { on: true, driver: guestId, asks: [] });
  }, context);
  assert.equal((await call(state(source))).status, 200);
  for (const [route, body] of [
    ['hire', hire()],
    ['dismiss', { clientId, workerId: 'pocket-000000000000000000000000' }],
    ['state', { clientId, action: 'chat', text: 'Hello', requestId: 'chat-1' }],
  ] as const) assert.equal((await call(`${route}/${source}`, body)).status, 409);
  const chat = { clientId, action: 'chat', text: 'Hello', requestId: 'chat-1' };
  assert.equal((await call(`state/${source}`, chat, 'guest')).status, 200);
  const repeated = await call(`state/${source}`, chat, 'guest');
  assert.equal(repeated.data.chat.length, 1);
  assert.equal(repeated.data.chat[0].from, `${guestId}:${clientId}`);
});

test('interrupted binding commit recovers the original receipt across extension reload', async () => {
  const source = await newSession(app);
  const count = app.sessions().length;
  (globalThis as any).officeFailBinding = true;
  assert.equal((await call(`hire/${source}`, hire('desk-4', 'interrupted'))).status, 500);
  assert.equal(app.sessions().length, count + 1, 'initial message was already admitted');
  const pending = (await call(state(source))).data.pending[0];
  assert.equal(pending.recoverable, true);
  await app.setExtensionEnabled(owner(app), 'office-v2.ts', false);
  await app.setExtensionEnabled(owner(app), 'office-v2.ts', true);
  const recovered = await call(`hire/${source}`, { clientId, deskId: pending.deskId, prompt: pending.prompt, requestId: pending.requestId });
  assert.equal(recovered.status, 200, JSON.stringify(recovered.data));
  assert.equal(recovered.data.bindings[0].workerId, pending.workerId);
  assert.equal(recovered.data.model, 'faux/faux-1');
  assert.deepEqual(recovered.data.pending, []);
  assert.equal(app.sessions().length, count + 1, 'receipt recovery never starts another session');
});

test('dismiss of uncertain admission retains durable exclusion until receipt recovery', async () => {
  const source = await newSession(app);
  (globalThis as any).officeFailBinding = true;
  assert.equal((await call(`hire/${source}`, hire('desk-5', 'uncertain'))).status, 500);
  const count = app.sessions().length;
  const pending = (await call(state(source))).data.pending[0];
  assert.equal((await call(`dismiss/${source}`, { clientId, workerId: pending.workerId })).status, 200);
  assert.equal((await call(`hire/${source}`, hire('desk-5', 'different'))).status, 409);
  const recovered = await call(`hire/${source}`, hire('desk-5', 'uncertain'));
  assert.equal(recovered.status, 200);
  assert.deepEqual(recovered.data.bindings, [], 'dismissed admitted session stays unseated');
  assert.deepEqual(recovered.data.pending, []);
  assert.equal(app.sessions().length, count, 'uncertain session is neither duplicated nor deleted');
  assert.equal((await call(`hire/${source}`, hire('desk-5', 'different'))).status, 200);
});

test('each read suppresses bindings when the source audience cannot see worker metadata', async () => {
  const source = await newSession(app);
  const first = await call(`hire/${source}`, hire('desk-6', 'filtering'));
  assert.equal(first.status, 200);
  assert.equal(first.data.bindings.length, 1);
  const restricted = app.config.addUser('Source-only reader', 'viewer', [String(source)]);
  try {
    const filtered = await call(state(source));
    assert.equal(filtered.status, 200);
    assert.deepEqual(filtered.data.bindings, []);
    assert.deepEqual(filtered.data.workers, []);
    assert.deepEqual(filtered.data.pending, [], 'bound hidden sessions do not enter recovery metadata');
  } finally { app.config.removeUser(restricted.user.id); }
});
