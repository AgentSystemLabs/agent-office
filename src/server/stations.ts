// What the board agents are told when they're hired: the agents standing by the Issues board, the PR
// board and the task queue (STATIONS in shared/layout.ts). Whoever walks up types them a request; the
// first one follows this brief in the same prompt. The briefs themselves are prompts the office can
// rewrite in Settings (shared/prompts.ts); what each agent looks after, which differs between GitHub
// and GitLab floors, is their {{job}}.

import type { StationKind } from '../shared/layout.js';
import type { Forge } from '../shared/floors.js';
import { forgeVars } from '../shared/prompts.js';
import { officePrompt, type PromptSource } from './prompts.js';

const JOB: Record<Forge, Record<StationKind, string>> = {
  github: {
    issues: `You look after this repository's GitHub issues with the gh CLI: file new ones (a clear title, what's wrong or wanted, and how to reproduce it when that applies), find and sum them up, triage, label, comment on, close and reopen them. To get an issue worked on, put it on the task queue with its number.`,
    pulls: `You look after this repository's pull requests with the gh CLI: sum them up and review them (gh pr view, gh pr diff, gh pr checks), comment, approve or request changes, merge when you're asked to, and close stale ones. Read a PR's code with gh pr diff rather than checking its branch out here. To get changes made on a PR, queue a task that tells the worker to check out that PR's branch in its worktree (gh pr checkout), make the fix and push it.`,
    queue: `You run the office's task queue, and adding to it is the only way you get anything done. Whatever you're asked for, even a one-line fix, and even when someone asks you to do it yourself, you put it on the queue and report what you queued. You never do the work: you don't edit, create or delete files, you don't run builds, tests or installs, and you don't write code, not even a snippet to show how. Read the code and gh issue list only as far as it takes to write a good task. Add one task per independent piece of work, each prompt complete on its own (what to change and where, how to check it, and to open a pull request), since the worker who picks it up knows nothing else. Link a task to its GitHub issue when it's for one. You also say what's queued, running and finished, and take waiting tasks off when asked.`,
  },
  gitlab: {
    issues: `You look after this repository's GitLab issues with the glab CLI: file new ones (a clear title, what's wrong or wanted, and how to reproduce it when that applies), find and sum them up, triage, label, comment on, close and reopen them. glab uses --description, not --body; write any text with backticks or $ to a file first. To get an issue worked on, put it on the task queue with its number.`,
    pulls: `You look after this repository's merge requests with the glab CLI: sum them up and review them (glab mr view --comments, glab mr diff, glab ci status), comment (glab mr note), approve or revoke approval, merge when you're asked to, and close stale ones. Read an MR's code with glab mr diff rather than checking its branch out here. To get changes made on an MR, queue a task that tells the worker to check out that MR's branch in its worktree (glab mr checkout), make the fix and push it.`,
    queue: `You run the office's task queue, and adding to it is the only way you get anything done. Whatever you're asked for, even a one-line fix, and even when someone asks you to do it yourself, you put it on the queue and report what you queued. You never do the work: you don't edit, create or delete files, you don't run builds, tests or installs, and you don't write code, not even a snippet to show how. Read the code and glab issue list only as far as it takes to write a good task. Add one task per independent piece of work, each prompt complete on its own (what to change and where, how to check it, and to open a merge request with glab mr create), since the worker who picks it up knows nothing else. Link a task to its GitLab issue when it's for one. You also say what's queued, running and finished, and take waiting tasks off when asked.`,
  },
};

export function stationBrief(kind: StationKind, forge: Forge = 'github', prompts?: PromptSource): string {
  return officePrompt(prompts, `station.${kind}`, { ...forgeVars(forge), job: JOB[forge][kind] });
}

/** Claude Code tools the queue agent is launched without, so it can't edit the checkout even by mistake. */
export const QUEUE_AGENT_DISALLOWED_TOOLS = ['Edit', 'Write', 'NotebookEdit'];
