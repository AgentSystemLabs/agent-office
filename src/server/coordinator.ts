// The floor's coordinator board: the phase plan its `plans/` folder holds (see the coordinator
// skill), read again every few seconds so the wall boards follow whatever the coordinator writes.

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { EMPTY_COORDINATOR, parseChecklist, parseMasterplan, parsePhase, parseTimeline } from '../shared/coordinator.js';
import type { CoordinatorState } from '../shared/protocol.js';

/** How often the office looks at a floor's plan files again. */
const REFRESH_MS = 5000;

/** A file's text, or undefined when it isn't there or can't be read. */
function read(p: string): string | undefined {
  try {
    return existsSync(p) ? readFileSync(p, 'utf8') : undefined;
  } catch {
    return undefined;
  }
}

/** A floor's plan, read from `plans/current.md` and the phase folder it names. */
export function readPlan(dir: string): CoordinatorState {
  const plans = path.join(dir, 'plans');
  const current = read(path.join(plans, 'current.md'));
  if (current === undefined) return { ...EMPTY_COORDINATOR };
  const phase = parsePhase(current);
  if (!phase) return { ...EMPTY_COORDINATOR, error: 'plans/current.md has no “Current phase:” line' };
  const at = path.join(plans, phase);
  const masterplan = read(path.join(at, 'masterplan.md'));
  const checklist = read(path.join(at, 'checklist.md'));
  const timeline = read(path.join(at, 'timeline.md'));
  const { goal, chapters } = masterplan === undefined ? { goal: null, chapters: [] } : parseMasterplan(masterplan);
  const { summary, cards } = checklist === undefined ? { summary: { ...EMPTY_COORDINATOR.summary }, cards: [] } : parseChecklist(checklist);
  return { phase, goal, chapters, cards, summary, timeline: timeline === undefined ? [] : parseTimeline(timeline), at: 0 };
}

/**
 * One floor's coordinator board. It reads the plan files off disk on its own schedule and whenever
 * someone asks, and tells the floor when they say something new.
 */
export class Coordinator {
  private current: CoordinatorState = EMPTY_COORDINATOR;
  private timer: NodeJS.Timeout;

  constructor(
    private dir: string,
    private onState: (state: CoordinatorState) => void,
  ) {
    this.poll(true);
    this.timer = setInterval(() => this.poll(), REFRESH_MS);
  }

  state(): CoordinatorState {
    return this.current;
  }

  /** Look at the plan files now, rather than waiting for the timer. */
  refresh() {
    this.poll();
  }

  shutdown() {
    clearInterval(this.timer);
  }

  private poll(force = false) {
    const next = readPlan(this.dir);
    // Only when the files say something new: they change on a person's or an agent's own time.
    if (!force && JSON.stringify(next) === JSON.stringify({ ...this.current, at: 0 })) return;
    this.current = { ...next, at: Date.now() };
    this.onState(this.current);
  }
}
