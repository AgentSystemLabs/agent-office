import type { GhPull, QueueTask } from '../shared/protocol.js';

/** Delivery is task-specific evidence, never merely the end of an agent's turn. */
export function delivered(task: QueueTask): boolean {
  if (task.confirmedBy) return true;
  const pr = task.pr;
  return !!pr && (pr.state === 'OPEN' || pr.state === 'MERGED') &&
    pr.coversTask === true &&
    (pr.state === 'MERGED' || pr.checks === 'pass' || pr.checks === 'none');
}

export function deliveryPull(task: QueueTask, pull: GhPull): boolean {
  const since = Math.floor((task.startedAt ?? task.addedAt) / 1000) * 1000;
  // Reused/shared workers must not inherit an earlier task's PR, even on the same branch.
  if (Date.parse(pull.createdAt) < since) return false;
  return task.issue !== undefined ? pull.closes.includes(task.issue) : !!task.branch && pull.headRefName === task.branch;
}

export function needsAttention(task: QueueTask, reason: string) {
  task.status = 'waiting';
  task.waitingReason = reason;
  delete task.finishedAt;
  if (task.outcome === 'done') delete task.outcome;
}

export function undeliveredReason(task: QueueTask): string {
  if (!task.pr) return 'Turn ended without a delivered result. Review the terminal or continue the task.';
  if (task.pr.state === 'DRAFT') return 'The PR is still a draft.';
  if (task.pr.state === 'CLOSED') return 'The PR was closed without merging.';
  if (!task.pr.coversTask) return 'The PR only covers partial, old or different work; this task is not completed.';
  return 'The PR checks are pending or failing.';
}
