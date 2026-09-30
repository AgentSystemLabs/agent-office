// End to end, three real processes: the office, a floor-host CLI dialing it from "another machine",
// and a browser client that rides the elevator up to the floor that lives on that machine.
//
// Run: npx tsx scripts/e2e-floor-ride.mjs
//
// This exists because the ride was the one thing nobody had run. `scripts/e2e-floor-host.mjs` wires
// the registry and a `RemoteFloor` by hand, which proves the loop but not the office: the bug this
// was written for was `floor.go` looking the floor up in the local `floors` map, finding nothing, and
// refusing with "No such floor" — in code no miniature wiring could ever reach. So this starts the
// real `cli.ts`, signs in over the real HTTP API, opens the real `/ws`, and sends the real message.
//
// It also follows the real order of operations, which is the other half of why this was hard to do by
// hand: a machine's id does not exist until it claims a pairing code, and the floor that names it is
// only in `floors.json` once it does. So: pair, then write the building, then restart.
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, statSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { WebSocket } from 'ws';
import { Hosts } from '../src/server/hosts.ts';

const PASSWORD = 'test1234';
const MACHINE = "Sam's laptop";
const FLOOR = 'sam-demo';
const problems = [];
const check = (what, passed, detail = '') => {
  if (!passed) problems.push(what);
  console.log(`   ${passed ? '\x1b[32myes\x1b[0m' : '\x1b[31mNO \x1b[0m'}  ${what}${detail ? `  \x1b[2m${detail}\x1b[0m` : ''}`);
};

const dir = mkdtempSync(path.join(tmpdir(), 'e2e-ride-'));
const home = path.join(dir, 'office');
const dataDir = path.join(home, '.agent-office');
const hostCfg = path.join(dir, 'host.json');
const checkout = path.join(dir, 'api');
const homeCheckout = path.join(dir, 'home-repo');
mkdirSync(dataDir, { recursive: true });
mkdirSync(checkout, { recursive: true });
mkdirSync(homeCheckout, { recursive: true });
writeFileSync(path.join(dataDir, 'config.json'), '{}');
// The checkout the floor runs on, on the machine pretending to be somebody else's. It only has to be
// a git repo: the host opens it as a floor, and the office must never look inside it.
for (const repo of [checkout, homeCheckout]) {
  execFileSync('git', ['init', '-q', '-b', 'main', repo]);
  execFileSync('git', ['-C', repo, 'commit', '-q', '--allow-empty', '-m', 'init']);
}

const cwd = process.cwd();

// The office refuses to start without a client bundle, and building one takes a vite run this script
// has no use for: it never loads a page, it speaks `/ws`. So it puts a stub in the gitignored `dist`
// when there is no real bundle, and says so. Anything that does load a page still gets the real one.
let stub = false;
if (!existsSync(path.join(cwd, 'dist/public/index.html')) && !existsSync(path.join(cwd, 'public/index.html'))) {
  mkdirSync(path.join(cwd, 'dist/public'), { recursive: true });
  writeFileSync(path.join(cwd, 'dist/public/index.html'), '<!doctype html><title>agent-office (e2e stub)</title>');
  stub = true;
  console.log('note: no client bundle here, so a stub went into dist/public — this script only uses /ws');
}
// And take it away again, or the next `npm run build` would leave a stub looking like a client.
const dropStub = () => {
  if (stub) rmSync(path.join(cwd, 'dist/public/index.html'), { force: true });
};
process.on('exit', dropStub);

const quiet = { stdio: ['ignore', 'pipe', 'pipe'] };
const said = new Map();
const spawnNode = (args, label) => {
  const child = spawn(process.execPath, ['--import', 'tsx', ...args], { cwd, env: { ...process.env, AGENT_OFFICE_NO_OPEN: '1' }, ...quiet });
  said.set(label, '');
  const say = (d) => {
    said.set(label, (said.get(label) ?? '') + d);
    if (process.env.E2E_VERBOSE) process.stdout.write(`      \x1b[2m${label}> ${d}\x1b[0m`);
  };
  child.stdout.on('data', say);
  child.stderr.on('data', say);
  return child;
};
const settle = (ms = 800) => new Promise((r) => setTimeout(r, ms));
const port = 4700 + Math.floor(Math.random() * 200);
const officeUrl = `http://127.0.0.1:${port}`;

async function startOffice() {
  const child = spawnNode(['src/server/cli.ts', '--home', home, '--port', String(port), '--password', PASSWORD], 'office');
  // `redirect: 'manual'` on purpose: `/` answers 302 to the sign-in page, and following it would make
  // a perfectly healthy office look like a failed connection. Starting from source under tsx is also
  // slow to boot, hence the generous budget.
  for (let i = 0; i < 300; i++) {
    try {
      await fetch(`${officeUrl}/`, { redirect: 'manual' });
      return child;
    } catch {
      await settle(200);
    }
  }
  throw new Error('the office never came up');
}

let office = await startOffice();

// --- 1. a machine claims a pairing code, which is what gives it an id ------------------------------
const hosts = new Hosts(dataDir);
const made = hosts.pair('nightshade');
if (typeof made === 'string') throw new Error(made);
console.log(`\n1. the office made a pairing code: ${made.code}`);

const pairing = spawnNode(
  ['src/server/cli.ts', 'floor-host', '--office', officeUrl, '--name', MACHINE, '--code', made.code, '--config', hostCfg],
  'host',
);
// Wait for the claim rather than guessing at a sleep: the office writes the host record, the host
// writes its token, and the two are what every check below reads.
for (let i = 0; i < 450 && !existsSync(hostCfg); i++) await settle(200);
if (!existsSync(hostCfg)) {
  console.log(`\n   the machine never paired. It said:\n${said.get('host')}\n`);
  process.exitCode = 1;
  throw new Error('the machine never paired');
}
pairing.kill('SIGTERM');
await settle(300);

const claimed = new Hosts(dataDir).list().find((h) => h.name === MACHINE);
const mode = statSync(hostCfg).mode & 0o777;
check('the machine paired and has an id', !!claimed, claimed?.id?.slice(0, 8) ?? said.get('host'));
check('its token is on its own disk, owner-only', mode === 0o600, `mode ${mode.toString(8)}`);
check('the office holds a hash, never the token', !readFileSync(path.join(dataDir, 'hosts.json'), 'utf8').includes(JSON.parse(readFileSync(hostCfg, 'utf8')).token));

// --- 2. the building points a floor at that machine, and the office is restarted to read it ---------
writeFileSync(
  path.join(dataDir, 'floors.json'),
  JSON.stringify(
    [
      // A floor on this office's own disk, so the browser has somewhere to be before it rides.
      { id: 'home-repo', name: 'home/repo', repo: 'home/repo', dir: homeCheckout, palette: 0, addedBy: 'nightshade', addedAt: Date.now() },
      { id: FLOOR, name: 'sam/demo', repo: 'sam/demo', dir: checkout, palette: 3, addedBy: 'nightshade', addedAt: Date.now(), host: claimed.id },
    ],
    null,
    2,
  ),
);
console.log(`\n2. the building has one floor here and one on ${claimed.id.slice(0, 8)}`);
office.kill('SIGTERM');
await settle(600);
office = await startOffice();

const floorHost = spawnNode(['src/server/cli.ts', 'floor-host', '--office', officeUrl, '--config', hostCfg], 'host');
await settle(3500);

// --- 3. a browser signs in, and rides the elevator up to it ----------------------------------------
const login = await fetch(`${officeUrl}/api/login`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ password: PASSWORD }),
});
const setCookies = login.headers.getSetCookie?.() ?? [login.headers.get('set-cookie')];
const cookie = setCookies.filter(Boolean).map((c) => c.split(';')[0]).join('; ');
check('a browser can sign in', login.ok && !!cookie, `HTTP ${login.status}`);

