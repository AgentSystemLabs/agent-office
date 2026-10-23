import test from 'node:test';
import assert from 'node:assert/strict';
// @ts-ignore Pocket browser modules are deliberately plain JavaScript.
import { workspaceFromLink, recentWorkspaces, rememberWorkspace } from '../integrations/pi-pocket/office-v2-client/workspace.js';
// @ts-ignore Pocket browser modules are deliberately plain JavaScript.
import { createBridge, validRequest } from '../integrations/pi-pocket/office-v2-client/bridge.js';

test('workspace picker accepts conversation numbers and same-app conversation links only', () => {
  for (const value of ['123', '#123', '/s/123', '/s/123/', 'https://pocket.test/s/123?ignored=1']) {
    assert.equal(workspaceFromLink(value, 'https://pocket.test'), 123);
  }
  for (const value of ['', '0', '-1', '1.5', '999999999999999999', '/s/0', '/s/123/anything', 'https://other.test/s/123', 'javascript:alert(1)', 'https://me:secret@pocket.test/s/123']) {
    assert.throws(() => workspaceFromLink(value, 'https://pocket.test'), /Paste a chat link/);
  }
});

test('recent workspace IDs are account-owned, bounded, unique, and do not cache titles or credentials', () => {
  const data = new Map<string, string>();
  const storage = { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => data.set(key, value) };
  for (let id = 1; id <= 12; id++) rememberWorkspace('owner', id, storage);
  rememberWorkspace('owner', 10, storage);
  rememberWorkspace('guest', 2, storage);
  assert.deepEqual(recentWorkspaces('owner', storage), [10, 12, 11, 9, 8, 7, 6, 5]);
  assert.deepEqual(recentWorkspaces('guest', storage), [2]);
  assert.equal(data.get('x.office-v2.owner.workspace'), '10');
  assert.equal(data.get('x.office-v2.guest.workspace'), '2');
  assert.ok([...data.keys()].every((key) => key.startsWith('x.office-v2.')));
});

test('blocked or malformed browser storage cannot stop workspace entry', () => {
  const blocked = { getItem: () => { throw new Error('Blocked'); }, setItem: () => { throw new Error('Blocked'); } };
  assert.deepEqual(recentWorkspaces('owner', blocked), []);
  assert.doesNotThrow(() => rememberWorkspace('owner', 12, blocked));
  assert.deepEqual(recentWorkspaces('owner', { getItem: () => 'not JSON' }), []);
  assert.deepEqual(recentWorkspaces('owner', { getItem: () => '[1,1,-1,0,"2",3.5,3]' }), [1, 3]);
});

test('3D workspace control opens the native picker without hiring or silently changing the room', async () => {
  let opened = 0;
  const frame = {};
  assert.equal(validRequest({ source: frame, origin: 'https://pocket.test', data: { type: 'office-v2:request', channel: 'channel', id: 'workspace-1', op: 'workspace', payload: {} } }, frame, 'https://pocket.test', 'channel'), true);
  const handle = createBridge({ pocket: { api: () => { throw new Error('No model or state change'); } }, source: 3, clientId: 'client', signal: new AbortController().signal, workspace: () => opened++ });
  assert.deepEqual(await handle('workspace', {}), { opened: true });
  assert.equal(opened, 1);
});
