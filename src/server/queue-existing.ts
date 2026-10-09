import { SEATS } from '../shared/layout.js';
import type { QueueTask, WorkerInfo } from '../shared/protocol.js';
import type { QueueWorkers } from './queue.js';

/** Reuse only ordinary, manually hired seats belonging to the task's account. */
export function existingWorker(workers: QueueWorkers, tasks: QueueTask[], task: QueueTask): WorkerInfo | undefined {
  if (!workers.prompt || !workers.ownerOf) return undefined;
  return workers.list().find((w) =>
    w.kind === 'agent' && SEATS.some((s) => s.id === w.deskId) &&
    !w.meeting && !w.lost && !w.prOpening && !w.createdBy.endsWith(' (queue)') &&
    (w.status === 'idle' || w.status === 'done') && w.viewers.length === 0 &&
    workers.ownerOf!(w.id) === task.owner &&
    !tasks.some((t) => t.status === 'running' && t.workerId === w.id));
}

export function existingPrompt(task: QueueTask): string {
  return `${task.prompt}\n\nThis is a new queue task in your existing session and workspace. Preserve all previous work and local changes. For a separate code change, start a fresh branch/worktree from the current remote base; do not append it to an earlier task's PR or merged branch. If you cannot safely proceed, ask for help.`;
}
