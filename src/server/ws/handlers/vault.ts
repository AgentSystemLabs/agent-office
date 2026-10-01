// The vault on every floor: environment variables its workers start with (see vault.ts). Anyone can
// see what's in it by name; only admins put things in or take them out, since every worker on the
// floor runs with them. Values never go back out to a browser.
import type { VaultClientMsg } from '../../../shared/protocol.js';
import type { Ctx } from '../../office/context.js';
import type { Client } from '../../office/client.js';
import type { Floor } from '../../floor.js';
import { str } from '../../office/input.js';
import { here } from './common.js';
import type { HandlerMap } from './types.js';

const vaultChanged = (ctx: Ctx, floor: Floor) => ctx.toFloor(floor, { t: 'vault', state: floor.vault.state(floor.id) });

/** The floor `c` is on, when they may change its vault; otherwise they're told why not. */
function editable(ctx: Ctx, c: Client): Floor | undefined {
  if (!ctx.meOf(c.accountId).admin) return void ctx.warn(c, 'Only admins can change the vault');
  return here(ctx, c);
}

export const vaultHandlers = {
  'vault.get'(ctx, c) {
    const floor = here(ctx, c);
    if (floor) ctx.sendTo(c, { t: 'vault', state: floor.vault.state(floor.id) });
  },
  'vault.set'(ctx, c, msg) {
    const floor = editable(ctx, c);
    if (!floor) return;
    const r = floor.vault.set(msg.vars, c.peer.name);
    if ('error' in r) return ctx.warn(c, r.error);
    vaultChanged(ctx, floor);
    const what = r.names.length === 1 ? r.names[0] : `${r.names.length} variables`;
    ctx.toastFloor(floor, `🗝️ ${c.peer.name} put ${what} in the vault: workers get it the next time they start`);
  },
  'vault.delete'(ctx, c, msg) {
    const floor = editable(ctx, c);
    const name = str(msg.name, 128);
    if (!floor || !floor.vault.delete(name)) return;
    vaultChanged(ctx, floor);
    ctx.toastFloor(floor, `🗝️ ${c.peer.name} took ${name} out of the vault`);
  },
} satisfies HandlerMap<VaultClientMsg>;
