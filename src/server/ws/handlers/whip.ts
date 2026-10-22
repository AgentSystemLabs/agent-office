// The whip: crack it at a worker on your floor and it flinches for everyone there, then gets the
// office's 'worker.whip' prompt, an optimization pass over its branch (see server/whip.ts).
import type { WhipClientMsg } from '../../../shared/protocol.js';
import { officePrompt } from '../../prompts.js';
import { WhipCooldowns, whipRefusal, whipVars } from '../../whip.js';
import { here, workerOf } from './common.js';
import type { HandlerMap } from './types.js';

/** When each worker was last whipped, building-wide: worker ids are unique across floors. */
const cooldowns = new WhipCooldowns();

export const whipHandlers = {
  'worker.whip'(ctx, c, msg) {
    const floor = here(ctx, c);
    if (!floor) return;
    const w = workerOf(ctx, msg.workerId);
    // Only a worker you can see: one on your own floor.
    if (!w || w.floor !== floor) return ctx.warn(c, 'No such worker here');
    const { wid, info } = w;
    const why = whipRefusal(info, cooldowns.left(wid));
    if (why) return ctx.warn(c, why);
    const text = officePrompt(ctx.prompts, 'worker.whip', whipVars(info, c.peer.name, floor.project));
    const err = floor.workers.prompt(wid, text, c.peer.name);
    if (err) return ctx.warn(c, err);
    cooldowns.mark(wid);
    ctx.toFloor(floor, { t: 'worker.whipped', workerId: wid, by: c.peer.id, name: c.peer.name });
    ctx.toastFloor(floor, `🪢 ${c.peer.name} cracked the whip at ${info.name}: optimization pass`);
  },
} satisfies HandlerMap<WhipClientMsg>;
