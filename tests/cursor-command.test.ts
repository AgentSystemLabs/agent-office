import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { cursorHookCommand, cursorHookWorkers, readableHookCommand, withCursorHookWorkers } from '../src/server/cursor-command.js';

test('shared registration rewriting preserves Windows and POSIX executable/path quoting', () => {
  for (const windows of [false, true]) {
    const args = ["/node with spaces/node", "/it's shared/agent-office-cursor-hook.cjs", 'stop'];
    const original = cursorHookCommand([...args, 'worker-a,worker-b'], windows);
    const updated = withCursorHookWorkers(original, ['worker-b']);
    assert.equal(updated, cursorHookCommand([...args, 'worker-b'], windows));
    assert.deepEqual(cursorHookWorkers(updated), ['worker-b']);
    assert.ok(readableHookCommand(updated).includes('agent-office-cursor-hook.cjs'));
  }
  assert.equal(cursorHookWorkers("'./user-hook' 'worker-a'"), undefined);
  assert.throws(() => withCursorHookWorkers(cursorHookCommand(['agent-office-cursor-hook.cjs', 'stop', 'worker-a']), ["bad'worker"]));
});

test('Windows hook preserves JSON stdin and literal arguments through cmd', { skip: process.platform !== 'win32' }, () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'cursor hook '));
  try {
    const file = path.join(dir, "it's a hook.cjs");
    writeFileSync(file, "let s='';process.stdin.on('data',d=>s+=d);process.stdin.on('end',()=>console.log(JSON.stringify({args:process.argv.slice(2),input:JSON.parse(s)})));");
    const args = ['stop', 'worker-123'];
    const result = spawnSync(process.env.COMSPEC || 'cmd.exe', ['/d','/s','/c',cursorHookCommand([process.execPath,file,...args])], { input: '{"conversation_id":"chat-1"}', encoding: 'utf8', timeout: 10000 });
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout.trim()), { args, input: { conversation_id: 'chat-1' } });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
