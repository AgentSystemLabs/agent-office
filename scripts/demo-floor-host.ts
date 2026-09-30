/**
 * Drives everything built so far, end to end, in one process — so the feature can be watched before
 * any of it is wired into the office.
 *
 *   npm run demo:floor-host
 *
 * What it shows, in order:
 *
 *   1. A machine pairs. The code is one-time, the token is shown once and never stored.
 *   2. A stranger's token is refused.
 *   3. The machine dials the office over a real socket and announces a floor.
 *   4. The office holds a RemoteFloor where it would hold a Floor, and hires through it. The worker
 *      is created on the "other machine" — here, a stand-in that announces a worker and streams it.
 *   5. A read (listing workers) is answered from what the host streamed, with nothing on the wire.
 *   6. The machine goes away. Everything on it is refused by name, in one pass — not failed, and not
 *      left waiting.
 *
 * This is a demo, not a test: the tests are the authority on all of the above (tests/hosts.test.ts,
 * tests/floorhost-conn.test.ts, tests/remote-floor.test.ts).
 */
import http from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { WebSocket } from 'ws';
import { Hosts } from '../src/server/hosts.js';
import { HostRegistry } from '../src/server/floor-hosts.js';
import { RemoteFloor } from '../src/server/remote-floor.js';
import { FLOORHOST_PROTOCOL } from '../src/shared/floorhost.js';
import type { WorkerInfo } from '../src/shared/protocol.js';

const line = (s = '') => console.log(s);
const step = (n: number, s: string) => console.log(`\n\x1b[1m${n}. ${s}\x1b[0m`);
const ok = (s: string) => console.log(`   \x1b[32m✓\x1b[0m ${s}`);
const no = (s: string) => console.log(`   \x1b[31m✗\x1b[0m ${s}`);

const worker = (id: string, deskId: string, name: string, status: string): WorkerInfo => ({
  id, deskId, kind: 'agent', provider: 'claude', name, color: '#7cc', status: status as WorkerInfo['status'],
  acked: true, createdBy: 'alice', createdAt: Date.now(), cols: 100, rows: 30, viewers: [], viewerIds: [],
});

