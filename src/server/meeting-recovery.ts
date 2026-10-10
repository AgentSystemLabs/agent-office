import type { Meeting, MeetingTurn, WorkerInfo } from '../shared/protocol.js';

/** Recover only this meeting's existing seats and files. Never hire replacements or discard notes. */
export function recoverMeeting(m: Meeting | null, workers: WorkerInfo[], written: (t: MeetingTurn) => boolean): string | undefined {
  if (!m || m.status !== 'stopped' || m.cleared) return 'There is no stopped meeting to continue';
  if (!m.turns.length) return 'This meeting has no round to continue';
  for (const seat of m.seats) {
    const worker = workers.find(w => w.id === seat.workerId && w.meeting === m.id);
    if (!worker) return `${seat.role} is no longer at the table. The saved notes remain available; call a new meeting.`;
  }
  for (const seat of m.seats) {
    const worker = workers.find(w => w.id === seat.workerId)!;
    if (worker.lost) return `${worker.name}'s worktree is missing. Restore it before continuing.`;
    if (worker.status !== 'idle' && worker.status !== 'done') return `Open ${worker.name}'s terminal first and wait until it is ready. The meeting remains stopped.`;
  }
  for (const turn of m.turns) {
    turn.state = written(turn) ? 'done' : 'waiting';
    delete turn.retried;
    if (turn.state === 'waiting') delete turn.sentAt;
  }
  m.status = 'running';
  delete m.reason; delete m.finishedAt;
}
