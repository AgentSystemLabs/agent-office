// The office's workers: see workers/ (manager.ts holds WorkerManager). Everything imported from
// here before the split still is.
export { MAX_REPOS, WorkerManager } from './workers/manager.js';
export { CARRY_ON_PROMPT } from './workers/tasks.js';
export type { HookEnv, OpenedPr, RepoSource, RunAs, WorkerEvents } from './workers/types.js';
export { clockWork, workedMs } from './workers/clock.js';
export { childEnv } from './workers/env.js';
export { defaultShell, resolveCommand } from './workers/process.js';
export { relatedBlock, withRelated } from './workers/pr.js';
export { workspaceNames } from './workers/worktree.js';
