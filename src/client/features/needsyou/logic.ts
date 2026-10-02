/**
 * What "a worker needs you" works out with nothing to draw: who just started asking, what the banner
 * says about them, and when to ring again. No three.js and no page here, so the tests run it as it is.
 */
import type { WorkerInfo, WorkerStatus } from '../../../shared/protocol';
import { alertDetail } from '../../../shared/status';

/** How long between reminders while a worker's still waiting on an answer nobody's looking at (ms). */
export const REMIND_EVERY = 30_000;

/** One wait of a worker's: asking something else later is another one. */
export const waitKey = (w: WorkerInfo) => `${w.id}@${w.waitingSince ?? w.createdAt}`;

/** Nobody has its terminal open, so nobody's answering it. */
export const unattended = (w: WorkerInfo) => w.viewers.length === 0;

/** How long it has waited, for the banner: nothing for the first minute, then "4 min", "1 h 05 min". */
export function waited(since: number | undefined, now: number): string {
  const min = since === undefined ? 0 : Math.floor((now - since) / 60_000);
  if (min < 1) return '';
  return min < 60 ? `${min} min` : `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, '0')} min`;
}

export interface BannerText {
  /** The worker it takes you to: whoever has waited longest. */
  id: string;
  title: string;
  /** What it's asking, and for how long. */
  detail: string;
  /** How many more are asking, or ''. */
  more: string;
  /** Changes whenever the banner would read differently. */
  key: string;
}

/** What the banner says about `asking` (longest first, see needingYou), or null with nobody to show. */
export function bannerText(asking: readonly WorkerInfo[], now: number): BannerText | null {
  const w = asking[0];
  if (!w) return null;
  const ask = alertDetail(w)?.replace(/\s+/g, ' ').trim();
  const detail = [ask && (ask.length > 90 ? `${ask.slice(0, 89)}…` : ask), waited(w.waitingSince, now)].filter(Boolean).join(' · ');
  const more = asking.length > 1 ? `+${asking.length - 1} more` : '';
  const title = `${w.name} needs you`;
  return { id: w.id, title, detail, more, key: `${w.id}|${title}|${detail}|${more}` };
}

/** Tells a worker that has just stopped to ask something from one that was asking already when the page first saw it. */
export class Fresh {
  private last = new Map<string, WorkerStatus>();

  /** The workers that started needing you since the last look. */
  take(workers: ReadonlyMap<string, WorkerInfo>): WorkerInfo[] {
    const out: WorkerInfo[] = [];
    for (const w of workers.values()) {
      const before = this.last.get(w.id);
      this.last.set(w.id, w.status);
      if (before !== undefined && before !== w.status && w.status === 'needs_input') out.push(w);
    }
    // Gone, or on a floor you've left: new to the page if it comes back.
    for (const id of this.last.keys()) if (!workers.has(id)) this.last.delete(id);
    return out;
  }
}

/** When to ring again: every REMIND_EVERY for as long as someone's asking and nobody's at its terminal. */
export class Reminders {
  private last = 0;
  private waiting = false;

  /** The alarm just rang: the next reminder is a whole wait away. */
  rang(now: number) {
    this.last = now;
    this.waiting = true;
  }

  /** Nobody the last wait was for is here any more (you've changed floors): the next one starts from scratch. */
  quiet() {
    this.waiting = false;
  }

  /** Whether to ring now, for `asking` (the workers that need you). Says yes once per wait. */
  due(asking: readonly WorkerInfo[], now: number): boolean {
    if (!asking.some(unattended)) {
      this.waiting = false;
      return false;
    }
    // Someone's asking again (or was when the page came up): the wait starts here, quietly.
    if (!this.waiting) {
      this.rang(now);
      return false;
    }
    if (now - this.last < REMIND_EVERY) return false;
    this.last = now;
    return true;
  }
}
