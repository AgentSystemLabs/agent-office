import test from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { MaintenanceChatArchive, MaintenanceTranscriptReader, transcriptMessage } from '../src/server/maintenance-chat.js';
import { stationBrief } from '../src/server/stations.js';
import { presentationBrief } from '../src/server/presentations.js';
import type { WorkerInfo } from '../src/shared/protocol.js';

const row = (role: string, text: string, at = '2026-10-01T12:00:00Z') => ({ type: 'response_item', timestamp: at, payload: { type: 'message', role, phase: 'final', content: [{ type: role === 'user' ? 'input_text' : 'output_text', text }] } });

test('chat extracts public Markdown and HTML but excludes tool results, reasoning and office wrappers', () => {
  assert.deepEqual(transcriptMessage(row('assistant', '## Done\n\n<table><tr><td>HTML</td></tr></table>')), { role: 'assistant', content: '## Done\n\n<table><tr><td>HTML</td></tr></table>', phase: 'final' });
  assert.equal(transcriptMessage({ type: 'response_item', payload: { type: 'function_call_output', output: 'secret tool data' } }), undefined);
  assert.equal(transcriptMessage({ type: 'response_item', payload: { type: 'reasoning', summary: [{ text: 'private reasoning' }] } }), undefined);
  assert.equal(transcriptMessage({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'thinking', thinking: 'secret' }, { type: 'tool_use', input: { token: 'secret' } }] } }), undefined);
  const prompt = `${stationBrief('maintenance')}\n\nBuild a chat view\n\n${presentationBrief('worker')}`;
  assert.equal(transcriptMessage(row('user', prompt))?.content, 'Build a chat view');
  assert.equal(transcriptMessage(row('user', '<environment_context>private context</environment_context>')), undefined);
  assert.equal(transcriptMessage(row('system', 'hidden instructions')), undefined);
  const privateMessage = row('assistant', 'Private reasoning');
  privateMessage.payload.phase = 'analysis';
  assert.equal(transcriptMessage(privateMessage), undefined);
  assert.equal(transcriptMessage({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'A reply' }] } })?.content, 'A reply');
});

test('Codex transcript reader is incremental, retries partial UTF-8 lines and rejects other sessions and paths', (t) => {
  const home = mkdtempSync(path.join(tmpdir(), 'maintenance-transcript-'));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  mkdirSync(path.join(home, 'sessions'));
  const file = path.join(home, 'sessions', 'rollout-session.jsonl');
  const meta = JSON.stringify({ type: 'session_meta', payload: { id: 'session' } }) + '\n';
  const line = JSON.stringify(row('assistant', 'Hello 🌍'));
  writeFileSync(file, meta + line.slice(0, -2));
  const reader = new MaintenanceTranscriptReader();
  assert.deepEqual(reader.read(file, 'session', 'codex', home), []);
  appendFileSync(file, line.slice(-2) + '\n');
  const first = reader.read(file, 'session', 'codex', home);
  assert.equal(first.length, 1);
  assert.equal(first[0].content, 'Hello 🌍');
  assert.deepEqual(reader.read(file, 'session', 'codex', home), []);
  const replay = new MaintenanceTranscriptReader().read(file, 'session', 'codex', home);
  assert.equal(replay[0].id, first[0].id);
  assert.deepEqual(reader.read(file, 'other', 'codex', home), []);
  const outside = path.join(home, 'other-session.jsonl');
  writeFileSync(outside, meta + line + '\n');
  assert.deepEqual(reader.read(outside, 'session', 'codex', home), []);
  writeFileSync(file, JSON.stringify({ type: 'session_meta', payload: { id: 'other' } }) + '\n' + line + '\n');
  assert.deepEqual(reader.read(file, 'session', 'codex', home), []);
  writeFileSync(file, meta + JSON.stringify(row('assistant', 'New')) + '\n');
  assert.equal(reader.read(file, 'session', 'codex', home)[0]?.content, 'New');
});

