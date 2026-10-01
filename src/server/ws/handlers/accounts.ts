// Inviting, listing and revoking people. Admins only: an admin account, or the shared password.
import type { AccountsClientMsg } from '../../../shared/protocol.js';
import type { Ctx } from '../../office/context.js';
import type { Client } from '../../office/client.js';
import { str } from '../../office/input.js';
import type { HandlerMap } from './types.js';
import { L } from '../../i18n.js';

/** Whether `c` may manage accounts; if not, they're told so. */
const admin = (ctx: Ctx, c: Client): boolean => {
  if (ctx.meOf(c.accountId).admin) return true;
  ctx.warn(c, L.srv.adminsAccounts);
  return false;
};

export const accountsHandlers = {
  'accounts.get'(ctx, c) {
    if (!admin(ctx, c)) return;
    ctx.sendTo(c, { t: 'accounts', state: ctx.accounts.state(ctx.onlineAccounts()) });
  },
  'accounts.invite'(ctx, c, msg) {
    const who = c.peer.name;
    if (!admin(ctx, c)) return;
    const r = ctx.accounts.invite(who, msg.role === 'admin' ? 'admin' : 'member', typeof msg.name === 'string' ? msg.name : undefined);
    if (typeof r === 'string') return ctx.sendTo(c, { t: 'accounts.invited', error: r });
    ctx.sendTo(c, { t: 'accounts.invited', invite: r });
    ctx.accountsChanged();
  },
  'accounts.cancel'(ctx, c, msg) {
    if (!admin(ctx, c)) return;
    if (ctx.accounts.cancel(str(msg.inviteId, 32))) ctx.accountsChanged();
  },
  'accounts.revoke'(ctx, c, msg) {
    const who = c.peer.name;
    if (!admin(ctx, c)) return;
    const id = str(msg.accountId, 32);
    if (id === c.accountId) return ctx.warn(c, L.srv.revokeSelf);
    const a = ctx.accounts.revoke(id);
    if (!a) return;
    console.log(`  ${who} revoked ${a.name}'s account`);
    ctx.toastAll(`${who} revoked ${a.name}'s account`);
    ctx.accountsChanged(); // signs them out everywhere
    ctx.signins.forget(a.id); // and their Claude and GitHub sign-ins go with the account
    ctx.accountLimits.get(a.id)?.reader.close();
    ctx.accountLimits.delete(a.id);
  },
  'accounts.role'(ctx, c, msg) {
    const who = c.peer.name;
    if (!admin(ctx, c)) return;
    const id = str(msg.accountId, 32);
    if (id === c.accountId) return ctx.warn(c, L.srv.ownRole);
    const a = ctx.accounts.setRole(id, msg.role === 'admin' ? 'admin' : 'member');
    if (!a) return;
    ctx.toastAll(a.role === 'admin' ? L.srv.madeAdmin(who, a.name) : L.srv.noLongerAdmin(a.name));
    ctx.accountsChanged();
    // Only admins may use the office's own sign-ins: a demoted one is back on their own.
    void ctx.signins.look(a.id, true);
  },
  'accounts.shared'(ctx, c, msg) {
    const who = c.peer.name;
    if (!admin(ctx, c)) return;
    if (msg.on === ctx.accounts.sharedPassword) return;
    // Only someone who can still get in without it may switch it off.
    if (!msg.on && !c.accountId) return ctx.warn(c, L.srv.adminFirst);
    ctx.accounts.setSharedPassword(!!msg.on);
    console.log(`  ${msg.on ? L.srv.sharedOnLog(who) : L.srv.sharedOffLog(who)}`);
    ctx.toastAll(msg.on ? L.srv.sharedOn(who) : L.srv.sharedOff(who));
    ctx.accountsChanged(); // signs out whoever came in with it
  },
} satisfies HandlerMap<AccountsClientMsg>;
