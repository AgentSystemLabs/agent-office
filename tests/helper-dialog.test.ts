import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Exercise the actual dialog entry point without booting the WebGL application.
const source = readFileSync(new URL('../src/client/main.ts', import.meta.url), 'utf8');
const entry = source.match(/^function helperFor\(w: WorkerInfo\) \{[\s\S]*?^\}/m)![0].replace('w: WorkerInfo', 'w');
for (const kind of ['agent', 'shell']) {
  test(`helper dialog opens and sends a request for a ${kind} in the shared checkout`, () => {
    let dialog: any;
    const sent: unknown[] = [];
    const open = new Function('officeIsFull', 'toast', 'store', 'fixLostWorktree', 'openPrompt', 'net', `${entry}; return helperFor;`)(
      () => false,
      (message: string) => { throw Error(message); },
      { helpers: [] },
      () => { throw Error('Unexpected worktree repair'); },
      (options: unknown) => { dialog = options; },
      { send: (message: unknown) => sent.push(message) },
    );
    open({ id: 'host', name: 'Sprocket', kind });
    assert.equal(dialog.title, '🆘 Bring a helper to Sprocket');
    dialog.onSubmit('', { provider: 'opencode' });
    assert.deepEqual(sent, [{ t: 'worker.helper', hostId: 'host', provider: 'opencode', model: undefined, effort: undefined }]);
  });
}
