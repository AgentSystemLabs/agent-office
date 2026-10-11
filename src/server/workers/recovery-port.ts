import type { WorkerContext } from './types.js';
import { holdTesting, recoveryBlocked, testingActive, testingStopped } from './testing.js';
import type { WorkerInfo } from '../../shared/protocol.js';
const reports = new WeakMap<WorkerInfo, { activity?: string; summary?: string; reason: string }>();

/** A narrow scheduler port: never type over a question, human input, a meeting or a dead terminal. */
export function recoveryStatus(ctx: WorkerContext, id: string, reason?: string): boolean {
  const w = ctx.workers.get(id);
  if (!w || ctx.closing || (!w.pty && !w.dsh) || w.viewers.size || w.bootBlocked ||
    w.info.meeting || w.info.lost || recoveryBlocked(w.info) || !['done', 'idle', 'waiting', 'testing'].includes(w.info.status)) return false;
  if (testingActive(w.info) && !testingStopped(w.info)) return false;
  holdTesting(w.info, reason);
  if (reason) {
    const saved = reports.get(w.info);
    reports.set(w.info, { activity: saved?.activity ?? w.info.activity, summary: saved?.summary ?? w.info.task?.summary, reason });
    w.info.activity = reason;
    if (w.info.task) w.info.task = { ...w.info.task, summary: reason };
  } else {
    const saved = reports.get(w.info);
    if (saved && w.info.activity === saved.reason) w.info.activity = saved.activity;
    if (saved && w.info.task?.summary === saved.reason) w.info.task = { ...w.info.task, summary: saved.summary ?? '' };
    reports.delete(w.info);
  }
  ctx.setStatus(w, reason ? 'waiting' : 'done');
  ctx.emit(w);
  return true;
}
