import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const source = readFileSync(new URL('../src/client/main.ts', import.meta.url), 'utf8');
const entry = source.match(/^function deskHint\(deskId: string\): Hint \{[\s\S]*?(?=  if \(!w && plan\(\))/m)![0].replace('deskId: string', 'deskId').replace(': Hint', '') + '}';

test('helper hint opens its own terminal without looking up a nonexistent desk', () => {
  let opened = '';
  const worker = { id: 'gizmo', name: 'Gizmo', helper: { hostId: 'widget' }, status: 'needs_input' };
  const hint = new Function('store', 'h', 'key', 'aside', 'STATUS_LABEL', 'openWorkerTerminal', `${entry}; return deskHint;`)(
    { workerAtDesk: () => worker }, (_: string, __: unknown, text: string) => text,
    (key: string, text: string, run?: () => void) => ({ key, text, run }), (text: string) => text,
    { needs_input: 'needs you' }, (id: string) => { opened = id; },
  )('helper:desk-1');
  assert.match(hint.parts[0], /Gizmo/);
  assert.match(hint.parts[1], /Answer or approve/);
  hint.parts[2].run();
  assert.equal(opened, 'gizmo');
  assert.equal(hint.parts[2].key, 'E');
});
