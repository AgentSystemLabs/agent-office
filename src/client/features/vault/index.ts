/**
 * The safe: the floor's .env, which the office writes into every worker's worktree so the services
 * they start (and their previews) have the keys they need. E at it opens it; admins can change it.
 */
import type { VaultState } from '../../../shared/protocol';
import type { Ctx } from '../../core/context';
import { aside, hintTitle, key, onE } from '../../core/hint';
import { store } from '../../state';
import { toast } from '../../ui/dom';
import { openVault, vaultChanged } from './ui';

// The kinds of thing you can use that this defines (see InteractKinds in world/types.ts).
declare module '../../world/types' {
  interface InteractKinds {
    vault: true;
  }
}

export function installVault(ctx: Ctx) {
  /** What the office last said is in this floor's safe, while the window's open. */
  let state: VaultState | undefined;

  ctx.messages.on('vault', (msg) => {
    if (msg.state.floor !== store.floor) return;
    state = msg.state;
    vaultChanged();
  });

  function showVault() {
    if (!store.floor) return toast('Take the elevator to a floor first');
    state = undefined;
    ctx.net.send({ t: 'vault.open' });
    openVault({
      state: () => state,
      save: (text) => ctx.net.send({ t: 'vault.save', text }),
      onOpen: (open) => ctx.office.safe.open(open),
    });
  }

  ctx.interactions.define('vault', {
    reach: 3.5,
    hint: () => ({ k: '', parts: [hintTitle('🔐 Safe'), aside("the floor's .env, for every worktree"), key('E', 'Open')] }),
    use: onE(() => showVault()),
  });

  return { showVault };
}
