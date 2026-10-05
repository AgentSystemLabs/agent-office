// The smartphone's contacts, actions and recents views: who they are, what each one does, and what
// was placed or sent. Recents resolve names live and drop workers that went home.
import type { WorkerInfo } from '../../../shared/protocol';
import { clearThreads } from '../../../shared/smartphone';
import { store } from '../../state';
import { clip, h, STATUS_LABEL, timeAgo, toast } from '../../ui/dom';
import { startCall } from './call';
import { contactSub, dotColor, kindIcon } from './logic';
import type { Phone } from './ui';

function pill(w: WorkerInfo) {
  const cls = w.status === 'needs_input' ? 'sp-pill sp-needs' : w.status === 'done' ? 'sp-pill sp-done' : 'sp-pill';
  return h('span', { class: cls }, STATUS_LABEL[w.status] ?? w.status);
}

/** Drops recents rows whose worker went home. Runs at the top of every draw, before anything is
 * painted, so renderers never mutate (every listener draws right after). */
export function pruneRecents(): void {
  const st = store.smartphone;
  const alive = st.recents.filter((r) => store.workers.has(r.workerId));
  if (alive.length !== st.recents.length) st.recents = alive;
}

export function renderContacts(phone: Phone, contacts: WorkerInfo[]): HTMLElement[] {
  if (!contacts.length) return [h('p.sp-empty', {}, '📵 No contacts — hire someone first (E at an empty desk).')];
  return contacts.map((w) => {
    const sub = contactSub(w);
    return h(
      'button.sp-contact',
      {
        type: 'button',
        onclick: () => {
          phone.go({ t: 'actions', id: w.id });
          phone.deps.sound.dialBlip();
        },
      },
      h('span.sp-dot', { style: `background:${dotColor(w)}` }),
      h('div.sp-main', {}, h('div.sp-name', {}, `${kindIcon(w)} ${w.name}`, w.pr && w.activity ? h('span.sp-pr', {}, `🔀 #${w.pr.number}`) : null), sub ? h('div.sp-sub', {}, clip(sub, 48)) : null),
      pill(w),
    );
  });
}

export function renderActions(phone: Phone, id: string): HTMLElement[] {
  const w = phone.worker(id);
  if (!w) {
    phone.go({ t: 'contacts' });
    return [];
  }
  const sub = contactSub(w);
  return [
    h('div.sp-who', {}, h('span.sp-bigdot', { style: `background:${dotColor(w)}` }), h('div.sp-main', {}, h('div.sp-name', {}, `${kindIcon(w)} ${w.name}`), sub ? h('div.sp-sub', {}, clip(sub, 60)) : null), pill(w)),
    h(
      'div.sp-actions',
      {},
      h('button.btn.primary.sp-call', { type: 'button', onclick: () => startCall(phone, w) }, '📞 Call'),
      h(
        'button.btn.sp-sms',
        {
          type: 'button',
          onclick: () => {
            phone.go({ t: 'thread', id: w.id });
            phone.deps.sound.dialBlip();
          },
        },
        '💬 SMS',
      ),
      h(
        'button.btn',
        {
          type: 'button',
          title: 'Walk over without opening anything',
          onclick: () => {
            // Lost workers get the fix flow the other actions use, not a walk to a dead desk.
            const now = phone.worker(w.id) ?? w;
            if (now.lost) {
              if (!now.worktree) {
                toast(`${now.name}'s workspace is gone and there is nothing to rebuild — send it home from its desk`, 'warn');
                return;
              }
              phone.close();
              phone.deps.fixLostWorktree(now);
              return;
            }
            if (!phone.deps.goToWorker(now.id)) toast(`Couldn't get to ${now.name}'s desk`, 'warn');
          },
        },
        '🚶 Go to desk',
      ),
    ),
  ];
}

export function renderRecents(phone: Phone): HTMLElement[] {
  // Pruned at the top of every draw; filtered again read-only so a race still can't render a ghost.
  // Names resolve live: a renamed worker shows its new name.
  const recents = store.smartphone.recents.filter((r) => phone.worker(r.workerId));
  if (!recents.length) return [h('p.sp-empty', {}, 'No calls or texts yet — tap a contact to ring them.')];
  return [
    ...recents.map((r) => {
      const w = phone.worker(r.workerId)!;
      return h(
        'button.sp-contact',
        {
          type: 'button',
          onclick: () => {
            phone.go({ t: 'actions', id: w.id });
            phone.deps.sound.dialBlip();
          },
        },
        h('span.sp-dot', {}, r.kind === 'call' ? '📞' : '💬'),
        h('div.sp-main', {}, h('div.sp-name', {}, w.name), h('div.sp-sub', {}, r.kind === 'call' ? 'outgoing call' : 'text message')),
        h('span.sp-when', { title: new Date(r.at).toLocaleString() }, timeAgo(r.at)),
      );
    }),
    h(
      'button.btn.sp-clear',
      {
        type: 'button',
        title: 'Forget every kept text and text recents (kept in this browser only)',
        onclick: () => {
          const s = store.smartphone;
          s.threads = {};
          clearThreads();
          // Calls reference no threads, but texts to forgotten threads would.
          s.recents = s.recents.filter((r) => r.kind !== 'sms');
          store.emit('smartphone');
          toast('🗑 Message history cleared');
        },
      },
      '🗑 Clear message history',
    ),
  ];
}
