// `agent-office tunnel` against the office's own request handler: it signs in, asks for the
// workers' servers, and what arrives on a port it opened reaches that worker's server.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, scryptSync } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import http from 'node:http';
import net, { type AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { Accounts } from '../src/server/accounts.js';
import { Auth } from '../src/server/auth.js';
import { requestHandler } from '../src/server/http/router.js';
import { authRoutes } from '../src/server/http/routes/auth.js';
import { pageRoutes } from '../src/server/http/routes/pages.js';
import { serviceRoutes } from '../src/server/http/routes/services.js';
import type { Ctx } from '../src/server/office/context.js';
import { acceptWebSockets } from '../src/server/ws/upgrade.js';
import { Forwarder } from '../src/server/tunnel/forwarder.js';
import { officeUrl, parseArgs } from '../src/server/tunnel/index.js';
import { Office } from '../src/server/tunnel/office.js';
import { sshArgs } from '../src/server/tunnel/ssh.js';
import type { Forward } from '../src/server/tunnel/wire.js';
import type { ServiceInfo } from '../src/shared/protocol.js';

const listen = (server: net.Server) => new Promise<number>((resolve) => server.listen(0, '127.0.0.1', () => resolve((server.address() as AddressInfo).port)));

/** A port nothing listens on. */
async function freePort(): Promise<number> {
  const s = net.createServer();
  const port = await listen(s);
  await new Promise((resolve) => s.close(resolve));
  return port;
}

interface Got {
  status: number;
  body: string;
}

function get(port: number, pathname: string, headers: http.OutgoingHttpHeaders = {}): Promise<Got> {
  return new Promise((resolve, reject) => {
    http
      .get({ host: '127.0.0.1', port, path: pathname, headers: { host: `localhost:${port}`, ...headers }, agent: false }, (res) => {
        let body = '';
        res.on('data', (d) => (body += d)).on('end', () => resolve({ status: res.statusCode ?? 0, body }));
      })
      .on('error', reject);
  });
}

/**
 * A worker's server and the office in front of it. Both are on this computer, so the port the
 * office says the server is on (`port`, which the client opens here) isn't the one it really
 * listens on: the office's own lookup goes from one to the other.
 */
async function setup() {
  const seen: http.IncomingHttpHeaders[] = [];
  const worker = http.createServer((req, res) => {
    seen.push(req.headers);
    res.setHeader('set-cookie', 'theirs=2');
    res.end(`worker ${req.method} ${req.url}`);
  });
  worker.on('upgrade', (_req, socket) => {
    socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: echo\r\nConnection: Upgrade\r\n\r\n');
    socket.pipe(socket);
  });
  const real = await listen(worker);
  const port = await freePort();
  const svc = { port: real, host: '127.0.0.1', pid: 1, command: 'vite', workerId: 'w1', title: 'Vite App', since: 0 } satisfies ServiceInfo;
  const running = new Set([port]);

  const salt = randomBytes(16);
  const accounts = new Accounts(mkdtempSync(path.join(os.tmpdir(), 'ao-tunnel-')));
  const cfg = { port: 0, trustProxy: false };
  const ctx = {
    cfg,
    accounts,
    auth: new Auth(scryptSync('hunter2', salt, 32), salt, 'secret', accounts),
    services: {
      list: () => (running.has(port) ? [{ ...svc, port }] : []),
      lookup: (p: number) => (p !== port ? undefined : running.has(port) ? svc : 'gone'),
    },
    workerFloor: (id: string) => (id === 'w1' ? { def: { name: 'acme' }, workers: { get: () => ({ name: 'Byte' }) } } : undefined),
  } as unknown as Ctx;
  const officeServer = http.createServer(requestHandler(ctx, [authRoutes.login, authRoutes.loginOptions, pageRoutes.health, serviceRoutes.forwards]));
  acceptWebSockets(ctx, officeServer);
  cfg.port = await listen(officeServer);

  const office = new Office(new URL(`http://127.0.0.1:${cfg.port}`));
  const events: string[] = [];
  const said = {
    opened: (f: Forward) => events.push(`opened ${f.port}`),
    closed: (f: Forward) => events.push(`closed ${f.port}`),
    busy: (f: Forward, why: string) => events.push(`busy ${f.port} ${why}`),
  };
  // No lingering: a port closes the moment its server is off the list.
  const forwarder = new Forwarder(office, said, new Set(), 0);
  const close = () => {
    forwarder.close();
    office.close();
    officeServer.close();
    officeServer.closeAllConnections();
    worker.close();
    worker.closeAllConnections();
  };
  return { port, real, seen, running, office, forwarder, events, said, close, officePort: cfg.port };
}

test("it signs in with the office password and is told the workers' servers", async () => {
  const t = await setup();
  try {
    assert.equal(await t.office.up(), true);
    assert.deepEqual(await t.office.loginOptions(), { accounts: false, shared: true });
    assert.equal(await t.office.forwards(), 'signed-out');
    assert.equal(await t.office.signIn('', 'wrong'), 'Wrong password');
    assert.equal(await t.office.signIn('', 'hunter2'), '');
    assert.deepEqual(await t.office.forwards(), { port: t.officePort, items: [{ port: t.port, title: 'Vite App', command: 'vite', worker: 'Byte', floor: 'acme' }] });
  } finally {
    t.close();
  }
});

test("a worker's server opens on the same port here, for anything on this computer, and closes when it stops", async () => {
  const t = await setup();
  try {
    await t.office.signIn('', 'hunter2');
    const list = await t.office.forwards();
    assert.ok(typeof list === 'object');
    await t.forwarder.sync(list.items);
    assert.deepEqual(t.events, [`opened ${t.port}`]);
    assert.deepEqual(t.forwarder.ports(), [t.port]);

    // No cookie of the office's, as curl would ask: the client's own session signs it in.
    const page = await get(t.port, '/hello?x=1', { cookie: 'mine=1' });
    assert.deepEqual(page, { status: 200, body: 'worker GET /hello?x=1' });
    const headers = t.seen.at(-1)!;
    assert.equal(headers.host, `localhost:${t.port}`);
    // The worker's server never sees the office's session, or how the request got to it.
    assert.equal(headers.cookie, 'mine=1');
    assert.equal(headers['x-agent-office-service'], undefined);

    // Many at once, over the connections the client keeps open to the office.
    const many = await Promise.all(Array.from({ length: 60 }, (_, i) => get(t.port, `/n/${i}`)));
    assert.deepEqual(many.map((r) => r.body), Array.from({ length: 60 }, (_, i) => `worker GET /n/${i}`));

    // WebSockets (hot reload) go through too.
    const echoed = await new Promise<string>((resolve, reject) => {
      const req = http.request({ host: '127.0.0.1', port: t.port, headers: { host: `localhost:${t.port}`, connection: 'Upgrade', upgrade: 'echo' } });
      req.on('upgrade', (_res, socket) => {
        socket.on('data', (d) => {
          resolve(String(d));
          socket.destroy();
        });
        socket.write('ping');
      });
      req.on('error', reject);
      req.end();
    });
    assert.equal(echoed, 'ping');

    // A page somewhere else that points a name of its own at the port gets nothing.
    assert.equal((await get(t.port, '/', { host: `evil.example:${t.port}` })).status, 421);

    t.running.clear();
    const after = await t.office.forwards();
    assert.ok(typeof after === 'object');
    await t.forwarder.sync(after.items);
    assert.deepEqual(t.events, [`opened ${t.port}`, `closed ${t.port}`]);
    await assert.rejects(get(t.port, '/'), /ECONNREFUSED/);
  } finally {
    t.close();
  }
});

test("a request the client sends never gets the office's own pages", async () => {
  const t = await setup();
  const item = (port: number): Forward => ({ port, title: 'x', command: 'x' });
  try {
    await t.office.signIn('', 'hunter2');
    // A port no worker serves (the office forgot it, or never knew it), and the office's own.
    const stale = await freePort();
    await t.forwarder.sync([item(t.port), item(stale)]);
    for (const p of ['/', '/api/services', '/api/health']) {
      const r = await get(stale, p);
      assert.equal(r.status, 503, p);
      assert.match(r.body, /Not running/);
    }
    // Nor does a worker's page that says the office relayed its request already.
    assert.equal((await get(stale, '/api/services', { 'x-agent-office-relay': '1' })).status, 503);
    assert.equal((await get(t.port, '/api/services', { 'x-agent-office-relay': '1' })).body, 'worker GET /api/services');

    const direct = (headers: http.OutgoingHttpHeaders) => get(t.officePort, '/api/health', { host: `127.0.0.1:${t.officePort}`, cookie: t.office.cookie(), ...headers });
    assert.equal((await direct({})).status, 200);
    assert.equal((await direct({ 'x-agent-office-service': String(t.officePort) })).status, 503);
    assert.equal((await direct({ 'x-agent-office-service': 'nope' })).status, 503);

    // Signed out (the password changed): the office asks who's there instead of relaying.
    t.office.token = 'not-a-session';
    const before = t.seen.length;
    const r = await get(t.port, '/hello');
    assert.equal(r.status, 401);
    assert.match(r.body, /Sign in to the office/);
    assert.equal(t.seen.length, before);
  } finally {
    t.close();
  }
});

test("a port something on this computer already has is left alone, and opens once it's free", async () => {
  const t = await setup();
  const mine = http.createServer((_req, res) => res.end('mine'));
  try {
    await t.office.signIn('', 'hunter2');
    const port = await listen(mine);
    const items: Forward[] = [{ port, title: 'Next', command: 'next dev' }];
    await t.forwarder.sync(items);
    await t.forwarder.sync(items);
    assert.deepEqual(t.events, [`busy ${port} taken`]);
    assert.equal((await get(port, '/')).body, 'mine');

    await new Promise((resolve) => mine.close(resolve));
    await t.forwarder.sync(items);
    assert.deepEqual(t.events, [`busy ${port} taken`, `opened ${port}`]);
  } finally {
    mine.close();
    t.close();
  }
});

test("a server that's off the list for a moment keeps its port, and the office answers for it meanwhile", async () => {
  const t = await setup();
  const forwarder = new Forwarder(t.office, t.said);
  const items: Forward[] = [{ port: t.port, title: 'Vite App', command: 'vite' }];
  try {
    await t.office.signIn('', 'hunter2');
    await forwarder.sync(items, 0);
    // Restarting, or the office missed it for one look: still open, with the office's page for it.
    t.running.clear();
    await forwarder.sync([], 1000);
    await forwarder.sync([], 9000);
    assert.deepEqual(t.events, [`opened ${t.port}`]);
    assert.equal((await get(t.port, '/')).status, 503);
    // Back within a few seconds: it never closed, and a later gap starts counting again.
    t.running.add(t.port);
    await forwarder.sync(items, 10_000);
    assert.equal((await get(t.port, '/')).body, 'worker GET /');
    await forwarder.sync([], 15_000);
    await forwarder.sync([], 24_000);
    assert.deepEqual(t.events, [`opened ${t.port}`]);
    // Gone for good.
    await forwarder.sync([], 25_000);
    assert.deepEqual(t.events, [`opened ${t.port}`, `closed ${t.port}`]);
    await assert.rejects(get(t.port, '/'), /ECONNREFUSED/);
  } finally {
    forwarder.close();
    t.close();
  }
});

test("the office's own port on this computer is never one of the ports it opens", async () => {
  const t = await setup();
  const events: string[] = [];
  const forwarder = new Forwarder(t.office, { opened: (f) => events.push(`opened ${f.port}`), closed: () => {}, busy: (f) => events.push(`busy ${f.port}`) }, new Set([t.officePort]));
  try {
    await forwarder.sync([{ port: t.officePort, title: 'x', command: 'x' }]);
    assert.deepEqual(events, []);
  } finally {
    forwarder.close();
    t.close();
  }
});

test('where the office is: an SSH address, or an address a browser opens', () => {
  assert.equal(officeUrl('office@203.0.113.7'), undefined);
  assert.equal(officeUrl('ssh://office@host:2222'), undefined);
  assert.equal(officeUrl('office-box'), undefined);
  assert.equal(officeUrl('http://localhost:4600')?.origin, 'http://localhost:4600');
  assert.equal(officeUrl('https://office.example.com/')?.origin, 'https://office.example.com');

  assert.equal(new Office(new URL('http://localhost:4600')).local, true);
  assert.equal(new Office(new URL('http://[::1]:4600')).local, true);
  assert.equal(new Office(new URL('https://office.example.com')).local, false);
  assert.equal(new Office(new URL('https://office.example.com')).host, 'office.example.com');
  assert.equal(new Office(new URL('https://office.example.com:8443')).host, 'office.example.com:8443');
});

test('the command line', () => {
  const env = {};
  assert.equal(parseArgs(['--help'], env), undefined);
  assert.deepEqual(parseArgs([], env), { where: '', officePort: 4600, credentials: { name: undefined, password: undefined }, open: true, insecure: false, ssh: [] });
  const o = parseArgs(['office@203.0.113.7', '-p', '4700', '--office-port', '4601', '--no-open', '--name', 'cody', '--', '-i', 'key', '-p', '2222'], { AGENT_OFFICE_PASSWORD: 'pw' })!;
  assert.deepEqual(o, { where: 'office@203.0.113.7', port: 4700, officePort: 4601, credentials: { name: 'cody', password: 'pw' }, open: false, insecure: false, ssh: ['-i', 'key', '-p', '2222'] });
  assert.throws(() => parseArgs(['a@b', 'c@d'], env), /one office at a time/);
  assert.throws(() => parseArgs(['--port', 'x'], env), /port number/);
  assert.throws(() => parseArgs(['--wat'], env), /unknown option/);

  // The one forward an invited key may open: this computer's port to the office's own.
  assert.deepEqual(sshArgs('office@203.0.113.7', 4700, 4600, ['-i', 'key']).slice(-5), ['-L', '4700:localhost:4600', '-i', 'key', 'office@203.0.113.7']);
});
