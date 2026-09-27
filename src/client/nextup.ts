// The workers waiting on you on this floor, longest first: N takes you to each in turn (see main.ts),
// arrows at the edge of the screen point to them (ui/compass.ts), and the top bar and the Workers panel count them.

import type { WorkerInfo } from '../shared/protocol';
import { waitingOnSomeone } from './notify';

type Waiting = WorkerInfo & { status: 'needs_input' | 'done' };

/** Since when it's been waiting (an office from before waitingSince had only the hire time). */
function since(w: WorkerInfo): number {
  return w.waitingSince ?? w.createdAt;
}

/** Workers waiting on someone, whoever has waited longest first. */
export function waitingInOrder(workers: Iterable<WorkerInfo>): Waiting[] {
  return [...workers].filter(waitingOnSomeone).sort((a, b) => since(a) - since(b) || a.createdAt - b.createdAt || a.id.localeCompare(b.id));
}

/** "2 waiting · 1 done": the ones that need input, then the ones that finished. */
export function waitingLabel(waiting: readonly WorkerInfo[]): string {
  const needs = waiting.filter((w) => w.status === 'needs_input').length;
  const done = waiting.length - needs;
  return [needs && `🙋 ${needs} waiting`, done && `✅ ${done} done`].filter(Boolean).join(' · ');
}

/**
 * One press of N after another: the longest-waiting worker you haven't been to yet this round, and
 * once you've been to them all, the longest-waiting again. A worker that starts waiting again after
 * you've been to it is new to this round.
 */
export class NextUp {
  /** Who this round has been to, and the wait each was on then. */
  private visited = new Map<string, number>();

  /** The one to go to next. `here` is the worker you're standing at, which only comes up if it's the only one. */
  next(workers: Iterable<WorkerInfo>, here?: string): Waiting | undefined {
    const waiting = waitingInOrder(workers);
    for (const [id, at] of this.visited) if (!waiting.some((w) => w.id === id && since(w) === at)) this.visited.delete(id);
    const others = waiting.filter((w) => w.id !== here);
    let pick = others.find((w) => !this.visited.has(w.id));
    if (!pick) {
      this.visited.clear();
      pick = others[0] ?? waiting[0];
    }
    if (pick) this.visited.set(pick.id, since(pick));
    return pick;
  }
}
