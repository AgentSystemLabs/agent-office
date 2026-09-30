// The floor's task queue: adding, moving and retrying tasks, and how many workers it keeps busy.
import { isAgentEffort, isAgentProvider, type QueueClientMsg } from '../../../shared/protocol.js';
import { OPEN_CODE_MODEL_MAX } from '../../../shared/providers.js';
import { num, str } from '../../office/input.js';
import { here } from './common.js';
import type { HandlerMap, ViewPieces } from './types.js';

export const queueView: ViewPieces['queue'] = (_ctx, floor) => floor?.queue.state() ?? { tasks: [], maxWorkers: 0 };

export const queueHandlers = {
  'queue.add'(ctx, c, msg) {
    const who = c.peer.name;
    const floor = here(ctx, c);
    if (!floor) return;
    if (msg.provider !== undefined && (!isAgentProvider(msg.provider) || !floor.project.agentProviders.includes(msg.provider))) {
      ctx.warn(c, 'Unknown agent provider');
      return;
    }
    const issue = Number.isInteger(msg.issue) && (msg.issue as number) > 0 ? (msg.issue as number) : undefined;
    const model = msg.model === undefined ? undefined : str(msg.model, OPEN_CODE_MODEL_MAX + 1);
    const effort = isAgentEffort(msg.effort) ? msg.effort : undefined;
    // Its worker runs on the sign-ins of whoever queued it, whenever it gets a desk.
    ctx.withSignIn(c, ctx.claudeFor(msg.provider ?? floor.workers.officeDefault.provider), () => {
      const err = floor.queue.add(str(msg.prompt, 20000), who, str(msg.title, 200), issue, msg.provider, model, effort, c.accountId);
      if (err) ctx.warn(c, err);
      else ctx.toastFloor(floor, `📋 ${who} queued ${issue !== undefined ? `issue #${issue}` : 'a task'}`);
    });
  },
  'queue.remove'(ctx, c, msg) {
    const floor = here(ctx, c);
    if (floor) ctx.warn(c, floor.queue.remove(str(msg.taskId, 32)));
  },
  'queue.move'(ctx, c, msg) {
    ctx.floorOf(c)?.queue.move(str(msg.taskId, 32), num(msg.delta) < 0 ? -1 : 1);
  },
  'queue.retry'(ctx, c, msg) {
    const floor = here(ctx, c);
    if (floor) ctx.warn(c, floor.queue.retry(str(msg.taskId, 32)));
  },
  'queue.clear'(ctx, c) {
    ctx.floorOf(c)?.queue.clear();
  },
  'queue.limit'(ctx, c, msg) {
    ctx.floorOf(c)?.queue.setLimit(num(msg.maxWorkers));
  },
} satisfies HandlerMap<QueueClientMsg>;
