import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  DEEPAI_MCP_PROTOCOL,
  DeepaiMcp,
  DeepaiMcpError,
  deepaiAuthorizeUrl,
  deepaiCredentialFile,
  exchangeDeepaiCode,
  loopbackRedirect,
  pkce,
  readDeepaiCredential,
  registerDeepaiClient,
  writeDeepaiCredential,
} from '../src/server/deepai-mcp.js';

function fixture(t: { after(fn: () => void): void }) {
  const root = mkdtempSync(path.join(tmpdir(), 'deepai-mcp-test-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

/** The app's MCP endpoint, faked: handshake, a session id, and one tool that answers in a shape. */
async function fakeMcp(t: { after(fn: () => void): void }) {
  const seen: { method: string; session?: string; protocol?: string; token?: string }[] = [];
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const rpc = body ? (JSON.parse(body) as { id: number; method: string; params?: { name?: string; arguments?: unknown } }) : undefined;
      seen.push({ method: rpc?.method ?? '', session: req.headers['mcp-session-id'] as string | undefined, protocol: req.headers['mcp-protocol-version'] as string | undefined, token: (req.headers.authorization ?? '').replace(/^Bearer /, '') });
      if (rpc?.method === 'initialize') {
        res.writeHead(200, { 'content-type': 'application/json', 'mcp-session-id': 'sess-1' });
        res.end(JSON.stringify({ jsonrpc: '2.0', id: rpc.id, result: { protocolVersion: DEEPAI_MCP_PROTOCOL, capabilities: {}, serverInfo: { name: 'DeepAI Code', version: '0.3.42' } } }));
        return;
      }
      if (rpc?.method === 'tools/list') {
        res.writeHead(200, { 'content-type': 'text/event-stream' });
        res.end(`event: message\ndata: ${JSON.stringify({ jsonrpc: '2.0', id: rpc.id, result: { tools: [{ name: 'deepai_thread_launch' }] } })}\n\n`);
        return;
      }
      const name = rpc?.params?.name;
      const args = rpc?.params?.arguments as { bad?: boolean } | undefined;
      const answer = args?.bad
        ? { content: [{ type: 'text', text: JSON.stringify({ code: 'target_required', message: 'Pass projectId' }) }], isError: true }
        : { content: [{ type: 'text', text: JSON.stringify({ threadId: 'mcp:1', status: 'completed' }) }] };
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ jsonrpc: '2.0', id: rpc?.id, result: name === undefined ? {} : answer }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  t.after(() => server.close());
  return { url: `http://127.0.0.1:${port}/mcp`, port, seen };
}

test('the MCP client says hello once, keeps the session, and says which revision it speaks', async (t) => {
  const mcp = await fakeMcp(t);
  const client = new DeepaiMcp({ url: mcp.url, token: 'tok' });
  const tools = await client.listTools();
  assert.deepEqual(tools.map((x) => x.name), ['deepai_thread_launch']);
  const answer = await client.call<{ threadId: string }>('deepai_thread_launch', { projectId: 'p' });
  assert.equal(answer.threadId, 'mcp:1');
  // One handshake for the whole client, and every call after it carries the session the app handed out.
  assert.equal(mcp.seen.filter((s) => s.method === 'initialize').length, 1);
  for (const call of mcp.seen.filter((s) => s.method !== 'initialize')) {
    assert.equal(call.session, 'sess-1');
    assert.equal(call.protocol, DEEPAI_MCP_PROTOCOL);
    assert.equal(call.token, 'tok');
  }
});

test('a tool that answers with an error says so, with the app\'s own message', async (t) => {
  const mcp = await fakeMcp(t);
  const client = new DeepaiMcp({ url: mcp.url, token: 'tok' });
  await assert.rejects(() => client.call('deepai_thread_launch', { bad: true }), (err: unknown) => {
    assert.ok(err instanceof DeepaiMcpError);
    assert.equal(err.message, 'deepai_thread_launch: Pass projectId');
    return true;
  });
});

test('the credential lives on the floor, readable by its user, and expires', (t) => {
  const root = fixture(t);
  const credential = {
    token: 'bearer',
    expiresAt: new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString(),
    clientId: 'client',
    redirectUri: loopbackRedirect(4599),
    url: 'http://127.0.0.1:3774/mcp',
  };
  writeDeepaiCredential(root, credential);
  assert.deepEqual(readDeepaiCredential(root), credential);
  assert.equal(statSync(deepaiCredentialFile(root)).mode & 0o777, 0o600);
  // A day past its date it's gone, and so is a folder that never had one.
  const later = new Date(Date.parse(credential.expiresAt) + 24 * 3600 * 1000);
  assert.equal(readDeepaiCredential(root, later), undefined);
  assert.equal(readDeepaiCredential(path.join(root, 'missing')), undefined);
  // A file written by hand without a date isn't a credential either.
  writeDeepaiCredential(root, { ...credential, expiresAt: 'soon' });
  assert.equal(readDeepaiCredential(root), undefined);
  assert.match(readFileSync(deepaiCredentialFile(root), 'utf8'), /"token": "bearer"/);
});

test('a pairing registers the office, asks with PKCE, and trades the code for a 30-day bearer', async (t) => {
  const requests: { url: string; body: string }[] = [];
  const fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    requests.push({ url, body: String(init?.body ?? '') });
    if (url.endsWith('/oauth/mcp/register')) return new Response(JSON.stringify({ client_id: 'client-1' }), { status: 201 });
    if (url.endsWith('/oauth/mcp/token')) return new Response(JSON.stringify({ access_token: 'bearer-1', expires_in: 2592000 }), { status: 200 });
    return new Response('no', { status: 404 });
  }) as typeof fetch;

  const url = 'http://127.0.0.1:3774/mcp';
  const redirectUri = loopbackRedirect(4599);
  const clientId = await registerDeepaiClient({ url, redirectUri, fetch });
  assert.equal(clientId, 'client-1');

  const { verifier, challenge } = pkce();
  assert.notEqual(verifier, challenge);
  const authorize = deepaiAuthorizeUrl({ url, clientId, redirectUri, challenge, state: 'st-1' });
  const parsed = new URL(authorize);
  assert.equal(parsed.origin + parsed.pathname, 'http://127.0.0.1:3774/oauth/mcp/authorize');
  assert.equal(parsed.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(parsed.searchParams.get('code_challenge'), challenge);
  assert.equal(parsed.searchParams.get('state'), 'st-1');
  assert.equal(parsed.searchParams.get('redirect_uri'), redirectUri);

  const now = new Date('2026-11-20T02:30:00Z');
  const credential = await exchangeDeepaiCode({ url, code: 'code-1', verifier, clientId, redirectUri, now, fetch });
  assert.equal(credential.token, 'bearer-1');
  assert.equal(credential.url, url);
  assert.equal(credential.expiresAt, new Date(now.getTime() + 2592000 * 1000).toISOString());
  const tokenCall = requests.find((r) => r.url.endsWith('/oauth/mcp/token'));
  assert.match(String(tokenCall?.body), /grant_type=authorization_code/);
  assert.match(String(tokenCall?.body), new RegExp(`code_verifier=${verifier.replace(/[-_.]/g, '\\$&')}`));

  // A refused exchange is an error, not a credential with an empty token.
  const failing = (async () => new Response('{"error":"invalid_grant"}', { status: 400 })) as unknown as typeof fetch;
  await assert.rejects(() => exchangeDeepaiCode({ url, code: 'x', verifier, clientId, redirectUri, fetch: failing }), /refused the code \(400\)/);
});
