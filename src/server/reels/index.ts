// The office's one reels studio, and its clock. Its crew are workers on any floor; the studio finds
// them, and talks to them, through the office's context.

import type { Ctx } from '../office/context.js';
import { Studio, TICK_MS } from './studio.js';
import type { CrewMember } from './types.js';

const studios = new WeakMap<Ctx, Studio>();

/** The office's studio, made the first time it's asked for. */
export function studioOf(ctx: Ctx): Studio {
  let studio = studios.get(ctx);
  if (!studio) {
    const worker = (m: CrewMember) => ctx.floors.get(m.floorId)?.workers.get(m.workerId);
    studio = new Studio(ctx.cfg.dataDir, {
      toast: (text, level) => ctx.toastAll(text, level),
      workerStatus: (m) => worker(m)?.status,
      tell: (m, text) => {
        const workers = ctx.floors.get(m.floorId)?.workers;
        if (!workers) return 'its floor closed';
        const err = workers.prompt(m.workerId, text, 'Reels studio');
        // Stopped or asleep: it wakes up with this as its next message.
        return err === 'Worker is not running' ? workers.resume(m.workerId, text) : err;
      },
    });
    studios.set(ctx, studio);
  }
  return studio;
}

/** Starts the studio's clock; returns what stops it. It does nothing until someone makes a series. */
export function startReels(ctx: Ctx): () => void {
  const timer = setInterval(() => {
    studioOf(ctx).tick().catch((e) => console.error('[reels]', e));
  }, TICK_MS);
  timer.unref();
  return () => clearInterval(timer);
}