const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, { headers: { cookie, origin: officeUrl } });
const inbox = [];
await new Promise((res, rej) => {
  ws.once('open', res);
  ws.once('error', rej);
});
ws.on('message', (d) => inbox.push(JSON.parse(d.toString())));
await settle(1200);
console.log(`\n3. riding the elevator to a floor on someone else's machine`);

const panel = () => inbox.filter((m) => m.t === 'floors').pop()?.floors ?? inbox.find((m) => m.floors)?.floors ?? [];
const row = panel().find((f) => f.id === FLOOR);
check('the elevator lists it', !!row, row ? `🖥 ${row.host?.name}${row.host?.reachable ? '' : ' · offline'}` : '');
check('it says whose machine, and whether it is answering', row?.host?.name === MACHINE && row.host?.reachable === true, `reachable=${row?.host?.reachable}`);
check('it never leaks the host checkout path', row?.dir === '', `dir="${row?.dir}"`);

// Where we are before the ride. The floor you land on arrives in the `welcome`, not as a
// `floor.enter`: walking in is not a ride.
const enteredFrom = inbox.find((m) => m.t === 'welcome')?.floor;
check('the browser walks in onto the office\'s own floor, not the hosted one', enteredFrom === 'home-repo', `floor=${enteredFrom}`);

