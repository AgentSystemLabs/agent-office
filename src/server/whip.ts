// The whip (see shared/protocol/whip.ts): who can be whipped, when again, and what the office's
// 'worker.whip' prompt is filled in with. The handler in ws/handlers/whip.ts sends it.
import { WHIP_COOLDOWN_MS, type WorkerInfo } from '../shared/protocol.js';
import { DESK_BY_ID } from '../shared/layout.js';
import type { PromptVars } from '../shared/prompts.js';
import { truncate } from './workers/util.js';

/** How much of a worker's first prompt stands in for its task when it has no sign yet: it has the rest already. */
const TASK_MAX = 400;

/** The floor's own checkout, for a worker that works in it rather than a worktree of its own. */
export interface WhipProject {
  /** The branch the checkout is on ('HEAD' when detached). */
  branch?: string;
  /** Its origin, when it has one. */
  remote?: string;
}

/** When each worker was last whipped, so it gets one optimization prompt per lash rather than a flood. */
export class WhipCooldowns {
  private at = new Map<string, number>();

  constructor(private ms = WHIP_COOLDOWN_MS) {}

  /** How long `id` still smarts for (ms), 0 when it can be whipped again. */
  left(id: string, now = Date.now()): number {
    const at = this.at.get(id);
    return at === undefined ? 0 : Math.max(0, at + this.ms - now);
  }

  /** It was just whipped. Lashes that have worn off are forgotten, so the map only holds the ones smarting. */
  mark(id: string, now = Date.now()) {
    for (const [k, at] of this.at) if (at + this.ms <= now) this.at.delete(k);
    this.at.set(id, now);
  }
}

/** Why `info` can't be whipped right now, or nothing when it can. */
export function whipRefusal(info: WorkerInfo, smartingMs = 0): string | undefined {
  const name = info.name;
  if (info.kind !== 'agent') return "That's a shell, not an agent: there's nobody to whip";
  if (DESK_BY_ID.get(info.deskId)?.station) return `The ${name} only looks after its board: whip a worker at a desk`;
  if (info.meeting) return `${name} is in a meeting: wait until it's over`;
  if (info.lost) return `${name}'s worktree is gone: rebuild it first`;
  if (info.status === 'exited' || info.status === 'offline') return `${name} is asleep: wake it up first`;
  if (info.status === 'starting') return `${name} is still sitting down: give it a moment`;
  // Typing into it now could answer the question it's asking.
  if (info.status === 'needs_input') return `${name} is waiting on an answer: answer it first`;
  if (smartingMs > 0) return `${name} is still smarting — give it ${Math.ceil(smartingMs / 1000)}s`;
  return undefined;
}

/** What the 'worker.whip' prompt is filled in with for `info`, whipped by `by`. */
export function whipVars(info: WorkerInfo, by: string, project: WhipProject = {}): PromptVars {
  const wt = info.worktree;
  const own = project.branch && project.branch !== 'HEAD' ? project.branch : undefined;
  // `branch` is the one it's on now; `made` only remembers the office's, once it has switched to its own.
  const branch = wt?.branch ?? own ?? 'the current branch';
  // What its pull request goes into, as origin has it (what GitHub diffs it against), else the commit it was cut from.
  const from = wt?.from && wt.from !== 'HEAD' ? wt.from : undefined;
  const base = from ? (project.remote ? `origin/${from}` : from) : (wt?.base?.slice(0, 12) ?? 'origin/HEAD');
  const task = info.task ? `${info.task.name}: ${info.task.summary}` : info.prompt?.trim() ? truncate(info.prompt, TASK_MAX) : 'the task you were given';
  return {
    by,
    name: info.name,
    task,
    branch,
    base,
    pr: info.pr ? `It has pull request #${info.pr.number} (${info.pr.url}): push your commit there.` : '',
    repos: info.repos?.length
      ? `You work across several repositories (${info.repos.map((r) => r.name).join(', ')} too): do this pass in each project's folder, each against the branch it was cut from.`
      : '',
  };
}
