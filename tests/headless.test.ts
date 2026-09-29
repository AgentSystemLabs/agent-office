import { test } from 'node:test';
import assert from 'node:assert/strict';
import { headlessArgs, parseHeadless } from '../src/server/headless.js';

const base = { claude: 'claude', env: {}, prompt: 'hi', schema: { type: 'object' } };

test('an isolated call runs with no tools and none of the user’s settings', () => {
  const args = headlessArgs({ ...base, isolated: true, system: 'Be brief' });
  assert.equal(args[0], '-p');
  assert.deepEqual(args.slice(args.indexOf('--model'), args.indexOf('--model') + 2), ['--model', 'haiku']);
  assert.ok(args.includes('--json-schema') && args[args.indexOf('--json-schema') + 1] === '{"type":"object"}');
  assert.deepEqual(args.slice(args.indexOf('--system-prompt'), args.indexOf('--system-prompt') + 2), ['--system-prompt', 'Be brief']);
  for (const flag of ['--tools', '--setting-sources', '--strict-mcp-config', '--disable-slash-commands', '--no-session-persistence']) assert.ok(args.includes(flag), flag);
  assert.equal(args[args.indexOf('--setting-sources') + 1], '');
  assert.ok(!args.includes('--allowedTools'));
});

test('a call that is not isolated loads the user’s settings', () => {
  const args = headlessArgs({ ...base, model: 'sonnet', maxTurns: 6 });
  assert.equal(args[args.indexOf('--model') + 1], 'sonnet');
  assert.equal(args[args.indexOf('--setting-sources') + 1], 'user');
  assert.equal(args[args.indexOf('--max-turns') + 1], '6');
  assert.ok(!args.includes('--strict-mcp-config') && !args.includes('--tools'));
});

test('parseHeadless takes structured_output, else the JSON in result, and nothing from an error', () => {
  assert.deepEqual(parseHeadless(JSON.stringify({ structured_output: { name: 'Fix Login' } })), { name: 'Fix Login' });
  assert.deepEqual(parseHeadless(JSON.stringify({ result: '```json\n{"name":"Fix Login"}\n```' })), { name: 'Fix Login' });
  assert.deepEqual(parseHeadless(JSON.stringify({ result: '{"a":1}' })), { a: 1 });
  assert.equal(parseHeadless(JSON.stringify({ is_error: true, structured_output: { name: 'x' } })), null);
  assert.equal(parseHeadless(JSON.stringify({ result: 'Sorry, I could not.' })), null);
  assert.equal(parseHeadless('not json'), null);
  assert.equal(parseHeadless(''), null);
});
