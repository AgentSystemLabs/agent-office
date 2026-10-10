import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { checkoutState, prepareCheckout, readyCheckout } from '../src/server/workers/checkout-safety.js';

const git = (dir: string, ...args: string[]) => execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
function repos(t: test.TestContext) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'ao-checkout-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  git(dir, 'init', '--bare', 'remote'); git(dir, 'clone', path.join(dir, 'remote'), 'writer');
  const writer = path.join(dir, 'writer');
  git(writer, 'config', 'user.name', 'Test'); git(writer, 'config', 'user.email', 'test@example.invalid');
  git(writer, 'checkout', '-b', 'main'); writeFileSync(path.join(writer, 'file'), 'first'); git(writer, 'add', '.'); git(writer, 'commit', '-m', 'first'); git(writer, 'push', '-u', 'origin', 'main');
  git(dir, 'clone', '-b', 'main', path.join(dir, 'remote'), 'office');
  const office = path.join(dir, 'office');
  writeFileSync(path.join(writer, 'file'), 'new'); git(writer, 'commit', '-am', 'second'); git(writer, 'push');
  return { dir, office, writer };
}

test('a clean, unused shared checkout fetches and fast-forwards to merged work', async t => {
  const { office, writer } = repos(t);
  assert.equal(await prepareCheckout(office, () => false), undefined);
  assert.equal(git(office, 'rev-parse', 'HEAD'), git(writer, 'rev-parse', 'HEAD'));
  assert.equal(readyCheckout(office, () => false), undefined);
});

test('dirty and active shared copies remain untouched and cannot silently accept new work', async t => {
  const { office } = repos(t); const head = git(office, 'rev-parse', 'HEAD');
  writeFileSync(path.join(office, 'file'), 'human changes'); writeFileSync(path.join(office, 'untracked'), 'keep me');
  assert.match((await prepareCheckout(office, () => false))!, /1 commits behind.*uncommitted changes/);
  assert.equal(git(office, 'rev-parse', 'HEAD'), head); assert.equal(readFileSync(path.join(office, 'file'), 'utf8'), 'human changes');
  assert.equal(readFileSync(path.join(office, 'untracked'), 'utf8'), 'keep me');
  assert.match(readyCheckout(office, () => false)!, /No new task was started/);
  // A second clean copy must also be left alone while another worker has it open.
  git(office, 'checkout', '--', 'file'); rmSync(path.join(office, 'untracked'));
  assert.match((await prepareCheckout(office, () => true))!, /1 commits behind/);
  assert.equal(git(office, 'rev-parse', 'HEAD'), head);
});

test('divergence, detached HEAD and network failures block instead of resetting local work', async t => {
  const { office, dir } = repos(t);
  git(office, 'config', 'user.name', 'Test'); git(office, 'config', 'user.email', 'test@example.invalid');
  writeFileSync(path.join(office, 'local'), 'local'); git(office, 'add', '.'); git(office, 'commit', '-m', 'local');
  const head = git(office, 'rev-parse', 'HEAD');
  assert.match((await prepareCheckout(office, () => false))!, /has 1 local commits/);
  assert.equal(git(office, 'rev-parse', 'HEAD'), head);
  git(office, 'checkout', '--detach'); assert.ok(checkoutState(office).error);
  git(office, 'checkout', 'main'); git(office, 'remote', 'set-url', 'origin', path.join(dir, 'missing'));
  assert.match((await prepareCheckout(office, () => false))!, /Could not fetch/);
  assert.equal(git(office, 'rev-parse', 'HEAD'), head);
});

test('a non-Git project needs no remote and concurrent startup checks share one fetch', async t => {
  const { dir, office } = repos(t);
  assert.equal(await prepareCheckout(dir, () => false), undefined);
  const first = prepareCheckout(office, () => false), second = prepareCheckout(office, () => false);
  assert.equal(first, second); assert.equal(await first, undefined);
});
