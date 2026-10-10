import { readFileSync } from 'node:fs';
import path from 'node:path';

const explicit = /^(?:--(?:sandbox|ask-for-approval|dangerously-bypass-approvals-and-sandbox|yolo|approve-for-me|full-auto|permissions|permission-profile)(?:=|$)|-[sa])/;
const configPermission = /^(?:approval_policy|sandbox_mode|permissions)(?:\.|\s*=)/;

/** Per-floor, owner-controlled opt-in; never changes the user's global Codex configuration. */
export function codexPermissionArgs(args: string[], dataDir: string): string[] {
  let raw: string;
  try { raw = readFileSync(path.join(dataDir, 'codex-permissions.json'), 'utf8'); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return args; throw error; }
  let config: { mode?: unknown };
  try { config = JSON.parse(raw.replace(/^\uFEFF/, '')); }
  catch { throw new Error('Invalid .agent-office/codex-permissions.json; expected {"mode":"native"} or {"mode":"full-access"}.'); }
  if (!config || typeof config.mode !== 'string' || !['native', 'full-access'].includes(config.mode)) throw new Error('Invalid Codex permission mode; use native or full-access.');
  if (config.mode === 'native') return args;
  // An explicit invocation wins; avoid conflicting options and never weaken an explicit sandbox.
  if (args.some((arg, i) => explicit.test(arg) ||
    ((arg === '-c' || arg === '--config') && configPermission.test(args[i + 1] ?? '')) ||
    ((arg.startsWith('--config=') || arg.startsWith('-c=')) && configPermission.test(arg.slice(arg.indexOf('=') + 1))) ||
    (arg.startsWith('-c') && configPermission.test(arg.slice(2))))) return args;
  return [...args, '--dangerously-bypass-approvals-and-sandbox'];
}
