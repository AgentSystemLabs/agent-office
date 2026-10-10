import type { WorkerInfo } from '../../shared/protocol.js';
import { DESK_BY_ID } from '../../shared/layout.js';

/** Carry the actual hiring choice into app-delivered prompts, including queue and resume. */
export function workspacePrompt(info: WorkerInfo, cwd: string, prompt: string | undefined): string | undefined {
  if (!prompt?.trim() || prompt.trimStart().startsWith('/') || info.kind !== 'agent' || DESK_BY_ID.get(info.deskId)?.station) return prompt;
  const location = JSON.stringify(cwd);
  const policy = info.meeting
    ? `Use the meeting workspace at ${location}. Coordinate overlapping files with the other participants; do not create a private checkout.`
    : info.worktree
      ? `The user selected "Work in its own git worktree & branch". Use the existing assigned workspace at ${location}, branch ${JSON.stringify(info.worktree.branch)}. Keep the task in that workspace; do not create an additional worktree or switch the shared project checkout. Preserve previous work before publishing task changes.`
      : `The user left "Work in its own git worktree & branch" unchecked. Use the shared project checkout at ${location} on its current branch, unless the task explicitly names another existing shared checkout. Do not create or switch to a private branch or worktree. Other workers may work here concurrently: coordinate overlapping files and Git index/commit operations, stage only your changes, and never stash, reset or commit another worker's changes. Independent work may proceed in parallel. Publish PRs through the PR coordinator without switching this shared checkout.`;
  return `${prompt}\n\n[Office workspace selection]\n${policy}\nPreserve already-started work in other folders; do not discard or migrate it automatically. Apply this selection to new work. This saved workspace selection takes precedence over generic branch/worktree boilerplate in task templates. It does not change Workers at once or authorize new tasks.`;
}
