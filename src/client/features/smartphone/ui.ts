import './ui.css';
import type { WorkerInfo } from '../../../shared/protocol';
import { byUrgency } from '../../nextup';
import { store } from '../../state';
import { h, openModal } from '../../ui/dom';
import { pruneRecents, renderActions, renderContacts, renderRecents } from './contacts';
import { renderCalling } from './call';
import { liveThread, renderThread, type ThreadLive } from './sms';

export interface SmartphoneDeps {
  net: { send(msg: { t: 'worker.prompt'; workerId: string; prompt: string }): void };
  /** Puts you at the worker's desk; false when there's no getting there. */
  goToWorker(id: string): boolean;
  openWorkerTerminal(id: string, doing?: string): void;
  fixLostWorktree(w: WorkerInfo): void;
  sound: { phoneRing(): () => void; smsSwoosh(): void; dialBlip(): void };
}

export type PhoneView = { t: 'contacts' } | { t: 'recents' } | { t: 'actions'; id: string } | { t: 'calling'; id: string } | { t: 'thread'; id: string };

/** What the phone's views share: the shell owns the modal, the view state and the timers. */
export interface Phone {
  deps: SmartphoneDeps;
  worker(id: string): WorkerInfo | undefined;
  go(view: PhoneView): void;
  draw(): void;
  /** Tabs only (a text sent only renames counts outside Recents). */
  refreshTabs(): void;
  /** Hanging up from anywhere: back to the contact's actions, never a silent cancel. */
  hangUp(): boolean;
  /** A view-scoped timeout, dropped on every redraw and on close (the call screen's phase). */
  after(ms: number, fn: () => void): void;
  /** The placed call's connect timer: separate from view timers, dropped on hang-up, close or fire. */
  setConnect(ms: number, fn: () => void): void;
  clearConnect(): void;
  /** The ringback's stop handle: hanging up mid-dial silences it instead of playing out. */
  setRing(stop: (() => void) | null): void;
  setLive(live: ThreadLive | null): void;
  close(): void;
}

/**
 * The player's GTA-style smartphone: contacts are the workers on this floor, a call puts you at
 * their desk with their terminal open, and an SMS is a prompt sent to their session. The views live
 * beside this shell (contacts, call, sms); this owns the modal, the tabs and the timers.
 */
