import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import type { Net } from '../net';
import { store } from '../state';
import { TERM_THEME } from '../world/laptop';
import { h, openModal, STATUS_LABEL, timeAgo, type Modal } from './dom';
import { usageLabel, usageTitle } from './usage';
import type { ServerMsg } from '../../shared/protocol';

let current: { workerId: string; modal: Modal } | null = null;
const listeners = new Set<(msg: ServerMsg) => void>();

/** Main feeds every server message through here so open terminals can pick theirs. */
export function routeTerminalMessage(msg: ServerMsg) {
  listeners.forEach((fn) => fn(msg));
}

export function openTerminalFor(): string | null {
  return current?.workerId ?? null;
}

export function openTerminal(net: Net, workerId: string, onChanges?: () => void) {
  if (current?.workerId === workerId) return;
  current?.modal.close();
  const info = store.workers.get(workerId);
  if (!info) return;

  const dot = h('span.dot', { style: `background:${info.color}` });
  const title = h('h2', {}, info.name);
  const pill = h('span.pill', {}, '');
  const cost = h('span.cost', {});
  const viewers = h('div.viewers', {});
  const typed = h('span.typed', {});
  const changesBtn = h('button.btn', { type: 'button', title: 'What this worker changed: files, diff, commit, open a PR (C at the desk)' }, '🌿 Changes');
  const closeBtn = h('button.btn.close', { title: 'Leave terminal (Esc) · Ctrl+[ sends Esc to the terminal', 'aria-label': 'Close' }, '✕');
  const host = h('div.term-host');
  const el = h('div.modal.term', { role: 'dialog', 'aria-label': `${info.name} terminal` }, h('header', {}, dot, title, pill, cost, viewers, typed, onChanges ? changesBtn : null, closeBtn), host);

  const term = new Terminal({
    fontFamily: 'ui-monospace, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace',
    fontSize: 14,
    lineHeight: 1.1,
    theme: TERM_THEME,
    cursorBlink: true,
    scrollback: 5000,
    allowProposedApi: true,
    macOptionIsMeta: true,
  });
  const fit = new FitAddon();
  term.loadAddon(fit);
  term.loadAddon(new WebLinksAddon());

  let ready = false;
  let lastSentSize = '';
  /**
   * Sizes the shared PTY to this window. Typing always claims it (latest typist wins); merely
   * opening or resizing the window only does when nobody else is watching, so a phone that is just
   * looking doesn't reflow the terminal under whoever is working.
   */
  const sendSize = (typing = false) => {
    if (!ready) return;
    if (!typing && (store.workers.get(workerId)?.viewers.length ?? 0) > 1) {
      const w = store.workers.get(workerId);
      if (w && (w.cols !== term.cols || w.rows !== term.rows)) term.resize(w.cols, w.rows);
      return;
    }
    try {
      fit.fit();
    } catch {
      return;
    }
    const key = `${term.cols}x${term.rows}`;
    const w = store.workers.get(workerId);
    if (w && (w.cols !== term.cols || w.rows !== term.rows) && key !== lastSentSize) {
      lastSentSize = key;
      net.send({ t: 'term.resize', workerId, cols: term.cols, rows: term.rows });
    }
  };

  const refresh = () => {
    const w = store.workers.get(workerId);
    if (!w) {
      modal.close();
      return;
    }
    title.textContent = [w.name, w.title, w.worktree && `🌿 ${w.worktree.branch}`].filter(Boolean).join(' · ');
    pill.className = `pill ${w.status}`;
    pill.textContent = STATUS_LABEL[w.status] ?? w.status;
    cost.textContent = w.usage?.calls ? usageLabel(w.usage) : '';
    cost.title = w.usage ? usageTitle(w.usage) : '';
    viewers.textContent = w.viewers.length ? `👀 ${w.viewers.join(', ')}` : '';
    typed.textContent = w.lastInput ? `⌨️ ${w.lastInput.by}` : '';
    typed.title = w.lastInput ? `${w.lastInput.by} typed here last, ${timeAgo(w.lastInput.at)}` : '';
    // Someone else resized the shared PTY (the latest typist wins): follow it so this view renders
    // correctly. Typing here fits the terminal back to this window and reclaims the size.
    const ptySize = `${w.cols}x${w.rows}`;
    if (ready && ptySize !== `${term.cols}x${term.rows}` && ptySize !== lastSentSize) {
      term.resize(w.cols, w.rows);
      lastSentSize = '';
    }
  };

  const onMsg = (msg: ServerMsg) => {
    if (msg.t === 'term.data' && msg.workerId === workerId) term.write(msg.data);
    else if (msg.t === 'term.snapshot' && msg.workerId === workerId) {
      term.reset();
      term.resize(msg.cols, msg.rows);
      term.write(msg.data, () => {
        ready = true;
        sendSize();
        term.scrollToBottom();
      });
    }
  };
  listeners.add(onMsg);
  const unsub = store.on('workers', refresh);
  const ro = new ResizeObserver(() => sendSize());

  const modal = openModal(el, {
    backdropCloses: true,
    onClose: () => {
      listeners.delete(onMsg);
      unsub();
      ro.disconnect();
      net.send({ t: 'worker.detach', workerId });
      term.dispose();
      if (current?.modal === modal) current = null;
    },
  });
  current = { workerId, modal };
  closeBtn.addEventListener('click', () => modal.close());
  changesBtn.addEventListener('click', () => {
    onChanges?.();
    modal.close();
  });

  term.open(host);
  term.attachCustomKeyEventHandler((e) => {
    if (e.type === 'keydown' && e.ctrlKey && e.key === ']') {
      modal.close();
      return false;
    }
    return true;
  });
  term.onData((data) => {
    sendSize(true);
    net.send({ t: 'term.input', workerId, data });
  });

  ro.observe(host);
  refresh();
  net.send({ t: 'worker.attach', workerId });
  setTimeout(() => term.focus(), 50);
}
