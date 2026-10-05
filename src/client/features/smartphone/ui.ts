import './ui.css';
import type { WorkerInfo } from '../../../shared/protocol';
import { appendSms, logRecent, saveThreads, threadKey } from '../../../shared/smartphone';
import { isAsleep } from '../../../shared/status';
import { byUrgency } from '../../nextup';
import { store } from '../../state';
import { clip, h, openModal, STATUS_LABEL, timeAgo, toast } from '../../ui/dom';
import { dictateField } from '../../ui/dictate';
import { contactSub, kindIcon, statusNote } from './logic';

export interface SmartphoneDeps {
  net: { send(msg: { t: 'worker.prompt'; workerId: string; prompt: string }): void };
  /** Puts you at the worker's desk; false when there's no getting there. */
  goToWorker(id: string): boolean;
  openWorkerTerminal(id: string): void;
  fixLostWorktree(w: WorkerInfo): void;
  sound: { phoneRing(): void; smsSwoosh(): void; dialBlip(): void };
}

type View = { t: 'contacts' } | { t: 'recents' } | { t: 'actions'; id: string } | { t: 'calling'; id: string } | { t: 'thread'; id: string };

/** A placed call connects once the ringback has rung twice. */
const CONNECT_MS = 2600;

/**
 * The player's GTA-style smartphone: contacts are the workers on this floor, a call puts you at
 * their desk with their terminal open, and an SMS is a prompt sent to their session.
 */
