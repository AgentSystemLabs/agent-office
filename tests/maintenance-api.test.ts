import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import type { AddressInfo } from 'node:net';
import { startServer } from '../src/server/server.js';
import { Services } from '../src/server/services.js';
import { WebSocket } from 'ws';
import type { WorkerInfo } from '../src/shared/protocol.js';
import { loadConfig } from '../src/server/config.js';

// A private disposable office with fake gh. It never starts an agent or touches the installed office.
test('maintenance APIs authenticate screenshots, create fork issues and retain queued evidence without starting work', async t => {
  // Service discovery is outside this test and would probe other parallel HTTP test fixtures.
  t.mock.method(Services.prototype, 'start', () => {});
  const root = mkdtempSync(path.join(tmpdir(), 'maintenance-api-'));
  const source = path.join(root, 'source'); mkdirSync(source);
  execFileSync('git', ['init', '-q', source]);
  execFileSync('git', ['remote', 'add', 'origin', 'https://github.com/fork/agent-office.git'], { cwd: source });
  writeFileSync(path.join(source, 'package.json'), '{"name":"agent-office"}');
  execFileSync('git', ['add', 'package.json'], { cwd: source });
  execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-qm', 'Initial source'], { cwd: source });
  mkdirSync(path.join(source, 'node_modules'));
  const cli = path.join(root, 'gh');
  writeFileSync(cli, `#!${process.execPath}
const fs = require('node:fs');
const a = process.argv.slice(2);
if (a[0] === 'repo') console.log(JSON.stringify({ nameWithOwner: 'fork/agent-office' }));
else if (a[0] === 'issue' && a[1] === 'create') {
 const title = a[a.indexOf('--title') + 1];
 fs.writeFileSync(${JSON.stringify(path.join(root, 'created.json'))}, JSON.stringify({ title, args: a }));
 console.log('https://github.com/fork/agent-office/issues/7');
} else if (a[0] === 'issue' && a[1] === 'view') console.log(JSON.stringify({ number: 7, state: 'OPEN', body: 'A captured idea', comments: [] }));
else if(a[0] === 'issue' && a[1] === 'list' && a.includes('open') && fs.existsSync(${JSON.stringify(path.join(root, 'created.json'))})) console.log(JSON.stringify([{number:7,title:'Capture this idea',state:'OPEN',url:'https://github.com/fork/agent-office/issues/7',labels:[],assignees:[]} ]));
else console.log('[]');
`); chmodSync(cli, 0o755);
  const before = { PATH: process.env.PATH, AGENT_OFFICE_SOURCE: process.env.AGENT_OFFICE_SOURCE };
  process.env.PATH = `${root}${path.delimiter}${before.PATH}`; process.env.AGENT_OFFICE_SOURCE = source;
  let office: Awaited<ReturnType<typeof startServer>> | undefined;
  t.after(async () => {
    if (office) { office.shutdown(); await new Promise(resolve => setTimeout(resolve, 100)); }
    for (const [key, value] of Object.entries(before)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
    rmSync(root, { recursive: true, force: true });
  });
  const cfg = loadConfig(['--home', path.join(root, 'office'), '--projects', path.join(root, 'projects'), '--password', 'test-only', '--no-open', '--weather', 'clear']);
  cfg.project = source;
  cfg.port = 0; cfg.city = undefined; cfg.tailnet = undefined; cfg.publicHost = undefined; cfg.webhook = undefined;
  office = await startServer(cfg);
  const base = `http://127.0.0.1:${(office.server.address() as AddressInfo).port}`;
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aIl8AAAAASUVORK5CYII=', 'base64');
  assert.equal((await fetch(`${base}/api/maintenance/image`, { method: 'POST', body: png })).status, 401);
  const login = await fetch(`${base}/api/link`, { method: 'POST', headers: { origin: base, 'content-type': 'application/json' }, body: JSON.stringify({ key: office.signInLink().split('key=')[1] }) });
  assert.equal(login.status, 200);
  const cookie = login.headers.get('set-cookie')!.split(';')[0];
  const headers = { cookie, origin: base, 'content-type': 'application/json' };
  assert.equal((await fetch(`${base}/api/maintenance/image`, { method: 'POST', headers: { ...headers, origin: 'https://evil.example', 'content-type': 'image/png' }, body: png })).status, 403);
  const upload = await fetch(`${base}/api/maintenance/image?name=screen.png`, { method: 'POST', headers: { ...headers, 'content-type': 'image/png' }, body: png });
  assert.equal(upload.status, 200); const image = await upload.json();
  assert.equal((await fetch(`${base}/api/maintenance/image?id=${image.id}`)).status, 401);
  const preview = await fetch(`${base}/api/maintenance/image?id=${image.id}`, { headers: { cookie } });
  assert.equal(preview.headers.get('content-type'), 'image/png');
  assert.deepEqual(Buffer.from(await preview.arrayBuffer()), png);
  assert.equal((await fetch(`${base}/api/maintenance/image?id=../../etc/passwd`, { headers: { cookie } })).status, 400);
  const created = await fetch(`${base}/api/maintenance/issue`, { method: 'POST', headers, body: JSON.stringify({ title: 'Capture this idea', body: 'While Maintenance works', queue: true, attachments: [image.id] }) });
  assert.equal(created.status, 200, JSON.stringify(await created.clone().json()));
  assert.equal((await created.json()).number, 7);
  const sent = JSON.parse(readFileSync(path.join(root, 'created.json'), 'utf8'));
  assert.ok(sent.args.includes('fork/agent-office'));
  const work = await (await fetch(`${base}/api/maintenance/chat`, { headers: { cookie } })).json();
  assert.equal(work.worker, undefined);
  assert.equal(work.work[0].status, 'queued'); assert.equal(work.work[0].number, 7);
  assert.deepEqual(work.work[0].attachments, [image]);
  assert.equal(work.conversations.length, 0, 'Capturing an idea must not create an agent conversation');
  // Verify websocket issue dispatch and screenshot delivery without launching a real provider CLI.
  const floor = office.floors()[0];
  let live: WorkerInfo | undefined;
  const starts: { prompt: string; options: unknown }[] = [];
  const list = floor.workers.list.bind(floor.workers), get = floor.workers.get.bind(floor.workers);
  const station = floor.workers.station.bind(floor.workers);
  floor.workers.list = () => live ? [live] : [];
  floor.workers.get = id => live?.id === id ? live : undefined;
  floor.workers.station = (_desk, _by, prompt, _owner, options) => {
    starts.push({ prompt, options });
    live = { id: 'stub-maintenance', deskId: 'station-maintenance', name: 'Maintenance', kind: 'agent', provider: 'codex', status: 'working', createdAt: Date.now(), cols: 80, rows: 24, viewers: [], viewerIds: [], acked: false, createdBy: 'Test' };
    return { info: live, hired: true };
  };
  t.after(() => { floor.workers.list = list; floor.workers.get = get; floor.workers.station = station; });
  const ws = new WebSocket(base.replace('http:', 'ws:') + '/ws', { headers: { cookie, origin: base } });
  const messages: any[] = [];
  ws.on('message', raw => messages.push(JSON.parse(raw.toString())));
  await new Promise<void>((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
  t.after(() => ws.close());
  const wait = async (id: string) => {
    for (let i = 0; i < 300; i++) { const receipt = messages.find(m => m.t === 'maintenance.chat.sent' && m.id === id); if (receipt) return receipt; await new Promise(resolve => setTimeout(resolve, 10)); }
    throw new Error('No Maintenance acknowledgement');
  };
  // Refresh GitHub after creation before requesting its full issue body.
  ws.send(JSON.stringify({ t: 'maintenance.issues' }));
  for (let i = 0; i < 100 && !messages.some(m => m.t === 'maintenance.issues' && m.state.items.length); i++) await new Promise(resolve => setTimeout(resolve, 10));
  ws.send(JSON.stringify({ t: 'maintenance.chat.send', id: 'start-one', prompt: '', maintenanceIssue: 7, newConversation: true }));
  const receipt = await wait('start-one');
  assert.equal(receipt.error, undefined); assert.equal(receipt.workerId, 'stub-maintenance');
  assert.equal(starts.length, 1); assert.match(starts[0].prompt, /Implement Agent Office issue #7/);
  assert.match(starts[0].prompt, /\[Maintenance images\]/);
  assert.ok(starts[0].prompt.includes(image.id), 'Queued screenshot was not delivered to the agent');
  assert.equal((starts[0].options as any).newConversation, true);
  ws.send(JSON.stringify({ t: 'maintenance.chat.send', id: 'busy-start', prompt: '', maintenanceIssue: 7, newConversation: true }));
  assert.match((await wait('busy-start')).error, /busy/); assert.equal(starts.length, 1);
  const running = await (await fetch(`${base}/api/maintenance/chat`, { headers: { cookie } })).json();
  assert.equal(running.work[0].status, 'running'); assert.equal(running.work[0].workerId, receipt.workerId);
  assert.deepEqual(running.conversation.messages[0].attachments, [image]);
  live!.status = 'done';
  const review = await (await fetch(`${base}/api/maintenance/chat`, { headers: { cookie } })).json();
  assert.equal(review.work[0].status, 'review');
  ws.close();
  const removed = await fetch(`${base}/api/maintenance/queue`, { method: 'POST', headers, body: JSON.stringify({ number: 7, remove: true }) });
  assert.equal(removed.status, 200);
  assert.equal((await (await fetch(`${base}/api/maintenance/chat`, { headers: { cookie } })).json()).work.length, 0);
});
