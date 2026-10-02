import type { GhIssue, QueueTask } from '../../../shared/protocol';

/**
 * Whether someone has started on an open issue: a worker just took it (before GitHub lists its
 * assignee), it's assigned, it has an in-progress label, or its queue task (`task`) is running. The
 * issues window puts these under In progress, and the cork board on the wall leaves them off: it
 * holds the ones still waiting to be taken.
 */
export function inProgress(issue: GhIssue, task: QueueTask | undefined): boolean {
  return !!issue.taken || issue.assignees.length > 0 || issue.labels.some((l) => /progress|doing|wip|started/i.test(l.name)) || task?.status === 'running';
}
