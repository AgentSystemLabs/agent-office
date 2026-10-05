import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import http from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Duplex } from 'node:stream';
import { WebSocket } from 'ws';
import { Hosts } from '../src/server/hosts.js';
import { HostRegistry } from '../src/server/floor-hosts.js';
import { FLOORHOST_PROTOCOL, type FloorReady } from '../src/shared/floorhost.js';

/**
 * A host on an ephemeral port, driven through the real registry and the real pairing check.
 *
 * This is the first test in the repo to open a socket. The closest precedents are a real http.Server
 * on an ephemeral port (tests/office-queue.test.ts) and a narrow interface faked rather than a class
 * (tests/queue.test.ts); this takes the first.
 */
function server() {
  const dir = mkdtempSync(path.join(tmpdir(), 'office-floorhosts-'));
  const hosts = new Hosts(dir);
  const registry = new HostRegistry(hosts);
  // The office's http server routes /floor-host before its session gate, then everything else.
  const srv = http.createServer((_req, res) => res.end('no'));
  srv.on('upgrade', (req, socket, head) => {
    const p = new URL(req.url ?? '/', 'http://x').pathname;
    if (!registry.upgrade(req, socket as Duplex, head as Buffer, p)) {
      socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
      socket.destroy();
    }
  });
  return new Promise<Fixture>((resolve) => {
    srv.listen(0, '127.0.0.1', () => {
      const port = (srv.address() as { port: number }).port;
      resolve({
        dir,
        hosts,
        registry,
        url: `ws://127.0.0.1:${port}/floor-host`,
        close() {
          registry.closeAll();
          srv.close();
          rmSync(dir, { recursive: true, force: true });
        },
      });
    });
  });
}

interface Fixture {
  dir: string;
  hosts: Hosts;
  registry: HostRegistry;
  url: string;
  close(): void;
}

const ready = (floorId: string, over: Partial<FloorReady> = {}): FloorReady => ({
  floorId,
  name: floorId,
  seats: 2,
  accepting: false,
  workers: [],
  forge: 'github',
  ...over,
});

async function connect(url: string, token: string, floors: string[] = ['f1'], projectsDir?: string) {
  const ws = new WebSocket(url);
  await new Promise((res, rej) => {
    ws.once('open', res);
    ws.once('error', rej);
  });
  ws.send(JSON.stringify({ t: 'hello', token, hostId: 'h1', protocol: FLOORHOST_PROTOCOL, floors, projectsDir }));
  return ws;
}

async function closed(ws: WebSocket) {
  await new Promise<void>((res) => {
    if (ws.readyState === WebSocket.CLOSED) return res();
    ws.once('close', () => res());
    setTimeout(res, 1500);
  });
  return ws.readyState;
}

test('a machine with no valid token is refused at the upgrade', async () => {
  const f = await server();
  try {
    const made = f.hosts.pair('admin');
    assert.ok(typeof made !== 'string');
    const ws = await connect(f.url, 'not-a-real-token');
    assert.equal(await closed(ws), WebSocket.CLOSED, 'the socket is closed, not left hanging');
    assert.equal(f.registry.floorsOf('nope'), 0);
  } finally {
    f.close();
  }
});

test('a paired machine connects, announces a floor, and the office knows it', async () => {
  const f = await server();
  try {
    const made = f.hosts.pair('admin');
    assert.ok(typeof made !== 'string');
    const claimed = f.hosts.claim(made.code, 'Alice’s laptop', 'alice', 4);
    assert.ok(typeof claimed !== 'string');

    const ws = await connect(f.url, claimed.token, ['f1']);
    ws.send(JSON.stringify({ t: 'ready', floor: ready('f1', { seats: 4 }) }));

    // The roster is what lets the office answer workerFloor without a scan, so wait for it.
    await new Promise((r) => setTimeout(r, 120));
    assert.equal(f.registry.isReachable('f1'), true, 'the floor is reachable');
    assert.equal(f.registry.serves('f1')?.host.id, claimed.host.id);
    assert.equal(f.registry.floorsOf(claimed.host.id), 1);
    ws.close();
  } finally {
    f.close();
  }
});

