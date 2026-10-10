import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { runCheckout } from '../src/server/worktree-checkout.js';

test('a slow checkout leaves the event loop responsive', async () => {
  let ticks = 0;
  const timer = setInterval(() => ticks++, 10);
  try {
    await runCheckout(process.execPath, ['-e', 'setTimeout(() => {}, 200)'], process.cwd(), undefined, 5000);
    assert.ok(ticks >= 5, `only ${ticks} event-loop ticks while checkout ran`);
  } finally { clearInterval(timer); }
});

test('checkout timeout reports the timeout, not progress output', async () => {
  await assert.rejects(runCheckout(process.execPath, ['-e', 'process.stderr.write("Updating files: 17%\\r"); setTimeout(() => {}, 30000)'], process.cwd(), undefined, 500), /timed out/);
});

test('cancelled preparation does not start a checkout', async () => {
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(runCheckout('not-a-command', [], process.cwd(), controller.signal), /cancelled/);
});

test('checkout errors retain the fatal cause instead of progress or advice', async () => {
  await assert.rejects(runCheckout(process.execPath, ['-e', 'process.stderr.write("Updating files: 17%\\rfatal: disk full\\nSee help\\n"); process.exit(1)'], process.cwd()), /fatal: disk full/);
});

test('cancelling a running checkout also stops its filter child', async (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), 'office-checkout-child-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const pidFile = path.join(dir, 'child.pid');
  const script = `const child = require('node:child_process').spawn(process.execPath, ['-e', 'setTimeout(() => {}, 30000)'], {stdio:'ignore'}); require('node:fs').writeFileSync(${JSON.stringify(pidFile)}, String(child.pid)); setTimeout(() => {}, 30000);`;
  const controller = new AbortController();
  const running = runCheckout(process.execPath, ['-e', script], dir, controller.signal, 5000);
  for (let i = 0; i < 100 && !existsSync(pidFile); i++) await new Promise((r) => setTimeout(r, 20));
  assert.ok(existsSync(pidFile), 'the checkout started its filter');
  const pid = Number(readFileSync(pidFile, 'utf8'));
  t.after(() => { try { process.kill(pid); } catch { /* already gone */ } });
  controller.abort();
  await assert.rejects(running, /cancelled/);
  assert.throws(() => process.kill(pid, 0), 'the filter must not outlive the cancelled checkout');
});
