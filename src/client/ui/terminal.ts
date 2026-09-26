import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import type { Net } from '../net';
import { store } from '../state';
import { TERM_THEME } from '../world/laptop';
import { h, openModal, STATUS_LABEL, type Modal } from './dom';
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

export function openTerminal(net: Net, workerId: string, actions: { prompt(): void; kill(): void; resume(): void }) {
  if (current?.workerId === workerId) return;
  current?.modal.close();
  const info = store.workers.get(workerId);
  if (!info) return;

  const dot = h('span.dot', { style: `background:${info.color}` });
  const title = h('h2', {}, info.name);
  const pill = h('span.pill', {}, '');
  const viewers = h('div.viewers', {});
  const resumeBtn = h('button.btn.primary', { title: 'Resume the Claude session', onclick: () => actions.resume() }, '▶ Resume');
  const promptBtn = h('button.btn', { title: 'Send a prompt', onclick: () => actions.prompt() }, '💬 Prompt');
  const killBtn = h('button.btn.danger', { title: 'Stop this worker and free the desk', onclick: () => actions.kill() }, '🏠 Send home');
  const closeBtn = h('button.btn.close', { title: 'Leave terminal (Ctrl+])', 'aria-label': 'Close' }, '✕');
  const host = h('div.term-host');
  const footer = h('footer', {}, h('span.grow', {}, 'Everyone in the office shares this terminal · Ctrl+] to step away'), promptBtn, killBtn);
  const el = h('div.modal.term', { role: 'dialog', 'aria-label': `${info.name} terminal` }, h('header', {}, dot, title, pill, viewers, resumeBtn, closeBtn), host, footer);

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
  const sendSize = () => {
    if (!ready) return;
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
    viewers.textContent = w.viewers.length ? `👀 ${w.viewers.join(', ')}` : '';
    const running = !(w.status === 'exited' || w.status === 'offline');
    resumeBtn.classList.toggle('hidden', running || (!w.sessionId && w.kind !== 'shell'));
    resumeBtn.textContent = w.kind === 'shell' ? '▶ Restart' : '▶ Resume';
    promptBtn.disabled = !running;
    // Someone else resized the shared PTY: follow it so the screen renders correctly.
    if (ready && `${w.cols}x${w.rows}` !== `${term.cols}x${term.rows}` && document.activeElement !== term.textarea) {
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
    escCloses: false,
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

  term.open(host);
  term.attachCustomKeyEventHandler((e) => {
    if (e.type === 'keydown' && e.ctrlKey && e.key === ']') {
      modal.close();
      return false;
    }
    return true;
  });
  term.onData((data) => {
    sendSize();
    net.send({ t: 'term.input', workerId, data });
  });
  term.textarea?.addEventListener('focus', () => sendSize());
  ro.observe(host);
  refresh();
  net.send({ t: 'worker.attach', workerId });
  setTimeout(() => term.focus(), 50);
}
