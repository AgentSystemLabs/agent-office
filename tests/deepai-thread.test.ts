import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { writeDeepaiCredential } from '../src/server/deepai-mcp.js';
import { ThreadSession } from '../src/server/deepai-thread.js';
import type { WorkerStatus } from '../src/shared/protocol.js';

async function waitFor(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 3000;
  while (!predicate() && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 10));
  assert.ok(predicate(), 'timed out waiting for the fake MCP response');
}

test('a DeepAI thread launches in the desk worktree, mirrors its transcript, sends and interrupts', async (t) => {
  const root = mkdtempSync(path.join(tmpdir(), 'deepai-thread-test-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      const rpc = JSON.parse(body) as { id: number; method: string; params?: { name?: string; arguments?: Record<string, unknown> } };
      if (rpc.method === 'initialize') {
        res.writeHead(200, { 'content-type': 'application/json', 'mcp-session-id': 'thread-test' });
        res.end(JSON.stringify({ jsonrpc: '2.0', id: rpc.id, result: {} }));
        return;
      }
      const name = rpc.params?.name ?? '';
      const args = rpc.params?.arguments ?? {};
      calls.push({ name, args });
      let answer: Record<string, unknown> = {};
      if (name === 'deepai_project_list') answer = { projects: [{ id: 'project-1', workspaceRoot: '/floor', deletedAt: null }], nextCursor: null };
      if (name === 'deepai_thread_launch') answer = { threadId: 'mcp:thread-1', status: 'running' };
      if (name === 'deepai_thread_read') answer = { thread: { status: 'completed' }, items: [{ itemId: 'assistant-1', type: 'assistant_message', text: 'Finished the change' }] };
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ jsonrpc: '2.0', id: rpc.id, result: { content: [{ type: 'text', text: JSON.stringify(answer) }] } }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/mcp`;
  writeDeepaiCredential(root, { token: 'test-token', expiresAt: new Date(Date.now() + 60_000).toISOString(), clientId: 'test', redirectUri: 'http://127.0.0.1/callback', url });
  const output: string[] = [];
  const statuses: WorkerStatus[] = [];
  const session = new ThreadSession({ dataDir: root, cwd: '/floor/.worktrees/desk', workspaceRoot: '/floor', model: 'deepai/glm-5.3-flash', title: 'Test desk', firstPrompt: 'Make a change' }, {
    output: (text) => output.push(text), status: (status) => statuses.push(status), usage: () => {}, session: () => {}, exit: () => {}, prompted: () => {},
  });
  await session.start();
  await waitFor(() => output.some((text) => text.includes('Finished the change')));
  assert.equal(session.id, 'mcp:thread-1');
  assert.deepEqual(statuses.slice(0, 2), ['starting', 'working']);
  assert.ok(output.some((text) => text.includes('Finished the change')));
  const launched = calls.find((call) => call.name === 'deepai_thread_launch');
  assert.equal(launched?.args.projectId, 'project-1');
  assert.deepEqual(launched?.args.workspaceStrategy, { type: 'existing_worktree', worktreePath: '/floor/.worktrees/desk' });
  assert.deepEqual(launched?.args.modelSelection, { provider: 'deepai', model: 'deepai/glm-5.3-flash' });
  session.prompt('Follow up');
  session.writeInput('\x1b');
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.ok(calls.some((call) => call.name === 'deepai_thread_send' && call.args.message === 'Follow up'));
  assert.ok(calls.some((call) => call.name === 'deepai_thread_interrupt' && call.args.threadId === 'mcp:thread-1'));
  session.close();
});

test('a thread without a valid pairing reports how to fix it', async (t) => {
  const root = mkdtempSync(path.join(tmpdir(), 'deepai-thread-unpaired-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const messages: string[] = [];
  const session = new ThreadSession({ dataDir: root, cwd: root, workspaceRoot: root, title: 'Unpaired' }, { output: (text) => messages.push(text), status: () => {}, usage: () => {}, session: () => {}, exit: () => {}, prompted: () => {} });
  await session.start();
  assert.match(messages.join(''), /pair DeepAI Code first/);
});

test('resume reads the saved app thread without creating a project or a new thread', async (t) => {
  const root = mkdtempSync(path.join(tmpdir(), 'deepai-thread-resume-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const methods: string[] = [];
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      const rpc = JSON.parse(body) as { id: number; method: string; params?: { name?: string } };
      if (rpc.method === 'initialize') { res.writeHead(200, { 'content-type': 'application/json', 'mcp-session-id': 'resume' }); res.end(JSON.stringify({ jsonrpc: '2.0', id: rpc.id, result: {} })); return; }
      const name = rpc.params?.name ?? '';
      methods.push(name);
      const result = name === 'deepai_thread_read' ? { thread: { status: 'completed' }, items: [] } : {};
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ jsonrpc: '2.0', id: rpc.id, result: { content: [{ type: 'text', text: JSON.stringify(result) }] } }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/mcp`;
  writeDeepaiCredential(root, { token: 'test', expiresAt: new Date(Date.now() + 60_000).toISOString(), clientId: 'test', redirectUri: 'http://127.0.0.1/callback', url });
  const sessions: string[] = [];
  const session = new ThreadSession({ dataDir: root, cwd: '/desk', workspaceRoot: '/floor', title: 'Resume', resumeThreadId: 'mcp:saved-thread' }, {
    output: () => {}, status: () => {}, usage: () => {}, session: (id) => sessions.push(id), exit: () => {}, prompted: () => {},
  });
  await session.start();
  await waitFor(() => methods.includes('deepai_thread_read'));
  assert.deepEqual(sessions, ['mcp:saved-thread']);
  assert.deepEqual(methods, ['deepai_thread_read']);
  session.close();
});

test('a thread waiting for app-side input maps to the office needs-input state', async (t) => {
  const root = mkdtempSync(path.join(tmpdir(), 'deepai-thread-waiting-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      const rpc = JSON.parse(body) as { id: number; method: string; params?: { name?: string } };
      if (rpc.method === 'initialize') { res.writeHead(200, { 'content-type': 'application/json', 'mcp-session-id': 'waiting' }); res.end(JSON.stringify({ jsonrpc: '2.0', id: rpc.id, result: {} })); return; }
      const name = rpc.params?.name ?? '';
      const result = name === 'deepai_project_list' ? { projects: [{ id: 'p', workspaceRoot: '/floor', deletedAt: null }], nextCursor: null }
        : name === 'deepai_thread_launch' ? { threadId: 'mcp:waiting', status: 'waiting' }
          : name === 'deepai_thread_read' ? { thread: { status: 'waiting' }, items: [] } : {};
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ jsonrpc: '2.0', id: rpc.id, result: { content: [{ type: 'text', text: JSON.stringify(result) }] } }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/mcp`;
  writeDeepaiCredential(root, { token: 'test', expiresAt: new Date(Date.now() + 60_000).toISOString(), clientId: 'test', redirectUri: 'http://127.0.0.1/callback', url });
  const statuses: WorkerStatus[] = [];
  const session = new ThreadSession({ dataDir: root, cwd: '/desk', workspaceRoot: '/floor', title: 'Waiting', firstPrompt: 'Start' }, {
    output: () => {}, status: (status) => statuses.push(status), usage: () => {}, session: () => {}, exit: () => {}, prompted: () => {},
  });
  await session.start();
  await waitFor(() => statuses.includes('needs_input'));
  assert.ok(statuses.includes('needs_input'));
  session.close();
});
