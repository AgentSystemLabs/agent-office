import type { QueueTask, WorkerInfo } from '../shared/protocol.js';

// Capture an explicit start instruction, never infer ownership from an AI summary or a PR number.
const requested = new WeakMap<WorkerInfo, number>();
export function requestQueueIssue(worker: WorkerInfo, issue: number) { requested.set(worker, issue); }
export function noteQueueAssignment(worker: WorkerInfo, prompt: string) {
  requested.delete(worker);
  const match = /^(?:(?:please|bitte)\s+)?(?:start|starte|bearbeite|work on|continue|resume)\s+(?:(?:the|das|den)\s+)?(?:issue|task|aufgabe)\s*#?\s*(\d+)\s*[.!]?$/i.exec(prompt.trim());
  if (match) requested.set(worker, Number(match[1]));
}

/** Only adopt work already selected by the user, on the same account, without displacing another task. */
export function queuedAssignment(tasks: QueueTask[], worker: WorkerInfo, owner: string | undefined, issue = requested.get(worker)): QueueTask | undefined {
  if (!issue || worker.kind !== 'agent' || worker.meeting || worker.lost || worker.deskId.startsWith('station-')) return;
  if (!['working', 'testing', 'waiting', 'needs_input'].includes(worker.status)) return;
  if (tasks.some(t => t.workerId === worker.id && (t.status === 'running' || t.status === 'waiting'))) return;
  const matches = tasks.filter(t => t.issue === issue && t.status === 'queued' && t.owner === owner);
  return matches.length === 1 ? matches[0] : undefined;
}
