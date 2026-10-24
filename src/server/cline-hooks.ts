import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { excludeFromGit } from './config.js';

export const CLINE_EVENTS = ['TaskStart', 'TaskResume', 'TaskCancel', 'TaskComplete', 'TaskError', 'PreToolUse', 'PostToolUse', 'UserPromptSubmit'] as const;

// Observation only: returning {} leaves native permissions and tool inputs unchanged.
export const CLINE_HOOK_SOURCE = String.raw`let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => { if (input.length <= 1048576) input += chunk; });
process.stdin.on('end', async () => {
  try {
    if (input.length > 1048576) return;
    const report = JSON.parse(input);
    if (report.parent_agent_id) return;
    const states = { agent_start: ['prompt', 'working'], agent_resume: ['prompt', 'working'],
      prompt_submit: ['prompt', 'working'], tool_call: ['permission', 'needs_input'], tool_result: ['tool', 'working'],
      agent_end: ['session', 'done'], agent_abort: ['error', 'needs_input'], agent_error: ['error', 'needs_input'] };
    const state = states[report.hookName];
    const worker = process.env.AGENT_OFFICE_WORKER_ID;
    const token = process.env.AGENT_OFFICE_HOOK_TOKEN;
    const base = process.env.AGENT_OFFICE_HOOK_URL;
    if (!state || !/^[a-f0-9]{12}$/.test(worker || '') || !/^[a-f0-9]{32}$/.test(token || '') || !base) return;
    const url = new URL('/hooks/cline', base);
    if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1') return;
    url.searchParams.set('worker', worker);
    const payload = { type: state[0], status: state[1], sessionId: 'agent-office-' + worker };
    const tool = report.preToolUse?.toolName || report.postToolUse?.toolName || report.tool_call?.name || report.tool_result?.name;
    if (typeof tool === 'string') payload.tool = tool.replace(/[\x00-\x1f\x7f-\x9f]/g, '').slice(0,120);
    await fetch(url, { method: 'POST', headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' },
      body: JSON.stringify(payload), redirect: 'error', signal: AbortSignal.timeout(2500) });
  } catch { /* No raw payload or credentials in errors. */ }
  finally { process.stdout.write('{}\n'); }
});
`;

export function writeClineHooks(dataDir: string): string {
  const dir = path.join(dataDir, 'cline-hooks');
  mkdirSync(dir, { recursive: true });
  for (const event of CLINE_EVENTS) writeFileSync(path.join(dir, event + '.cjs'), CLINE_HOOK_SOURCE, { mode: 0o600 });
  return dir;
}

/** Shipped CLI versions ignore --hooks-dir. Use native project discovery without replacing hooks. */
export function addClineHooks(cwd: string, source: string): void {
  const dir = path.join(cwd, '.cline', 'hooks');
  const root = realpathSync(cwd);
  for (const relative of ['.cline', '.cline/hooks', ...CLINE_EVENTS.map(event => '.cline/hooks/' + event + '.cjs')]) {
    const file = path.join(cwd, relative);
    if (!existsSync(file)) continue;
    const within = path.relative(root, realpathSync(file));
    if (lstatSync(file).isSymbolicLink() || within.startsWith('..') || path.isAbsolute(within)) throw new Error('Office will not write Cline hooks through linked project paths.');
  }
  const wrapper = (event: string) => '// Agent Office managed lifecycle hook\nrequire(' + JSON.stringify(path.join(source, event + '.cjs')) + ');\n';
  if (existsSync(dir)) {
    for (const file of readdirSync(dir)) {
      const event = CLINE_EVENTS.find(e => e.toLowerCase() === path.parse(file).name.toLowerCase());
      if (!event) continue;
      if (file !== event + '.cjs' || readFileSync(path.join(dir, file), 'utf8') !== wrapper(event)) throw new Error('Office will not replace an existing project Cline lifecycle hook.');
    }
  }
  mkdirSync(dir, { recursive: true });
  for (const event of CLINE_EVENTS) {
    writeFileSync(path.join(dir, event + '.cjs'), wrapper(event));
    excludeFromGit(cwd, '/.cline/hooks/' + event + '.cjs');
  }
}