export function openSmartphone(deps: SmartphoneDeps) {
  let view: View = { t: 'contacts' };
  let timers: ReturnType<typeof setTimeout>[] = [];
  const clearTimers = () => {
    for (const t of timers) clearTimeout(t);
    timers = [];
  };

  const close = h('button.btn.close', { type: 'button', 'aria-label': 'Close', title: 'Close (Esc)' }, '✕');
  const back = h('button.btn.sp-back', { type: 'button', 'aria-label': 'Back', title: 'Back' }, '‹');
  const tabs = h('nav.sp-tabs', { 'aria-label': 'Phone' });
  const body = h('div.sp-body');
  const el = h(
    'div.modal.smartphone',
    { role: 'dialog', 'aria-label': 'Smartphone' },
    h('header', {}, back, h('h2', {}, '📱 iFruit'), close),
    h('div.sp-status', {}, h('span', {}, 'Tinkle 📶'), h('span', {}, '🔋 100%')),
    tabs,
    body,
  );

  const worker = (id: string) => store.workers.get(id);

  function draw() {
    clearTimers();
    const contacts = byUrgency(store.workers.values());
    const recents = store.smartphone.recents;
    back.classList.toggle('hidden', view.t === 'contacts' || view.t === 'recents');
    tabs.replaceChildren(
      tab('Contacts', contacts.length, view.t === 'contacts' || view.t === 'actions' || view.t === 'calling' || view.t === 'thread', () => {
        view = { t: 'contacts' };
        deps.sound.dialBlip();
        draw();
      }),
      tab('Recents', recents.length, view.t === 'recents', () => {
        view = { t: 'recents' };
        deps.sound.dialBlip();
        draw();
      }),
    );
    if (view.t === 'contacts') renderContacts(contacts);
    else if (view.t === 'recents') renderRecents();
    else if (view.t === 'actions') renderActions(view.id);
    else if (view.t === 'calling') renderCalling(view.id);
    else renderThread(view.id);
  }

  const tab = (label: string, n: number, on: boolean, go: () => void) => h('button.sp-tab', { type: 'button', class: on ? 'on' : '', 'aria-pressed': String(on), onclick: go }, label, n ? h('span.sp-count', {}, String(n)) : null);

  function pill(w: WorkerInfo) {
    const cls = w.status === 'needs_input' ? 'sp-pill sp-needs' : w.status === 'done' ? 'sp-pill sp-done' : 'sp-pill';
    return h('span', { class: cls }, STATUS_LABEL[w.status] ?? w.status);
  }

  function renderContacts(contacts: WorkerInfo[]) {
    if (!contacts.length) {
      body.replaceChildren(h('p.sp-empty', {}, '📵 No contacts — hire someone first (E at an empty desk).'));
      return;
    }
    body.replaceChildren(
      ...contacts.map((w) => {
        const sub = contactSub(w);
        return h(
          'button.sp-contact',
          {
            type: 'button',
            onclick: () => {
              view = { t: 'actions', id: w.id };
              deps.sound.dialBlip();
              draw();
            },
          },
          h('span.sp-dot', { style: `background:${w.color}` }),
          h('div.sp-main', {}, h('div.sp-name', {}, `${kindIcon(w)} ${w.name}`, w.pr && w.activity ? h('span.sp-pr', {}, `🔀 #${w.pr.number}`) : null), sub ? h('div.sp-sub', {}, clip(sub, 48)) : null),
          pill(w),
        );
      }),
    );
  }

  function renderRecents() {
    const recents = store.smartphone.recents;
    if (!recents.length) {
      body.replaceChildren(h('p.sp-empty', {}, 'No calls or texts yet — tap a contact to ring them.'));
      return;
    }
    body.replaceChildren(
      ...recents.map((r) =>
        h(
          'button.sp-contact',
          {
            type: 'button',
            onclick: () => {
              if (!worker(r.workerId)) {
                toast(`${r.name} went home`, 'warn');
                return;
              }
              view = { t: 'actions', id: r.workerId };
              deps.sound.dialBlip();
              draw();
            },
          },
          h('span.sp-dot', {}, r.kind === 'call' ? '📞' : '💬'),
          h('div.sp-main', {}, h('div.sp-name', {}, r.name), h('div.sp-sub', {}, r.kind === 'call' ? 'outgoing call' : 'text message')),
          h('span.sp-when', { title: new Date(r.at).toLocaleString() }, timeAgo(r.at)),
        ),
      ),
    );
  }

  function renderActions(id: string) {
    const w = worker(id);
    if (!w) {
      view = { t: 'contacts' };
      return draw();
    }
    const sub = contactSub(w);
    body.replaceChildren(
      h('div.sp-who', {}, h('span.sp-bigdot', { style: `background:${w.color}` }), h('div.sp-main', {}, h('div.sp-name', {}, `${kindIcon(w)} ${w.name}`), sub ? h('div.sp-sub', {}, clip(sub, 60)) : null), pill(w)),
      h(
        'div.sp-actions',
        {},
        h('button.btn.primary.sp-call', { type: 'button', onclick: () => startCall(w) }, '📞 Call'),
        h(
          'button.btn.sp-sms',
          {
            type: 'button',
            onclick: () => {
              view = { t: 'thread', id: w.id };
              deps.sound.dialBlip();
              draw();
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
              if (!deps.goToWorker(w.id)) toast(`Couldn't get to ${w.name}'s desk`, 'warn');
            },
          },
          '🚶 Go to desk',
        ),
      ),
    );
  }

  function startCall(w: WorkerInfo) {
    view = { t: 'calling', id: w.id };
    draw();
    deps.sound.phoneRing();
    timers.push(
      setTimeout(() => {
        const now = worker(w.id);
        if (!now) {
          toast(`${w.name} went home`, 'warn');
          view = { t: 'contacts' };
          return draw();
        }
        if (now.lost && now.worktree) {
          modal.close();
          deps.fixLostWorktree(now);
          return;
        }
        const st = store.smartphone;
        st.recents = logRecent(st.recents, { kind: 'call', workerId: now.id, name: now.name, at: Date.now() });
        store.emit('smartphone');
        if (!deps.goToWorker(now.id)) {
          toast(`Couldn't get to ${now.name}'s desk`, 'warn');
          view = { t: 'contacts' };
          return draw();
        }
        deps.openWorkerTerminal(now.id);
      }, CONNECT_MS),
    );
  }

  function renderCalling(id: string) {
    const w = worker(id);
    if (!w) {
      view = { t: 'contacts' };
      return draw();
    }
    const phase = h('div.sp-phase', {}, 'Dialing…');
    timers.push(setTimeout(() => phase.replaceChildren('Ringing…'), 800));
    body.replaceChildren(
      h('div.sp-calling', {}, h('span.sp-bigdot', { style: `background:${w.color}` }), h('div.sp-name', {}, w.name), phase, h('div.sp-sub', {}, `${STATUS_LABEL[w.status] ?? w.status} · connects into their terminal`)),
      h(
        'div.sp-actions',
        {},
        h(
          'button.btn.danger.sp-hang',
          {
            type: 'button',
            onclick: () => {
              view = { t: 'actions', id };
              deps.sound.dialBlip();
              draw();
            },
          },
          '📵 End',
        ),
      ),
    );
  }

  function renderThread(id: string) {
    const w = worker(id);
    if (!w) {
      view = { t: 'contacts' };
      return draw();
    }
    const key = threadKey(store.floor, id);
    const thread = store.smartphone.threads[key] ?? [];
    const asleep = isAsleep(w.status);
    const input = h('input', { type: 'text', placeholder: asleep ? `${w.name} is asleep — call to wake it` : `Text ${w.name}…`, 'aria-label': 'Message', autocomplete: 'off' }) as HTMLInputElement;
    input.toggleAttribute('disabled', asleep);
    const sendBtn = h('button.btn.primary', { type: 'submit' }, 'Send');
    sendBtn.toggleAttribute('disabled', asleep);
    const form = h('form.sp-compose', {}, dictateField(input), sendBtn);
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const text = input.value.trim();
      const now = worker(id);
      if (!text || !now || isAsleep(now.status)) return;
      deps.net.send({ t: 'worker.prompt', workerId: now.id, prompt: text });
      const st = store.smartphone;
      st.threads[key] = appendSms(st.threads[key], text);
      saveThreads(st.threads);
      st.recents = logRecent(st.recents, { kind: 'sms', workerId: now.id, name: now.name, at: Date.now() });
      store.emit('smartphone');
      deps.sound.smsSwoosh();
      toast(`📩 SMS sent to ${now.name}`);
      input.value = '';
      draw();
      (body.querySelector('input') as HTMLInputElement | null)?.focus();
    });
    const msgs = h(
      'div.sp-thread',
      {},
      ...thread.map((m) => (m.dir === 'out' ? h('div.sp-bubble sp-out', {}, m.text) : h('div.sp-bubble sp-note', {}, m.text))),
    );
    body.replaceChildren(h('div.sp-who', {}, h('span.sp-dot', { style: `background:${w.color}` }), h('div.sp-main', {}, h('div.sp-name', {}, `💬 ${w.name}`))), msgs, h('div.sp-hint', {}, statusNote(w)), form);
    msgs.scrollTop = msgs.scrollHeight;
    setTimeout(() => input.focus(), 30);
  }

  back.addEventListener('click', () => {
    if (view.t === 'actions' || view.t === 'thread') view = view.t === 'thread' && worker(view.id) ? { t: 'actions', id: view.id } : { t: 'contacts' };
    else view = { t: 'contacts' };
    deps.sound.dialBlip();
    draw();
  });

  // The workers change under the phone (a hire, a status flip): redraw the lists, but never a view
  // with focus or timers in it (the thread's composer, the call being placed).
  const onStore = () => {
    if (view.t === 'thread' || view.t === 'calling') return;
    draw();
  };
  const offWorkers = store.on('workers', onStore);
  const offPhone = store.on('smartphone', onStore);
  const modal = openModal(el, {
    doing: '📱 checking contacts',
    onClose: () => {
      clearTimers();
      offWorkers();
      offPhone();
    },
  });
  close.addEventListener('click', () => modal.close());
  draw();
}