test('a host with no floors reports its projects folder during the handshake', async () => {
  const f = await server();
  try {
    const code = f.hosts.pair('admin');
    assert.ok(typeof code !== 'string');
    const paired = f.hosts.claim(code.code, 'Empty laptop');
    assert.ok(typeof paired !== 'string');
    const ws = await connect(f.url, paired.token, [], 'C:\\work');
    await new Promise<void>((resolve) => ws.once('message', () => resolve()));
    assert.equal(f.hosts.get(paired.host.id)?.projectsDir, 'C:\\work');
    assert.equal(f.registry.floorsOf(paired.host.id), 0);
    ws.close();
  } finally {
    f.close();
  }
});

test('leaving one floor notifies the office without disconnecting the other floors', async () => {
  const f = await server();
  try {
    const made = f.hosts.pair('admin');
    assert.ok(typeof made !== 'string');
    const claimed = f.hosts.claim(made.code, 'Alice’s laptop', 'alice', 4);
    assert.ok(typeof claimed !== 'string');
    const ws = await connect(f.url, claimed.token, ['f1', 'f2']);
    const bothReady = new Promise<void>((resolve) => {
      f.registry.onFloorUp = (id) => { if (id === 'f2') resolve(); };
    });
    ws.send(JSON.stringify({ t: 'ready', floor: ready('f1') }));
    ws.send(JSON.stringify({ t: 'ready', floor: ready('f2') }));
    await bothReady;
    const gone = new Promise<string>((resolve) => { f.registry.onFloorGone = resolve; });
    ws.send(JSON.stringify({ t: 'leave', floorId: 'f1' }));
    assert.equal(await gone, 'f1');
    assert.equal(f.registry.isReachable('f1'), false);
    assert.equal(f.registry.isReachable('f2'), true);
    ws.close();
  } finally {
    f.close();
  }
});

test('everything a machine announces reaches the proxy, not just the registry', async () => {
  // `ready` is the one frame the registry handles itself, and handling it there alone is a silent
  // trap: the office's `RemoteFloor` is where the roster, the branch, the agent list and the forge
  // kind are read from, and none of them arrive any other way. Dropping it here is an elevator that
  // always says zero workers and a Bitbucket floor the office goes on treating as GitHub.
  const f = await server();
  try {
    const made = f.hosts.pair('admin');
    assert.ok(typeof made !== 'string');
    const claimed = f.hosts.claim(made.code, 'Alice’s laptop', 'alice', 4);
    assert.ok(typeof claimed !== 'string');

    const upward: { floorId: string; t: string; floor?: unknown }[] = [];
    f.registry.onUpward = (floorId, msg) => upward.push({ floorId, ...(msg as { t: string }) });

    const ws = await connect(f.url, claimed.token, ['f1']);
    ws.send(JSON.stringify({ t: 'ready', floor: ready('f1', { seats: 4, branch: 'release/2', providers: ['claude', 'opencode'], workers: [{ id: 'w1', status: 'working', deskId: 'desk-1' }] }) }));
    await new Promise((r) => setTimeout(r, 120));

    const told = upward.find((m) => m.t === 'ready');
    assert.ok(told, 'the proxy is handed the ready frame');
    assert.equal(told.floorId, 'f1');
    const payload = told.floor as { branch?: string; providers?: string[]; workers: { id: string }[] };
    assert.equal(payload.branch, 'release/2', 'the branch only that machine knows');
    assert.deepEqual(payload.providers, ['claude', 'opencode'], 'and the agents it actually has');
    assert.deepEqual(
      payload.workers.map((w) => w.id),
      ['w1'],
      'and the roster of workers already on it',
    );
    ws.close();
  } finally {
    f.close();
  }
});

test('one socket carries several floors, and losing it loses them all in one pass', async () => {
  // decision 6, and the reason this class is shaped this way: the socket is the unit of failure, so a
  // drop marks every floor at once rather than letting the first worker exit decide.
  const f = await server();
  try {
    const made = f.hosts.pair('admin');
    assert.ok(typeof made !== 'string');
    const claimed = f.hosts.claim(made.code, 'Alice’s laptop', 'alice', 4);
    assert.ok(typeof claimed !== 'string');

    const gone: string[] = [];
    const ws = await connect(f.url, claimed.token, ['f1', 'f2', 'f3']);
    for (const id of ['f1', 'f2', 'f3']) ws.send(JSON.stringify({ t: 'ready', floor: ready(id) }));
    await new Promise((r) => setTimeout(r, 120));
    assert.equal(f.registry.floorsOf(claimed.host.id), 3, 'one connection, three floors');

    // Wire the office's one-pass loss handler, the way server.ts will.
    const socket = f.registry.serves('f1');
    assert.ok(socket);
    socket.onFloorGone = (id) => gone.push(id);
    ws.close();
    await closed(ws);
    await new Promise((r) => setTimeout(r, 120));

    assert.deepEqual(gone.sort(), ['f1', 'f2', 'f3'], 'every floor went with the socket');
    assert.equal(f.registry.isReachable('f1'), false);
    assert.equal(f.registry.isReachable('f3'), false);
  } finally {
    f.close();
  }
});

