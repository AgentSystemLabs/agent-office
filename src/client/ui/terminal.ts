import './terminal.css';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import type { Net } from '../net';
import { store } from '../state';
import { TERM_THEME } from './termtheme';
import { h, openModal, STATUS_LABEL, timeAgo, toast, type Modal } from './dom';
import { usageLabel, usageTitle } from './usage';
import type { ServerMsg, WorkerInfo } from '../../shared/protocol';
import { isAsleep } from '../../shared/status';
import { findLine } from '../../shared/search';
import { DROP_MAX_BYTES, droppedPaths } from '../../shared/drops';
import { engineLabel, providerUsageNote, providerUsageState, providerWaitingLabel, resolvedProvider } from './provider';
import { naturalKey } from './termkeys';
import { termTabs } from './termtabs';
import { dictateField, dictation } from './dictate';

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

/**
 * Whether the program in the terminal says Esc does something right now, like Claude's /skills
 * menu ("Esc to close") or a question ("Esc to cancel"), apart from interrupting it while it works.
 */
function screenMentionsEsc(term: Terminal): boolean {
  const buf = term.buffer.active;
  for (let y = buf.baseY; y < buf.baseY + term.rows; y++) {
    if (/\besc(ape)?\b(?!\s+(to\s+)?interrupt)/i.test(buf.getLine(y)?.translateToString(true) ?? '')) return true;
  }
  return false;
}

/** Up to two letters for someone's face: "Sam" -> "S", "Ada Lovelace" -> "AL". */
function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const first = (w: string | undefined) => (w ? Array.from(w)[0].toUpperCase() : '');
  return first(words[0]) + (words.length > 1 ? first(words[words.length - 1]) : '') || '?';
}

/** Sends a file dropped or pasted into a worker's terminal to the office; where the office keeps it. */
async function uploadDrop(workerId: string, f: File): Promise<string> {
  const name = f.name || 'That file';
  if (f.size > DROP_MAX_BYTES) throw new Error(`${name} is too big to drop into a terminal (${DROP_MAX_BYTES / 1024 / 1024} MB at most)`);
  const q = new URLSearchParams({ floor: store.floor ?? '', worker: workerId, name: f.name });
  const res = await fetch(`/api/term/drop?${q}`, { method: 'POST', headers: { 'content-type': f.type || 'application/octet-stream' }, body: f });
  const r = (await res.json().catch(() => ({}))) as { path?: string; error?: string };
  if (!res.ok || !r.path) throw new Error(r.error ?? `${name} could not be dropped into the terminal`);
  return r.path;
}

export interface TerminalOptions {
  /**
   * The keys a phone's keyboard hasn't got (1 2 3 for a menu, arrows, Enter, Tab, Esc, Ctrl+C) and a
   * box to send a prompt from, under the terminal, for the 2D view (lite.ts). The terminal doesn't
   * take the focus as it opens either, so a phone's keyboard stays down until you tap into it.
   */
  keypad?: boolean;
}

/** The keypad's keys: what each types, or a function of the terminal for the ones that depend on its mode. */
const KEYPAD: { label: string; title: string; keys: string | ((term: Terminal) => string) }[] = [
  { label: '1', title: 'Pick 1 (yes, in a permission prompt)', keys: '1' },
  { label: '2', title: 'Pick 2', keys: '2' },
  { label: '3', title: 'Pick 3', keys: '3' },
  { label: '↑', title: 'Up', keys: (t) => (t.modes.applicationCursorKeysMode ? '\x1bOA' : '\x1b[A') },
  { label: '↓', title: 'Down', keys: (t) => (t.modes.applicationCursorKeysMode ? '\x1bOB' : '\x1b[B') },
  { label: '⏎', title: 'Enter', keys: '\r' },
  { label: '⇥', title: 'Tab', keys: '\t' },
  { label: 'Esc', title: 'Esc: close a menu, or interrupt the agent', keys: '\x1b' },
  { label: '^C', title: 'Ctrl+C', keys: '\x03' },
];

let current: { workerId: string; modal: Modal; find(f: TerminalFind): void } | null = null;
const listeners = new Set<(msg: ServerMsg) => void>();

/** Main feeds every server message through here so open terminals can pick theirs. */
export function routeTerminalMessage(msg: ServerMsg) {
  listeners.forEach((fn) => fn(msg));
}

export function openTerminalFor(): string | null {
  return current?.workerId ?? null;
}

