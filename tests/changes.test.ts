import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Changes, insideCheckout, type ChangesTarget } from '../src/server/changes.js';
import { changedImageType } from '../src/shared/protocol.js';

/** A git repo with one committed picture, and a Changes that diffs it against HEAD. */
function fixture(t: { after(fn: () => void): void }) {
  const root = mkdtempSync(path.join(tmpdir(), 'office-changes-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const dir = path.join(root, 'repo');
  mkdirSync(path.join(dir, 'assets'), { recursive: true });
  const git = (...args: string[]) => execFileSync('git', args, { cwd: dir, stdio: 'ignore' });
  git('init', '-q', '-b', 'main');
  writeFileSync(path.join(dir, 'assets', 'logo.png'), 'old picture');
  writeFileSync(path.join(dir, 'assets', 'gone.gif'), 'deleted picture');
  writeFileSync(path.join(dir, 'README.md'), '# demo\n');
  git('add', '.');
  git('-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'init');
  const target: ChangesTarget = { name: 'Worker 1', cwd: dir, rel: '' };
  const changes = new Changes(dir, 'main', (id) => (id === 'w1' ? target : undefined), () => undefined, {
    state() {},
    toast() {},
    refreshGitHub() {},
  });
  t.after(() => changes.stop());
  return { root, dir, changes };
}

test('only pictures have a preview type, picked by extension', () => {
  assert.equal(changedImageType('assets/showcase/hero.webp'), 'image/webp');
  assert.equal(changedImageType('a/b/PHOTO.JPG'), 'image/jpeg');
  assert.equal(changedImageType('x.jpeg'), 'image/jpeg');
  assert.equal(changedImageType('icon.svg'), 'image/svg+xml');
  assert.equal(changedImageType('favicon.ico'), 'image/x-icon');
  for (const p of ['README.md', 'archive.zip', 'png', '.png', 'dir.png/file', 'x.constructor', 'x.__proto__', 'x.']) assert.equal(changedImageType(p), undefined, p);
});

test('a file outside the checkout, by .. or by a link, is refused', async (t) => {
  const { root, dir, changes } = fixture(t);
  const outside = path.join(root, 'outside');
  mkdirSync(outside);
  writeFileSync(path.join(outside, 'secret.png'), 'secret');
  assert.equal(await insideCheckout(dir, 'assets/logo.png'), realpathSync(path.join(dir, 'assets', 'logo.png')));
  assert.equal(await insideCheckout(dir, '../outside/secret.png'), undefined);
  assert.equal(await insideCheckout(dir, path.join(outside, 'secret.png')), undefined);
  assert.equal(await insideCheckout(dir, 'missing.png'), undefined);
  // A junction works without admin rights on Windows; elsewhere it's an ordinary symlink.
  symlinkSync(outside, path.join(dir, 'link'), 'junction');
  assert.equal(await insideCheckout(dir, 'link/secret.png'), undefined);
  // Even when the link itself is one of the worker's changes.
  const r = await changes.file('w1', 'link/secret.png', 'new');
  assert.ok('error' in r && r.status === 404);
});

test('the preview serves both sides of a changed picture, and nothing outside the list of changes', async (t) => {
  const { root, dir, changes } = fixture(t);
  writeFileSync(path.join(dir, 'assets', 'logo.png'), 'new picture');
  writeFileSync(path.join(dir, 'assets', 'hero.webp'), 'added picture');
  writeFileSync(path.join(dir, 'notes.txt'), 'not a picture');
  rmSync(path.join(dir, 'assets', 'gone.gif'));

  const text = async (side: 'old' | 'new', p: string) => {
    const r = await changes.file('w1', p, side);
    if ('error' in r) return r;
    return { type: r.type, body: r.body.toString('utf8') };
  };
  assert.deepEqual(await text('old', 'assets/logo.png'), { type: 'image/png', body: 'old picture' });
  assert.deepEqual(await text('new', 'assets/logo.png'), { type: 'image/png', body: 'new picture' });
  assert.deepEqual(await text('new', 'assets/hero.webp'), { type: 'image/webp', body: 'added picture' });
  assert.equal((await text('old', 'assets/hero.webp') as { status: number }).status, 404);
  assert.deepEqual(await text('old', 'assets/gone.gif'), { type: 'image/gif', body: 'deleted picture' });
  assert.equal((await text('new', 'assets/gone.gif') as { status: number }).status, 404);

  // Not a picture, not changed, not in the checkout, no such worker.
  assert.equal((await text('new', 'notes.txt') as { status: number }).status, 415);
  writeFileSync(path.join(root, 'secret.png'), 'secret');
  for (const p of ['README.png', '../secret.png', path.join(root, 'secret.png')]) assert.equal((await text('new', p) as { status: number }).status, 404, p);
  assert.equal(((await changes.file('nobody', 'assets/logo.png', 'new')) as { status: number }).status, 404);
});

test('a renamed picture shows its old name before and its new name after', async (t) => {
  const { dir, changes } = fixture(t);
  execFileSync('git', ['mv', 'assets/logo.png', 'assets/brand.png'], { cwd: dir, stdio: 'ignore' });
  const old = await changes.file('w1', 'assets/brand.png', 'old');
  const now = await changes.file('w1', 'assets/brand.png', 'new');
  assert.ok(!('error' in old) && !('error' in now));
  assert.equal(old.body.toString('utf8'), 'old picture');
  assert.equal(now.body.toString('utf8'), 'old picture');
});