test('a host can leave one floor without dropping the others', async () => {
  const f = await server();
  try {
    const made = f.hosts.pair('admin');
    assert.ok(typeof made !== 'string');
    const claimed = f.hosts.claim(made.code, 'Alice’s laptop', 'alice', 4);
    assert.ok(typeof claimed !== 'string');

    const ws = await connect(f.url, claimed.token, ['f1', 'f2']);
    for (const id of ['f1', 'f2']) ws.send(JSON.stringify({ t: 'ready', floor: ready(id) }));
    await new Promise((r) => setTimeout(r, 120));

    ws.send(JSON.stringify({ t: 'leave', floorId: 'f2' }));
    await new Promise((r) => setTimeout(r, 120));
    assert.equal(f.registry.isReachable('f1'), true, 'f1 is still up');
    assert.equal(f.registry.isReachable('f2'), false, 'f2 went on its own');
    ws.close();
  } finally {
    f.close();
  }
});

test('a machine speaking the wrong protocol is refused and told why', async () => {
  // Better a clear refusal than a half-understood frame: the shapes are not compatible.
  const f = await server();
  try {
    const made = f.hosts.pair('admin');
    assert.ok(typeof made !== 'string');
    const claimed = f.hosts.claim(made.code, 'Alice’s laptop');
    assert.ok(typeof claimed !== 'string');

    const ws = new WebSocket(f.url);
    await new Promise((res, rej) => {
      ws.once('open', res);
      ws.once('error', rej);
    });
    const said: string[] = [];
    ws.on('message', (raw) => said.push(String(raw)));
    ws.send(JSON.stringify({ t: 'hello', token: claimed.token, hostId: 'h1', protocol: 99, floors: [] }));

    await new Promise((r) => setTimeout(r, 200));
    assert.ok(said.some((m) => m.includes('floor-host protocol')), `expected a reason, got ${said.join(' | ')}`);
    assert.equal(await closed(ws), WebSocket.CLOSED);
  } finally {
    f.close();
  }
});

test('a second socket from the same machine is dropped', async () => {
  // "Which socket owns these floors" must never be ambiguous — that ambiguity is what makes revocation
  // unclear, and revocation is the whole security story this design rests on.
  const f = await server();
  try {
    const made = f.hosts.pair('admin');
    assert.ok(typeof made !== 'string');
    const claimed = f.hosts.claim(made.code, 'Alice’s laptop');
    assert.ok(typeof claimed !== 'string');

    const first = await connect(f.url, claimed.token, ['f1']);
    first.send(JSON.stringify({ t: 'ready', floor: ready('f1') }));
    await new Promise((r) => setTimeout(r, 120));

    const second = await connect(f.url, claimed.token, ['f9']);
    assert.equal(await closed(second), WebSocket.CLOSED, 'the newcomer is turned away');
    assert.equal(f.registry.isReachable('f1'), true, 'and the first one keeps its floors');
    first.close();
  } finally {
    f.close();
  }
});

test('a revoked machine is refused even while it holds a socket', async () => {
  // Revoking has to take effect at once: the token is checked on hello, and the office drops the
  // connection itself. Either way the floors stop being reachable.
  const f = await server();
  try {
    const made = f.hosts.pair('admin');
    assert.ok(typeof made !== 'string');
    const claimed = f.hosts.claim(made.code, 'Alice’s laptop');
    assert.ok(typeof claimed !== 'string');
    const ws = await connect(f.url, claimed.token, ['f1']);
    ws.send(JSON.stringify({ t: 'ready', floor: ready('f1') }));
    await new Promise((r) => setTimeout(r, 120));
    assert.equal(f.registry.isReachable('f1'), true);

    f.hosts.revoke(claimed.host.id);
    const second = await connect(f.url, claimed.token, ['f2']);
    assert.equal(await closed(second), WebSocket.CLOSED, 'the revoked token no longer opens anything');
    ws.close();
  } finally {
    f.close();
  }
});


