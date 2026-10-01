import type { GhIssue, GhPull, QueueTask } from '../shared/protocol.js';

/** An issue to close because the pull request that did it merged, and whose gh to close it with. */
export interface DoneIssue {
  issue: number;
  pr: number;
  owner?: string;
}

/**
 * Moves an issue to ✅ Done once the pull request that did it merges. GitHub closes the ones a PR
 * says it closes ("closes #12") by itself; this is for the rest: a queue task's PR, linked by the
 * worker's branch, that never said so. Only a PR seen open at the last look counts, so starting the
 * office up closes nothing, and an issue reopened after its PR merged stays open.
 */
export class IssueDone {
  /** Open at the last look; unset until the first. */
  private open?: Set<number>;

  look(pulls: GhPull[], tasks: QueueTask[], issues: GhIssue[]): DoneIssue[] {
    const open = this.open;
    this.open = new Set(pulls.filter((p) => p.state === 'OPEN').map((p) => p.number));
    if (!open) return [];
    const merged = new Map(pulls.filter((p) => p.state === 'MERGED' && open.has(p.number)).map((p) => [p.number, p]));
    const stillOpen = new Set(issues.filter((i) => i.state === 'OPEN').map((i) => i.number));
    const out: DoneIssue[] = [];
    for (const t of tasks) {
      const p = t.pr && merged.get(t.pr.number);
      if (!p || t.issue === undefined || p.closes.includes(t.issue) || !stillOpen.has(t.issue)) continue;
      if (out.some((d) => d.issue === t.issue)) continue;
      out.push({ issue: t.issue, pr: p.number, ...(t.owner ? { owner: t.owner } : {}) });
    }
    return out;
  }
}
