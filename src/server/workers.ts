// The office's workers: see workers/ (manager.ts holds WorkerManager). Everything imported from
// here before the split still is.
export { CARRY_ON_PROMPT, MAX_REPOS, WorkerManager, type HookEnv, type OpenedPr, type RepoSource, type RunAs, type WorkerEvents } from './workers/manager.js';
export { clockWork, workedMs } from './workers/clock.js';
export { childEnv } from './workers/env.js';
export { defaultShell, resolveCommand } from './workers/process.js';
export { relatedBlock, withRelated } from './workers/pr.js';
export { workspaceNames } from './workers/worktree.js';
