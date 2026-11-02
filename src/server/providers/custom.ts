// A custom --agent: the office runs it as it is. It reports on Claude Code's hook route when it
// speaks Claude Code's hooks, and is read like Claude Code's screen and transcript.
import { claudeBlocked } from './claude.js';
import type { ProviderAdapter } from './types.js';

export const custom: ProviderAdapter = {
  id: 'custom',
  launch: ({ args, prompt, resumeSessionId }) => {
    // A custom agent is hired with a task, so it has to be given one. The
    // office's own default agent never had this problem: every provider but
    // `custom` put its own CLI's prompt flag in `launch`, and a custom one is
    // run untouched, so its task was silently dropped.
    //
    // A custom agent that knows about sessions resumes them. Ahead of `--`,
    // which ends the options and would swallow anything after it as prompt text.
    if (resumeSessionId) args.push('--resume', resumeSessionId);
    if (prompt) args.push('--', prompt);
    return { args };
  },
  hooksAs: 'claude',
  screen: { blocked: claudeBlocked },
  usage: { transcript: true },
  namesTasks: true,
};