// This is the bug: `floor.go` looked in the local `floors` map, found nothing, and answered
// "No such floor" — so the client never left the floor it was already on.
const before = inbox.length;
ws.send(JSON.stringify({ t: 'floor.go', floor: FLOOR }));
await settle(1500);
const entered = inbox.slice(before).find((m) => m.t === 'floor.enter');
check('you can ride to it', !!entered, entered ? `floor=${entered.floor}` : '\x1b[2mno floor.enter came back\x1b[0m');
check('and you arrive on that floor', entered?.floor === FLOOR, `floor=${entered?.floor}`);
check('it is a whole room, not a placeholder', !!entered && entered.workers !== undefined && entered.plan !== undefined && entered.decor !== undefined, `workers=${entered?.workers?.length} wing=${entered?.plan?.wing} decor=${entered?.decor?.length}`);
check('the host\'s own states came with it', !!entered && Array.isArray(entered.cars) && entered.meeting !== undefined, `cars=${entered?.cars?.length}`);
check('the three host-local features are absent, not faked', entered?.dog === null && entered?.whiteboard?.elements?.length === 0, `dog=${entered?.dog} whiteboard=${entered?.whiteboard?.elements?.length}`);
check('and no checkout path came with it either', entered?.project?.dir === '', `project.dir="${entered?.project?.dir}"`);
// The branch and the agents are facts only the far machine has, and they arrive in its `ready`. If
// they are missing, the room came up without knowing what it is or what it can hire.
check('it names the branch its checkout is on', entered?.project?.branch === 'main', `branch=${entered?.project?.branch}`);
check('and the agents that machine has', Array.isArray(entered?.project?.agentProviders) && entered.project.agentProviders.length > 0, `providers=${entered?.project?.agentProviders}`);
check('the refusal names the machine if you ask', (await new Promise((res) => {
  ws.send(JSON.stringify({ t: 'dog.pet' }));
  const mark = inbox.length;
  setTimeout(() => res(inbox.slice(mark).map((m) => m.text).join(' ')), 900);
})).includes(MACHINE), '');

// --- 4. the machine shuts its laptop ---------------------------------------------------------------
floorHost.kill('SIGTERM');
await settle(2000);
const after = panel().find((f) => f.id === FLOOR);
console.log(`\n4. the machine went away`);
check('the floor is still on the panel', !!after, after ? `🖥 ${after.host?.name} · ${after.host?.reachable ? 'connected' : 'offline'}` : '');
check('marked offline rather than removed', after?.host?.reachable === false, `reachable=${after?.host?.reachable}`);

ws.close();
office.kill('SIGTERM');
dropStub();
rmSync(dir, { recursive: true, force: true });

console.log(`\n${problems.length ? `\x1b[31m${problems.length} problem(s): ${problems.join('; ')}\x1b[0m` : '\x1b[32mall good\x1b[0m'}\n`);
process.exit(problems.length ? 1 : 0);
