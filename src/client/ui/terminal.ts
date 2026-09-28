import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import type { Net } from '../net';
import { store } from '../state';
import { TERM_THEME } from '../world/laptop';
import { h, openModal, STATUS_LABEL, timeAgo, toast, type Modal } from './dom';
import { usageLabel, usageTitle } from './usage';
import type { ServerMsg, WorkerInfo } from '../../shared/protocol';
import { isAsleep } from '../../shared/status';
import { findLine } from '../../shared/search';
import { MONO } from '../fonts';
import { providerLabel, providerUsageNote, providerUsageState, resolvedProvider } from './provider';

/** A line to scroll to once the terminal has loaded: a search hit (see search.ts). */
export interface TerminalFind {
  /** What was searched for, as a searchKey. */
  needle: string;
  /** How many rows from the bottom of the worker's terminal the line was. */
  fromEnd: number;
}

/** How long someone shows as typing after the last word from their keyboard (they send one about every second). */
const TYPING_SHOWS_MS = 2500;

/** "Sam is typing…", "Sam and Ada are typing…", "Sam and 2 others are typing…". */
function typingLine(names: string[]): string {
  if (names.length === 1) return `${names[0]} is typing…`;
  if (names.length === 2) return `${names[0]} and ${names[1]} are typing…`;
  return `${names[0]} and ${names.length - 1} others are typing…`;
}

/** Up to two letters for someone's face: "Sam" -> "S", "Ada Lovelace" -> "AL". */
function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const first = (w: string | undefined) => (w ? Array.from(w)[0].toUpperCase() : '');
  return first(words[0]) + (words.length > 1 ? first(words[words.length - 1]) : '') || '?';
}

let current: { workerId: string; modal: Modal; find(f: TerminalFind): void } | null = null;
const listeners = new Set<(msg: ServerMsg) => void>();

/** Main feeds every server message through here so open terminals can pick theirs. */
export function routeTerminalMessage(msg: ServerMsg) {
  listeners.forEach((fn) => fn(msg));
}

export function openTerminalFor(): string | null {
  return current?.workerId ?? null;
}

