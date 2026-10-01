// Grok: its hooks live in a GROK_HOME of the office's own (see ../grok.ts), so a worker never edits
// ~/.grok, and report on /hooks/grok. Its spend isn't metered by the office.
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { normalizeGrokHook, withoutGrokLaunchArgs, writeGrokHome } from '../grok.js';
import { reduceLifecycle } from '../workers/lifecycle.js';
import type { ProviderAdapter } from './types.js';

interface GrokSetup {
  home: string;
  socket: string;
  /** The person's own Grok sign-in, when there is one. */
  authPath?: string;
}

export const grok: ProviderAdapter<undefined, GrokSetup> = {
  id: 'grok',
  scrubEnv: [
    'GROK_SESSION_ID', 'GROK_AGENT_ID', 'GROK_HOOK_EVENT', 'GROK_HOOK_NAME', 'GROK_WORKSPACE_ROOT',
    'GROK_PLUGIN_ROOT', 'GROK_PLUGIN_DATA', 'GROK_AUTH', 'GROK_AUTH_PATH',
  ],
  prepare({ dataDir }) {
    const { home, socket } = writeGrokHome(dataDir);
    const userGrok = process.env.GROK_HOME || path.join(homedir(), '.grok');
    const auth = path.join(userGrok, 'auth.json');
    return { home, socket, authPath: existsSync(auth) ? auth : undefined };
  },
  launch({ h: { info }, args, prompt, resumeSessionId, setup }) {
    args = withoutGrokLaunchArgs(args);
    args.push('--no-alt-screen', '--trust', '--leader-socket', setup.socket);
    if (resumeSessionId) {
      args.push('--resume', resumeSessionId);
    } else {
      if (!info.sessionId) info.sessionId = randomUUID();
      args.push('--session-id', info.sessionId);
      if (info.model) args.push('--model', info.model);
      if (info.effort) args.push('--effort', info.effort);
    }
    if (prompt) args.push('--', prompt);
    return { args, rotateToken: true, env: { GROK_HOME: setup.home, ...(setup.authPath ? { GROK_AUTH_PATH: setup.authPath } : {}) } };
  },
  bootHint: 'Open the terminal: complete login if Grok asks',
  titleNoise: /^grok( build)?$/i,
  hook: {
    strictJson: true,
    handle(h, event, payload) {
      const report = normalizeGrokHook(event, payload);
      return !!report && reduceLifecycle(h, report);
    },
  },
};
