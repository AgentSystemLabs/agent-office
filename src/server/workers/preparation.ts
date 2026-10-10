import path from 'node:path';
import { WORKTREES_DIR } from '../worktrees.js';
import type { Worktrees } from '../worktrees.js';
import type { Worker, WorkerContext } from './types.js';

/** A reserved worker owns its seat while Git prepares its checkout, before any agent is launched. */
export class WorkerPreparation {
  private pending = new Map<string, { controller: AbortController; done: Promise<void> }>();

  constructor(private ctx: WorkerContext) {}

  blocked(id: string): string | undefined {
    return this.pending.has(id) ? 'The worker is still preparing its worktree' : this.ctx.workers.get(id)?.preparingWorktree ? 'Worktree preparation is incomplete. Keep its files and retry the task with a new worker.' : undefined;
  }

  start(w: Worker, trees: Worktrees, slug: string, launch: () => void) {
    const controller = new AbortController();
    w.preparingWorktree = path.join(this.ctx.dir, WORKTREES_DIR, slug);
    w.info.activity = 'Preparing worktree…';
    // Defer even immediate errors until the queue has recorded this worker and reserved its slot.
    const done = Promise.resolve().then(async () => {
      const made = await trees.createAsync(slug, controller.signal);
      if (controller.signal.aborted || this.ctx.closing || this.ctx.workers.get(w.info.id) !== w) return;
      this.pending.delete(w.info.id);
      if (typeof made === 'string') {
        w.info.activity = made;
        w.info.exitCode = 1;
        this.ctx.setStatus(w, 'exited');
        this.ctx.events.toast(`${w.info.name}: ${made}`, 'error');
      } else {
        const { note, ...ref } = made;
        w.info.worktree = ref;
        w.preparingWorktree = undefined;
        if (note) this.ctx.events.toast(`🌿 ${w.info.name}'s worktree ${note}`, 'info');
        w.info.activity = w.info.prompt?.slice(0, 80);
        launch();
      }
      this.ctx.persist();
      this.ctx.emit(w);
    }).finally(() => this.pending.delete(w.info.id));
    this.pending.set(w.info.id, { controller, done });
    this.ctx.emit(w);
  }

  async cancel(id: string, incomplete = false): Promise<boolean> {
    const pending = this.pending.get(id);
    const preserve = !!pending || incomplete;
    pending?.controller.abort();
    await pending?.done;
    return preserve;
  }

  shutdown() {
    for (const p of this.pending.values()) p.controller.abort();
  }
}
