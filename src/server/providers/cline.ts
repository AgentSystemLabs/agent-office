// Cline runs as an interactive PTY worker. Its CLI takes the first prompt on argv and keeps the TUI
// open for later turns. A TUI resumed with --id ignores a new argv prompt, so an Office restart
// begins a new Cline session rather than silently dropping the carry-on prompt.
import { existsSync } from 'node:fs';
import path from 'node:path';
import type { ProviderAdapter } from './types.js';

const NVIDIA_MODEL = 'nvidia/nemotron-3.5-super-vl-120b-a12b';

export const cline: ProviderAdapter = {
  id: 'cline',
  launch({ prompt, cwd }) {
    // Office owns the entire invocation. Saved --agent-args can change credentials, permission
    // policy, or session selection, so this provider intentionally starts from a clean argv.
    const args = ['-i', '--auto-approve', 'false', '-P', 'nvidia', '-m', NVIDIA_MODEL, '-c', cwd];
    if (prompt) args.push('--', prompt);
    return {
      args,
      // The bundled Desktop CLI needs this file to load Cline plugins. An already configured path
      // wins, and other platforms (or installs without Desktop) keep their own runtime behavior.
      finishEnv(env) {
        if (process.platform !== 'win32' || env.CLINE_PLUGIN_BOOTSTRAP_PATH || !env.LOCALAPPDATA) return;
        const bootstrap = path.join(env.LOCALAPPDATA, 'Cline', 'bin', 'extensions', 'plugin-sandbox-bootstrap.js');
        if (existsSync(bootstrap)) env.CLINE_PLUGIN_BOOTSTRAP_PATH = bootstrap;
      },
    };
  },
  titleNoise: /^Cline$/i,
};