export function openTerminal(net: Net, workerId: string, onChanges?: () => void, find?: TerminalFind, opts: TerminalOptions = {}) {
  if (current?.workerId === workerId) {
    if (find) current.find(find);
    return;
  }
  current?.modal.close();
  const info = store.workers.get(workerId);
  if (!info) return;

  const dot = h('span.dot', { style: `background:${info.color}` });
  const title = h('h2', {}, info.kind === 'agent' ? `${engineLabel(info, store.project)} · ${info.name}` : info.name);
  const pill = h('span.pill', {}, '');
  const cost = h('span.cost', {});
  const viewers = h('div.viewers', {});
  const modelsBtn = h('button.btn', {
    type: 'button',
    title: 'OpenCode models: Ctrl+X then M (use /models if custom bindings override it)',
    'aria-label': 'OpenCode models',
  }, '🧠 Models');
  const typed = h('span.typed', {});
  // The Esc key leaves the terminal, so this is how Esc reaches the program: to close a menu like
  // Claude's /skills, or to interrupt it. Ctrl+[ does the same from the keyboard.
  const escBtn = h('button.btn', {
    type: 'button',
    title: 'Send Esc to the terminal (Ctrl+[): closes a menu like /skills, or interrupts the agent. The Esc key on its own leaves the terminal',
    'aria-label': 'Send Esc to the terminal',
  }, '⎋ Esc');
  const changesBtn = h('button.btn', { type: 'button', title: 'What this worker changed: files, diff, commit, open a PR (C at the desk)' }, '🌿 Changes');
  const closeBtn = h('button.btn.close', { title: 'Leave terminal (Esc or Ctrl+]) · ⎋ Esc or Ctrl+[ sends Esc to the terminal', 'aria-label': 'Close' }, '✕');
  const host = h('div.term-host', { 'data-drop': '📎 Drop screenshots or files here to put them in the terminal' });
  const keys = h('div.term-keys', { role: 'group', 'aria-label': 'Keys' });
  const say = h('input', { type: 'text', placeholder: 'Reply, or tell it what to do next…', 'aria-label': 'Prompt', enterkeyhint: 'send', autocomplete: 'off' }) as HTMLInputElement;
  const sayBtn = h('button.btn.primary', { type: 'submit' }, 'Send');
  const sayForm = h('form.term-say', {}, dictateField(say), sayBtn);
  const keypad = opts.keypad ? h('div.term-keypad', {}, keys, sayForm) : null;
  const tabs = termTabs(workerId, { host, keypad, focusTerm: () => term.focus() });
  // What you say is typed in at the terminal's cursor, as a paste, for you to read over and send (see dictate.ts).
  const mic = dictation(
    {
      off: () => !ready || isAsleep(store.workers.get(workerId)?.status ?? 'exited'),
      insert: (text) => {
        sendSize(true);
        sayTyping();
        term.paste(`${text} `);
      },
    },
    { label: 'Dictate' },
  );
  host.append(mic.live);
  // The keypad has an Esc of its own, and a 🎤 on its prompt box.
  const el = h('div.modal.term', { role: 'dialog', 'aria-label': `${info.name} terminal` }, h('header', {}, dot, title, pill, cost, viewers, typed, modelsBtn, keypad ? null : mic.button, keypad ? null : escBtn, onChanges ? changesBtn : null, closeBtn), tabs.bar, host, tabs.pages, keypad);

  const term = new Terminal({
    fontFamily: 'ui-monospace, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace',
    // A few more columns on a phone's narrow screen.
    fontSize: opts.keypad ? 12 : 14,
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
    title.textContent = [w.kind === 'agent' ? engineLabel(w, store.project) : null, w.name, w.title, w.worktree && `🌿 ${w.worktree.branch}`, w.repos?.length && `🗂️ ${[w.worktree?.path.split(/[\\/]/).pop(), ...w.repos.map((r) => r.name)].join(' + ')}`].filter(Boolean).join(' · ');
    pill.className = `pill ${w.status}`;
    pill.textContent = STATUS_LABEL[w.status] ?? w.status;
    const workerProvider = w.kind === 'agent' ? resolvedProvider(w.provider, store.project) : undefined;
    const usageState = w.kind === 'agent' ? providerUsageState(w.provider, store.project, w.usage) : undefined;
    const waiting = usageState === 'waiting' ? providerWaitingLabel(workerProvider, store.project) : '';
    cost.textContent = w.kind !== 'agent' ? '' : usageState === 'tracked' && w.usage ? usageLabel(w.usage, workerProvider) : waiting ? waiting : usageState === 'untracked' ? 'usage untracked' : '';
    cost.title = w.kind === 'agent' && w.usage ? usageTitle(w.usage, workerProvider) : w.kind === 'agent' ? providerUsageNote(workerProvider!) : '';
    renderPresence(w);
    const openCode = w.kind === 'agent' && resolvedProvider(w.provider, store.project) === 'opencode';
    modelsBtn.classList.toggle('hidden', !openCode);
    modelsBtn.toggleAttribute('disabled', !openCode || !ready || isAsleep(w.status));
    escBtn.toggleAttribute('disabled', !ready || isAsleep(w.status));
    mic.button?.toggleAttribute('disabled', !ready || isAsleep(w.status));
    for (const b of keys.children) b.toggleAttribute('disabled', !ready || isAsleep(w.status));
    sayBtn.toggleAttribute('disabled', isAsleep(w.status));
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
    onClose: (byEsc) => {
      // Leaving with Esc while the program wanted one (you were in /skills, say): say how to send it one.
      if (byEsc && ready && screenMentionsEsc(term)) toast(`Esc left the terminal. To send ${store.workers.get(workerId)?.name ?? info.name} an Esc (to close a menu), use ⎋ Esc at the top or Ctrl+[`);
      listeners.delete(onMsg);
      unsub();
      unsubPeers();
      clearInterval(typingTimer);
      ro.disconnect();
      mic.drop();
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
  const sendEsc = () => {
    sendSize(true);
    sayTyping();
    term.input('\x1b');
  };
  term.attachCustomKeyEventHandler((e) => {
    // Ctrl+Space, held: push to talk.
    if (mic.key(e)) return false;
    if (e.type === 'keydown' && e.ctrlKey && !e.altKey && !e.metaKey) {
      // By the key's place too, for keyboards where [ and ] take AltGr or are other letters (ü, å), but
      // not where that key types something else ASCII: Ctrl + + zooms in on a German keyboard.
      const at = (key: string, code: string) => e.key === key || (e.code === code && !/^[ -~]$/.test(e.key));
      if (at(']', 'BracketRight')) {
        modal.close();
        return false;
      }
      if (at('[', 'BracketLeft')) {
        e.preventDefault();
        sendEsc();
        return false;
      }
    }
    // ⌘⌫, Ctrl+⌫, Shift+Enter and friends edit the prompt the way your own terminal does (termkeys.ts).
    const natural = e.type === 'keydown' && !e.isComposing ? naturalKey(e) : undefined;
    if (natural !== undefined) {
      e.preventDefault();
      e.stopPropagation();
      sayTyping();
      term.input(natural);
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

  // Files dropped in, or a screenshot pasted, go up to the office's machine and the terminal types
  // where they are, as a terminal does with a file dragged into it: Claude Code attaches a picture.
  let uploading = 0;
  const insertFiles = async (files: File[]) => {
    if (!files.length) return;
    el.classList.toggle('uploading', ++uploading > 0);
    try {
      const paths = await Promise.all(files.map((f) => uploadDrop(workerId, f)));
      if (current?.modal !== modal) return;
      sayTyping();
      sendSize(true);
      term.paste(droppedPaths(paths));
      term.focus();
    } catch (err) {
      toast((err as Error).message, 'warn');
    } finally {
      el.classList.toggle('uploading', --uploading > 0);
    }
  };
  const hasFiles = (e: DragEvent) => !!e.dataTransfer?.types.includes('Files');
  // The whole screen is the drop zone while the terminal is open, so a near miss doesn't open the file in the browser.
  let dragDepth = 0;
  const dragEnd = () => {
    dragDepth = 0;
    el.classList.remove('dropping');
  };
  modal.backdrop.addEventListener('dragenter', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    dragDepth++;
    el.classList.add('dropping');
  });
  modal.backdrop.addEventListener('dragover', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    e.dataTransfer!.dropEffect = 'copy';
  });
  modal.backdrop.addEventListener('dragleave', (e) => {
    if (hasFiles(e) && --dragDepth <= 0) dragEnd();
  });
  modal.backdrop.addEventListener('drop', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    dragEnd();
    void insertFiles([...e.dataTransfer!.files]);
  });
  // A picture on the clipboard with no text (a screenshot) pastes like a dropped file. Caught on the
  // way down, before xterm would paste it as nothing.
  host.addEventListener(
    'paste',
    (e) => {
      const files = [...(e.clipboardData?.files ?? [])];
      if (!files.length || e.clipboardData?.getData('text/plain')) return;
      e.preventDefault();
      e.stopPropagation();
      void insertFiles(files);
    },
    true,
  );
  escBtn.addEventListener('click', () => {
    if (escBtn.hasAttribute('disabled')) return;
    sendEsc();
    term.focus();
  });
  for (const k of KEYPAD) {
    const b = h('button.btn', { type: 'button', title: k.title, 'aria-label': k.title }, k.label);
    // Not the terminal's focus: a key from here shouldn't bring up the phone's keyboard.
    b.addEventListener('pointerdown', (e) => e.preventDefault());
    b.addEventListener('click', () => {
      if (b.hasAttribute('disabled')) return;
      sendSize(true);
      sayTyping();
      term.input(typeof k.keys === 'string' ? k.keys : k.keys(term));
    });
    keys.append(b);
  }
  sayForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const prompt = say.value.trim();
    if (!prompt || sayBtn.hasAttribute('disabled')) return;
    sendSize(true);
    net.send({ t: 'worker.prompt', workerId, prompt });
    say.value = '';
  });
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
  if (!opts.keypad) setTimeout(() => term.focus(), 50);
}
