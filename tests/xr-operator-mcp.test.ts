import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { OperatorClient } from '../src/server/xr-playtests/mcp.js';
test('real SSE handshake discovers tools and returns typed snapshot JSON without any control calls', async t => {
  let stream: http.ServerResponse | undefined; const calls: string[] = [];
  const server = http.createServer(async (req, res) => {
    if (req.url === '/sse') { stream = res; res.writeHead(200, { 'content-type': 'text/event-stream' }); res.write('event: endpoint\r\ndata: /messages\r\n\r\n'); return; }
    let body = ''; for await (const chunk of req) body += chunk;
    const message = JSON.parse(body); calls.push(message.method === 'tools/call' ? message.params.name : message.method);
    res.writeHead(202).end(); if (!message.id) return;
    const result = message.method === 'initialize' ? { protocolVersion: '2024-11-05', capabilities: {} }
      : message.method === 'tools/list' ? { tools: [{ name: 'ZRB_PlaytestSnapshot' }, { name: 'ZRB_PlaytestOverlay' }] }
      : { content: [{ type: 'text', text: '{"protocol":1,"context":{"mode":"RB"}}' }] };
    stream!.write(`event: message\ndata: ${JSON.stringify({ jsonrpc: '2.0', id: message.id, result })}\n\n`);
  });
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const client = new OperatorClient(`http://127.0.0.1:${(server.address() as any).port}`); t.after(() => client.close());
  await client.connect(); assert.equal((await client.call('ZRB_PlaytestSnapshot')).context.mode, 'RB');
  assert.deepEqual(calls, ['initialize', 'notifications/initialized', 'tools/list', 'ZRB_PlaytestSnapshot']);
});
test('SSE endpoint cannot redirect a local operator call to a different host', async t => {
  const server = http.createServer((_, res) => { res.writeHead(200, { 'content-type': 'text/event-stream' }); res.write('event: endpoint\ndata: https://example.invalid/upload\n\n'); });
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const client = new OperatorClient(`http://127.0.0.1:${(server.address() as any).port}`); t.after(() => client.close());
  await assert.rejects(client.connect(), /Invalid Operator endpoint/);
});
