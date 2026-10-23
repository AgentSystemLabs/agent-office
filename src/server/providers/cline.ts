// Cline runs as an interactive PTY worker. Its CLI takes the first prompt on argv and keeps the TUI
// open for later turns. A TUI resumed with --id ignores a new argv prompt, so an Office restart
// begins a new Cline session rather than silently dropping the carry-on prompt.
import { existsSync } from 'node:fs';
import path from 'node:path';
import { homedir } from 'node:os';
import type { ProviderAdapter } from './types.js';
import { addClineHooks, writeClineHooks } from '../cline-hooks.js';
import { reduceStatus, type StatusState } from './opencode.js';
import type { OpenCodeStatusEvent } from '../opencode.js';

const NVIDIA_MODEL = 'nvidia/nemotron-3.5-super-vl-120b-a12b';

export const cline: ProviderAdapter<StatusState, { hooks: string }> = {
  id: 'cline',
  createState: () => ({}),
  prepare: ({ dataDir }) => ({ hooks: writeClineHooks(dataDir) }),
  launch({ h, prompt, cwd, setup }) {
    addClineHooks(cwd, setup.hooks);
    h.info.sessionId = 'agent-office-' + h.info.id;
    // Office owns the entire invocation. Saved --agent-args can change credentials, permission
    // policy, or session selection, so this provider intentionally starts from a clean argv.
    const args = ['-i', '--auto-approve', 'false', '-P', 'nvidia', '-m', NVIDIA_MODEL, '-c', cwd];
    if (prompt) args.push('--', prompt);
    return {
      args,
      rotateToken: true,
      // The bundled Desktop CLI needs this file to load Cline plugins. An already configured path
      // wins, and other platforms (or installs without Desktop) keep their own runtime behavior.
      finishEnv(env) {
        // A shared hub was started outside Office and cannot inherit this worker's hook identity.
        // Keep the session in this process so per-worker native hooks receive its environment.
        env.CLINE_SESSION_BACKEND_MODE = 'local';
        // The shipped interactive UI explicitly chooses auto despite that env setting. Its native
        // sandbox flag forces a local session. Reuse the existing provider store; no key is copied.
        // This flag controls Cline state/routing and is not an OS security boundary.
        env.CLINE_SANDBOX = '1';
        env.CLINE_SANDBOX_DATA_DIR = env.CLINE_DATA_DIR || env.CLINE_SANDBOX_DATA_DIR
          || path.join(env.USERPROFILE || env.HOME || homedir(), '.cline', 'data');
        if (process.platform !== 'win32' || env.CLINE_PLUGIN_BOOTSTRAP_PATH || !env.LOCALAPPDATA) return;
        const bootstrap = path.join(env.LOCALAPPDATA, 'Cline', 'bin', 'extensions', 'plugin-sandbox-bootstrap.js');
        if (existsSync(bootstrap)) env.CLINE_PLUGIN_BOOTSTRAP_PATH = bootstrap;
      },
    };
  },
  hook: {
    strictJson: true,
    handle(h, _event, value) {
      if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
      const p = value as Record<string, unknown>;
      if (p.sessionId !== 'agent-office-' + h.info.id
        || !['session', 'prompt', 'tool', 'permission', 'error'].includes(String(p.type))
        || !['working', 'needs_input', 'done'].includes(String(p.status))
        || (p.tool !== undefined && (typeof p.tool !== 'string' || p.tool.length > 120))) return false;
      return reduceStatus(h, p as unknown as OpenCodeStatusEvent);
    },
  },
  titleNoise: /^Cline$/i,
};
