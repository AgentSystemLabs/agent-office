// The safe on every floor: the .env the office writes into its workers' worktrees (see server/vault.ts).
// Anyone can see which variables are in it; only an admin can open it to read or change them.
import { parseEnv, VAULT_MAX } from '../../../shared/vault.js';
import type { VaultClientMsg, VaultState } from '../../../shared/protocol.js';
import type { Floor } from '../../floor.js';
import type { Ctx } from '../../office/context.js';
import type { Client } from '../../office/client.js';
import { str } from '../../office/input.js';
import { readVault, saveVault, stocked } from '../../vault.js';
import { here } from './common.js';
import type { HandlerMap } from './types.js';

/** `floor`'s safe as `c` may see it. */
const vaultState = (ctx: Ctx, c: Client, floor: Floor): VaultState => {
  const saved = readVault(floor.dir);
  const canEdit = ctx.meOf(c.accountId).admin;
  return {
    floor: floor.id,
    keys: saved ? parseEnv(saved.text).keys : [],
    ...(canEdit && saved ? { text: saved.text } : {}),
    canEdit,
    by: saved?.by,
    at: saved?.at,
    stocked: stocked(floor.dir),
  };
};

export const vaultHandlers = {
  'vault.open'(ctx, c) {
    const floor = here(ctx, c);
    if (floor) ctx.sendTo(c, { t: 'vault', state: vaultState(ctx, c, floor) });
  },
  'vault.save'(ctx, c, msg) {
    const floor = here(ctx, c);
    if (!floor) return;
    if (!ctx.meOf(c.accountId).admin) return ctx.warn(c, 'Only admins can change what is in the safe');
    const text = str(msg.text, VAULT_MAX + 1);
    const was = readVault(floor.dir)?.text ?? '';
    if (text.trim() === was.trim()) return ctx.sendTo(c, { t: 'vault', state: vaultState(ctx, c, floor) });
    const who = c.peer.name;
    const done = saveVault(floor.dir, text, who);
    if ('error' in done) return ctx.warn(c, done.error);
    ctx.sendTo(c, { t: 'vault', state: vaultState(ctx, c, floor) });
    const n = done.keys.length;
    const where = done.stocked === 1 ? '1 checkout' : `${done.stocked} checkouts`;
    // Names only: never what's in them.
    ctx.toastFloor(floor, n ? `🔐 ${who} put ${n === 1 ? '1 variable' : `${n} variables`} in the safe (.env in ${where})` : `🔐 ${who} emptied the safe`);
  },
} satisfies HandlerMap<VaultClientMsg>;
