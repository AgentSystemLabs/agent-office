#!/usr/bin/env node
import { pathToFileURL } from 'node:url';
export async function main(args = process.argv.slice(2), env = process.env) {
  const command = args[0];
  if (!command || command === '--help') { console.log('office-decisions list | add (JSON on stdin). Human answers are read-only for workers.'); return; }
  if (!['list', 'add'].includes(command)) throw Error('Use list or add. Only a human can answer in the Office.');
  if (!env.AGENT_OFFICE_HOOK_URL || !env.AGENT_OFFICE_WORKER_ID || !env.AGENT_OFFICE_HOOK_TOKEN) throw Error('Run inside an Office worker.');
  const url = new URL('/office/decisions', env.AGENT_OFFICE_HOOK_URL);
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || url.protocol !== 'http:') throw Error('Expected local Office hook server.');
  url.searchParams.set('worker', env.AGENT_OFFICE_WORKER_ID);
  let body;
  if (command === 'add') { let text = ''; for await (const chunk of process.stdin) { text += chunk; if (Buffer.byteLength(text) > 24000) throw Error('Question too long.'); } body = JSON.stringify(JSON.parse(text)); }
  const res = await fetch(url, { method: body ? 'POST' : 'GET', body, headers: { authorization: 'Bearer ' + env.AGENT_OFFICE_HOOK_TOKEN, 'content-type': 'application/json' }, signal: AbortSignal.timeout(15000) });
  const result = await res.json(); if (!res.ok) throw Error(result.error || 'Office request failed'); console.log(JSON.stringify(result, null, 2));
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(e => { console.error(e.message); process.exitCode = 1; });
