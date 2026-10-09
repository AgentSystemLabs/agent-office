import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { cursorHookCommand } from '../src/server/cursor-command.js';

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