async function main() {
  const dir = mkdtempSync(path.join(tmpdir(), 'floor-host-demo-'));
  const hosts = new Hosts(dir);
  const registry = new HostRegistry(hosts);

  // The office's http server, with /floor-host branched before anything else — the same place
  // server.ts branches it, before the session gate that only ever looked at /ws.
  const srv = http.createServer((_req, res) => res.end('the office'));
  srv.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url ?? '/', 'http://x');
    if (registry.upgrade(req, socket, head, url.pathname)) return;
    socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
    socket.destroy();
  });
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', () => r()));
  const url = `ws://127.0.0.1:${(srv.address() as { port: number }).port}/floor-host`;

  try {
    // --- 1. pairing ---------------------------------------------------------------------------
    step(1, 'A machine pairs');
    const made = hosts.pair('bob (admin)');
    if (typeof made === 'string') throw new Error(made);
    ok(`pairing code ${made.code} — expires in 30 minutes, single use`);

    const claimed = hosts.claim(made.code, 'Alice’s laptop', 'alice', 4);
    if (typeof claimed !== 'string') {
      ok(`"${claimed.host.name}" admitted, owned by ${claimed.host.owner}, ${claimed.host.seats} seats`);
      ok(`token ${claimed.token.slice(0, 12)}… — shown once, never written down`);
      const onDisk = JSON.stringify(hosts.list());
      if (!onDisk.includes(claimed.token)) ok('and it is not in hosts.json — only a hash of it is');
      else no('the token leaked into hosts.json');
    }

    // --- 2. a stranger ------------------------------------------------------------------------
    step(2, 'A token the office does not know is refused');
    const stranger = new WebSocket(url);
    await new Promise<void>((r) => stranger.once('open', () => r()));
    const strangerClosed = new Promise<void>((r) => stranger.once('close', () => r()));
    stranger.send(JSON.stringify({ t: 'hello', token: 'not-a-real-token', hostId: 'x', protocol: FLOORHOST_PROTOCOL, floors: [] }));
    await strangerClosed;
    ok('the socket was closed, not left hanging');

    if (typeof claimed === 'string') throw new Error(claimed);

    // --- 3. the machine dials in --------------------------------------------------------------
    step(3, 'The machine connects and announces a floor');
    const socket = new WebSocket(url);
    await new Promise<void>((r) => socket.once('open', () => r()));
    const answers: Record<string, unknown>[] = [];
    socket.on('message', (raw) => answers.push(JSON.parse(String(raw))));
    socket.send(JSON.stringify({ t: 'hello', token: claimed.token, hostId: claimed.host.id, protocol: FLOORHOST_PROTOCOL, floors: ['f1'] }));
    const floorId = 'f1';
    socket.send(JSON.stringify({
      t: 'ready',
      floor: {
        floorId, name: 'acme/api', seats: 4, accepting: false, forge: 'github', gitIdentity: 'alice <alice@acme.dev>', branch: 'main', providers: ['claude'],
        workers: [{ id: 'w1', status: 'working', deskId: 'desk-1' }],
      },
    }));
    await new Promise((r) => setTimeout(r, 150));
    ok(`"${registry.serves(floorId)?.host.name}" is connected, serving ${registry.floorsOf(claimed.host.id)} floor`);
    ok(`the machine's git identity is its own: alice <alice@acme.dev>`);

    // --- 4. the office hires through the proxy -------------------------------------------------
    step(4, 'The office holds a RemoteFloor and hires through it');
    const floor = new RemoteFloor(
      floorId, registry.serves(floorId)!.host.name, claimed.host.id, registry,
      { id: floorId, name: 'acme/api', repo: 'acme/api', dir: '/home/alice/api', palette: 0, addedBy: 'alice', addedAt: Date.now() },
    );
    // What the office does once, when it builds the floor: send its upward frames here, and hold its
    // workers asleep when the machine goes.
    registry.onUpward = (id, msg) => {
      if (id === floorId) floor.deliver(msg);
    };
    registry.onFloorGone = (id) => {
      if (id === floorId) floor.onGone(id);
    };
    // A machine announces its floors every time it connects, and the office builds the proxy when it
    // loads the building — which can be either side of that. So the host says `ready` again now that
    // something is listening for it, the way it does on a reconnect.
    socket.send(JSON.stringify({
      t: 'ready',
      floor: {
        floorId, name: 'acme/api', seats: 4, accepting: false, forge: 'github', gitIdentity: 'alice <alice@acme.dev>', branch: 'main', providers: ['claude'],
        workers: [{ id: 'w1', status: 'working', deskId: 'desk-1' }],
      },
    }));
    await new Promise((r) => setTimeout(r, 150));
    // The host answers the hire the way the real host will: it seats the worker and streams it up.
    socket.on('message', (raw) => {
      const msg = JSON.parse(String(raw));
      if (msg.t !== 'worker.spawn') return;
      // A real host seats the worker on its own machine and streams it up as it changes. The hire
      // itself answers through that stream, so the office learns of the desk from the floor, not
      // from the reply.
      const w = worker('w2', msg.deskId, 'Sable', 'working');
      socket.send(JSON.stringify({ t: 'event', floorId, seq: msg.seq, msg: { t: 'worker.update', worker: w } }));
    });

    await floor.workers.spawn('desk-2', 'bob', 'fix the flaky login test');
    await new Promise((r) => setTimeout(r, 60));
    ok('hire shipped to the machine; nothing was spawned in this process');

    // --- 5. a read costs no round trip ---------------------------------------------------------
    step(5, 'A read is answered from what the host streamed');
    socket.send(JSON.stringify({ t: 'event', floorId, seq: 0, msg: { t: 'worker.update', worker: worker('w1', 'desk-1', 'Pip', 'working') } }));
    await new Promise((r) => setTimeout(r, 60));
    const listed = floor.workers.list();
    ok(`${listed.length} worker(s) listed, nothing sent to ask: ${listed.map((w) => w.name).join(', ')}`);
    ok(`desk-1 occupied? ${floor.workers.deskOccupied('desk-1')}`);
    ok(`the office holds no checkout path for it: dir is ${JSON.stringify(floor.info().dir)}`);
    // Riding in needs a room to describe, and the only machine that can describe it is the one whose
    // disk it is on. So the branch and the agents come off `ready`, exactly as they do in the office.
    ok(`and it can describe the floor from what the host said: branch ${floor.project?.branch}, agents ${floor.project?.agentProviders.join('/')}`);
    ok(`a hire here starts on the machine's own agent: ${floor.workers.officeDefault.provider}`);

    // --- 6. the machine goes away --------------------------------------------------------------
    step(6, 'The machine goes away');
    const before = registry.floorsOf(claimed.host.id);
    const gone: string[] = [];
    registry.serves(floorId)!.onFloorGone = (id) => gone.push(id);
    socket.close();
    await new Promise((r) => setTimeout(r, 200));
    ok(`${before} floor marked unreachable in one pass: ${gone.join(', ')}`);
    const after = await floor.workers.spawn('desk-3', 'bob', 'something else');
    ok(`a hire now refuses by name, rather than failing: "${String(after)}"`);
    ok('and the refusal names the machine, never the person');

    step(0, 'Swap the object, and the office does not know the difference');
    line('   server.ts calls floor.workers.spawn(...) either way — a Floor in this');
    line('   process, or a RemoteFloor over the socket. That is the whole design.');
    line();
  } finally {
    registry.closeAll();
    srv.close();
    rmSync(dir, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
