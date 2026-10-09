// The smartphone's call: a ringback, then you at their desk with their terminal open. A call is
// only logged once it really connected: re-checked after the walk-over, never for failed ones.
import type { WorkerInfo } from '../../../shared/protocol';
import { logRecent } from '../../../shared/smartphone';
import { store } from '../../state';
import { h, STATUS_LABEL, toast } from '../../ui/dom';
import { dotColor } from './logic';
import type { Phone } from './ui';

/** A placed call connects just as the double ringback ends (~1.55s), with a beat to spare. */
const CONNECT_MS = 1800;

export function startCall(phone: Phone, w: WorkerInfo) {
  phone.go({ t: 'calling', id: w.id });
  phone.setRing(phone.deps.sound.phoneRing());
  phone.setConnect(CONNECT_MS, () => {
    const now = phone.worker(w.id);
    if (!now) {
      phone.setRing(null);
      toast(`${w.name} went home`, 'warn');
      phone.go({ t: 'contacts' });
      return;
    }
    if (now.lost) {
      // No worktree to rebuild (a workspace gone with it): say so where the phone still is.
      if (!now.worktree) {
        phone.setRing(null);
        toast(`${now.name}'s workspace is gone and there is nothing to rebuild — send it home from its desk`, 'warn');
        phone.go({ t: 'contacts' });
        return;
      }
      phone.close();
      phone.deps.fixLostWorktree(now);
      return;
    }
    if (!phone.deps.goToWorker(now.id)) {
      phone.setRing(null);
      toast(`Couldn't get to ${now.name}'s desk`, 'warn');
      phone.go({ t: 'contacts' });
      return;
    }
    // Re-checked after the walk-over (the phone is closed by now): only connected calls are logged.
    const open = phone.worker(w.id);
    if (!open || open.lost) {
      toast(`${w.name} went home`, 'warn');
      return;
    }
    const st = store.smartphone;
    st.recents = logRecent(st.recents, { kind: 'call', workerId: open.id, name: open.name, at: Date.now() });
    store.emit('smartphone');
    phone.deps.openWorkerTerminal(open.id, `📱 on a call with ${open.name}`);
  });
}

export function renderCalling(phone: Phone, id: string): HTMLElement[] {
  const w = phone.worker(id);
  if (!w) {
    phone.go({ t: 'contacts' });
    return [];
  }
  const phase = h('div.sp-phase', {}, 'Dialing…');
  phone.after(800, () => phase.replaceChildren('Ringing…'));
  return [
    h('div.sp-calling', {}, h('span.sp-bigdot', { style: `background:${dotColor(w)}` }), h('div.sp-name', {}, w.name), phase, h('div.sp-sub', {}, `${STATUS_LABEL[w.status] ?? w.status} · connects into their terminal`)),
    h(
      'div.sp-actions',
      {},
      h(
        'button.btn.danger.sp-hang',
        {
          type: 'button',
          onclick: () => {
            phone.hangUp();
          },
        },
        '📵 End',
      ),
    ),
  ];
}
