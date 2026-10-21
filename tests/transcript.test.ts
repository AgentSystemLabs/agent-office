import test from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync, mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { TranscriptLog, cleanPrompt, toolGist } from '../src/server/transcript.ts';

const line = (r: unknown) => `${JSON.stringify(r)}\n`;
const user = (content: unknown, extra: Record<string, unknown> = {}) => ({ type: 'user', uuid: `u-${Math.random()}`, timestamp: '2026-10-21T10:00:00Z', message: { role: 'user', content }, ...extra });
const assistant = (content: unknown, extra: Record<string, unknown> = {}) => ({ type: 'assistant', uuid: `a-${Math.random()}`, timestamp: '2026-10-21T10:00:01Z', message: { id: 'msg', role: 'assistant', content }, ...extra });

function tempLog(...records: unknown[]): TranscriptLog {
  const file = path.join(mkdtempSync(path.join(os.tmpdir(), 'ao-transcript-')), 'session.jsonl');
  writeFileSync(file, records.map(line).join(''));
  return new TranscriptLog(file);
}

test('prompts, replies and tool calls become chat items, and a tool result fills its call in', () => {
  const log = tempLog(
    user('fix the login bug'),
    assistant([{ type: 'thinking', thinking: 'hmm' }, { type: 'text', text: 'Looking at it.' }, { type: 'tool_use', id: 'tu-1', name: 'Bash', input: { command: 'npm test', description: 'Run tests' } }]),
    user([{ type: 'tool_result', tool_use_id: 'tu-1', content: [{ type: 'text', text: '12 passing' }] }], { toolUseResult: {} }),
    assistant([{ type: 'text', text: 'All green.' }]),
  );
  const { added, patched } = log.read();
  assert.deepEqual(
    added.map((i) => [i.role, i.text ?? i.tool?.name]),
    [
      ['you', 'fix the login bug'],
      ['agent', 'Looking at it.'],
      ['tool', 'Bash'],
      ['agent', 'All green.'],
    ],
  );
  // The call and its result came in the same read: the item is sent once, filled in.
  assert.equal(patched.length, 0);
  const tool = added[2].tool!;
  assert.equal(tool.input, 'npm test');
  assert.equal(tool.result, '12 passing');
  assert.equal(tool.error, undefined);
  assert.equal(added[2].id, 'tu-1');
});

test('a result that arrives in a later read is a patch of the item already sent, and reads are incremental', () => {
  const log = tempLog(user('run it'), assistant([{ type: 'tool_use', id: 'tu-2', name: 'Bash', input: { command: 'npm run build' } }]));
  const first = log.read();
  assert.equal(first.added.length, 2);
  assert.equal(first.added[1].tool?.result, undefined);
  appendFileSync(log.path, line(user([{ type: 'tool_result', tool_use_id: 'tu-2', content: 'boom', is_error: true }])));
  appendFileSync(log.path, line(assistant([{ type: 'text', text: 'That failed.' }])));
  const second = log.read();
  assert.deepEqual(
    second.added.map((i) => i.text),
    ['That failed.'],
  );
  assert.equal(second.patched.length, 1);
  assert.equal(second.patched[0].id, 'tu-2');
  assert.equal(second.patched[0].tool?.result, 'boom');
  assert.equal(second.patched[0].tool?.error, true);
  assert.equal(log.items.length, 3);
  // Nothing new: nothing added.
  assert.deepEqual(log.read(), { added: [], patched: [] });
});

test("what isn't the conversation is left out: subagents, meta records, bookkeeping and empty text", () => {
  const log = tempLog(
    { type: 'permission-mode', mode: 'default' },
    user('hidden', { isMeta: true }),
    user('side', { isSidechain: true }),
    assistant([{ type: 'text', text: '   ' }]),
    user([{ type: 'text', text: '[Request interrupted by user for tool use]' }]),
    { type: 'summary', summary: 'x' },
    'not json',
  );
  const { added } = log.read();
  assert.deepEqual(
    added.map((i) => [i.role, i.text]),
    [['note', 'Interrupted']],
  );
});

test('a prompt reads as it was typed: slash commands by name, and the tags around it gone', () => {
  assert.equal(cleanPrompt('<command-name>/clear</command-name>\n<command-message>clear</command-message>'), '/clear');
  assert.equal(cleanPrompt('<command-name>/model</command-name><command-args>opus</command-args>'), '/model opus');
  assert.equal(cleanPrompt('do it\n<system-reminder>\nsecret context\n</system-reminder>'), 'do it');
  assert.equal(cleanPrompt('<local-command-stdout>noise</local-command-stdout>'), '');
});

test("a tool's gist is the field that says what it did", () => {
  assert.equal(toolGist('Bash', { command: 'ls -la', description: 'List' }), 'ls -la');
  assert.equal(toolGist('Read', { file_path: '/a/b.ts' }), '/a/b.ts');
  assert.equal(toolGist('Grep', { pattern: 'TODO', path: '.' }), 'TODO');
  assert.equal(toolGist('Agent', { description: 'Survey', prompt: 'long…' }), 'Survey');
  assert.equal(toolGist('Odd', { a: 1 }), '{"a":1}');
  assert.equal(toolGist('Odd', undefined), '');
  assert.match(toolGist('Bash', { command: 'x'.repeat(700) }), /more characters\)$/);
});
