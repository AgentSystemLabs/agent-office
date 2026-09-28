import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { WebSocket } from 'ws';
import { createServer } from 'node:http';
import { loadConfig } from '../src/server/config.js';
import { startServer } from '../src/server/server.js';
import { PROTOCOL_VERSION } from '../src/shared/protocol.js';

interface Office {
  base: string;
  wsBase: string;
  shutdown: (keep?: boolean) => void;
}

/** A free loopback port: bound for a moment, then handed to the office. */
function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const s = createServer();
    s.listen(0, '127.0.0.1', () => {
      const port = (s.address() as { port: number }).port;
      s.close(() => resolve(port));
    });
  });
}

/** A real office on a throwaway home dir and port, with password `pw`. */
async function openOffice(t: { after(fn: () => void): void }, password = 'pw'): Promise<Office> {
  const home = mkdtempSync(path.join(tmpdir(), 'agent-office-pair-'));
  const cfg = loadConfig(['--home', home, '--port', String(await freePort()), '--password', password, '--agent', 'true']);
  const office = await startServer(cfg);
  t.after(() => {
    office.shutdown();
    rmSync(home, { recursive: true, force: true });
  });
  const addr = office.server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  assert.ok(port > 0);
  return { base: `http://127.0.0.1:${port}`, wsBase: `ws://127.0.0.1:${port}`, shutdown: office.shutdown };
}