export function openTerminal(net: Net, workerId: string, onChanges?: () => void, find?: TerminalFind) {
  if (current?.workerId === workerId) {
    if (find) current.find(find);
    return;
  }
  current?.modal.close();
  const info = store.workers.get(workerId);
  if (!info) return;

  const dot = h('span.dot', { style: `background:${info.color}` });
  const title = h('h2', {}, info.kind === 'agent' ? `${providerLabel(info.provider, store.project)} · ${info.name}` : info.name);
  const pill = h('span.pill', {}, '');
  const cost = h('span.cost', {});
  const viewers = h('div.viewers', {});
  const modelsBtn = h('button.btn', {
    type: 'button',
    title: 'OpenCode models: Ctrl+X then M (use /models if custom bindings override it)',
    'aria-label': 'OpenCode models',
  }, '🧠 Models');
  const typed = h('span.typed', {});
  const changesBtn = h('button.btn', { type: 'button', title: 'What this worker changed: files, diff, commit, open a PR (C at the desk)' }, '🌿 Changes');
  const closeBtn = h('button.btn.close', { title: 'Leave terminal (Esc) · Ctrl+[ sends Esc to the terminal', 'aria-label': 'Close' }, '✕');
  const host = h('div.term-host');
  const el = h('div.modal.term', { role: 'dialog', 'aria-label': `${info.name} terminal` }, h('header', {}, dot, title, pill, cost, viewers, typed, modelsBtn, onChanges ? changesBtn : null, closeBtn), host);

  const term = new Terminal({
    fontFamily: MONO,
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

  /** Who else is typing here right now (PeerInfo ids), until when. */
  const typing = new Map<string, number>();
  /** The viewers' faces, and who's typing (or who typed last, once nobody is). */
  const renderPresence = (w: WorkerInfo) => {
    const now = Date.now();
    for (const [id, until] of typing) if (until <= now || !w.viewerIds.includes(id)) typing.delete(id);
    const people = viewersOf(w);
    viewers.replaceChildren(
      ...people.map((v) =>
        h(
          'span.avatar',
          { class: v.typing ? 'typing' : '', style: `background:${v.color}`, title: `${v.name}${v.you ? ' (you)' : ''}${v.typing ? ' · typing' : ''}` },
          initials(v.name),
        ),
      ),
    );
    viewers.title = people.length ? `In this terminal: ${people.map((v) => (v.you ? `${v.name} (you)` : v.name)).join(', ')}` : '';
    const typists = people.filter((v) => v.typing && !v.you).map((v) => v.name);
    typed.classList.toggle('now', typists.length > 0);
    if (typists.length) {
      typed.textContent = `✍️ ${typingLine(typists)}`;
      typed.title = '';
    } else {
      typed.textContent = w.lastInput ? `⌨️ ${w.lastInput.by}` : '';
      typed.title = w.lastInput ? `${w.lastInput.by} typed here last, ${timeAgo(w.lastInput.at)}` : '';
    }
  };
  /** Everyone in the terminal, one face per person however many windows they have it open in, you first. */
  const viewersOf = (w: WorkerInfo) => {
    const byName = new Map<string, { name: string; color: string; you: boolean; typing: boolean }>();
    for (const id of w.viewerIds) {
      const p = store.peers.get(id);
      if (!p) continue;
      const v = byName.get(p.name) ?? { name: p.name, color: p.color, you: false, typing: false };
      v.you ||= id === store.you;
      v.typing ||= typing.has(id);
      byName.set(p.name, v);
    }
    return [...byName.values()].sort((a, b) => Number(b.you) - Number(a.you));
  };
  // Typing stops showing a couple of seconds after the last keystroke.
  const typingTimer = setInterval(() => {
    const w = store.workers.get(workerId);
    if (w && typing.size) renderPresence(w);
  }, 500);
  /** Tells the others here you're typing, about once a second while you are. */
  let typingSentAt = 0;
  const sayTyping = () => {
    const now = Date.now();
    if (now - typingSentAt < 1000) return;
    typingSentAt = now;
    net.send({ t: 'term.typing', workerId });
  };

  const refresh = () => {
    const w = store.workers.get(workerId);
    if (!w) {
      modal.close();
      return;
    }
    title.textContent = [w.kind === 'agent' ? providerLabel(w.provider, store.project) : null, w.name, w.title, w.worktree && `🌿 ${w.worktree.branch}`].filter(Boolean).join(' · ');
    pill.className = `pill ${w.status}`;
    pill.textContent = STATUS_LABEL[w.status] ?? w.status;
    const workerProvider = w.kind === 'agent' ? resolvedProvider(w.provider, store.project) : undefined;
    const usageState = w.kind === 'agent' ? providerUsageState(w.provider, store.project, w.usage) : undefined;
    cost.textContent = w.kind !== 'agent' ? '' : usageState === 'tracked' && w.usage ? usageLabel(w.usage, workerProvider) : workerProvider === 'opencode' && usageState === 'waiting' ? 'waiting for metrics' : workerProvider === 'codex' && usageState === 'waiting' ? 'waiting for first report' : usageState === 'untracked' ? 'usage untracked' : '';
    cost.title = w.kind === 'agent' && w.usage ? usageTitle(w.usage, workerProvider) : w.kind === 'agent' ? providerUsageNote(workerProvider!) : '';
    renderPresence(w);
    const openCode = w.kind === 'agent' && resolvedProvider(w.provider, store.project) === 'opencode';
    modelsBtn.classList.toggle('hidden', !openCode);
    modelsBtn.toggleAttribute('disabled', !openCode || !ready || isAsleep(w.status));
    // Someone else resized the shared PTY (the latest typist wins): follow it so this view renders
    // correctly. Typing here fits the terminal back to this window and reclaims the size.
    const ptySize = `${w.cols}x${w.rows}`;
    if (ready && ptySize !== `${term.cols}x${term.rows}` && ptySize !== lastSentSize) {
      term.resize(w.cols, w.rows);
      lastSentSize = '';
    }
  };

  /** Scrolls a search hit into view and lights it up for a few seconds. */
  const jumpTo = (f: TerminalFind) => {
    const buf = term.buffer.active;
    const row = findLine(buf, f.needle, f.fromEnd);
    if (row === undefined) return toast('That line has scrolled out of the terminal since', 'warn');
    let end = row;
    while (buf.getLine(end + 1)?.isWrapped) end++;
    // A marker follows the line when the terminal reflows, which it does as the window settles.
    const marker = term.registerMarker(row - (buf.baseY + buf.cursorY));
    if (!marker) return;
    const mark = term.registerDecoration({ marker, width: term.cols, height: end - row + 1, backgroundColor: TERM_THEME.yellow, foregroundColor: TERM_THEME.background });
    const scroll = () => {
      if (marker.line < 0) return;
      // xterm scrolls from where its scrollbar is, which lags behind a resize; from the top is exact.
      term.scrollLines(-term.buffer.active.length);
      term.scrollLines(Math.max(0, marker.line - Math.floor(term.rows / 3)));
    };
    scroll();
    // The window settles its size just after it opens; stay on the line through that.
    const follow = term.onResize(() => setTimeout(scroll, 50));
    setTimeout(() => follow.dispose(), 1500);
    setTimeout(() => {
      mark?.dispose();
      marker.dispose();
    }, 8000);
  };
  let pendingFind = find;

  const onMsg = (msg: ServerMsg) => {
    if (msg.t === 'term.data' && msg.workerId === workerId) term.write(msg.data);
    else if (msg.t === 'term.typing' && msg.workerId === workerId) {
      typing.set(msg.id, Date.now() + TYPING_SHOWS_MS);
      const w = store.workers.get(workerId);
      if (w) renderPresence(w);
    } else if (msg.t === 'term.snapshot' && msg.workerId === workerId) {
      term.reset();
      term.resize(msg.cols, msg.rows);
      term.write(msg.data, () => {
        ready = true;
        sendSize();
        term.scrollToBottom();
        refresh();
        if (pendingFind) jumpTo(pendingFind);
        pendingFind = undefined;
      });
    }
  };
  listeners.add(onMsg);
  const unsub = store.on('workers', refresh);
  // A viewer's name or color can change while they're here.
  const unsubPeers = store.on('peers', () => {
    const w = store.workers.get(workerId);
    if (w) renderPresence(w);
  });
  const ro = new ResizeObserver(() => sendSize());

  const modal = openModal(el, {
    backdropCloses: true,
    doing: `💻 in ${info.name}'s terminal`,
    onClose: () => {
      listeners.delete(onMsg);
      unsub();
      unsubPeers();
      clearInterval(typingTimer);
      ro.disconnect();
      net.send({ t: 'worker.detach', workerId });
      term.dispose();
      if (current?.modal === modal) current = null;
    },
  });
  current = {
    workerId,
    modal,
    find: (f) => {
      if (ready) jumpTo(f);
      else pendingFind = f;
    },
  };
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
  // Only your own keys and pastes count as typing, not the terminal answering the program's queries.
  term.onKey(sayTyping);
  term.textarea?.addEventListener('input', sayTyping);
  term.textarea?.addEventListener('paste', sayTyping);
  modelsBtn.addEventListener('click', () => {
    if (modelsBtn.hasAttribute('disabled')) return;
    sendSize(true);
    // OpenCode's native model picker is Ctrl+X, then M. Injecting the
    // control sequence preserves any draft already in the TUI input box.
    term.input('\x18m');
    term.focus();
  });

  ro.observe(host);
  refresh();
  net.send({ t: 'worker.attach', workerId });
  setTimeout(() => term.focus(), 50);
}
