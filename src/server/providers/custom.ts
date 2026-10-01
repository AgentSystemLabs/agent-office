// A custom --agent: the office runs it as it is. It reports on Claude Code's hook route when it
// speaks Claude Code's hooks, and is read like Claude Code's screen and transcript.
import { claudeBlocked } from './claude.js';
import type { ProviderAdapter } from './types.js';

export const custom: ProviderAdapter = {
  id: 'custom',
  launch: ({ args }) => ({ args }),
  hooksAs: 'claude',
  screen: { blocked: claudeBlocked },
  usage: { transcript: true },
  namesTasks: true,
};
