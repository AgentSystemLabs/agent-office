import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { dispatch, exportPath, localRequest, readReply, safeFile } from '../src/server/telegram/service.js';
import type { Ctx } from '../src/server/office/context.js';
test('leader input and permission dialogs never receive a Telegram prompt', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'telegram-office-')); t.after(() => fs.rm(root, { recursive: true, force: true }));
  const dir = path.join(root, '.agent-office/artiq-studio/brands/artiq-studio'); await fs.mkdir(dir, { recursive: true }); await fs.writeFile(path.join(dir, 'profile.json'), '{}');
  const prior = process.env.AGENT_OFFICE_TELEGRAM_LEADER_ID; process.env.AGENT_OFFICE_TELEGRAM_LEADER_ID = 'leader';
  t.after(() => { if (prior === undefined) delete process.env.AGENT_OFFICE_TELEGRAM_LEADER_ID; else process.env.AGENT_OFFICE_TELEGRAM_LEADER_ID = prior; });
  let prompts = 0; const floor = { id: 'floor', dir: root, workers: { get: () => ({ id: 'leader', kind: 'agent', status: 'needs_input' }), prompt: () => { prompts++; } } };
  assert.equal((await dispatch({ workerFloor: () => floor } as unknown as Ctx, { id: 'tg-124', brand: 'artiq-studio', text: 'yes' })).status, 'needs_input');
  assert.equal(prompts, 0); await assert.rejects(fs.access(path.join(root, '.agent-office/telegram/requests/tg-124.json')));
});
test('connector accepts neither remote nor browser-origin requests', () => {
  assert.equal(localRequest('127.0.0.1', undefined), true); assert.equal(localRequest('::ffff:127.0.0.1', undefined), true);
  assert.equal(localRequest('192.168.1.1', undefined), false); assert.equal(localRequest('127.0.0.1', 'https://evil.example'), false);
});
test('exports reject credential paths, traversal and arbitrary files', () => {
  for (const file of ['.agent-office/homes/key.json', '.agent-office/artiq-studio/brands/viniela-design/results/camp/v06/../accounts.json', '.agent-office/artiq-studio/brands/viniela-design/results/camp/v06/profile.json']) assert.throws(() => exportPath(file));
  assert.equal(exportPath('.agent-office/artiq-studio/brands/viniela-design/results/camp/v06/feed-1080x1350.png').endsWith('.png'), true);
});
test('reader rejects symlinks and size violations', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'telegram-office-')); t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.writeFile(path.join(root, 'real.md'), 'body'); await fs.symlink('real.md', path.join(root, 'link.md'));
  await assert.rejects(safeFile(root, 'link.md'), /Symlink/); await assert.rejects(safeFile(root, 'real.md', 2), /size/);
  assert.equal((await safeFile(root, 'real.md')).toString(), 'body');
});
test('persisted request is not typed twice; reply cannot cross brands', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'telegram-office-')); t.after(() => fs.rm(root, { recursive: true, force: true }));
  const profileDir = path.join(root, '.agent-office/artiq-studio/brands/viniela-design'); await fs.mkdir(profileDir, { recursive: true }); await fs.writeFile(path.join(profileDir, 'profile.json'), '{}');
  const prior = process.env.AGENT_OFFICE_TELEGRAM_LEADER_ID; process.env.AGENT_OFFICE_TELEGRAM_LEADER_ID = 'leader';
  t.after(() => { if (prior === undefined) delete process.env.AGENT_OFFICE_TELEGRAM_LEADER_ID; else process.env.AGENT_OFFICE_TELEGRAM_LEADER_ID = prior; });
  let prompts = 0; const floor = { id: 'floor', dir: root, workers: { get: () => ({ id: 'leader', kind: 'agent' }), prompt: () => { prompts++; return undefined; } } };
  const ctx = { workerFloor: () => floor } as unknown as Ctx; const input = { id: 'tg-123', brand: 'viniela-design', text: 'hello' };
  assert.equal((await dispatch(ctx, input)).status, 'accepted'); assert.equal((await dispatch(ctx, input)).status, 'accepted'); assert.equal(prompts, 1);
  const replies = path.join(root, '.agent-office/telegram/replies'); await fs.mkdir(replies, { recursive: true });
  await fs.writeFile(path.join(replies, 'tg-123.json'), JSON.stringify({ brand_id: 'viniela-design', text: 'done', files: ['.agent-office/artiq-studio/brands/rumatemu/reports/camp/report.md'] }));
  await assert.rejects(readReply(root, 'tg-123'), /brand boundaries/);
});
