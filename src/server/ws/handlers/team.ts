// Who may SSH-tunnel into an office deployed with deploy/aws.sh or deploy/azure.sh.
import type { TeamClientMsg } from '../../../shared/protocol.js';
import type { Ctx } from '../../office/context.js';
import { str } from '../../office/input.js';
import type { HandlerMap } from './types.js';

const teamState = async (ctx: Ctx) => ({ ...(await ctx.team.state()), deploy: ctx.cfg.deployScript });
const teamChanged = async (ctx: Ctx) => ctx.broadcast({ t: 'team', state: await teamState(ctx) });

export const teamHandlers = {
  'team.get'(ctx, c) {
    void teamState(ctx).then((state) => ctx.sendTo(c, { t: 'team', state }));
  },
  'team.invite'(ctx, c, msg) {
    const who = c.peer.name;
    const user = str(msg.github, 64);
    void ctx.team.invite(user).then(async (r) => {
      ctx.sendTo(c, { t: 'team.invited', github: user, ...r });
      if ('error' in r) return;
      ctx.toastAll(`${who} invited ${r.name} to the office`);
      await teamChanged(ctx);
    });
  },
  'team.remove'(ctx, c, msg) {
    const who = c.peer.name;
    const name = str(msg.name, 64);
    void ctx.team.remove(name).then(async (err) => {
      if (err) return ctx.warn(c, err);
      ctx.toastAll(`${who} removed ${name}'s access`);
      await teamChanged(ctx);
    });
  },
} satisfies HandlerMap<TeamClientMsg>;