async function login(base: string, password = 'pw'): Promise<string> {
  const res = await fetch(`${base}/api/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password }) });
  assert.equal(res.status, 200);
  const cookie = res.headers.get('set-cookie');
  assert.ok(cookie);
  return cookie.split(';')[0];
}

async function api(base: string, p: string, opts: { method?: string; cookie?: string; token?: string; body?: unknown; origin?: string } = {}) {
  const headers: Record<string, string> = {};
  if (opts.cookie) headers.cookie = opts.cookie;
  if (opts.token) headers.authorization = `Bearer ${opts.token}`;
  if (opts.origin !== undefined) headers.origin = opts.origin;
  if (opts.body !== undefined) headers['content-type'] = 'application/json';
  const res = await fetch(`${base}${p}`, { method: opts.method ?? 'GET', headers, body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined });
  return { status: res.status, body: (await res.json().catch(() => ({}))) as Record<string, unknown> };
}

function connect(url: string, headers: Record<string, string> = {}): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url, { headers });
    // The office sends `welcome` the instant the upgrade completes, possibly before 'open'
    // fires: hold every message from the start, so none is missed while awaiting.
    const queue: unknown[] = [];
    (ws as WebSocket & { queue: unknown[] }).queue = queue;
    ws.on('message', (raw) => queue.push(raw));
    ws.once('open', () => resolve(ws));
    ws.once('error', reject);
  });
}

/** The first message the office sent (usually `welcome`), whenever it arrived. */
function firstOf(ws: WebSocket): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const queue = (ws as WebSocket & { queue: unknown[] }).queue ?? [];
    const take = (): boolean => {
      const raw = queue.shift();
      if (raw === undefined) return false;
      try {
        resolve(JSON.parse(String(raw)));
      } catch (err) {
        reject(err);
      }
      return true;
    };
    if (take()) return;
    ws.once('message', () => void take());
    ws.once('error', reject);
    setTimeout(() => reject(new Error('no message arrived')), 5000);
  });
}

test('start → claim → bearer whoami, then revoke', async (t) => {
  const { base } = await openOffice(t);
  const cookie = await login(base);

  // The laptop starts a pairing…
  const started = await api(base, '/api/pair/start', { method: 'POST', cookie });
  assert.equal(started.status, 200);
  assert.match(String(started.body.code), /^[0-9ABCDEFGHJKMNPQRSTVWXYZ]{8}$/);
  assert.ok(Number(started.body.expiresAt) > Date.now());

  // …the headset claims it…
  const claimed = await api(base, '/api/pair/claim', { method: 'POST', body: { code: started.body.code, name: 'Quest 3' } });
  assert.equal(claimed.status, 200);
  const token = String(claimed.body.token);
  assert.ok(token.length >= 43);
  assert.equal(claimed.body.name, 'Quest 3');

  // …single-use: the same code is gone now.
  const again = await api(base, '/api/pair/claim', { method: 'POST', body: { code: started.body.code, name: 'Quest 3' } });
  assert.equal(again.status, 404);

  // The token signs in as the device.
  const who = await api(base, '/api/whoami', { token });
  assert.equal(who.status, 200);
  assert.equal(who.body.ok, true);

  // The laptop lists and revokes it.
  const list = await api(base, '/api/pair/list', { cookie });
  assert.equal(list.status, 200);
  const devices = list.body.devices as { id: string; name: string }[];
  assert.equal(devices.length, 1);
  assert.equal(devices[0].name, 'Quest 3');
  assert.ok(!('tokenHash' in devices[0]) && !('token' in devices[0]));
  const revoked = await api(base, '/api/pair/revoke', { method: 'POST', cookie, body: { tokenId: devices[0].id } });
  assert.equal(revoked.status, 200);
  assert.equal((await api(base, '/api/whoami', { token })).status, 401);
  assert.deepEqual(((await api(base, '/api/pair/list', { cookie })).body.devices as unknown[]).length, 0);
});

test('wrong codes answer 404 with a generic error', async (t) => {
  const { base } = await openOffice(t);
  await login(base);
  const res = await api(base, '/api/pair/claim', { method: 'POST', body: { code: 'ZZZZZZZZ', name: 'Quest 3' } });
  assert.equal(res.status, 404);
  assert.ok(String(res.body.error).length > 0);
});

test('pairing management needs a session, and a bad token signs nothing in', async (t) => {
  const { base } = await openOffice(t);
  assert.equal((await api(base, '/api/pair/start', { method: 'POST' })).status, 401);
  assert.equal((await api(base, '/api/pair/list')).status, 401);
  assert.equal((await api(base, '/api/pair/revoke', { method: 'POST', body: { tokenId: 'x' } })).status, 401);
  assert.equal((await api(base, '/api/server-url')).status, 401);
  assert.equal((await api(base, '/api/whoami', { token: 'bogus' })).status, 401);
});

test('a device socket connects with ?token= and gets a versioned welcome', async (t) => {
  const { base, wsBase } = await openOffice(t);
  const cookie = await login(base);
  const started = await api(base, '/api/pair/start', { method: 'POST', cookie });
  const claimed = await api(base, '/api/pair/claim', { method: 'POST', body: { code: started.body.code, name: 'Quest 3' } });
  const token = String(claimed.body.token);

  // No Origin (native clients send none), token in the query string.
  const ws = await connect(`${wsBase}/ws?token=${token}&name=Sneaky`);
  t.after(() => ws.close());
  const welcome = await firstOf(ws);
  assert.equal(welcome.t, 'welcome');
  assert.equal(welcome.protocolVersion, PROTOCOL_VERSION);
  const peers = welcome.peers as { id: string; name: string }[];
  const me = peers.find((p) => p.id === welcome.you);
  assert.equal(me?.name, 'Quest 3'); // the claimed name, not ?name=
  ws.close();
});

test('a device socket connects with an Authorization header', async (t) => {
  const { base, wsBase } = await openOffice(t);
  const cookie = await login(base);
  const started = await api(base, '/api/pair/start', { method: 'POST', cookie });
  const claimed = await api(base, '/api/pair/claim', { method: 'POST', body: { code: started.body.code, name: 'Quest 3' } });
  const ws = await connect(`${wsBase}/ws`, { authorization: `Bearer ${claimed.body.token}` });
  t.after(() => ws.close());
  const welcome = await firstOf(ws);
  assert.equal(welcome.t, 'welcome');
  assert.equal(welcome.protocolVersion, PROTOCOL_VERSION);
  ws.close();
});

test('cookie sockets still need a matching Origin; token sockets do not', async (t) => {
  const { base, wsBase } = await openOffice(t);
  const cookie = await login(base);

  // A cookie with a foreign Origin is refused (CSRF protection, unchanged).
  await assert.rejects(connect(`${wsBase}/ws`, { cookie, origin: 'https://evil.example.com' }));

  // A cookie with no Origin at all is refused too.
  await assert.rejects(connect(`${wsBase}/ws`, { cookie }));

  // A valid token with no Origin is let in (tested above); a bad one is refused.
  await assert.rejects(connect(`${wsBase}/ws?token=bogus`));
  await assert.rejects(connect(`${wsBase}/ws`, { authorization: 'Bearer bogus' }));
});

test('/api/server-url answers a LAN URL, or the --public-url', async (t) => {
  const { base } = await openOffice(t);
  const cookie = await login(base);
  const res = await api(base, '/api/server-url', { cookie });
  assert.equal(res.status, 200);
  assert.match(String(res.body.url), /^http:\/\/\d+\.\d+\.\d+\.\d+:\d+$/);
  assert.ok(!String(res.body.url).includes('127.0.0.1'), 'never loopback: that is the headset talking to itself');
});

test('--public-url wins over the LAN address', async (t) => {
  const home = mkdtempSync(path.join(tmpdir(), 'agent-office-pair-'));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const cfg = loadConfig(['--home', home, '--port', String(await freePort()), '--password', 'pw', '--agent', 'true', '--public-url', 'https://office.example.com']);
  assert.equal(cfg.publicUrl, 'https://office.example.com');
  const office = await startServer(cfg);
  t.after(() => office.shutdown());
  const port = (office.server.address() as { port: number }).port;
  const base = `http://127.0.0.1:${port}`;
  const res = await api(base, '/api/server-url', { cookie: await login(base) });
  assert.equal(res.body.url, 'https://office.example.com');
});
