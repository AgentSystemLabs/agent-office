import type { Meeting, WorkerStatus, WorkerTask } from '../../../shared/protocol';
import { MEETING_PATTERNS } from '../../../shared/meetings';

export interface MeetingTask extends WorkerTask { meetingStatus: 'stopped' | 'done'; }
export function endedMeetingTask(m: Meeting, role: string, status: WorkerStatus): MeetingTask {
  const p = MEETING_PATTERNS[m.pattern];
  const terminal = status === 'working' ? 'Terminal still active; the meeting is not advancing.' : status === 'offline' || status === 'exited' ? 'Terminal asleep.' : status === 'needs_input' ? 'Terminal waiting for input.' : 'Terminal ready.';
  return { meetingStatus: m.status === 'done' ? 'done' : 'stopped', name: `${role} · ${p.icon} ${p.label}`,
    summary: `${m.status === 'done' ? `Wrote ${m.output}.` : `${m.reason ?? 'Stopped'}. Continue in Meeting room.`} ${terminal}` };
}
export function meetingTaskStatus(task: WorkerTask | undefined): MeetingTask['meetingStatus'] | undefined {
  const status = (task as Partial<MeetingTask> | undefined)?.meetingStatus;
  return status === 'stopped' || status === 'done' ? status : undefined;
}