test('the office can drop every machine at once when it shuts down', async () => {
  const f = await server();
  try {
    const made = f.hosts.pair('admin');
    assert.ok(typeof made !== 'string');
    const claimed = f.hosts.claim(made.code, 'Alice’s laptop');
    assert.ok(typeof claimed !== 'string');
    const ws = await connect(f.url, claimed.token, ['f1']);
    ws.send(JSON.stringify({ t: 'ready', floor: ready('f1') }));
    await new Promise((r) => setTimeout(r, 120));

    f.registry.closeAll();
    assert.equal(await closed(ws), WebSocket.CLOSED);
    assert.equal(f.registry.isReachable('f1'), false, 'and nothing is left reachable');
  } finally {
    f.close();
  }
});

test('the roster from ready answers a worker lookup without scanning every floor', async () => {
  // This is what replaces workerFloor's linear scan (server.ts:256) for hosted floors.
  const f = await server();
  try {
    const made = f.hosts.pair('admin');
    assert.ok(typeof made !== 'string');
    const claimed = f.hosts.claim(made.code, 'Alice’s laptop');
    assert.ok(typeof claimed !== 'string');
    const ws = await connect(f.url, claimed.token, ['f1']);
    ws.send(JSON.stringify({ t: 'ready', floor: ready('f1', { workers: [{ id: 'w1', status: 'working', deskId: 'desk-1' }, { id: 'w2', status: 'idle', deskId: 'desk-2' }] }) }));
    await new Promise((r) => setTimeout(r, 120));

    const socket = f.registry.serves('f1');
    assert.ok(socket);
    assert.deepEqual(socket.workersOn('f1').sort(), ['w1', 'w2']);
    assert.equal(socket.floors.get('f1')?.accepting, false, 'accepting comes from the host, not the office');
    ws.close();
  } finally {
    f.close();
  }
});

test('an upward frame reaches whoever holds that floor proxy', async () => {
  // The gap the demo found: the socket itself has to hand a floor's upward frames to the floor's
  // proxy, or a hire's answer never arrives and every call waits out its timeout. This is the
  // office's one line of wiring, and it is what makes the proxy work at all.
  const f = await server();
  try {
    const made = f.hosts.pair('admin');
    assert.ok(typeof made !== 'string');
    const claimed = f.hosts.claim(made.code, 'Alice’s laptop');
    assert.ok(typeof claimed !== 'string');

    const upward: { floorId: string; t: string }[] = [];
    const lost: string[] = [];
    f.registry.onUpward = (floorId, msg) => upward.push({ floorId, t: msg.t });
    f.registry.onFloorGone = (floorId) => lost.push(floorId);

    const ws = await connect(f.url, claimed.token, ['f1', 'f2']);
    for (const id of ['f1', 'f2']) ws.send(JSON.stringify({ t: 'ready', floor: ready(id) }));
    await new Promise((r) => setTimeout(r, 120));

    // An answer to a call, and a plain event: both are the floor talking upward. And the two `ready`
    // frames ahead of them, which the registry handles itself but must still hand on — the proxy is
    // where the roster, the branch and the forge kind are read from, and nothing else carries them.
    ws.send(JSON.stringify({ t: 'event', floorId: 'f1', seq: 7, msg: { t: 'worker.update' } }));
    ws.send(JSON.stringify({ t: 'term.data', floorId: 'f2', workerId: 'w1', data: 'hi' }));
    await new Promise((r) => setTimeout(r, 120));
    assert.deepEqual(upward, [
      { floorId: 'f1', t: 'ready' },
      { floorId: 'f2', t: 'ready' },
      { floorId: 'f1', t: 'event' },
      { floorId: 'f2', t: 'term.data' },
    ]);

    // And losing the machine tells the office about every floor it carried, in one pass.
    ws.close();
    await closed(ws);
    await new Promise((r) => setTimeout(r, 120));
    assert.deepEqual(lost.sort(), ['f1', 'f2']);
  } finally {
    f.close();
  }
});
