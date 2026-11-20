import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fetchDeepaiModels, MODEL_LISTERS } from '../src/server/models.js';
import { writeDeepaiCredential } from '../src/server/deepai-mcp.js';
import { providerAdapter } from '../src/server/providers/index.js';

test('DeepAI Code reads live model IDs and Theos labels from orchestrator_capabilities', async (t) => {
  const root = mkdtempSync(path.join(tmpdir(), 'deepai-models-test-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(path.join(root, '.agent-office'));
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      const rpc = JSON.parse(body) as { id: number; method: string };
      if (rpc.method === 'initialize') {
        res.writeHead(200, { 'content-type': 'application/json', 'mcp-session-id': 'models-test' });
        res.end(JSON.stringify({ jsonrpc: '2.0', id: rpc.id, result: {} }));
        return;
      }
      const value = { providers: [{ providerInstanceId: 'deepai', models: [
        { id: 'deepai/glm-5.3-flash', label: 'GLM 5.3 Flash', theosPerRequest: 0 },
        { id: 'deepai/claude-sonnet-5-5', label: 'Claude Sonnet 5.5', theosPerRequest: 15 },
        { id: 'other/not-deepai', label: 'Other' },
      ] }] };
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ jsonrpc: '2.0', id: rpc.id, result: { content: [{ type: 'text', text: JSON.stringify(value) }] } }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/mcp`;
  writeDeepaiCredential(path.join(root, '.agent-office'), { token: 'test', expiresAt: new Date(Date.now() + 60_000).toISOString(), clientId: 'test', redirectUri: 'http://127.0.0.1/callback', url });
  assert.deepEqual(await fetchDeepaiModels('', root), [
    { id: 'deepai/glm-5.3-flash', name: 'GLM 5.3 Flash · free', free: true },
    { id: 'deepai/claude-sonnet-5-5', name: 'Claude Sonnet 5.5 · 15 Theos/call', free: false },
  ]);
  assert.ok(MODEL_LISTERS.deepai);
  assert.equal(providerAdapter('deepai')?.transport, 'thread');
});

test('DeepAI Code has no model suggestions until the floor is paired', async () => {
  assert.deepEqual(await fetchDeepaiModels('', '/missing/floor'), []);
});