test('Claude transcript reader checks each row session and skips oversized records without stalling', (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), 'maintenance-claude-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'session.jsonl');
  const message = (sessionId: string, text: string) => ({ type: 'assistant', sessionId, timestamp: '2026-10-01T12:00:00Z', message: { role: 'assistant', content: [{ type: 'text', text }] } });
  writeFileSync(file, 'x'.repeat(3 * 1024 * 1024) + '\n' + JSON.stringify(message('wrong', 'Not yours')) + '\n' + JSON.stringify(message('session', 'Visible')) + '\n');
  const reader = new MaintenanceTranscriptReader();
  assert.deepEqual(reader.read(file, 'session', 'claude'), []);
  assert.equal(reader.read(file, 'session', 'claude')[0]?.content, 'Visible');
  assert.deepEqual(reader.read(file, 'session', 'claude'), []);
});

test('archive retains sessions after restart, reconciles accepted requests and preserves repeated requests', (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), 'maintenance-archive-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const archive = new MaintenanceChatArchive(dir);
  const worker = { id: 'maintenance-1', createdAt: 1 } as WorkerInfo;
  archive.capture(worker, [{ id: 'api-1', role: 'user', content: 'Fix this', at: 2, by: 'Alex', pending: true }]);
  archive.capture(worker, [{ id: 'transcript-1', role: 'user', content: 'Fix this', at: 3 }, { id: 'answer-1', role: 'assistant', content: '**Done**', at: 4 }]);
  archive.capture(worker, [{ id: 'transcript-1', role: 'user', content: 'Fix this', at: 3 }]);
  assert.equal(archive.page(worker.id)?.messages.length, 2);
  assert.equal(archive.page(worker.id)?.messages[0].by, 'Alex');
  archive.capture(worker, [{ id: 'api-2', role: 'user', content: 'Fix this', at: 5, pending: true }]);
  archive.capture(worker, [{ id: 'transcript-2', role: 'user', content: 'Fix this', at: 6 }]);
  assert.equal(archive.page(worker.id)?.messages.length, 3);
  archive.capture({ id: 'maintenance-2', createdAt: 7 } as WorkerInfo, [{ id: 'new', role: 'user', content: 'New task', at: 8 }]);
  const restored = new MaintenanceChatArchive(dir);
  assert.deepEqual(restored.list().map(c => c.id), ['maintenance-2', 'maintenance-1']);
  assert.equal(restored.page(worker.id)?.title, 'Fix this');
  assert.equal(restored.page(worker.id)?.messages[1].content, '**Done**');
  assert.equal(statSync(path.join(dir, 'maintenance-chat-archive.json')).mode & 0o777, 0o600);
  assert.ok(!readFileSync(path.join(dir, 'maintenance-chat-archive.json'), 'utf8').includes('api-1'));
  assert.equal(restored.page('missing'), undefined);
});

test('archive pages older messages without losing the newest page and skips malformed saved entries', (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), 'maintenance-pages-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(path.join(dir, 'maintenance-chat-archive.json'), JSON.stringify([null, { id: 'bad', messages: null }]));
  const archive = new MaintenanceChatArchive(dir);
  assert.equal(archive.list().length, 0);
  archive.capture({ id: 'worker', createdAt: 1 } as WorkerInfo, Array.from({ length: 205 }, (_, i) => ({ id: String(i), role: 'assistant', content: `Reply ${i}`, at: i + 1 })));
  const latest = archive.page('worker')!;
  assert.equal(latest.messages.length, 100);
  assert.equal(latest.messages[0].id, '105');
  assert.equal(latest.hasOlder, true);
  const older = archive.page('worker', latest.messages[0].id)!;
  assert.equal(older.messages[0].id, '5');
  const first = archive.page('worker', older.messages[0].id)!;
  assert.equal(first.messages.length, 5);
  assert.equal(first.hasOlder, false);
});
