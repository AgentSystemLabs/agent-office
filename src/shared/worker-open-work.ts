import type { GhIssue, GhPull, QueueTask, WorkerInfo } from './protocol.js';

export interface OpenWork {
  key: string;
  label: string;
}

/** Only this worker's assignments, never all issues assigned to its human owner. */
export function workerOpenWork(worker: WorkerInfo, tasks: readonly QueueTask[], issues: readonly GhIssue[], pulls: readonly GhPull[]): OpenWork[] {
  const found = new Map<string, OpenWork>();
  const add = (key: string, label: string) => found.set(key, { key, label });
  const issue = (number: number, unknown = false) => {
    const row = issues.find((i) => i.number === number);
    if (row?.state.toUpperCase() === 'OPEN') add(`issue:${number}`, `Issue #${number}: ${row.title}`);
    else if (!row && unknown) add(`issue:${number}`, `Issue #${number}: completion not confirmed`);
  };
  for (const task of tasks) {
    if (task.workerId !== worker.id) continue;
    // A finished agent turn is not proof that its issue was closed or its PR merged.
    const unfinished = task.status !== 'done' || task.outcome !== 'done';
    if (unfinished) add(`task:${task.id}`, `Task: ${task.title}`);
    if (task.issue !== undefined) issue(task.issue, unfinished || task.pr?.state.toUpperCase() !== 'MERGED');
    if (task.pr?.state.toUpperCase() === 'OPEN') add(`pr:${task.pr.number}`, `PR #${task.pr.number}: ${task.pr.title}`);
  }
  // This is the office's explicit issue-handoff prefix, not arbitrary issue references in a prompt.
  const handed = worker.prompt?.match(/^Work on GitHub issue #(\d+)\b/i);
  if (handed) issue(Number(handed[1]));
  const owned = new Set([worker.pr?.number, ...(worker.pastPrs ?? [])]);
  for (const pull of pulls) {
    if (!owned.has(pull.number)) continue;
    if (pull.state.toUpperCase() === 'OPEN') add(`pr:${pull.number}`, `PR #${pull.number}: ${pull.title}`);
    for (const number of pull.closes) issue(number);
  }
  if (!found.size && worker.kind === 'agent' && ['starting', 'working', 'needs_input'].includes(worker.status)) {
    add('active', `Current work: ${worker.task?.name || 'agent session still in progress'}`);
  }
  return [...found.values()];
}
