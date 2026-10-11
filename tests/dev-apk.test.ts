import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import http from 'node:http';
import { configFor } from '../src/server/dev-apk/config.js';
import { start, view } from '../src/server/dev-apk/manager.js';
import { activeJob, atomic, jobDir, projectFor, release, rootFor, saveJob, type Job } from '../src/server/dev-apk/storage.js';
import { publish } from '../src/server/dev-apk/runner.js';
import { byteRange } from '../src/server/dev-apk/download.js';
import { devApkRoute } from '../src/server/http/routes/dev-apk.js';
import { requestHandler } from '../src/server/http/router.js';
const repo = 'owner/game', admin = { account: { id: 'admin', name: 'Admin', role: 'admin' } } as any;
function fixture(t: any) {
  const dir = mkdtempSync(path.join(tmpdir(), 'office-apk-')); t.after(() => rmSync(dir, { recursive: true, force: true }));
  const source = path.join(dir, 'source'); mkdirSync(path.join(source, 'Tools'), { recursive: true });
  for (const file of ['Build-Quest.ps1', 'BuildLock.ps1']) writeFileSync(path.join(source, 'Tools', file), '# test fixture');
  const config = { repo, sourceDir: source, buildDir: path.join(dir, 'build'), ref: 'origin/main', apkName: 'Game-dev.apk', builders: ['builder'] };
  atomic(path.join(dir, 'dev-apk.json'), { projects: [config] });
  return { dir, config, root: rootFor(dir), project: projectFor(repo) };
}
async function ready(f: ReturnType<typeof fixture>, bytes = Buffer.from('PK\x03\x04first apk'), finishedOffset = 0) {
  const job: Job = { id: randomUUID(), project: f.project, config: f.config, pid: process.pid, requestedBy: 'Tester', ref: 'origin/main', startedAt: Date.now(), status: 'publishing' };
  saveJob(f.root, job); const folder = jobDir(f.root, f.project, job.id);
  writeFileSync(path.join(folder, 'app.apk.part'), bytes); writeFileSync(path.join(folder, 'revision.txt'), 'a'.repeat(40));
  await publish(f.root, job); job.finishedAt! += finishedOffset; saveJob(f.root, job); return job;
}
test('builds use local config only, enforce permission and reject duplicate starts', t => {
  const f = fixture(t); const member = { account: { id: 'member', name: 'Tester', role: 'member' } } as any;
  assert.equal(view(f.dir, repo, member).canBuild, false);
  assert.throws(() => start(f.dir, repo, member, () => {}), /freigeschaltete/);
  assert.equal(view(f.dir, repo, { account: { ...member.account, id: 'builder' } }).canBuild, true);
  let launched: Job | undefined;
  const j = start(f.dir, repo, admin, (_, job) => { launched = job; })!;
  assert.equal(launched?.config.ref, 'origin/main'); assert.equal(view(f.dir, repo, admin).busy, true);
  assert.throws(() => start(f.dir, repo, admin, () => {}), /läuft bereits/);
  assert.equal(readFileSync(path.join(f.config.sourceDir, 'Tools/Build-Quest.ps1'), 'utf8'), '# test fixture');
  release(f.root, j.id);
});
test('unsafe config cannot designate a parent of the source checkout as disposable build folder', t => {
  const f = fixture(t);
  atomic(path.join(f.dir, 'dev-apk.json'), { projects: [{ ...f.config, buildDir: f.dir }] });
  assert.throws(() => configFor(f.dir, repo), /nicht enthalten/);
  atomic(path.join(f.dir, 'dev-apk.json'), { projects: [{ ...f.config, ref: 'origin/main; bad' }] });
  assert.throws(() => configFor(f.dir, repo), /Konfiguration prüfen/);
});
test('previous download survives invalid or failed publication, exact artifact gets hash and commit', async t => {
  const f = fixture(t), good = await ready(f);
  const before = view(f.dir, repo, admin).latest!; assert.equal(before.id, good.id); assert.equal(before.sha256?.length, 64);
  await assert.rejects(ready(f, Buffer.from('not an apk')), /keine APK/);
  assert.equal(view(f.dir, repo, admin).latest?.id, good.id);
  assert.equal(view(f.dir, repo, admin).latest?.revision, 'a'.repeat(40));
});
test('orphaned job is interrupted after restart and does not delete last successful APK', async t => {
  const f = fixture(t), good = await ready(f); const j = start(f.dir, repo, admin, () => {})!;
  atomic(path.join(f.root, 'active.json'), { id: j.id, project: f.project, pid: 2147483647 });
  assert.equal(activeJob(f.root), undefined);
  assert.equal(view(f.dir, repo, admin).current?.status, 'interrupted');
  assert.equal(view(f.dir, repo, admin).latest?.id, good.id);
});
test('range parser handles suffixes, open ends, overflow and invalid multi-ranges', () => {
  assert.deepEqual(byteRange('bytes=2-5', 10), { start: 2, end: 5 });
  assert.deepEqual(byteRange('bytes=7-', 10), { start: 7, end: 9 });
  assert.deepEqual(byteRange('bytes=-3', 10), { start: 7, end: 9 });
  assert.deepEqual(byteRange('bytes=-300', 10), { start: 0, end: 9 });
  for (const h of ['bytes=-0', 'bytes=10-', 'bytes=3-2', 'bytes=0-1,5-6', 'bytes=999999999999999999-']) assert.equal(byteRange(h, 10), undefined);
});
test('retention keeps three successful APKs and never deletes the latest', async t => {
  const f = fixture(t); const jobs: Job[] = [];
  for (let i = 0; i < 4; i++) jobs.push(await ready(f, undefined, i * 1000));
  assert.equal(existsSync(path.join(jobDir(f.root, f.project, jobs[0].id), 'app.apk')), false);
  assert.equal(existsSync(path.join(jobDir(f.root, f.project, jobs[3].id), 'app.apk')), true);
});
test('HTTP download requires office login, streams ranges and pins versions while latest changes', async t => {
  const f = fixture(t), first = await ready(f);
  const member = { account: { id: 'member', name: 'Tester', role: 'member' } };
  const ctx = { cfg: { dataDir: f.dir, port: 0, trustProxy: false }, services: { lookup: () => undefined },
    auth: { fromRequest: (req: http.IncomingMessage) => req.headers.cookie === 'signed-in' ? member : undefined },
    floors: new Map([['game', { def: { repo } }]]) } as any;
  const server = http.createServer(requestHandler(ctx, [devApkRoute])); await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const origin = `http://127.0.0.1:${(server.address() as any).port}`, url = origin + '/api/dev-apk/download?floor=game', headers = { cookie: 'signed-in' };
  assert.equal((await fetch(url)).status, 401);
  assert.equal((await fetch(origin + '/api/dev-apk?floor=game', { method: 'POST', headers })).status, 403);
  assert.equal((await fetch(origin + '/api/dev-apk?floor=game', { method: 'POST', headers: { ...headers, origin } })).status, 403);
  const response = await fetch(url, { headers }); assert.equal(response.status, 200); const etag = response.headers.get('etag')!;
  assert.equal(Buffer.from(await response.arrayBuffer()).toString(), 'PK\x03\x04first apk');
  const partial = await fetch(url, { headers: { ...headers, range: 'bytes=4-8', 'if-range': etag } }); assert.equal(partial.status, 206); assert.equal(await partial.text(), 'first');
  assert.equal((await fetch(url, { headers: { ...headers, range: 'bytes=99999-' } })).status, 416);
  const head = await fetch(url, { method: 'HEAD', headers }); assert.equal(head.status, 200); assert.equal(await head.text(), ''); assert.equal(head.headers.get('content-length'), String(first.bytes));
  await ready(f, Buffer.from('PK\x03\x04second apk'));
  const changed = await fetch(url, { headers: { ...headers, range: 'bytes=4-8', 'if-range': etag } }); assert.equal(changed.status, 200); await changed.arrayBuffer();
  const pinned = await fetch(url + '&id=' + first.id, { headers }); assert.equal(await pinned.text(), 'PK\x03\x04first apk');
  assert.equal((await fetch(url + '&id=../../escape', { headers })).status, 404);
  assert.equal((await fetch(origin + '/api/dev-apk?floor=missing', { headers })).status, 404);
});
