/**
 * The vault's safe: E at it opens the vault (ui/vault.ts), the floor's environment variables for its
 * workers. Its dial spins and its door swings open while the window is up, and it shuts after.
 */
import type { Ctx } from '../../core/context';
import { aside, hintTitle, key, onE } from '../../core/hint';
import { store } from '../../state';
import { openVault } from '../../ui/vault';
import { safeOf, type Safe } from './world';

// The kinds of thing you can use that this defines (see InteractKinds in world/types.ts).
declare module '../../world/types' {
  interface InteractKinds {
    safe: true;
  }
}

export function installVault(ctx: Ctx) {
  /** The safes still opening or shutting. */
  const moving = new Set<Safe>();
  const swing = (safe: Safe, on: boolean) => {
    safe.open(on);
    moving.add(safe);
    ctx.sound.safe(safe.at, on);
  };

  ctx.interactions.define('safe', {
    reach: 3,
    hint: () => {
      const v = store.vault;
      const n = v && v.floor === store.floor ? v.entries.length : undefined;
      return { k: '', parts: [hintTitle('🗝️ Vault'), aside(n === undefined ? 'the workers’ secrets' : `${n} secret${n === 1 ? '' : 's'} inside`), key('E', 'Open it')] };
    },
    use: onE((it) => {
      const safe = safeOf(it);
      if (openVault(ctx.net, () => safe && swing(safe, false)) && safe) swing(safe, true);
    }),
  });

  ctx.ticks.add('world', (f) => {
    for (const s of moving) if (!s.update(f.dt)) moving.delete(s);
  });
}
