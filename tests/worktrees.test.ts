import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readdirSync, rmSync, symlinkSync, writeFileSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Worktrees } from '../src/server/worktrees.js';
import { Changes } from '../src/server/changes.js';
import type { ChangesState } from '../src/shared/protocol.js';

test('foreign worktree keeps its own PR base and excludes office state from the source checkout', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'agent-office-foreign-'));
  const git = (...args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  let changes: Changes | undefined;
  try {
    git('init', '-b', 'develop');
    writeFileSync(path.join(root, 'README.md'), 'fixture');
    git('add', 'README.md');
    git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-m', 'Fixture');
    writeFileSync(path.join(root, '.git', 'info', 'exclude'), '# Preserve this\nexisting-rule\n');
    const made = new Worktrees(root).create('worker-5678');
    assert.notEqual(typeof made, 'string', typeof made === 'string' ? made : undefined);
    if (typeof made === 'string') return;
    assert.equal(made.from, 'develop');
    assert.equal(git('status', '--porcelain'), '');
    assert.match(readFileSync(path.join(root, '.git', 'info', 'exclude'), 'utf8'), /existing-rule\n\.agent-office\//);
    let latest: ChangesState | undefined;
    changes = new Changes('/different-office', 'main', () => ({
      name: 'Fixture', cwd: path.join(root, made.path), rel: made.path,
      projectDir: root, repository: 'demo/other', worktreeBase: made.base, worktreeFrom: made.from,
    }), () => undefined, { state: (state) => { latest = state; }, toast() {}, refreshGitHub() {} });
    changes.watch('fixture', 'client');
    for (let i = 0; i < 100 && !latest; i++) await new Promise((resolve) => setTimeout(resolve, 20));
    assert.ok(latest);
    assert.equal(latest.error, undefined);
    assert.equal(latest.prBase, 'develop');
  } finally {
    changes?.stop();
    rmSync(root, { recursive: true, force: true });
  }
});

test('worktree creation rejects a symlinked .agent-office tree before invoking git', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'agent-office-worktrees-'));
  const outside = mkdtempSync(path.join(tmpdir(), 'agent-office-outside-'));
  try {
    symlinkSync(outside, path.join(root, '.agent-office'));
    const result = new Worktrees(root).create('worker-1234');
    assert.equal(typeof result, 'string');
    assert.match(result as string, /symlink|reserved worktree path/i);
    assert.equal(existsSync(path.join(outside, 'worktrees')), false);
    assert.deepEqual(readdirSync(outside), []);
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});

test('worktree creation creates missing parents only inside the project', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'agent-office-worktrees-'));
  try {
    const result = new Worktrees(root).create('worker-1234');
    assert.equal(typeof result, 'string');
    assert.equal(existsSync(path.join(root, '.agent-office', 'worktrees')), true);
    assert.equal(existsSync(path.join(root, '.agent-office', 'worktrees', 'worker-1234')), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
