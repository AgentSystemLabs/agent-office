import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { excludeFromGit } from './config.js';

export const GOOSE_OFFICE_PLUGIN = 'agent-office-status';
export const GOOSE_EVENTS = ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'PostToolUseFailure', 'Stop'] as const;

// Native lifecycle events, not model-controlled terminal text, advance Office workflows.
export const GOOSE_HOOK_SOURCE = String.raw`const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => { if (input.length < 1048576) input += chunk; });
process.stdin.on('end', async () => {
  try {
    if (input.length > 1048576) return;
    const report = JSON.parse(input);
    const worker = process.env.AGENT_OFFICE_WORKER_ID;
    const token = process.env.AGENT_OFFICE_HOOK_TOKEN;
    const base = process.env.AGENT_OFFICE_HOOK_URL;
    if (!/^[a-f0-9]{12}$/.test(worker || '') || !/^[a-f0-9]{32}$/.test(token || '') || !base) return;
    const url = new URL('/hooks/goose', base);
    if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1') return;
    const states = { SessionStart: ['session', 'starting'], UserPromptSubmit: ['prompt', 'working'],
      PreToolUse: ['tool', 'working'], PostToolUse: ['tool', 'working'], PostToolUseFailure: ['tool', 'working'], Stop: ['session', 'done'] };
    const state = states[report.event];
    if (!state) return;
    if (typeof report.session_id !== 'string' || !report.session_id || report.session_id.length > 512) return;
    // Child Goose sessions can inherit Office env and project plugins. Only the first native
    // SessionStart for this worker token owns its lifecycle; a child Stop cannot complete its parent.
    const binding = path.join(__dirname, '.goose-root-' + worker + '-' + createHash('sha256').update(token).digest('hex').slice(0,32));
    if (report.event === 'SessionStart') {
      try { fs.writeFileSync(binding, report.session_id, { flag: 'wx', mode: 0o600 }); }
      catch (error) { if (error.code !== 'EEXIST') return; }
    }
    if (fs.readFileSync(binding, 'utf8') !== report.session_id) return;
    if (report.event === 'SessionStart' && process.env.AGENT_OFFICE_INITIAL_PROMPT === '1') {
      state[0] = 'prompt'; state[1] = 'working';
    }
    const payload = { type: state[0], status: state[1], sessionId: 'agent-office-' + worker };
    if (state[0] === 'tool' && typeof report.tool_name === 'string') payload.tool = report.tool_name.replace(/[\x00-\x1f\x7f-\x9f]/g, '').slice(0, 120);
    url.searchParams.set('worker', worker);
    await fetch(url, { method: 'POST', headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' },
      body: JSON.stringify(payload), redirect: 'error', signal: AbortSignal.timeout(2500) });
  } catch { /* Reporting must never change native tool approval or expose a payload. */ }
});
`;

export function writeGooseHook(dataDir: string): string {
  mkdirSync(dataDir, { recursive: true });
  const file = path.join(dataDir, 'agent-office-goose-hook.cjs');
  writeFileSync(file, GOOSE_HOOK_SOURCE, { mode: 0o600 });
  return file;
}

/** Same project-scoped discovery Goose itself supports; never replace a user's plugin. */
export function addGooseHooks(cwd: string, hook: string): void {
  const dir = path.join(cwd, '.agents', 'plugins', GOOSE_OFFICE_PLUGIN);
  const manifest = path.join(dir, 'plugin.json');
  const root = realpathSync(cwd);
  for (const relative of ['.agents', '.agents/plugins', `.agents/plugins/${GOOSE_OFFICE_PLUGIN}`,
    `.agents/plugins/${GOOSE_OFFICE_PLUGIN}/plugin.json`, `.agents/plugins/${GOOSE_OFFICE_PLUGIN}/hooks`,
    `.agents/plugins/${GOOSE_OFFICE_PLUGIN}/hooks/hooks.json`]) {
    const candidate = path.join(cwd, relative);
    if (!existsSync(candidate)) continue;
    const actual = realpathSync(candidate);
    const within = path.relative(root, actual);
    if (lstatSync(candidate).isSymbolicLink() || within.startsWith('..') || path.isAbsolute(within)) {
      throw new Error('Office will not write a Goose plugin through linked project paths.');
    }
  }
  if (existsSync(dir)) {
    let owned = false;
    try { owned = JSON.parse(readFileSync(manifest, 'utf8')).agentOfficeManaged === true; } catch { /* fail closed below */ }
    if (!owned) throw new Error('The project already has an agent-office-status plugin that Office does not own.');
  }
  mkdirSync(path.join(dir, 'hooks'), { recursive: true });
  const quote = (value: string) => `'${value.replaceAll('\\', '/').replaceAll("'", "'\"'\"'")}'`;
  const command = `${quote(process.execPath)} ${quote(hook)}`;
  writeFileSync(manifest, JSON.stringify({ name: GOOSE_OFFICE_PLUGIN, version: '1.0.0', description: 'Agent Office lifecycle reporting', agentOfficeManaged: true }, null, 2));
  writeFileSync(path.join(dir, 'hooks', 'hooks.json'), JSON.stringify({ hooks: Object.fromEntries(GOOSE_EVENTS.map(event => [event, [{ hooks: [{ type: 'command', command, timeout: 5 }] }]])) }, null, 2));
  excludeFromGit(cwd, `/.agents/plugins/${GOOSE_OFFICE_PLUGIN}/`);
}
