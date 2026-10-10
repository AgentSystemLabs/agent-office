#!/usr/bin/env node
// Human test handoffs, deliberately separate from office-queue.
const usage = 'office-playtests list | office-playtests add (JSON on stdin: title, steps, expected, category, source)';
async function main() {
  const cmd = process.argv[2];
  if (!cmd || cmd === '--help') { console.log(usage); return; }
  if (!['list', 'add'].includes(cmd) || process.argv.length > 3) throw new Error(usage);
  const { AGENT_OFFICE_HOOK_URL: base, AGENT_OFFICE_WORKER_ID: worker, AGENT_OFFICE_HOOK_TOKEN: token } = process.env;
  if (!base || !worker || !token) throw new Error('Run this from an existing Office worker terminal');
  const url = new URL('/office/playtests', base); url.searchParams.set('worker', worker);
  const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
  let body;
  if (cmd === 'add') {
    let input = '';
    for await (const chunk of process.stdin) { input += chunk; if (input.length > 24000) throw new Error('Test too large'); }
    body = JSON.stringify({ action: 'add', test: JSON.parse(input.replace(/^\uFEFF/, '')) });
  }
  const r = await fetch(url, { method: cmd === 'list' ? 'GET' : 'POST', headers, body, signal: AbortSignal.timeout(15000) });
  const result = await r.json();
  if (!r.ok) throw new Error(result.error ?? `Office returned ${r.status}`);
  console.log(JSON.stringify(result, null, 2));
}
main().catch(e => { console.error(e.message); process.exitCode = 1; });
