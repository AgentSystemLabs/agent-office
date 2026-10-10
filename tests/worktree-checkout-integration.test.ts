import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Worktrees } from '../src/server/worktrees.js';

test('a real checkout taking longer than the old 20-second limit completes without blocking', async (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), 'office-slow-checkout-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const git = (...args: string[]) => execFileSync('git', args, { cwd: dir, stdio: 'pipe' });
  git('init', '-q', '-b', 'main');
  writeFileSync(path.join(dir, 'a.txt'), 'asset contents\n');
  writeFileSync(path.join(dir, '.gitattributes'), 'a.txt -text filter=slow\n');
  git('add', 'a.txt', '.gitattributes');
  git('-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-qm', 'fixture');
  const filter = path.join(dir, 'slow.cjs');
  writeFileSync(filter, 'setTimeout(() => process.stdin.pipe(process.stdout), 21000);');
  git('config', 'filter.slow.smudge', `"${process.execPath.replaceAll('\\', '/')}" "${filter.replaceAll('\\', '/')}"`);
  git('config', 'filter.slow.required', 'true');
  let ticks = 0;
  const timer = setInterval(() => ticks++, 100);
  try {
    const made = await new Worktrees(dir).createAsync('slow');
    assert.notEqual(typeof made, 'string', String(made));
    assert.ok(typeof made !== 'string');
    assert.equal(readFileSync(path.join(dir, made.path, 'a.txt'), 'utf8'), 'asset contents\n');
    assert.ok(ticks >= 180, `${ticks} ticks while copying the slow asset`);
  } finally { clearInterval(timer); }
});
