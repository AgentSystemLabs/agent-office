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
  return `${task.prompt}\n\nContinue this queue task in your existing session and workspace. Preserve previous work and local changes. Follow the user's explicit branch/worktree policy; reusing a worker does not authorize creating another branch or worktree. In a shared checkout, serialize edits and keep each task's changes separate from unrelated local edits. A completed response or background launcher is not proof that the task or its tests finished: verify results and deliver the requested artifact, or identify the concrete remaining blocker.`;
}
