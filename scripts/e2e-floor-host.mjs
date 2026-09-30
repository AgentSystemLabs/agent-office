// End to end, two real processes: an office with a /floor-host socket, and the floor-host CLI
// dialing in from "another machine". Run: npx tsx scripts/e2e-floor-host.mjs
import http from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Hosts } from '../src/server/hosts.ts';
import { HostRegistry } from '../src/server/floor-hosts.ts';

const dir = mkdtempSync(path.join(tmpdir(), 'e2e-'));
const dataDir = path.join(dir, '.agent-office');
mkdirSync(dataDir, { recursive: true });
writeFileSync(path.join(dataDir, 'config.json'), '{}');
const checkout = path.join(dir, 'api');
mkdirSync(checkout, { recursive: true });

const hosts = new Hosts(dataDir);
const registry = new HostRegistry(hosts);
registry.floorsFor = () => [{ id: 'f1', dir: checkout, name: 'acme/api' }];
// What the office does when it builds the floor: route this floor's frames to its RemoteFloor.
const upward = [];
// The office's own wiring, in miniature: the proxy is created first, and the registry hands it every
// frame a floor sends up. Getting this wrong is what the demo found once already — an answer nobody
// routes is an answer the caller never hears.
let remote;
registry.onUpward = (floorId, msg) => {
  upward.push({ floorId, t: msg.t });
  if (remote) remote.deliver(msg);
};
registry.onFloorGone = () => {};

const srv = http.createServer((_q, r) => r.end('office'));
srv.on('upgrade', (q, s, h) => {
  const p = new URL(q.url ?? '/', 'http://x').pathname;
  if (!registry.upgrade(q, s, h, p)) { s.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n'); s.destroy(); }
});
await new Promise((r) => srv.listen(0, '127.0.0.1', () => r()));
const port = srv.address().port;

function dial(args) {
  const child = spawn(process.execPath, ['--import', 'tsx', 'src/server/cli.ts', 'floor-host', ...args], { cwd: process.cwd(), env: { ...process.env, AGENT_OFFICE_HOST_DEBUG: '1' } });
  child.stdout.on('data', (d) => process.stdout.write('   host> ' + d));
  child.stderr.on('data', (d) => process.stdout.write('   host! ' + d));
  return child;
}

// --- first pairing: a code, and a token minted for the machine ------------------------------------
const made = hosts.pair('bob');
console.log(`1. office made a pairing code: ${made.code}\n`);
const cfg = path.join(dir, 'host.json');
let child = dial(['--office', `ws://127.0.0.1:${port}`, '--code', made.code, '--name', "Alice's laptop", '--seats', '4', '--config', cfg]);
await new Promise((r) => setTimeout(r, 12000));

const host = hosts.list()[0];
console.log(`\n2. while connected`);
// The office's own view of the floor: a RemoteFloor, asked the way a browser's call would be.
const { RemoteFloor } = await import('../src/server/remote-floor.js');
remote = new RemoteFloor('f1', host.name, host.id, registry, { id: 'f1', name: 'acme/api', dir: checkout, palette: 0, addedBy: 'bob', addedAt: 1 }, 'main', ['claude']);
const listed = remote.workers.list();
console.log(`   the office's view:       ${listed.length} worker(s) known, ${remote.info().workers} on the roster (host's, streamed up)`);
// A call that reaches the host's real Floor: a queued task. Nothing is spawned, so it does not need
// an agent installed, but it does cross the socket, run on the other machine, and come back.
const added = await remote.queue.add('write the migration for #212', 'bob');
await new Promise((r) => setTimeout(r, 400));
const queued = remote.queue.state();
console.log(`   a task added over it:    ${added ? `refused: ${added}` : `${queued.tasks.length} task(s) on the host's queue`}`);
if (queued.tasks[0]) console.log(`   and it really is there:  "${String(queued.tasks[0].prompt).slice(0, 40)}"`);
console.log(`   the office knows:        ${host.name} (${host.id.slice(0, 8)}), ${host.seats} seats`);
console.log(`   floors it is serving:    ${registry.floorsOf(host.id)}`);
console.log(`   the elevator would show: host="${registry.serves('f1').host.name}", dir="${''}" (no checkout path leaked)`);
console.log(`   token kept on the host:  ${existsSync(cfg) ? 'yes' : 'NO'}`);
const mode = existsSync(cfg) ? (statSync(cfg).mode & 0o777).toString(8) : 'n/a';
console.log(`   and it is mode ${mode}`);
console.log(`   in the office's hosts.json? ${readFileSync(path.join(dataDir, 'hosts.json'), 'utf8').includes(JSON.parse(readFileSync(cfg, 'utf8')).token) ? 'LEAKED' : 'no, only a hash'}`);

child.kill('SIGINT');
await new Promise((r) => setTimeout(r, 1000));
console.log(`\n3. the machine went away`);
console.log(`   floors reachable now:    ${registry.floorsOf(host.id)} (the office has not forgotten the machine)`);
console.log(`   but it is still listed:  ${hosts.list().length} machine`);

// --- reconnect with the kept token, no code ------------------------------------------------------
console.log(`\n4. the same machine comes back with its token, no code\n`);
child = dial(['--office', `ws://127.0.0.1:${port}`, '--seats', '4', '--config', cfg]);
await new Promise((r) => setTimeout(r, 12000));
console.log(`\n5. reconnected`);
console.log(`   machines known:          ${hosts.list().length} (it did not pair again)`);
console.log(`   floors it is serving:    ${registry.floorsOf(host.id)}`);
child.kill('SIGINT');
await new Promise((r) => setTimeout(r, 800));

registry.closeAll(); srv.close(); rmSync(dir, { recursive: true, force: true });
process.exit(0);