export function openSmartphone(deps: SmartphoneDeps) {
  let view: PhoneView = { t: 'contacts' };
  let viewTimers: ReturnType<typeof setTimeout>[] = [];
  let connectTimer: ReturnType<typeof setTimeout> | null = null;
  let live: ThreadLive | null = null;
  let raf = 0;
  let lastSig = '';

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

  const clearViewTimers = () => {
    for (const t of viewTimers) clearTimeout(t);
    viewTimers = [];
  };
  const clearConnect = () => {
    if (connectTimer) clearTimeout(connectTimer);
    connectTimer = null;
  };
  let ringStop: (() => void) | null = null;
  const stopRing = () => {
    ringStop?.();
    ringStop = null;
  };

  const phone: Phone = {
    deps,
    worker: (id) => store.workers.get(id),
    go: (v) => {
      view = v;
      draw();
    },
    draw: () => draw(),
    refreshTabs: () => drawTabs(store.workers.size),
    hangUp: () => {
      if (view.t !== 'calling') return false;
      stopRing();
      clearConnect();
      view = { t: 'actions', id: view.id };
      deps.sound.dialBlip();
      draw();
      return true;
    },
    after: (ms, fn) => void viewTimers.push(setTimeout(fn, ms)),
    setConnect: (ms, fn) => {
      clearConnect();
      connectTimer = setTimeout(() => {
        connectTimer = null;
        fn();
      }, ms);
    },
    clearConnect,
    setRing: (stop) => {
      stopRing();
      ringStop = stop;
    },
    setLive: (l) => {
      live?.dropMic();
      live = l;
    },
    close: () => modal.close(),
  };

  /** What the open phone shows, for skipping redraws whose inputs didn't change. Cheap stable
   * fields only: activity rides as length + prefix, since its full text rebuilds the string that
   * decides *not* to redraw on every activity tick. */
  function sig(contacts: WorkerInfo[]): string {
    const field = (w: WorkerInfo) => [w.id, w.kind, w.name, w.color, w.status, w.pr?.number ?? 0, w.lost ? 1 : 0, w.activity ? `${w.activity.length}:${w.activity.slice(0, 24)}` : ''].join('|');
    return `${contacts.map(field).join('~')}#${store.smartphone.recents.length}`;
  }

  function draw() {
    if (raf) {
      cancelAnimationFrame(raf);
      raf = 0;
    }
    clearViewTimers();
    pruneRecents();
    const contacts = byUrgency(store.workers.values());
    drawTabs(contacts.length);
    drawBody(contacts);
    lastSig = sig(contacts);
  }

  function drawTabs(count: number) {
    back.classList.toggle('hidden', view.t === 'contacts' || view.t === 'recents');
    tabs.replaceChildren(
      tab('Contacts', count, view.t !== 'recents', () => {
        if (phone.hangUp()) return;
        phone.go({ t: 'contacts' });
        deps.sound.dialBlip();
      }),
      tab('Recents', store.smartphone.recents.length, view.t === 'recents', () => {
        if (phone.hangUp()) return;
        phone.go({ t: 'recents' });
        deps.sound.dialBlip();
      }),
    );
  }

  function drawBody(contacts: WorkerInfo[]) {
    phone.setLive(null);
    // A renderer whose worker vanished redirects via go() (which paints the fallback itself):
    // skip the replace or the empty fallback nodes wipe what it just painted.
    const at = view;
    const nodes =
      view.t === 'contacts'
        ? renderContacts(phone, contacts)
        : view.t === 'recents'
          ? renderRecents(phone)
          : view.t === 'actions'
            ? renderActions(phone, view.id)
            : view.t === 'calling'
              ? renderCalling(phone, view.id)
              : renderThread(phone, view.id);
    if (view !== at) return;
    body.replaceChildren(...nodes);
  }

  const tab = (label: string, n: number, on: boolean, go: () => void) => h('button.sp-tab', { type: 'button', class: on ? 'on' : '', 'aria-pressed': String(on), onclick: go }, label, n ? h('span.sp-count', {}, String(n)) : null);

  back.addEventListener('click', () => {
    if (phone.hangUp()) return;
    if (view.t === 'actions' || view.t === 'thread') view = view.t === 'thread' && phone.worker(view.id) ? { t: 'actions', id: view.id } : { t: 'contacts' };
    else view = { t: 'contacts' };
    deps.sound.dialBlip();
    draw();
  });

  // The workers change under the phone (a hire, a status flip, an activity tick): coalesced to one
  // redraw per frame, skipped when nothing visible changed — but never a view with focus or timers
  // in it (the thread's composer follows along live, or the call being placed).
  const onWorkers = () => {
    if (view.t === 'calling') return;
    if (view.t === 'thread') return liveThread(phone, live);
    if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      if (!el.isConnected || view.t === 'calling' || view.t === 'thread') return;
      const contacts = byUrgency(store.workers.values());
      if (sig(contacts) === lastSig) return;
      draw();
    });
  };
  // A text sent (or history cleared) only renames tab counts outside Recents; Recents redraws.
  const onPhone = () => {
    if (view.t === 'thread' || view.t === 'calling') return;
    if (view.t === 'recents') return draw();
    drawTabs(store.workers.size);
  };
  const offWorkers = store.on('workers', onWorkers);
  const offPhone = store.on('smartphone', onPhone);
  const modal = openModal(el, {
    doing: '📱 checking contacts',
    onClose: () => {
      stopRing();
      clearConnect();
      clearViewTimers();
      if (raf) cancelAnimationFrame(raf);
      phone.setLive(null);
      offWorkers();
      offPhone();
    },
  });
  close.addEventListener('click', () => modal.close());
  draw();
}
