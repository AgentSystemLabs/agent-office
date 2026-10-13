// LokiDewa Council: a Hermes Agent worker. Hermes is installed on the office machine
// (hermes-agent, or the venv at ~/.hermes/hermes-agent); a worker is one
// `hermes chat` session whose ID the office keeps, so a model swap mid-council is a
// re-launch against the same session — the briefcase, not the brain, is what persists.
import type { ProviderAdapter } from './types.js';

/** A Hermes session's ID, kept by the office and resumed on re-launch. */
export interface HermesState {
  sessionId?: string;
}

export const hermes: ProviderAdapter<HermesState> = {
  id: 'hermes',
  // Hermes sets these on its own children; a worker never inherits them.
  scrubEnv: ['HERMES_SESSION', 'HERMES_WORKTREE'],
  scrubPrefixes: ['HERMES_'],
  createState: () => ({}),

  // `hermes chat` flags: -m picks the model, -q seeds the first turn, --resume continues a
  // session, --pass-session-id prints the id the office keeps, --cli stays headless in the PTY.
  // A reasoning effort goes in as Hermes's own --reasoning level, when one was picked.
  launch: ({ args, prompt, resumeSessionId, cwd, h }) => {
    const plan: LaunchPlan = { args: [...args] };
    if (h.info.model) plan.args.push('-m', h.info.model);
    if (h.info.effort) plan.args.push('--reasoning', h.info.effort);
    plan.args.push('--cli', '--pass-session-id', '--in', cwd);
    if (resumeSessionId) plan.args.push('--resume', resumeSessionId);
    if (prompt) plan.args.push('-q', prompt);
    return plan;
  },

  transport: 'pty',
  bootHint: 'Booting Hermes — waiting for its first tool call',
  titleNoise: /^hermes( chat)?$/i,
  // A session that has been pruned or imported can't be resumed: start fresh.
  freshIfResumeFails: true,

  // Hermes speaks Claude Code's hook route when configured to; the office reads its
  // transcript for usage either way.
  hooksAs: 'claude',
  usage: { transcript: true },
  namesTasks: true,
};

type LaunchPlan = import('./types.js').LaunchPlan;
