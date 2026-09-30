// Muse Code: its settings and hooks live in XDG dirs of the office's own (see ../muse.ts), so a
// worker never edits ~/.config/muse, and report on /hooks/muse. Its spend isn't metered by the office.
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { normalizeMuseHook, withoutMuseLaunchArgs, writeMuseHome, type MuseHome } from '../muse.js';
import { reduceLifecycle } from '../workers/lifecycle.js';
import type { ProviderAdapter } from './types.js';

export const muse: ProviderAdapter<undefined, MuseHome> = {
  id: 'muse',
  scrubEnv: ['MUSE_BIN', 'MUSE_AGENTS_THREAD', 'MUSE_AGENTS_ROLE', 'MUSE_PROJECTS_HOME'],
  prepare({ dataDir }) {
    const userMuse = path.join(process.env.XDG_CONFIG_HOME || path.join(homedir(), '.config'), 'muse');
    return writeMuseHome(dataDir, existsSync(userMuse) ? userMuse : undefined);
  },
  launch({ h, args, prompt, resumeSessionId, setup }) {
    const { info } = h;
    args = withoutMuseLaunchArgs(args);
    args.push('--trust-workspace');
    if (resumeSessionId) {
      args.push('resume', resumeSessionId);
      // Muse resume cannot take a prompt on argv: it's pasted into the TUI after SessionStart.
      h.pendingPrompt = prompt;
    } else {
      if (info.model) args.push('--model', info.model);
      if (info.effort) args.push('--reasoning-effort', info.effort);
      if (prompt) args.push('--', prompt);
    }
    return { args, rotateToken: true, env: { XDG_CONFIG_HOME: setup.configHome, XDG_DATA_HOME: setup.dataHome, XDG_STATE_HOME: setup.stateHome } };
  },
  bootHint: 'Open the terminal: complete login if Muse asks',
  titleNoise: /^muse( code)?$/i,
  hook: {
    strictJson: true,
    handle(h, event, payload) {
      const report = normalizeMuseHook(event, payload);
      return !!report && reduceLifecycle(h, report);
    },
  },
};
