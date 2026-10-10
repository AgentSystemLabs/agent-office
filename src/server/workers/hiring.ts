import { randomBytes } from 'node:crypto';
import type { WorkerManager } from './manager.js';
import type { Worktrees } from '../worktrees.js';
import type { WorkerTrees } from './worktree.js';
import type { WorkerEvents } from './types.js';
import type { WorkerInfo, WorkerRepo } from '../../shared/protocol.js';

export interface PreparedHire {
  worktree: NonNullable<WorkerInfo['worktree']>;
  repos?: WorkerRepo[];
  notes: string[];
}

/** A desk is reserved until its checkout completes. No agent runs in a partial checkout. */
export class PendingHires {
  private pending = new Map<string, AbortController>();
  private closed = false;

  has(desk: string): boolean { return this.pending.has(desk); }

  close(): void {
    this.closed = true;
    for (const controller of this.pending.values()) controller.abort();
  }

  async run(desk: string, prepare: (signal: AbortSignal) => Promise<PreparedHire | string>, launch: (prepared: PreparedHire) => WorkerInfo | string): Promise<WorkerInfo | string> {
    if (this.closed) return 'The office is restarting; hire again once it is back';
    if (this.has(desk)) return 'A worker is already being prepared at that desk';
    const controller = new AbortController();
    this.pending.set(desk, controller);
    try {
      const made = await prepare(controller.signal);
      if (typeof made === 'string') return made;
      if (controller.signal.aborted) return `Hire cancelled; the checkout at ${made.worktree.path} is kept`;
      // Completion is synchronous: release only for the final validation and launch.
      this.pending.delete(desk);
      const result = launch(made);
      return typeof result === 'string' ? `${result}. The prepared checkout at ${made.worktree.path} is kept; no worker was started.` : result;
    } catch (error) {
      return `Could not prepare worker: ${(error as Error).message}`;
    } finally {
      this.pending.delete(desk);
    }
  }
}

type HireArgs = Parameters<WorkerManager['spawn']>;

export async function prepareHire(pending: PendingHires, args: HireArgs, ctx: {
  validate(): string | undefined;
  spawn(args: HireArgs): WorkerInfo | string;
  trees: Worktrees;
  worktrees: WorkerTrees;
  events: Pick<WorkerEvents, 'toast'>;
}): Promise<WorkerInfo | string> {
  if (!args[3]) return ctx.spawn(args);
  const error = ctx.validate();
  if (error) return error;
  const slug = `hire-${randomBytes(6).toString('hex')}`;
  return pending.run(args[0], async (signal) => {
    ctx.events.toast('Preparing the worker worktree; large projects can take a few minutes. The office stays usable.', 'info');
    const repos = args[10];
    if (repos?.length) return ctx.worktrees.prepareWorkspace(slug, repos, signal);
    const made = await ctx.trees.prepareCheckout(slug, undefined, undefined, signal);
    if (typeof made === 'string') return made;
    const { note, ...ref } = made;
    return { worktree: ref, notes: note ? [note] : [] };
  }, (prepared) => {
    const final: HireArgs = [...args];
    final[12] = prepared;
    return ctx.spawn(final);
  });
}
